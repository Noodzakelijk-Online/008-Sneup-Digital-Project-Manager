const FIRST_WAVE_ADAPTERS = [
  'trello',
  'jira_software',
  'jira_service_management',
  'asana',
  'slack',
  'github',
  'google_workspace',
  'microsoft_365'
];
const githubWorkSignalClient = require('./githubWorkSignalClient');
const trelloWorkSignalClient = require('./trelloWorkSignalClient');
const jiraWorkSignalClient = require('./jiraWorkSignalClient');
const asanaWorkSignalClient = require('./asanaWorkSignalClient');
const slackWorkSignalClient = require('./slackWorkSignalClient');
const googleWorkspaceWorkSignalClient = require('./googleWorkspaceWorkSignalClient');

const asArray = (value) => {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value === undefined || value === null || value === '') return [];
  return [value];
};

const compact = (items) => asArray(items)
  .map(item => String(item || '').trim())
  .filter(Boolean);

const pick = (...values) => values.find(value => value !== undefined && value !== null && value !== '');

const textFromDescription = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value.content)) {
    return value.content
      .flatMap(part => part.content || [])
      .map(part => part.text || '')
      .join(' ')
      .trim();
  }
  return String(value);
};

const labelNames = (labels) => compact(asArray(labels).map(label => label?.name || label?.title || label));
const userNames = (users) => compact(asArray(users).map(user =>
  user?.displayName || user?.name || user?.fullName || user?.email || user?.login || user?.username || user
));

const priorityFromText = (...values) => {
  const text = values.flatMap(asArray).map(value =>
    typeof value === 'object' ? JSON.stringify(value) : String(value || '')
  ).join(' ').toLowerCase();
  if (/(critical|blocker|urgent|p0|sev0|sev1)/.test(text)) return 'critical';
  if (/(high|important|p1|sev2)/.test(text)) return 'high';
  if (/(low|minor|p3|p4)/.test(text)) return 'low';
  if (text) return 'normal';
  return 'unknown';
};

const statusFromText = (...values) => {
  const text = values.map(value => String(value || '').toLowerCase()).join(' ');
  if (/(done|closed|resolved|complete|completed|merged|sent)/.test(text)) return 'done';
  if (/(blocked|stuck|impediment)/.test(text)) return 'blocked';
  if (/(waiting|pending|hold|review)/.test(text)) return 'waiting';
  if (/(progress|started|active|doing|open)/.test(text)) return text.includes('progress') || text.includes('started') ? 'in_progress' : 'open';
  if (/(archived|deleted|trashed)/.test(text)) return 'archived';
  return 'unknown';
};

const titleFromText = (value, fallback = 'Untitled work signal') => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return fallback;
  return text.length > 96 ? `${text.slice(0, 93)}...` : text;
};

const baseEvidence = (account, record, label) => [{
  provider: account.connectorId,
  externalId: String(pick(record.externalId, record.id, record.gid, record.key, record.ts, record.node_id, record.web_url, record.html_url, 'unknown')),
  url: pick(record.url, record.shortUrl, record.html_url, record.htmlUrl, record.permalink_url, record.permalink, record.webUrl, record.webViewLink, record.self),
  label,
  type: account.connectorId
}];

const buildAdapter = (connectorId, label, normalizer) => ({
  connectorId,
  label,
  capabilities: {
    list: true,
    fetchDelta: true,
    normalize: true,
    applyAction: false
  },
  async list(account) {
    return this.readRecords(account);
  },
  async fetchDelta(account, cursor) {
    const records = this.readRecords(account);
    return {
      records,
      nextCursor: records.length > 0 ? new Date().toISOString() : cursor || null,
      hasMore: false
    };
  },
  normalize(account, record) {
    return normalizer(account, record || {});
  },
  async applyAction() {
    const error = new Error('Work signal adapters are read-only and cannot write to external providers');
    error.statusCode = 403;
    throw error;
  },
  readRecords(account) {
    const metadata = account?.metadata || {};
    return [
      ...asArray(metadata.syncRecords),
      ...asArray(metadata.providerRecords),
      ...asArray(metadata.seedSignals)
    ];
  }
});

