const FIRST_WAVE_ADAPTERS = [
  'trello',
  'jira_software',
  'jira_service_management',
  'asana',
  'slack',
  'github',
  'gitlab',
  'google_workspace',
  'microsoft_365',
  'linear',
  'notion',
  'monday',
  'clickup',
  'azure_devops',
  'wrike',
  'smartsheet',
  'airtable', 'todoist', 'shortcut', 'bitbucket', 'harvest'
];
const githubWorkSignalClient = require('./githubWorkSignalClient');
const gitlabWorkSignalClient = require('./gitlabWorkSignalClient');
const trelloWorkSignalClient = require('./trelloWorkSignalClient');
const jiraWorkSignalClient = require('./jiraWorkSignalClient');
const asanaWorkSignalClient = require('./asanaWorkSignalClient');
const slackWorkSignalClient = require('./slackWorkSignalClient');
const googleWorkspaceWorkSignalClient = require('./googleWorkspaceWorkSignalClient');
const microsoft365WorkSignalClient = require('./microsoft365WorkSignalClient');
const linearWorkSignalClient = require('./linearWorkSignalClient');
const notionWorkSignalClient = require('./notionWorkSignalClient');
const mondayWorkSignalClient = require('./mondayWorkSignalClient');
const clickUpWorkSignalClient = require('./clickupWorkSignalClient');
const azureDevOpsWorkSignalClient = require('./azureDevOpsWorkSignalClient');
const wrikeWorkSignalClient = require('./wrikeWorkSignalClient');
const smartsheetWorkSignalClient = require('./smartsheetWorkSignalClient');
const airtableWorkSignalClient = require('./airtableWorkSignalClient');
const todoistWorkSignalClient = require('./todoistWorkSignalClient');
const shortcutWorkSignalClient = require('./shortcutWorkSignalClient');
const bitbucketWorkSignalClient = require('./bitbucketWorkSignalClient');
const harvestWorkSignalClient = require('./harvestWorkSignalClient');

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

const gitlabAdapter = buildAdapter('gitlab', 'GitLab issue and merge request adapter', (account, item) => ({
  externalId: pick(item.externalId, item.id),
  sourceType: item.gitlabSource === 'merge_request' || item.sourceType === 'pull_request' ? 'pull_request' : 'issue',
  title: pick(item.title, item.name),
  description: '',
  status: statusFromText(item.status, item.state, item.mergedAt ? 'merged' : ''),
  priority: priorityFromText(item.priority, item.labels, item.draft ? 'draft' : ''),
  url: pick(item.url, item.webUrl, item.web_url),
  owners: userNames([...(item.assignees || []), ...(item.reviewers || []), item.author]),
  labels: labelNames(item.labels),
  dueAt: pick(item.dueAt, item.dueDate, item.milestone?.dueDate),
  providerCreatedAt: pick(item.providerCreatedAt, item.createdAt, item.created_at),
  providerUpdatedAt: pick(item.providerUpdatedAt, item.updatedAt, item.updated_at, item.closedAt, item.mergedAt),
  evidenceRefs: baseEvidence(account, item, item.gitlabSource === 'merge_request' ? 'GitLab merge request' : 'GitLab issue'),
  raw: item
}));
gitlabAdapter.capabilities.credentialBackedSync = true;
gitlabAdapter.list = async (account) => (await gitlabWorkSignalClient.fetchDelta(account, null)).records;
gitlabAdapter.fetchDelta = (account, cursor) => gitlabWorkSignalClient.fetchDelta(account, cursor);
adapters.set('gitlab', gitlabAdapter);