const adapters = new Map();

const trelloAdapter = buildAdapter('trello', 'Trello card adapter', (account, card) => {
  const labels = labelNames(card.labels);
  return {
    externalId: pick(card.externalId, card.id, card.trelloId, card.shortLink),
    sourceType: 'task',
    title: pick(card.title, card.name),
    description: pick(card.description, card.desc, ''),
    status: card.closed || card.dueComplete ? 'done' : statusFromText(card.status, card.listName),
    priority: priorityFromText(labels, card.priority),
    url: pick(card.url, card.shortUrl),
    owners: userNames(card.members || card.assignees),
    labels,
    dueAt: pick(card.dueAt, card.due),
    providerCreatedAt: pick(card.providerCreatedAt, card.createdAt),
    providerUpdatedAt: pick(card.providerUpdatedAt, card.dateLastActivity, card.updatedAt),
    evidenceRefs: baseEvidence(account, card, 'Trello card'),
    raw: card
  };
});
trelloAdapter.capabilities.credentialBackedSync = true;
trelloAdapter.list = async (account) => (await trelloWorkSignalClient.fetchDelta(account, null)).records;
trelloAdapter.fetchDelta = (account, cursor) => trelloWorkSignalClient.fetchDelta(account, cursor);
adapters.set('trello', trelloAdapter);

const normalizeJira = (account, issue) => {
  const fields = issue.fields || {};
  const issueType = String(fields.issuetype?.name || issue.issueType || '').toLowerCase();
  return {
    externalId: pick(issue.externalId, issue.key, issue.id),
    sourceType: issueType.includes('bug') ? 'issue' : 'task',
    title: pick(issue.title, issue.summary, fields.summary),
    description: textFromDescription(pick(issue.description, fields.description)),
    status: statusFromText(issue.status, fields.status?.name),
    priority: priorityFromText(issue.priority, fields.priority?.name, fields.labels),
    url: pick(issue.url, issue.self, issue.webUrl),
    owners: userNames([fields.assignee, fields.reporter, ...(issue.assignees || [])]),
    labels: labelNames(pick(issue.labels, fields.labels)),
    dueAt: pick(issue.dueAt, fields.duedate),
    providerCreatedAt: pick(issue.providerCreatedAt, fields.created, issue.createdAt),
    providerUpdatedAt: pick(issue.providerUpdatedAt, fields.updated, issue.updatedAt),
    evidenceRefs: baseEvidence(account, issue, 'Jira issue'),
    raw: issue
  };
};
const jiraSoftwareAdapter = buildAdapter('jira_software', 'Jira Software issue adapter', normalizeJira);
jiraSoftwareAdapter.capabilities.credentialBackedSync = true;
jiraSoftwareAdapter.list = async (account) => (await jiraWorkSignalClient.fetchDelta(account, null)).records;
jiraSoftwareAdapter.fetchDelta = (account, cursor) => jiraWorkSignalClient.fetchDelta(account, cursor);
adapters.set('jira_software', jiraSoftwareAdapter);

const jiraServiceManagementAdapter = buildAdapter('jira_service_management', 'Jira Service Management request adapter', normalizeJira);
jiraServiceManagementAdapter.capabilities.credentialBackedSync = true;
jiraServiceManagementAdapter.list = async (account) => (await jiraWorkSignalClient.fetchDelta(account, null)).records;
jiraServiceManagementAdapter.fetchDelta = (account, cursor) => jiraWorkSignalClient.fetchDelta(account, cursor);
adapters.set('jira_service_management', jiraServiceManagementAdapter);

const asanaAdapter = buildAdapter('asana', 'Asana task adapter', (account, task) => ({
  externalId: pick(task.externalId, task.gid, task.id),
  sourceType: 'task',
  title: pick(task.title, task.name),
  description: pick(task.description, task.notes, ''),
  status: task.completed ? 'done' : statusFromText(task.status, task.resource_subtype),
  priority: priorityFromText(task.priority, task.tags),
  url: pick(task.url, task.permalink_url),
  owners: userNames([task.assignee, ...(task.followers || [])]),
  labels: labelNames(task.tags || task.labels),
  dueAt: pick(task.dueAt, task.due_at, task.due_on),
  providerCreatedAt: pick(task.providerCreatedAt, task.created_at),
  providerUpdatedAt: pick(task.providerUpdatedAt, task.modified_at),
  evidenceRefs: baseEvidence(account, task, 'Asana task'),
  raw: task
}));
asanaAdapter.capabilities.credentialBackedSync = true;
asanaAdapter.list = async (account) => (await asanaWorkSignalClient.fetchDelta(account, null)).records;
asanaAdapter.fetchDelta = (account, cursor) => asanaWorkSignalClient.fetchDelta(account, cursor);
adapters.set('asana', asanaAdapter);

const slackAdapter = buildAdapter('slack', 'Slack message adapter', (account, message) => {
  const text = pick(message.title, message.text, message.message, '');
  return {
    externalId: pick(message.externalId, message.client_msg_id, message.ts, message.id),
    sourceType: 'message',
    title: titleFromText(text, 'Slack message'),
    description: String(text || ''),
    status: statusFromText(message.status, text),
    priority: priorityFromText(message.priority, text),
    url: pick(message.url, message.permalink),
    owners: userNames([message.user_profile, message.user_name, message.user]),
    labels: compact([message.channel_name, message.channel, ...(message.tags || [])]),
    providerCreatedAt: message.ts ? new Date(Number(message.ts) * 1000) : pick(message.createdAt),
    providerUpdatedAt: pick(message.providerUpdatedAt, message.updatedAt),
    evidenceRefs: baseEvidence(account, message, 'Slack message'),
    raw: message
  };
});
slackAdapter.capabilities.credentialBackedSync = true;
slackAdapter.list = async (account) => (await slackWorkSignalClient.fetchDelta(account, null)).records;
slackAdapter.fetchDelta = (account, cursor) => slackWorkSignalClient.fetchDelta(account, cursor);
adapters.set('slack', slackAdapter);

const githubAdapter = buildAdapter('github', 'GitHub issue and pull request adapter', (account, item) => ({
  externalId: pick(item.externalId, item.node_id, item.id, item.number),
  sourceType: item.pull_request || item.merge_commit_sha ? 'pull_request' : 'issue',
  title: pick(item.title, item.name),
  description: pick(item.description, item.body, ''),
  status: statusFromText(item.status, item.state, item.merged ? 'merged' : ''),
  priority: priorityFromText(item.priority, item.labels),
  url: pick(item.url, item.html_url, item.htmlUrl),
  owners: userNames(item.assignees || item.requested_reviewers || item.author),
  labels: labelNames(item.labels),
  dueAt: pick(item.dueAt, item.milestone?.due_on),
  providerCreatedAt: pick(item.providerCreatedAt, item.created_at),
  providerUpdatedAt: pick(item.providerUpdatedAt, item.updated_at, item.closed_at),
  evidenceRefs: baseEvidence(account, item, item.pull_request ? 'GitHub pull request' : 'GitHub issue'),
  raw: item
}));
githubAdapter.capabilities.credentialBackedSync = true;
githubAdapter.list = async (account) => (await githubWorkSignalClient.fetchDelta(account, null)).records;
githubAdapter.fetchDelta = (account, cursor) => githubWorkSignalClient.fetchDelta(account, cursor);
adapters.set('github', githubAdapter);