const googleWorkspaceAdapter = buildAdapter('google_workspace', 'Google Workspace artifact adapter', (account, item) => {
  const mime = String(item.mimeType || item.kind || '').toLowerCase();
  const sourceType = mime.includes('calendar') || item.start ? 'event'
    : mime.includes('mail') || item.threadId ? 'message'
      : 'document';
  const nativeId = pick(item.id, item.threadId, 'unknown');
  const externalId = pick(item.externalId, sourceType === 'event'
    ? `calendar:${item.calendar?.id || 'default'}:${nativeId}`
    : `drive:${nativeId}`);
  return {
    externalId,
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

const microsoft365Adapter = buildAdapter('microsoft_365', 'Microsoft 365 work item adapter', (account, item) => {
  const source = item.microsoftSource || (item.start || item.end ? 'calendar' : item.file || item.folder ? 'onedrive' : 'todo');
  const nativeId = pick(item.id, 'unknown');
  const externalId = pick(item.externalId, source === 'calendar'
    ? `calendar:${nativeId}`
    : source === 'onedrive'
      ? `onedrive:${nativeId}`
      : `todo:${item.todoList?.id || 'default'}:${nativeId}`);
  return {
    externalId,
    sourceType: source === 'calendar' ? 'event' : source === 'onedrive' ? 'document' : 'task',
    title: pick(item.title, item.subject, item.name),
    description: pick(item.description, ''),
    status: item.deleted || item.isCancelled ? 'archived' : statusFromText(item.status, item.completedDateTime ? 'completed' : ''),
    priority: priorityFromText(item.importance, item.priority, item.categories),
    url: pick(item.url, item.webUrl, item.webLink),
    owners: userNames([item.assignedTo, item.createdBy?.user, item.organizer?.emailAddress]),
    labels: labelNames(item.categories),
    dueAt: pick(item.dueAt, item.dueDateTime?.dateTime, item.end?.dateTime),
    providerCreatedAt: pick(item.providerCreatedAt, item.createdDateTime),
    providerUpdatedAt: pick(item.providerUpdatedAt, item.lastModifiedDateTime),
    evidenceRefs: baseEvidence(account, item, 'Microsoft 365 item'),
    raw: item
  };
});
microsoft365Adapter.capabilities.credentialBackedSync = true;
microsoft365Adapter.list = async (account) => (await microsoft365WorkSignalClient.fetchDelta(account, null)).records;
microsoft365Adapter.fetchDelta = (account, cursor) => microsoft365WorkSignalClient.fetchDelta(account, cursor);
adapters.set('microsoft_365', microsoft365Adapter);

const linearPriority = (value) => ({ 1: 'urgent', 2: 'high', 3: 'normal', 4: 'low' }[Number(value)] || 'unknown');
const linearStatus = (issue) => {
  const type = String(issue.state?.type || '').toLowerCase();
  if (type === 'completed') return 'done';
  if (type === 'canceled') return 'archived';
  if (type === 'started') return 'in_progress';
  if (type === 'backlog' || type === 'unstarted' || type === 'triage') return 'open';
  return statusFromText(issue.state?.name, issue.completedAt ? 'completed' : '');
};
const linearAdapter = buildAdapter('linear', 'Linear issue adapter', (account, issue) => ({
  externalId: pick(issue.externalId, issue.id, issue.identifier),
  sourceType: 'issue',
  title: pick(issue.title, issue.identifier),
  description: pick(issue.description, ''),
  status: linearStatus(issue),
  priority: priorityFromText(linearPriority(issue.priority), issue.labels?.nodes || issue.labels),
  url: pick(issue.url),
  owners: userNames(issue.assignee),
  labels: labelNames(issue.labels?.nodes || issue.labels),
  dueAt: pick(issue.dueDate),
  providerCreatedAt: pick(issue.createdAt),
  providerUpdatedAt: pick(issue.updatedAt, issue.completedAt, issue.canceledAt),
  evidenceRefs: baseEvidence(account, issue, 'Linear issue'),
  raw: issue
}));
linearAdapter.capabilities.credentialBackedSync = true;
linearAdapter.list = async (account) => (await linearWorkSignalClient.fetchDelta(account, null)).records;
linearAdapter.fetchDelta = (account, cursor) => linearWorkSignalClient.fetchDelta(account, cursor);
adapters.set('linear', linearAdapter);

const plainText = (items) => asArray(items)
  .map(item => item?.plain_text || item?.text?.content || item?.content || '')
  .join(' ')
  .replace(/\s+/g, ' ')
  .trim();
const notionTitle = (record) => {
  if (record.title) return plainText(record.title) || String(record.title);
  const property = Object.values(record.properties || {}).find(value => value?.type === 'title' || Array.isArray(value?.title));
  return plainText(property?.title) || record.id || 'Untitled Notion item';
};
const notionAdapter = buildAdapter('notion', 'Notion page and data-source adapter', (account, record) => {
  const source = record.object === 'data_source' ? 'data_source' : 'page';
  return {
    externalId: pick(record.externalId, `${source}:${record.id || 'unknown'}`),
    sourceType: 'document',
    title: notionTitle(record),
    description: '',
    status: record.in_trash || record.is_archived || record.archived ? 'archived' : 'open',
    priority: 'unknown',
    url: pick(record.url, record.public_url),
    owners: [],
    labels: compact([record.parent?.type, record.parent?.data_source_id || record.parent?.database_id]),
    providerCreatedAt: pick(record.created_time, record.createdAt),
    providerUpdatedAt: pick(record.last_edited_time, record.lastEditedTime),
    evidenceRefs: baseEvidence(account, record, source === 'data_source' ? 'Notion data source' : 'Notion page'),
    raw: record
  };
});
notionAdapter.capabilities.credentialBackedSync = true;
notionAdapter.list = async (account) => (await notionWorkSignalClient.fetchDelta(account, null)).records;
notionAdapter.fetchDelta = (account, cursor) => notionWorkSignalClient.fetchDelta(account, cursor);
adapters.set('notion', notionAdapter);

const mondayColumnText = (item) => compact((item.column_values || []).map(column => column.text));
const mondayAdapter = buildAdapter('monday', 'monday.com board item adapter', (account, item) => {
  const columnText = mondayColumnText(item);
  const people = (item.column_values || [])
    .filter(column => /people|person/i.test(String(column.type || '')))
    .flatMap(column => String(column.text || '').split(','));
  const dueAt = (item.column_values || [])
    .find(column => /date/i.test(String(column.type || '')))?.text;
  return {
    externalId: pick(item.externalId, `board:${item.board?.id || 'unknown'}:${item.id || 'unknown'}`),
    sourceType: 'task',
    title: pick(item.name, item.title),
    description: '',
    status: statusFromText(...columnText),
    priority: priorityFromText(...columnText),
    url: pick(item.url, item.board?.url),
    owners: compact(people),
    labels: compact([item.board?.name, item.group?.title]),
    dueAt,
    providerCreatedAt: pick(item.created_at, item.createdAt),
    providerUpdatedAt: pick(item.updated_at, item.updatedAt, item.board?.updated_at),
    evidenceRefs: baseEvidence(account, item, 'monday.com board item'),
    raw: item
  };
});
mondayAdapter.capabilities.credentialBackedSync = true;
mondayAdapter.list = async (account) => (await mondayWorkSignalClient.fetchDelta(account, null)).records;
mondayAdapter.fetchDelta = (account, cursor) => mondayWorkSignalClient.fetchDelta(account, cursor);
adapters.set('monday', mondayAdapter);

const clickUpPriority = (value) => ({ 1: 'critical', 2: 'high', 3: 'normal', 4: 'low' }[Number(value?.priority || value)] || 'unknown');
const clickUpAdapter = buildAdapter('clickup', 'ClickUp task adapter', (account, task) => ({
  externalId: pick(task.externalId, `workspace:${task.team?.id || 'unknown'}:task:${task.id || 'unknown'}`),
  sourceType: 'task',
  title: pick(task.name, task.title),
  description: '',
  status: statusFromText(task.status?.status, task.status?.type, task.date_done ? 'done' : ''),
  priority: priorityFromText(clickUpPriority(task.priority), task.tags),
  url: pick(task.url),
  owners: userNames(task.assignees),
  labels: compact([task.team?.name, task.space?.name, task.folder?.name, task.list?.name, ...labelNames(task.tags)]),
  dueAt: pick(task.due_date, task.dueAt),
  providerCreatedAt: pick(task.date_created, task.createdAt),
  providerUpdatedAt: pick(task.date_updated, task.date_done, task.date_closed, task.updatedAt),
  evidenceRefs: baseEvidence(account, task, 'ClickUp task'),
  raw: task
}));
clickUpAdapter.capabilities.credentialBackedSync = true;
clickUpAdapter.list = async (account) => (await clickUpWorkSignalClient.fetchDelta(account, null)).records;
clickUpAdapter.fetchDelta = (account, cursor) => clickUpWorkSignalClient.fetchDelta(account, cursor);
adapters.set('clickup', clickUpAdapter);

const azureDevOpsPriority = (value) => ({ 1: 'critical', 2: 'high', 3: 'normal', 4: 'low' }[Number(value)] || 'unknown');
const azureDevOpsStatus = (item) => {
  const status = String(item.status || '').toLowerCase();
  if (/(closed|completed|done|resolved)/.test(status) || item.closedDate) return 'done';
  if (/(active|doing|progress|started)/.test(status)) return 'in_progress';
  return statusFromText(status);
};
const azureDevOpsAdapter = buildAdapter('azure_devops', 'Azure DevOps work item adapter', (account, item) => ({
  externalId: pick(item.externalId, item.id),
  sourceType: /bug|issue/i.test(String(item.workItemType || '')) ? 'issue' : 'task',
  title: pick(item.title, item.name),
  description: '',
  status: azureDevOpsStatus(item),
  priority: priorityFromText(azureDevOpsPriority(item.priority), item.tags),
  url: pick(item.url),
  owners: userNames(item.assignee),
  labels: compact([item.project?.name, item.workItemType, item.areaPath, item.iterationPath, ...labelNames(item.tags)]),
  dueAt: pick(item.dueDate),
  providerCreatedAt: pick(item.createdDate),
  providerUpdatedAt: pick(item.changedDate, item.closedDate),
  evidenceRefs: baseEvidence(account, item, 'Azure DevOps work item'),
  raw: item
}));
azureDevOpsAdapter.capabilities.credentialBackedSync = true;
azureDevOpsAdapter.list = async (account) => (await azureDevOpsWorkSignalClient.fetchDelta(account, null)).records;
azureDevOpsAdapter.fetchDelta = (account, cursor) => azureDevOpsWorkSignalClient.fetchDelta(account, cursor);
adapters.set('azure_devops', azureDevOpsAdapter);

const wrikePriority = (value) => ({ High: 'high', Normal: 'normal', Low: 'low' }[String(value || '')] || 'unknown');
const wrikeStatus = (task) => {
  const status = String(task.status || '').toLowerCase();
  if (status === 'completed') return 'done';
  if (status === 'cancelled') return 'archived';
  if (status === 'deferred') return 'waiting';
  if (status === 'active') return 'open';
  return statusFromText(status);
};
const wrikeAdapter = buildAdapter('wrike', 'Wrike task adapter', (account, task) => ({
  externalId: pick(task.externalId, task.id),
  sourceType: 'task',
  title: pick(task.title, task.name),
  description: '',
  status: wrikeStatus(task),
  priority: priorityFromText(wrikePriority(task.importance)),
  url: pick(task.url, task.permalink),
  owners: userNames(task.responsibleIds),
  labels: compact([...(task.projectNames || []), task.status]),
  dueAt: pick(task.dates?.due, task.dates?.finish),
  providerCreatedAt: pick(task.createdDate),
  providerUpdatedAt: pick(task.updatedDate),
  evidenceRefs: baseEvidence(account, task, 'Wrike task'),
  raw: task
}));
wrikeAdapter.capabilities.credentialBackedSync = true;
wrikeAdapter.list = async (account) => (await wrikeWorkSignalClient.fetchDelta(account, null)).records;
wrikeAdapter.fetchDelta = (account, cursor) => wrikeWorkSignalClient.fetchDelta(account, cursor);
adapters.set('wrike', wrikeAdapter);

const smartsheetAdapter = buildAdapter('smartsheet', 'Smartsheet row adapter', (account, row) => ({
  externalId: pick(row.externalId, row.id),
  sourceType: 'task',
  title: pick(row.title, row.name),
  description: '',
  status: statusFromText(row.status),
  priority: priorityFromText(row.priority),
  url: pick(row.url, row.sheet?.permalink),
  owners: userNames(row.owners),
  labels: compact([row.sheet?.name, row.status]),
  dueAt: pick(row.dueAt),
  providerCreatedAt: pick(row.createdAt),
  providerUpdatedAt: pick(row.modifiedAt),
  evidenceRefs: baseEvidence(account, row, 'Smartsheet row'),
  raw: row
}));
smartsheetAdapter.capabilities.credentialBackedSync = true;
smartsheetAdapter.list = async (account) => (await smartsheetWorkSignalClient.fetchDelta(account, null)).records;
smartsheetAdapter.fetchDelta = (account, cursor) => smartsheetWorkSignalClient.fetchDelta(account, cursor);
adapters.set('smartsheet', smartsheetAdapter);

const airtableAdapter = buildAdapter('airtable', 'Airtable record adapter', (account, record) => ({
  externalId: pick(record.externalId, record.id), sourceType: 'task', title: pick(record.title, record.name), description: '',
  status: statusFromText(record.status), priority: priorityFromText(record.priority), url: pick(record.url), owners: userNames(record.owners),
  labels: compact([record.base?.name, record.table?.name, record.status]), dueAt: pick(record.dueAt), providerCreatedAt: pick(record.createdTime),
  providerUpdatedAt: pick(record.updatedTime, record.createdTime), evidenceRefs: baseEvidence(account, record, 'Airtable record'), raw: record
}));
airtableAdapter.capabilities.credentialBackedSync = true;
airtableAdapter.list = async (account) => (await airtableWorkSignalClient.fetchDelta(account, null)).records;
airtableAdapter.fetchDelta = (account, cursor) => airtableWorkSignalClient.fetchDelta(account, cursor);
adapters.set('airtable', airtableAdapter);
const todoistAdapter = buildAdapter('todoist', 'Todoist task adapter', (account, task) => ({ externalId: pick(task.id), sourceType: 'task', title: pick(task.content), description: '', status: 'open', priority: priorityFromText({ 4: 'critical', 3: 'high', 2: 'normal', 1: 'low' }[Number(task.priority)]), url: pick(task.url), owners: userNames(task.assigneeId), labels: compact([task.project?.name, task.sectionId]), dueAt: pick(task.due), providerCreatedAt: pick(task.createdAt), providerUpdatedAt: pick(task.createdAt), evidenceRefs: baseEvidence(account, task, 'Todoist task'), raw: task }));
todoistAdapter.capabilities.credentialBackedSync = true;
todoistAdapter.list = async account => (await todoistWorkSignalClient.fetchDelta(account, null)).records;
todoistAdapter.fetchDelta = (account, cursor) => todoistWorkSignalClient.fetchDelta(account, cursor);
adapters.set('todoist', todoistAdapter);
const shortcutStatus = (story) => {
  if (story.completed) return 'done';
  if (story.blocked) return 'blocked';
  return story.started ? 'in_progress' : 'open';
};
const shortcutAdapter = buildAdapter('shortcut', 'Shortcut story adapter', (account, story) => ({
  externalId: pick(story.id), sourceType: 'issue', title: pick(story.title), description: '', status: shortcutStatus(story),
  priority: priorityFromText(story.blocked ? 'blocker' : story.storyType), url: pick(story.url, story.project?.url), owners: userNames(story.ownerIds),
  labels: compact([story.project?.name, story.storyType]), dueAt: pick(story.dueAt), providerCreatedAt: pick(story.createdAt),
  providerUpdatedAt: pick(story.updatedAt, story.createdAt), evidenceRefs: baseEvidence(account, story, 'Shortcut story'), raw: story
}));
shortcutAdapter.capabilities.credentialBackedSync = true;
shortcutAdapter.list = async account => (await shortcutWorkSignalClient.fetchDelta(account, null)).records;
shortcutAdapter.fetchDelta = (account, cursor) => shortcutWorkSignalClient.fetchDelta(account, cursor);
adapters.set('shortcut', shortcutAdapter);
const bitbucketPriority = (value) => {
  const priority = String(value || '').toLowerCase();
  if (priority === 'blocker' || priority === 'critical') return 'critical';
  if (priority === 'major') return 'high';
  if (priority === 'minor' || priority === 'trivial') return 'low';
  return priorityFromText(priority);
};
const bitbucketAdapter = buildAdapter('bitbucket', 'Bitbucket work item adapter', (account, item) => ({
  externalId: pick(item.id), sourceType: pick(item.sourceType, 'issue'), title: pick(item.title), description: '',
  status: statusFromText(item.status), priority: bitbucketPriority(item.priority), url: pick(item.url, item.repository?.url), owners: userNames(item.owners),
  labels: compact([item.repository?.fullName, item.kind, item.sourceType]), providerCreatedAt: pick(item.createdAt),
  providerUpdatedAt: pick(item.updatedAt, item.createdAt), evidenceRefs: baseEvidence(account, item, 'Bitbucket work item'), raw: item
}));
bitbucketAdapter.capabilities.credentialBackedSync = true;
bitbucketAdapter.list = async account => (await bitbucketWorkSignalClient.fetchDelta(account, null)).records;
bitbucketAdapter.fetchDelta = (account, cursor) => bitbucketWorkSignalClient.fetchDelta(account, cursor);
adapters.set('bitbucket', bitbucketAdapter);

const harvestAdapter = buildAdapter('harvest', 'Harvest time-entry adapter', (account, entry) => ({
  externalId: pick(entry.externalId, entry.id),
  sourceType: 'time_entry',
  title: titleFromText([entry.project?.name || 'Untitled project', entry.task?.name || 'Tracked time'].join(' - ')),
  description: '',
  status: entry.isRunning ? 'in_progress' : 'done',
  priority: 'normal',
  url: undefined,
  owners: userNames(entry.user),
  labels: compact([entry.client?.name, entry.project?.name, entry.task?.name, entry.billable ? 'billable' : 'non-billable', entry.approvalStatus]),
  providerCreatedAt: pick(entry.createdAt),
  providerUpdatedAt: pick(entry.updatedAt, entry.createdAt),
  evidenceRefs: baseEvidence(account, entry, 'Harvest time entry'),
  raw: {
    id: entry.id,
    spentDate: entry.spentDate,
    hours: entry.hours,
    approvalStatus: entry.approvalStatus,
    isRunning: entry.isRunning === true,
    billable: entry.billable === true,
    user: entry.user,
    client: entry.client,
    project: entry.project,
    task: entry.task
  }
}));
harvestAdapter.capabilities.credentialBackedSync = true;
harvestAdapter.list = async account => (await harvestWorkSignalClient.fetchDelta(account, null)).records;
harvestAdapter.fetchDelta = (account, cursor) => harvestWorkSignalClient.fetchDelta(account, cursor);
adapters.set('harvest', harvestAdapter);

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