const googleWorkspaceAdapter = buildAdapter('google_workspace', 'Google Workspace artifact adapter', (account, item) => {
  const mime = String(item.mimeType || item.kind || '').toLowerCase();
  const sourceType = mime.includes('calendar') || item.start ? 'event'
    : mime.includes('mail') || item.threadId ? 'message'
      : 'document';
  return {
    externalId: pick(item.externalId, item.id, item.threadId),
    sourceType,
    title: pick(item.title, item.name, item.summary, item.subject),
    description: pick(item.description, item.snippet, ''),
    status: item.trashed ? 'archived' : statusFromText(item.status),
    priority: priorityFromText(item.priority, item.labels),
    url: pick(item.url, item.webViewLink, item.htmlLink),
    owners: userNames(item.owners || item.creator || item.organizer),
    labels: labelNames(pick(item.labels, item.labelIds)),
    dueAt: pick(item.dueAt, item.end?.dateTime, item.end?.date),
    providerCreatedAt: pick(item.providerCreatedAt, item.createdTime, item.created),
    providerUpdatedAt: pick(item.providerUpdatedAt, item.modifiedTime, item.updated),
    evidenceRefs: baseEvidence(account, item, 'Google Workspace item'),
    raw: item
  };
});
googleWorkspaceAdapter.capabilities.credentialBackedSync = true;
googleWorkspaceAdapter.list = async (account) => (await googleWorkspaceWorkSignalClient.fetchDelta(account, null)).records;
googleWorkspaceAdapter.fetchDelta = (account, cursor) => googleWorkspaceWorkSignalClient.fetchDelta(account, cursor);
adapters.set('google_workspace', googleWorkspaceAdapter);

adapters.set('microsoft_365', buildAdapter('microsoft_365', 'Microsoft 365 work item adapter', (account, item) => ({
  externalId: pick(item.externalId, item.id),
  sourceType: item.start || item.end ? 'event' : item.bodyPreview || item.subject ? 'message' : 'task',
  title: pick(item.title, item.subject, item.name),
  description: pick(item.description, item.bodyPreview, item.body?.content, ''),
  status: statusFromText(item.status, item.completedDateTime ? 'completed' : ''),
  priority: priorityFromText(item.importance, item.priority, item.categories),
  url: pick(item.url, item.webUrl, item.webLink),
  owners: userNames([
    item.assignedTo,
    item.createdBy?.user,
    item.organizer?.emailAddress,
    item.from?.emailAddress
  ]),
  labels: labelNames(item.categories),
  dueAt: pick(item.dueAt, item.dueDateTime?.dateTime, item.end?.dateTime),
  providerCreatedAt: pick(item.providerCreatedAt, item.createdDateTime),
  providerUpdatedAt: pick(item.providerUpdatedAt, item.lastModifiedDateTime),
  evidenceRefs: baseEvidence(account, item, 'Microsoft 365 item'),
  raw: item
})));

class WorkSignalAdapterService {
  getFirstWaveConnectorIds() {
    return [...FIRST_WAVE_ADAPTERS];
  }

  getAdapter(connectorId) {
    return adapters.get(connectorId) || null;
  }

  requireAdapter(connectorId) {
    const adapter = this.getAdapter(connectorId);
    if (!adapter) {
      const error = new Error('Connector does not have a work signal adapter yet');
      error.statusCode = 404;
      throw error;
    }
    return adapter;
  }

  listAdapters() {
    return [...adapters.values()].map(adapter => this.describeAdapter(adapter.connectorId));
  }

  describeAdapter(connectorId) {
    const adapter = this.requireAdapter(connectorId);
    return {
      connectorId: adapter.connectorId,
      label: adapter.label,
      capabilities: adapter.capabilities,
      safeWritePolicy: 'Read-only adapter: external provider writes are blocked; actions must go through Sneup approvals.',
      methods: ['list', 'fetchDelta', 'normalize', 'applyAction']
    };
  }

  async list(account) {
    return this.requireAdapter(account.connectorId).list(account);
  }

  async fetchDelta(account, cursor) {
    return this.requireAdapter(account.connectorId).fetchDelta(account, cursor);
  }

  normalize(account, record) {
    return this.requireAdapter(account.connectorId).normalize(account, record);
  }

  async applyAction(account, action) {
    return this.requireAdapter(account.connectorId).applyAction(account, action);
  }
}

module.exports = new WorkSignalAdapterService();
