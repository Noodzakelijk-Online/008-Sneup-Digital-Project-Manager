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
  'azure_devops', 'workfront', 'servicenow',
  'wrike',
  'smartsheet',
  'airtable', 'todoist', 'shortcut', 'bitbucket', 'harvest', 'coda', 'teamwork', 'basecamp', 'redmine', 'microsoft_planner', 'youtrack', 'taiga', 'backlog', 'freedcamp', 'meistertask', 'aha', 'productboard', 'toggl_track', 'clockify', 'float', 'resource_guru', 'sentry', 'pagerduty', 'statuspage', 'rest_api_generic', 'datadog', 'zendesk', 'freshdesk', 'pipedrive', 'hubspot', 'typeform', 'salesforce', 'zoom', 'miro', 'dropbox', 'calendly', 'teams', 'google_chat', 'figma', 'confluence', 'box', 'rally', 'gmail', 'outlook', 'podio', 'intercom', 'webex', 'discord', 'mattermost'
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
const codaWorkSignalClient = require('./codaWorkSignalClient');
const teamworkWorkSignalClient = require('./teamworkWorkSignalClient');
const basecampWorkSignalClient = require('./basecampWorkSignalClient');
const redmineWorkSignalClient = require('./redmineWorkSignalClient');
const microsoftPlannerWorkSignalClient = require('./microsoftPlannerWorkSignalClient');
const youTrackWorkSignalClient = require('./youTrackWorkSignalClient');
const taigaWorkSignalClient = require('./taigaWorkSignalClient');
const backlogWorkSignalClient = require('./backlogWorkSignalClient');
const freedcampWorkSignalClient = require('./freedcampWorkSignalClient');
const meisterTaskWorkSignalClient = require('./meisterTaskWorkSignalClient');
const ahaWorkSignalClient = require('./ahaWorkSignalClient');
const productboardWorkSignalClient = require('./productboardWorkSignalClient');
const togglTrackWorkSignalClient = require('./togglTrackWorkSignalClient');
const clockifyWorkSignalClient = require('./clockifyWorkSignalClient');
const floatWorkSignalClient = require('./floatWorkSignalClient');
const resourceGuruWorkSignalClient = require('./resourceGuruWorkSignalClient');
const sentryWorkSignalClient = require('./sentryWorkSignalClient');
const pagerDutyWorkSignalClient = require('./pagerDutyWorkSignalClient');
const statuspageWorkSignalClient = require('./statuspageWorkSignalClient');
const genericRestApiWorkSignalClient = require('./genericRestApiWorkSignalClient');
const datadogWorkSignalClient = require('./datadogWorkSignalClient');
const zendeskWorkSignalClient = require('./zendeskWorkSignalClient');
const freshdeskWorkSignalClient = require('./freshdeskWorkSignalClient');
const pipedriveWorkSignalClient = require('./pipedriveWorkSignalClient');
const hubSpotWorkSignalClient = require('./hubSpotWorkSignalClient');
const typeformWorkSignalClient = require('./typeformWorkSignalClient');
const salesforceWorkSignalClient = require('./salesforceWorkSignalClient');
const zoomWorkSignalClient = require('./zoomWorkSignalClient');
const miroWorkSignalClient = require('./miroWorkSignalClient');
const dropboxWorkSignalClient = require('./dropboxWorkSignalClient');
const calendlyWorkSignalClient = require('./calendlyWorkSignalClient');
const teamsWorkSignalClient = require('./teamsWorkSignalClient');
const googleChatWorkSignalClient = require('./googleChatWorkSignalClient');
const figmaWorkSignalClient = require('./figmaWorkSignalClient');
const confluenceWorkSignalClient = require('./confluenceWorkSignalClient');
const boxWorkSignalClient = require('./boxWorkSignalClient');
const podioWorkSignalClient = require('./podioWorkSignalClient');
const intercomWorkSignalClient = require('./intercomWorkSignalClient');
const webexWorkSignalClient = require('./webexWorkSignalClient');
const discordWorkSignalClient = require('./discordWorkSignalClient');
const mattermostWorkSignalClient = require('./mattermostWorkSignalClient');
const workfrontWorkSignalClient = require('./workfrontWorkSignalClient');
const serviceNowWorkSignalClient = require('./serviceNowWorkSignalClient');
const rallyWorkSignalClient = require('./rallyWorkSignalClient');
const gmailWorkSignalClient = require('./gmailWorkSignalClient');
const outlookWorkSignalClient = require('./outlookWorkSignalClient');

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

const codaAdapter = buildAdapter('coda', 'Coda allowlisted table metadata adapter', (account, table) => ({
  externalId: pick(table.externalId, table.id),
  sourceType: 'document',
  title: titleFromText(table.name, 'Coda table'),
  description: '',
  status: 'open',
  priority: 'normal',
  url: pick(table.url, table.browserLink),
  owners: [],
  labels: compact(['coda_table', table.documentId, table.tableType]),
  providerCreatedAt: pick(table.createdAt),
  providerUpdatedAt: pick(table.updatedAt, table.createdAt),
  evidenceRefs: baseEvidence(account, table, 'Coda table metadata'),
  raw: {
    id: table.id,
    documentId: table.documentId,
    tableId: table.tableId,
    name: table.name,
    tableType: table.tableType,
    rowCount: table.rowCount,
    browserLink: table.browserLink,
    createdAt: table.createdAt,
    updatedAt: table.updatedAt
  }
}));
codaAdapter.capabilities.credentialBackedSync = true;
codaAdapter.list = async account => (await codaWorkSignalClient.fetchDelta(account, null)).records;
codaAdapter.fetchDelta = (account, cursor) => codaWorkSignalClient.fetchDelta(account, cursor);
adapters.set('coda', codaAdapter);

const teamworkStatus = (item) => {
  const status = String(item.status || '').toLowerCase();
  if (/(complete|closed|done)/.test(status) || item.completedAt) return 'done';
  if (/(progress|started|active)/.test(status)) return 'in_progress';
  if (/(late|overdue|blocked)/.test(status)) return 'blocked';
  return statusFromText(status);
};
const teamworkAdapter = buildAdapter('teamwork', 'Teamwork project and task metadata adapter', (account, item) => ({
  externalId: pick(item.externalId, item.id),
  sourceType: pick(item.sourceType, 'task'),
  title: titleFromText(item.name, 'Teamwork work item'),
  description: '',
  status: teamworkStatus(item),
  priority: priorityFromText(item.priority, item.status),
  url: undefined,
  owners: [],
  labels: compact(['teamwork', item.sourceType, item.projectId ? `project:${item.projectId}` : undefined, item.tasklistId ? `tasklist:${item.tasklistId}` : undefined, item.status]),
  dueAt: pick(item.dueAt),
  providerCreatedAt: pick(item.createdAt),
  providerUpdatedAt: pick(item.updatedAt, item.completedAt, item.createdAt),
  evidenceRefs: baseEvidence(account, item, 'Teamwork metadata'),
  raw: {
    id: item.id,
    sourceType: item.sourceType,
    projectId: item.projectId,
    taskId: item.taskId,
    tasklistId: item.tasklistId,
    parentTaskId: item.parentTaskId,
    name: item.name,
    status: item.status,
    priority: item.priority,
    startAt: item.startAt,
    dueAt: item.dueAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    completedAt: item.completedAt
  }
}));
teamworkAdapter.capabilities.credentialBackedSync = true;
teamworkAdapter.list = async account => (await teamworkWorkSignalClient.fetchDelta(account, null)).records;
teamworkAdapter.fetchDelta = (account, cursor) => teamworkWorkSignalClient.fetchDelta(account, cursor);
adapters.set('teamwork', teamworkAdapter);

const basecampStatus = (item) => item.completedAt || item.status === 'completed' ? 'done' : statusFromText(item.status);
const basecampAdapter = buildAdapter('basecamp', 'Basecamp project and to-do metadata adapter', (account, item) => ({
  externalId: pick(item.externalId, item.id),
  sourceType: pick(item.sourceType, 'todo'),
  title: titleFromText(item.name, 'Basecamp work item'),
  description: '',
  status: basecampStatus(item),
  priority: priorityFromText(item.priority, item.status),
  url: undefined,
  owners: [],
  labels: compact(['basecamp', item.sourceType, item.projectId ? `project:${item.projectId}` : undefined, item.todoListId ? `todo_list:${item.todoListId}` : undefined, item.status]),
  dueAt: pick(item.dueAt),
  providerCreatedAt: pick(item.createdAt),
  providerUpdatedAt: pick(item.updatedAt, item.completedAt, item.createdAt),
  evidenceRefs: baseEvidence(account, item, 'Basecamp metadata'),
  raw: {
    id: item.id, sourceType: item.sourceType, projectId: item.projectId, todoId: item.todoId,
    todoListId: item.todoListId, name: item.name, status: item.status, dueAt: item.dueAt,
    createdAt: item.createdAt, updatedAt: item.updatedAt, completedAt: item.completedAt
  }
}));
basecampAdapter.capabilities.credentialBackedSync = true;
basecampAdapter.list = async account => (await basecampWorkSignalClient.fetchDelta(account, null)).records;
basecampAdapter.fetchDelta = (account, cursor) => basecampWorkSignalClient.fetchDelta(account, cursor);
adapters.set('basecamp', basecampAdapter);

const redmineStatus = (item) => {
  const status = String(item.status || '').toLowerCase();
  if (/(closed|resolved|rejected)/.test(status)) return 'done';
  if (/(blocked|waiting)/.test(status)) return 'blocked';
  if (/(assigned|progress|started|active)/.test(status)) return 'in_progress';
  return statusFromText(status);
};
const redminePriority = (value) => {
  const priority = String(value || '').toLowerCase();
  if (/(immediate|urgent|critical)/.test(priority)) return 'critical';
  if (/high/.test(priority)) return 'high';
  if (/low/.test(priority)) return 'low';
  return 'normal';
};
const redmineAdapter = buildAdapter('redmine', 'Redmine project and issue metadata adapter', (account, item) => ({
  externalId: pick(item.id),
  sourceType: pick(item.sourceType, 'issue'),
  title: titleFromText(item.name, 'Redmine work item'),
  description: '',
  status: redmineStatus(item),
  priority: redminePriority(item.priority),
  url: pick(item.url),
  owners: userNames(item.owners),
  labels: compact(['redmine', item.sourceType, item.project?.name, item.tracker, item.status]),
  dueAt: pick(item.dueAt),
  providerCreatedAt: pick(item.createdAt),
  providerUpdatedAt: pick(item.updatedAt, item.createdAt),
  evidenceRefs: baseEvidence(account, item, 'Redmine metadata'),
  raw: {
    id: item.id, sourceType: item.sourceType, projectId: item.projectId, issueId: item.issueId,
    identifier: item.identifier, project: item.project, tracker: item.tracker, status: item.status, priority: item.priority,
    owners: item.owners, dueAt: item.dueAt, createdAt: item.createdAt, updatedAt: item.updatedAt, url: item.url,
    dependencies: item.dependencies, blockedBy: item.blockedBy, blocks: item.blocks, related: item.related, duplicates: item.duplicates
  }
}));
redmineAdapter.capabilities.credentialBackedSync = true;
redmineAdapter.list = async account => (await redmineWorkSignalClient.fetchDelta(account, null)).records;
redmineAdapter.fetchDelta = (account, cursor) => redmineWorkSignalClient.fetchDelta(account, cursor);
adapters.set('redmine', redmineAdapter);

const microsoftPlannerAdapter = buildAdapter('microsoft_planner', 'Microsoft Planner assigned-task metadata adapter', (account, item) => ({
  externalId: pick(item.id), sourceType: 'task', title: titleFromText(item.title, 'Microsoft Planner task'), description: '',
  status: Number(item.percentComplete) >= 100 ? 'done' : Number(item.percentComplete) > 0 ? 'in_progress' : 'open', priority: priorityFromText(item.priority), owners: [],
  labels: compact(['microsoft_planner', item.planId ? `plan:${item.planId}` : undefined, item.bucketId ? `bucket:${item.bucketId}` : undefined, Number(item.percentComplete) >= 100 ? 'completed' : undefined]),
  dueAt: pick(item.dueAt), providerCreatedAt: pick(item.createdAt), providerUpdatedAt: pick(item.updatedAt, item.completedAt, item.createdAt), evidenceRefs: baseEvidence(account, item, 'Microsoft Planner task metadata'),
  raw: { id: item.id, taskId: item.taskId, planId: item.planId, bucketId: item.bucketId, percentComplete: item.percentComplete, priority: item.priority, assigneeIds: item.assigneeIds, dueAt: item.dueAt, completedAt: item.completedAt, createdAt: item.createdAt, updatedAt: item.updatedAt }
}));
microsoftPlannerAdapter.capabilities.credentialBackedSync = true;
microsoftPlannerAdapter.list = async account => (await microsoftPlannerWorkSignalClient.fetchDelta(account, null)).records;
microsoftPlannerAdapter.fetchDelta = (account, cursor) => microsoftPlannerWorkSignalClient.fetchDelta(account, cursor);
adapters.set('microsoft_planner', microsoftPlannerAdapter);

const youTrackAdapter = buildAdapter('youtrack', 'YouTrack issue metadata adapter', (account, item) => ({
  externalId: pick(item.id), sourceType: 'issue', title: titleFromText(item.name, 'YouTrack issue'), description: '',
  status: item.resolvedAt ? 'done' : statusFromText(item.status), priority: priorityFromText(item.priority), url: pick(item.url), owners: userNames(item.owners),
  labels: compact(['youtrack', item.project?.name, item.status, item.priority]), dueAt: undefined,
  providerCreatedAt: pick(item.createdAt), providerUpdatedAt: pick(item.updatedAt, item.resolvedAt, item.createdAt), evidenceRefs: baseEvidence(account, item, 'YouTrack issue metadata'),
  raw: { id: item.id, issueId: item.issueId, issueKey: item.issueKey, project: item.project, status: item.status, priority: item.priority, owners: item.owners, resolvedAt: item.resolvedAt, createdAt: item.createdAt, updatedAt: item.updatedAt, url: item.url }
}));
youTrackAdapter.capabilities.credentialBackedSync = true;
youTrackAdapter.list = async account => (await youTrackWorkSignalClient.fetchDelta(account, null)).records;
youTrackAdapter.fetchDelta = (account, cursor) => youTrackWorkSignalClient.fetchDelta(account, cursor);
adapters.set('youtrack', youTrackAdapter);

const taigaAdapter = buildAdapter('taiga', 'Taiga project, user-story, and task metadata adapter', (account, item) => ({
  externalId: pick(item.id), sourceType: pick(item.sourceType, 'task'), title: titleFromText(item.name, 'Taiga work item'), description: '',
  status: item.closed ? 'done' : item.blocked ? 'blocked' : statusFromText(item.status), priority: 'unknown', owners: [],
  labels: compact(['taiga', item.sourceType, item.project?.name, item.status, item.blocked ? 'blocked' : undefined]), dueAt: pick(item.dueAt),
  providerCreatedAt: pick(item.createdAt), providerUpdatedAt: pick(item.updatedAt, item.createdAt), evidenceRefs: baseEvidence(account, item, 'Taiga metadata'),
  raw: { id: item.id, sourceType: item.sourceType, projectId: item.projectId, storyId: item.storyId, taskId: item.taskId, reference: item.reference, project: item.project, status: item.status, blocked: item.blocked, closed: item.closed, milestoneId: item.milestoneId, dueAt: item.dueAt, createdAt: item.createdAt, updatedAt: item.updatedAt }
}));
taigaAdapter.capabilities.credentialBackedSync = true;
taigaAdapter.list = async account => (await taigaWorkSignalClient.fetchDelta(account, null)).records;
taigaAdapter.fetchDelta = (account, cursor) => taigaWorkSignalClient.fetchDelta(account, cursor);
adapters.set('taiga', taigaAdapter);

const backlogAdapter = buildAdapter('backlog', 'Backlog project and issue metadata adapter', (account, item) => ({ externalId: pick(item.id), sourceType: pick(item.sourceType, 'issue'), title: titleFromText(item.name, 'Backlog work item'), description: '', status: statusFromText(item.status), priority: priorityFromText(item.priority), url: pick(item.url), owners: userNames(item.owners), labels: compact(['backlog', item.project?.name, item.issueType, item.status, item.priority]), dueAt: pick(item.dueAt), providerCreatedAt: pick(item.createdAt), providerUpdatedAt: pick(item.updatedAt, item.createdAt), evidenceRefs: baseEvidence(account, item, 'Backlog metadata'), raw: { id: item.id, sourceType: item.sourceType, projectId: item.projectId, issueId: item.issueId, issueKey: item.issueKey, project: item.project, status: item.status, priority: item.priority, issueType: item.issueType, owners: item.owners, dueAt: item.dueAt, createdAt: item.createdAt, updatedAt: item.updatedAt, url: item.url } }));
backlogAdapter.capabilities.credentialBackedSync = true;
backlogAdapter.list = async account => (await backlogWorkSignalClient.fetchDelta(account, null)).records;
backlogAdapter.fetchDelta = (account, cursor) => backlogWorkSignalClient.fetchDelta(account, cursor);
adapters.set('backlog', backlogAdapter);

const freedcampAdapter = buildAdapter('freedcamp', 'Freedcamp project, task, and milestone metadata adapter', (account, item) => ({ externalId: pick(item.id), sourceType: pick(item.sourceType, 'task'), title: titleFromText(item.name, 'Freedcamp work item'), description: '', status: statusFromText(item.status), priority: priorityFromText(item.priority), url: pick(item.url), owners: userNames(item.owners), labels: compact(['freedcamp', item.sourceType, item.project?.name, item.status, item.priority]), dueAt: pick(item.dueAt), providerCreatedAt: pick(item.createdAt), providerUpdatedAt: pick(item.updatedAt, item.createdAt), evidenceRefs: baseEvidence(account, item, 'Freedcamp metadata'), raw: { id: item.id, sourceType: item.sourceType, projectId: item.projectId, taskId: item.taskId, milestoneId: item.milestoneId, listId: item.listId, project: item.project, status: item.status, priority: item.priority, owners: item.owners, dueAt: item.dueAt, completedAt: item.completedAt, createdAt: item.createdAt, updatedAt: item.updatedAt, url: item.url } }));
freedcampAdapter.capabilities.credentialBackedSync = true;
freedcampAdapter.list = async account => (await freedcampWorkSignalClient.fetchDelta(account, null)).records;
freedcampAdapter.fetchDelta = (account, cursor) => freedcampWorkSignalClient.fetchDelta(account, cursor);
adapters.set('freedcamp', freedcampAdapter);

const meisterTaskAdapter = buildAdapter('meistertask', 'MeisterTask project, section, and task metadata adapter', (account, item) => ({ externalId: pick(item.id), sourceType: pick(item.sourceType, 'task'), title: titleFromText(item.name, 'MeisterTask work item'), description: '', status: statusFromText(item.status), priority: 'unknown', owners: [], labels: compact(['meistertask', item.sourceType, item.project?.name, item.section?.name, item.status]), dueAt: pick(item.dueAt), providerCreatedAt: pick(item.createdAt), providerUpdatedAt: pick(item.updatedAt, item.createdAt), evidenceRefs: baseEvidence(account, item, 'MeisterTask metadata'), raw: { id: item.id, sourceType: item.sourceType, projectId: item.projectId, sectionId: item.sectionId, taskId: item.taskId, project: item.project, section: item.section, status: item.status, assigneeId: item.assigneeId, dueAt: item.dueAt, createdAt: item.createdAt, updatedAt: item.updatedAt } }));
meisterTaskAdapter.capabilities.credentialBackedSync = true;
meisterTaskAdapter.list = async account => (await meisterTaskWorkSignalClient.fetchDelta(account, null)).records;
meisterTaskAdapter.fetchDelta = (account, cursor) => meisterTaskWorkSignalClient.fetchDelta(account, cursor);
adapters.set('meistertask', meisterTaskAdapter);

const ahaAdapter = buildAdapter('aha', 'Aha! product and feature metadata adapter', (account, item) => ({ externalId: pick(item.id), sourceType: pick(item.sourceType, 'feature'), title: titleFromText(item.name, 'Aha! work item'), description: '', status: statusFromText(item.status), priority: 'unknown', url: pick(item.url), owners: [], labels: compact(['aha', item.sourceType, item.product?.name, item.status]), dueAt: pick(item.dueAt), providerCreatedAt: pick(item.createdAt), providerUpdatedAt: pick(item.updatedAt, item.createdAt), evidenceRefs: baseEvidence(account, item, 'Aha! metadata'), raw: { id: item.id, sourceType: item.sourceType, productId: item.productId, featureId: item.featureId, reference: item.reference, product: item.product, workspaceType: item.workspaceType, status: item.status, dueAt: item.dueAt, createdAt: item.createdAt, updatedAt: item.updatedAt, url: item.url } }));
ahaAdapter.capabilities.credentialBackedSync = true;
ahaAdapter.list = async account => (await ahaWorkSignalClient.fetchDelta(account, null)).records;
ahaAdapter.fetchDelta = (account, cursor) => ahaWorkSignalClient.fetchDelta(account, cursor);
adapters.set('aha', ahaAdapter);

const productboardAdapter = buildAdapter('productboard', 'Productboard component, feature, and objective metadata adapter', (account, item) => ({ externalId: pick(item.id), sourceType: pick(item.sourceType, 'feature'), title: titleFromText(item.name, 'Productboard work item'), description: '', status: statusFromText(item.status), priority: 'unknown', owners: [], labels: compact(['productboard', item.sourceType, item.status]), dueAt: pick(item.dueAt), providerCreatedAt: pick(item.createdAt), providerUpdatedAt: pick(item.updatedAt, item.createdAt), evidenceRefs: baseEvidence(account, item, 'Productboard metadata'), raw: { id: item.id, sourceType: item.sourceType, entityId: item.entityId, status: item.status, dueAt: item.dueAt, createdAt: item.createdAt, updatedAt: item.updatedAt } }));
productboardAdapter.capabilities.credentialBackedSync = true;
productboardAdapter.list = async account => (await productboardWorkSignalClient.fetchDelta(account, null)).records;
productboardAdapter.fetchDelta = (account, cursor) => productboardWorkSignalClient.fetchDelta(account, cursor);
adapters.set('productboard', productboardAdapter);

const togglTrackAdapter = buildAdapter('toggl_track', 'Toggl Track project and utilization metadata adapter', (account, item) => ({ externalId: pick(item.id), sourceType: pick(item.sourceType, 'time_entry'), title: item.sourceType === 'project' ? titleFromText(item.name, 'Toggl Track project') : `Toggl Track entry ${item.timeEntryId || item.id}`, description: '', status: item.sourceType === 'project' ? statusFromText(item.status) : 'done', priority: 'unknown', owners: [], labels: compact(['toggl_track', item.sourceType, item.projectId ? `project:${item.projectId}` : undefined, item.status, item.billable === true ? 'billable' : undefined]), dueAt: undefined, providerCreatedAt: pick(item.createdAt, item.startedAt), providerUpdatedAt: pick(item.updatedAt, item.startedAt, item.createdAt), evidenceRefs: baseEvidence(account, item, 'Toggl Track utilization metadata'), raw: { id: item.id, sourceType: item.sourceType, projectId: item.projectId, timeEntryId: item.timeEntryId, workspaceId: item.workspaceId, status: item.status, isActive: item.isActive, startedAt: item.startedAt, stoppedAt: item.stoppedAt, durationSeconds: item.durationSeconds, billable: item.billable, createdAt: item.createdAt, updatedAt: item.updatedAt } }));
togglTrackAdapter.capabilities.credentialBackedSync = true;
togglTrackAdapter.list = async account => (await togglTrackWorkSignalClient.fetchDelta(account, null)).records;
togglTrackAdapter.fetchDelta = (account, cursor) => togglTrackWorkSignalClient.fetchDelta(account, cursor);
adapters.set('toggl_track', togglTrackAdapter);

const clockifyAdapter = buildAdapter('clockify', 'Clockify project and personal utilization metadata adapter', (account, item) => ({ externalId: pick(item.id), sourceType: pick(item.sourceType, 'time_entry'), title: item.sourceType === 'project' ? titleFromText(item.name, 'Clockify project') : `Clockify entry ${item.timeEntryId || item.id}`, description: '', status: item.sourceType === 'project' ? item.archived ? 'archived' : 'open' : 'done', priority: 'unknown', owners: [], labels: compact(['clockify', item.sourceType, item.projectId ? `project:${item.projectId}` : undefined, item.taskId ? `task:${item.taskId}` : undefined, item.billable === true ? 'billable' : undefined]), dueAt: undefined, providerCreatedAt: pick(item.startedAt), providerUpdatedAt: pick(item.stoppedAt, item.startedAt), evidenceRefs: baseEvidence(account, item, 'Clockify utilization metadata'), raw: { id: item.id, sourceType: item.sourceType, projectId: item.projectId, timeEntryId: item.timeEntryId, taskId: item.taskId, workspaceId: item.workspaceId, archived: item.archived, billable: item.billable, startedAt: item.startedAt, stoppedAt: item.stoppedAt, trackedDuration: item.trackedDuration } }));
clockifyAdapter.capabilities.credentialBackedSync = true;
clockifyAdapter.list = async account => (await clockifyWorkSignalClient.fetchDelta(account, null)).records;
clockifyAdapter.fetchDelta = (account, cursor) => clockifyWorkSignalClient.fetchDelta(account, cursor);
adapters.set('clockify', clockifyAdapter);

const floatAdapter = buildAdapter('float', 'Float project and allocation schedule metadata adapter', (account, item) => ({ externalId: pick(item.id), sourceType: pick(item.sourceType, 'allocation'), title: item.sourceType === 'project' ? titleFromText(item.name, 'Float project') : `Float allocation ${item.allocationId || item.id}`, description: '', status: item.sourceType === 'project' ? Number(item.active) === 1 ? 'open' : 'archived' : 'in_progress', priority: 'unknown', owners: [], labels: compact(['float', item.sourceType, item.projectId ? `project:${item.projectId}` : undefined, item.assigneeId ? `assignee:${item.assigneeId}` : undefined, item.status]), dueAt: pick(item.dueAt), providerCreatedAt: pick(item.createdAt, item.startedAt), providerUpdatedAt: pick(item.updatedAt, item.createdAt, item.startedAt), evidenceRefs: baseEvidence(account, item, 'Float schedule metadata'), raw: { id: item.id, sourceType: item.sourceType, projectId: item.projectId, allocationId: item.allocationId, assigneeId: item.assigneeId, active: item.active, status: item.status, startedAt: item.startedAt, dueAt: item.dueAt, scheduledHours: item.scheduledHours, createdAt: item.createdAt, updatedAt: item.updatedAt } }));
floatAdapter.capabilities.credentialBackedSync = true;
floatAdapter.list = async account => (await floatWorkSignalClient.fetchDelta(account, null)).records;
floatAdapter.fetchDelta = (account, cursor) => floatWorkSignalClient.fetchDelta(account, cursor);
adapters.set('float', floatAdapter);

const resourceGuruAdapter = buildAdapter('resource_guru', 'Resource Guru project and allocation schedule metadata adapter', (account, item) => ({ externalId: pick(item.id), sourceType: pick(item.sourceType, 'booking'), title: item.sourceType === 'project' ? titleFromText(item.name, 'Resource Guru project') : `Resource Guru booking ${item.bookingId || item.id}`, description: '', status: item.sourceType === 'project' ? item.archived ? 'archived' : 'open' : 'in_progress', priority: 'unknown', owners: [], labels: compact(['resource_guru', item.sourceType, item.projectId ? `project:${item.projectId}` : undefined, item.resourceId ? `resource:${item.resourceId}` : undefined, item.approvalState]), dueAt: pick(item.dueAt), providerCreatedAt: pick(item.createdAt, item.startedAt), providerUpdatedAt: pick(item.updatedAt, item.createdAt, item.startedAt), evidenceRefs: baseEvidence(account, item, 'Resource Guru schedule metadata'), raw: { id: item.id, sourceType: item.sourceType, projectId: item.projectId, bookingId: item.bookingId, resourceId: item.resourceId, archived: item.archived, approvalState: item.approvalState, startedAt: item.startedAt, dueAt: item.dueAt, scheduledMinutes: item.scheduledMinutes, createdAt: item.createdAt, updatedAt: item.updatedAt } }));
resourceGuruAdapter.capabilities.credentialBackedSync = true;
resourceGuruAdapter.list = async account => (await resourceGuruWorkSignalClient.fetchDelta(account, null)).records;
resourceGuruAdapter.fetchDelta = (account, cursor) => resourceGuruWorkSignalClient.fetchDelta(account, cursor);
adapters.set('resource_guru', resourceGuruAdapter);

const sentryAdapter = buildAdapter('sentry', 'Sentry project and unresolved issue metadata adapter', (account, item) => ({ externalId: pick(item.id), sourceType: pick(item.sourceType, 'issue'), title: item.sourceType === 'project' ? titleFromText(item.name, 'Sentry project') : titleFromText(item.name, 'Sentry issue'), description: '', status: item.sourceType === 'project' ? item.status || 'open' : item.status || 'unresolved', priority: priorityFromText(item.level), owners: [], labels: compact(['sentry', item.sourceType, item.projectId ? `project:${item.projectId}` : undefined, item.projectSlug ? `project:${item.projectSlug}` : undefined, item.level]), dueAt: undefined, providerCreatedAt: pick(item.createdAt, item.firstSeen), providerUpdatedAt: pick(item.updatedAt, item.lastSeen, item.firstSeen), evidenceRefs: baseEvidence(account, item, 'Sentry incident metadata'), raw: { id: item.id, sourceType: item.sourceType, projectId: item.projectId, projectSlug: item.projectSlug, slug: item.slug, status: item.status, level: item.level, firstSeen: item.firstSeen, lastSeen: item.lastSeen, eventCount: item.eventCount, affectedUsers: item.affectedUsers, createdAt: item.createdAt, updatedAt: item.updatedAt } }));
sentryAdapter.capabilities.credentialBackedSync = true;
sentryAdapter.list = async account => (await sentryWorkSignalClient.fetchDelta(account, null)).records;
sentryAdapter.fetchDelta = (account, cursor) => sentryWorkSignalClient.fetchDelta(account, cursor);
adapters.set('sentry', sentryAdapter);

const pagerDutyAdapter = buildAdapter('pagerduty', 'PagerDuty service and active incident metadata adapter', (account, item) => ({ externalId: pick(item.id), sourceType: pick(item.sourceType, 'incident'), title: item.sourceType === 'service' ? titleFromText(item.name, 'PagerDuty service') : titleFromText(item.name, 'PagerDuty incident'), description: '', status: item.status || 'triggered', priority: item.status === 'triggered' ? 'high' : 'normal', owners: [], labels: compact(['pagerduty', item.sourceType, item.serviceId ? `service:${item.serviceId}` : undefined, item.urgency]), dueAt: undefined, providerCreatedAt: pick(item.createdAt, item.lastStatusChangeAt), providerUpdatedAt: pick(item.lastStatusChangeAt, item.updatedAt, item.createdAt), evidenceRefs: baseEvidence(account, item, 'PagerDuty incident metadata'), raw: { id: item.id, sourceType: item.sourceType, serviceId: item.serviceId, serviceStatus: item.serviceStatus, status: item.status, urgency: item.urgency, createdAt: item.createdAt, updatedAt: item.updatedAt, lastStatusChangeAt: item.lastStatusChangeAt } }));
pagerDutyAdapter.capabilities.credentialBackedSync = true;
pagerDutyAdapter.list = async account => (await pagerDutyWorkSignalClient.fetchDelta(account, null)).records;
pagerDutyAdapter.fetchDelta = (account, cursor) => pagerDutyWorkSignalClient.fetchDelta(account, cursor);
adapters.set('pagerduty', pagerDutyAdapter);

const statuspageAdapter = buildAdapter('statuspage', 'Atlassian Statuspage component and incident metadata adapter', (account, item) => ({ externalId: pick(item.id), sourceType: pick(item.sourceType, 'incident'), title: item.sourceType === 'component' ? titleFromText(item.name, 'Statuspage component') : titleFromText(item.name, 'Statuspage incident'), description: '', status: item.status || 'unknown', priority: item.impact === 'critical' ? 'critical' : item.impact === 'major' ? 'high' : item.impact === 'minor' ? 'normal' : 'unknown', owners: [], labels: compact(['statuspage', item.sourceType, item.impact, item.status, ...(item.componentIds || []).slice(0, 100).map(componentId => `component:${componentId}`)]), dueAt: undefined, providerCreatedAt: pick(item.createdAt), providerUpdatedAt: pick(item.updatedAt, item.resolvedAt, item.createdAt), evidenceRefs: baseEvidence(account, item, 'Statuspage incident metadata'), raw: { id: item.id, sourceType: item.sourceType, componentId: item.componentId, incidentId: item.incidentId, componentIds: item.componentIds, status: item.status, impact: item.impact, createdAt: item.createdAt, updatedAt: item.updatedAt, resolvedAt: item.resolvedAt } }));
statuspageAdapter.capabilities.credentialBackedSync = true;
statuspageAdapter.list = async account => (await statuspageWorkSignalClient.fetchDelta(account, null)).records;
statuspageAdapter.fetchDelta = (account, cursor) => statuspageWorkSignalClient.fetchDelta(account, cursor);
adapters.set('statuspage', statuspageAdapter);

const genericRestApiAdapter = buildAdapter('rest_api_generic', 'Generic REST API bounded metadata adapter', (account, item) => ({ externalId: pick(item.id), sourceType: pick(item.sourceType, 'record'), title: titleFromText(item.name, 'External record'), description: '', status: item.status || 'unknown', priority: priorityFromText(item.priority), owners: [], labels: compact(['rest_api_generic', item.sourceType, item.status, item.priority]), dueAt: undefined, providerCreatedAt: pick(item.createdAt), providerUpdatedAt: pick(item.updatedAt, item.createdAt), evidenceRefs: baseEvidence(account, item, 'Generic REST API metadata'), raw: { id: item.id, sourceType: item.sourceType, recordId: item.recordId, status: item.status, priority: item.priority, createdAt: item.createdAt, updatedAt: item.updatedAt } }));
genericRestApiAdapter.capabilities.credentialBackedSync = true;
genericRestApiAdapter.list = async account => (await genericRestApiWorkSignalClient.fetchDelta(account, null)).records;
genericRestApiAdapter.fetchDelta = (account, cursor) => genericRestApiWorkSignalClient.fetchDelta(account, cursor);
adapters.set('rest_api_generic', genericRestApiAdapter);

const datadogAdapter = buildAdapter('datadog', 'Datadog monitor and active incident metadata adapter', (account, item) => ({ externalId: pick(item.id), sourceType: pick(item.sourceType, 'incident'), title: item.sourceType === 'monitor' ? titleFromText(item.name, 'Datadog monitor') : titleFromText(item.name, 'Datadog incident'), description: '', status: item.status || 'unknown', priority: item.severity === 'SEV-1' ? 'critical' : item.severity === 'SEV-2' ? 'high' : item.status === 'Alert' ? 'high' : item.status === 'Warn' ? 'normal' : 'unknown', owners: [], labels: compact(['datadog', item.sourceType, item.monitorType, item.severity, item.status]), dueAt: undefined, providerCreatedAt: pick(item.createdAt), providerUpdatedAt: pick(item.updatedAt, item.resolvedAt, item.createdAt), evidenceRefs: baseEvidence(account, item, 'Datadog incident metadata'), raw: { id: item.id, sourceType: item.sourceType, monitorId: item.monitorId, incidentId: item.incidentId, monitorType: item.monitorType, status: item.status, severity: item.severity, createdAt: item.createdAt, updatedAt: item.updatedAt, resolvedAt: item.resolvedAt } }));
datadogAdapter.capabilities.credentialBackedSync = true;
datadogAdapter.list = async account => (await datadogWorkSignalClient.fetchDelta(account, null)).records;
datadogAdapter.fetchDelta = (account, cursor) => datadogWorkSignalClient.fetchDelta(account, cursor);
adapters.set('datadog', datadogAdapter);

const zendeskAdapter = buildAdapter('zendesk', 'Zendesk incremental ticket metadata adapter', (account, item) => ({ externalId: pick(item.id), sourceType: pick(item.sourceType, 'ticket'), title: titleFromText(item.name, 'Zendesk ticket'), description: '', status: item.status || 'open', priority: item.priority === 'urgent' ? 'critical' : item.priority === 'high' ? 'high' : item.priority || 'unknown', owners: [], labels: compact(['zendesk', item.sourceType, item.ticketType, item.status, item.priority, item.groupId ? `group:${item.groupId}` : undefined]), dueAt: pick(item.dueAt), providerCreatedAt: pick(item.createdAt), providerUpdatedAt: pick(item.updatedAt, item.createdAt), evidenceRefs: baseEvidence(account, item, 'Zendesk ticket metadata'), raw: { id: item.id, sourceType: item.sourceType, ticketId: item.ticketId, ticketType: item.ticketType, status: item.status, priority: item.priority, groupId: item.groupId, problemId: item.problemId, blockedBy: item.blockedBy, dueAt: item.dueAt, createdAt: item.createdAt, updatedAt: item.updatedAt, url: item.url } }));
zendeskAdapter.capabilities.credentialBackedSync = true;
zendeskAdapter.list = async account => (await zendeskWorkSignalClient.fetchDelta(account, null)).records;
zendeskAdapter.fetchDelta = (account, cursor) => zendeskWorkSignalClient.fetchDelta(account, cursor);
adapters.set('zendesk', zendeskAdapter);

const freshdeskAdapter = buildAdapter('freshdesk', 'Freshdesk ticket metadata adapter', (account, item) => ({ externalId: pick(item.id), sourceType: pick(item.sourceType, 'ticket'), title: titleFromText(item.name, 'Freshdesk ticket'), description: '', status: item.status || 'open', priority: item.priority === 'urgent' ? 'critical' : item.priority === 'high' ? 'high' : item.priority || 'unknown', owners: [], labels: compact(['freshdesk', item.sourceType, item.ticketType, item.status, item.priority, item.groupId ? `group:${item.groupId}` : undefined]), dueAt: pick(item.dueAt), providerCreatedAt: pick(item.createdAt), providerUpdatedAt: pick(item.updatedAt, item.createdAt), evidenceRefs: baseEvidence(account, item, 'Freshdesk ticket metadata'), raw: { id: item.id, sourceType: item.sourceType, ticketId: item.ticketId, ticketType: item.ticketType, status: item.status, priority: item.priority, groupId: item.groupId, dueAt: item.dueAt, createdAt: item.createdAt, updatedAt: item.updatedAt } }));
freshdeskAdapter.capabilities.credentialBackedSync = true;
freshdeskAdapter.list = async account => (await freshdeskWorkSignalClient.fetchDelta(account, null)).records;
freshdeskAdapter.fetchDelta = (account, cursor) => freshdeskWorkSignalClient.fetchDelta(account, cursor);
adapters.set('freshdesk', freshdeskAdapter);

const pipedriveAdapter = buildAdapter('pipedrive', 'Pipedrive deal metadata adapter', (account, item) => ({ externalId: pick(item.id), sourceType: pick(item.sourceType, 'deal'), title: titleFromText(item.name, 'Pipedrive deal'), description: '', status: item.status || 'open', priority: 'unknown', owners: [], labels: compact(['pipedrive', item.sourceType, item.status, item.pipelineId ? `pipeline:${item.pipelineId}` : undefined, item.stageId ? `stage:${item.stageId}` : undefined]), dueAt: pick(item.dueAt), providerCreatedAt: pick(item.createdAt), providerUpdatedAt: pick(item.updatedAt, item.createdAt), evidenceRefs: baseEvidence(account, item, 'Pipedrive deal metadata'), raw: { id: item.id, sourceType: item.sourceType, dealId: item.dealId, status: item.status, pipelineId: item.pipelineId, stageId: item.stageId, dueAt: item.dueAt, createdAt: item.createdAt, updatedAt: item.updatedAt, wonAt: item.wonAt, lostAt: item.lostAt } }));
pipedriveAdapter.capabilities.credentialBackedSync = true;
pipedriveAdapter.list = async account => (await pipedriveWorkSignalClient.fetchDelta(account, null)).records;
pipedriveAdapter.fetchDelta = (account, cursor) => pipedriveWorkSignalClient.fetchDelta(account, cursor);
adapters.set('pipedrive', pipedriveAdapter);

const hubspotAdapter = buildAdapter('hubspot', 'HubSpot deal metadata adapter', (account, item) => ({ externalId: pick(item.id), sourceType: pick(item.sourceType, 'deal'), title: titleFromText(item.name, 'HubSpot deal'), description: '', status: item.status || 'open', priority: 'unknown', owners: [], labels: compact(['hubspot', item.sourceType, item.status, item.pipeline ? `pipeline:${item.pipeline}` : undefined, item.dealStage ? `stage:${item.dealStage}` : undefined]), dueAt: pick(item.dueAt), providerCreatedAt: pick(item.createdAt), providerUpdatedAt: pick(item.updatedAt, item.createdAt), evidenceRefs: baseEvidence(account, item, 'HubSpot deal metadata'), raw: { id: item.id, sourceType: item.sourceType, dealId: item.dealId, status: item.status, dealStage: item.dealStage, pipeline: item.pipeline, dueAt: item.dueAt, createdAt: item.createdAt, updatedAt: item.updatedAt, archived: item.archived } }));
hubspotAdapter.capabilities.credentialBackedSync = true;
hubspotAdapter.list = async account => (await hubSpotWorkSignalClient.fetchDelta(account, null)).records;
hubspotAdapter.fetchDelta = (account, cursor) => hubSpotWorkSignalClient.fetchDelta(account, cursor);
adapters.set('hubspot', hubspotAdapter);

const typeformAdapter = buildAdapter('typeform', 'Typeform form metadata adapter', (account, item) => ({ externalId: pick(item.id), sourceType: pick(item.sourceType, 'form'), title: titleFromText(item.name, 'Typeform intake form'), description: '', status: item.status || 'open', priority: 'unknown', owners: [], labels: compact(['typeform', item.sourceType, item.workspaceId ? `workspace:${item.workspaceId}` : undefined]), dueAt: undefined, providerCreatedAt: pick(item.createdAt), providerUpdatedAt: pick(item.updatedAt, item.createdAt), evidenceRefs: baseEvidence(account, item, 'Typeform form metadata'), raw: { id: item.id, sourceType: item.sourceType, formId: item.formId, workspaceId: item.workspaceId, createdAt: item.createdAt, updatedAt: item.updatedAt } }));
typeformAdapter.capabilities.credentialBackedSync = true;
typeformAdapter.list = async account => (await typeformWorkSignalClient.fetchDelta(account, null)).records;
typeformAdapter.fetchDelta = (account, cursor) => typeformWorkSignalClient.fetchDelta(account, cursor);
adapters.set('typeform', typeformAdapter);

const salesforceAdapter = buildAdapter('salesforce', 'Salesforce opportunity metadata adapter', (account, item) => ({ externalId: pick(item.id), sourceType: pick(item.sourceType, 'opportunity'), title: titleFromText(item.name, 'Salesforce opportunity'), description: '', status: item.status || 'open', priority: 'unknown', owners: [], labels: compact(['salesforce', item.sourceType, item.stage ? `stage:${item.stage}` : undefined]), dueAt: pick(item.dueAt), providerCreatedAt: pick(item.createdAt), providerUpdatedAt: pick(item.updatedAt, item.createdAt), evidenceRefs: baseEvidence(account, item, 'Salesforce opportunity metadata'), raw: { id: item.id, sourceType: item.sourceType, opportunityId: item.opportunityId, status: item.status, stage: item.stage, dueAt: item.dueAt, createdAt: item.createdAt, updatedAt: item.updatedAt } }));
salesforceAdapter.capabilities.credentialBackedSync = true;
salesforceAdapter.list = async account => (await salesforceWorkSignalClient.fetchDelta(account, null)).records;
salesforceAdapter.fetchDelta = (account, cursor) => salesforceWorkSignalClient.fetchDelta(account, cursor);
adapters.set('salesforce', salesforceAdapter);

const zoomAdapter = buildAdapter('zoom', 'Zoom scheduled-meeting metadata adapter', (account, item) => ({ externalId: pick(item.id), sourceType: pick(item.sourceType, 'scheduled_meeting'), title: titleFromText(item.name, 'Zoom meeting'), description: '', status: item.status || 'scheduled', priority: 'unknown', owners: [], labels: compact(['zoom', item.sourceType, item.meetingType ? `type:${item.meetingType}` : undefined]), dueAt: pick(item.startAt), providerCreatedAt: pick(item.createdAt), providerUpdatedAt: pick(item.startAt, item.createdAt), evidenceRefs: baseEvidence(account, item, 'Zoom scheduled-meeting metadata'), raw: { id: item.id, sourceType: item.sourceType, meetingId: item.meetingId, meetingType: item.meetingType, startAt: item.startAt, createdAt: item.createdAt } }));
zoomAdapter.capabilities.credentialBackedSync = true;
zoomAdapter.list = async account => (await zoomWorkSignalClient.fetchDelta(account, null)).records;
zoomAdapter.fetchDelta = (account, cursor) => zoomWorkSignalClient.fetchDelta(account, cursor);
adapters.set('zoom', zoomAdapter);

const miroAdapter = buildAdapter('miro', 'Miro board metadata adapter', (account, item) => ({ externalId: pick(item.id), sourceType: pick(item.sourceType, 'board'), title: titleFromText(item.name, 'Miro board'), description: '', status: item.status || 'open', priority: 'unknown', owners: [], labels: compact(['miro', item.sourceType, item.boardType ? `type:${item.boardType}` : undefined]), dueAt: undefined, providerCreatedAt: pick(item.createdAt), providerUpdatedAt: pick(item.updatedAt, item.createdAt), evidenceRefs: baseEvidence(account, item, 'Miro board metadata'), raw: { id: item.id, sourceType: item.sourceType, boardId: item.boardId, boardType: item.boardType, createdAt: item.createdAt, updatedAt: item.updatedAt } }));
miroAdapter.capabilities.credentialBackedSync = true;
miroAdapter.list = async account => (await miroWorkSignalClient.fetchDelta(account, null)).records;
miroAdapter.fetchDelta = (account, cursor) => miroWorkSignalClient.fetchDelta(account, cursor);
adapters.set('miro', miroAdapter);

const dropboxAdapter = buildAdapter('dropbox', 'Dropbox root file and folder metadata adapter', (account, item) => ({ externalId: pick(item.id), sourceType: pick(item.sourceType, 'file'), title: titleFromText(item.name, 'Dropbox entry'), description: '', status: item.status || 'open', priority: 'unknown', owners: [], labels: compact(['dropbox', item.sourceType]), dueAt: undefined, providerCreatedAt: pick(item.createdAt), providerUpdatedAt: pick(item.updatedAt, item.createdAt), evidenceRefs: baseEvidence(account, item, 'Dropbox metadata'), raw: { id: item.id, sourceType: item.sourceType, entryId: item.entryId, createdAt: item.createdAt, updatedAt: item.updatedAt } }));
dropboxAdapter.capabilities.credentialBackedSync = true;
dropboxAdapter.list = async account => (await dropboxWorkSignalClient.fetchDelta(account, null)).records;
dropboxAdapter.fetchDelta = (account, cursor) => dropboxWorkSignalClient.fetchDelta(account, cursor);
adapters.set('dropbox', dropboxAdapter);

const calendlyAdapter = buildAdapter('calendly', 'Calendly event-type metadata adapter', (account, item) => ({ externalId: pick(item.id), sourceType: pick(item.sourceType, 'event_type'), title: titleFromText(item.name, 'Calendly event type'), description: '', status: item.status || 'open', priority: 'unknown', owners: [], labels: compact(['calendly', item.sourceType, item.durationMinutes ? `duration:${item.durationMinutes}` : undefined]), dueAt: undefined, providerCreatedAt: pick(item.createdAt), providerUpdatedAt: pick(item.updatedAt, item.createdAt), evidenceRefs: baseEvidence(account, item, 'Calendly event-type metadata'), raw: { id: item.id, sourceType: item.sourceType, eventTypeId: item.eventTypeId, durationMinutes: item.durationMinutes, createdAt: item.createdAt, updatedAt: item.updatedAt } }));
calendlyAdapter.capabilities.credentialBackedSync = true;
calendlyAdapter.list = async account => (await calendlyWorkSignalClient.fetchDelta(account, null)).records;
calendlyAdapter.fetchDelta = (account, cursor) => calendlyWorkSignalClient.fetchDelta(account, cursor);
adapters.set('calendly', calendlyAdapter);

const teamsAdapter = buildAdapter('teams', 'Microsoft Teams joined-team and channel metadata adapter', (account, item) => ({ externalId: pick(item.id), sourceType: pick(item.sourceType, 'channel'), title: item.sourceType === 'team' ? titleFromText(item.name, 'Microsoft Team') : titleFromText(item.teamName ? `${item.teamName}: ${item.name}` : item.name, 'Microsoft Teams channel'), description: '', status: item.status || 'open', priority: 'unknown', owners: [], labels: compact(['teams', item.sourceType, item.membershipType, item.teamId ? `team:${item.teamId}` : undefined]), dueAt: undefined, providerCreatedAt: pick(item.createdAt), providerUpdatedAt: pick(item.updatedAt, item.createdAt), evidenceRefs: baseEvidence(account, item, 'Microsoft Teams metadata'), raw: { id: item.id, sourceType: item.sourceType, teamId: item.teamId, channelId: item.channelId, membershipType: item.membershipType, status: item.status, createdAt: item.createdAt } }));
teamsAdapter.capabilities.credentialBackedSync = true;
teamsAdapter.list = async account => (await teamsWorkSignalClient.fetchDelta(account, null)).records;
teamsAdapter.fetchDelta = (account, cursor) => teamsWorkSignalClient.fetchDelta(account, cursor);
adapters.set('teams', teamsAdapter);

const googleChatAdapter = buildAdapter('google_chat', 'Google Chat named-space metadata adapter', (account, item) => ({ externalId: pick(item.id), sourceType: pick(item.sourceType, 'space'), title: titleFromText(item.name, 'Google Chat space'), description: '', status: item.status || 'open', priority: 'unknown', owners: [], labels: compact(['google_chat', item.sourceType, item.spaceType]), dueAt: undefined, providerCreatedAt: pick(item.createdAt), providerUpdatedAt: pick(item.updatedAt, item.createdAt), evidenceRefs: baseEvidence(account, item, 'Google Chat space metadata'), raw: { id: item.id, sourceType: item.sourceType, spaceId: item.spaceId, spaceType: item.spaceType, status: item.status, createdAt: item.createdAt, updatedAt: item.updatedAt } }));
googleChatAdapter.capabilities.credentialBackedSync = true;
googleChatAdapter.list = async account => (await googleChatWorkSignalClient.fetchDelta(account, null)).records;
googleChatAdapter.fetchDelta = (account, cursor) => googleChatWorkSignalClient.fetchDelta(account, cursor);
adapters.set('google_chat', googleChatAdapter);

const figmaAdapter = buildAdapter('figma', 'Figma project and file metadata adapter', (account, item) => ({ externalId: pick(item.id), sourceType: pick(item.sourceType, 'file'), title: titleFromText(item.sourceType === 'file' && item.projectName ? `${item.projectName}: ${item.name}` : item.name, 'Figma work item'), description: '', status: item.status || 'open', priority: 'unknown', owners: [], labels: compact(['figma', item.sourceType, item.projectName]), dueAt: undefined, providerCreatedAt: undefined, providerUpdatedAt: pick(item.updatedAt), evidenceRefs: baseEvidence(account, item, 'Figma project/file metadata'), raw: { id: item.id, sourceType: item.sourceType, projectId: item.projectId, fileKey: item.fileKey, updatedAt: item.updatedAt } }));
figmaAdapter.capabilities.credentialBackedSync = true;
figmaAdapter.list = async account => (await figmaWorkSignalClient.fetchDelta(account, null)).records;
figmaAdapter.fetchDelta = (account, cursor) => figmaWorkSignalClient.fetchDelta(account, cursor);
adapters.set('figma', figmaAdapter);

const confluenceAdapter = buildAdapter('confluence', 'Confluence page and space metadata adapter', (account, item) => ({ externalId: pick(item.id), sourceType: pick(item.sourceType, 'page'), title: titleFromText(item.sourceType === 'page' ? `${item.spaceName ? `${item.spaceName}: ` : ''}${item.name}` : item.name, 'Confluence metadata'), description: '', status: item.status || 'current', priority: 'unknown', owners: [], labels: compact(['confluence', item.sourceType, item.spaceId ? `space:${item.spaceId}` : undefined, item.spaceType]), dueAt: undefined, providerCreatedAt: pick(item.createdAt), providerUpdatedAt: pick(item.updatedAt, item.createdAt), evidenceRefs: baseEvidence(account, item, 'Confluence page/space metadata'), raw: { id: item.id, sourceType: item.sourceType, spaceId: item.spaceId, pageId: item.pageId, parentPageId: item.parentPageId, spaceType: item.spaceType, status: item.status, createdAt: item.createdAt, updatedAt: item.updatedAt } }));
confluenceAdapter.capabilities.credentialBackedSync = true;
confluenceAdapter.list = async account => (await confluenceWorkSignalClient.fetchDelta(account, null)).records;
confluenceAdapter.fetchDelta = (account, cursor) => confluenceWorkSignalClient.fetchDelta(account, cursor);
adapters.set('confluence', confluenceAdapter);

const boxAdapter = buildAdapter('box', 'Box root file and folder metadata adapter', (account, item) => ({ externalId: pick(item.id), sourceType: pick(item.sourceType, 'file'), title: titleFromText(item.name, 'Box entry'), description: '', status: item.status || 'open', priority: 'unknown', owners: [], labels: compact(['box', item.sourceType]), dueAt: undefined, providerCreatedAt: pick(item.createdAt), providerUpdatedAt: pick(item.updatedAt, item.createdAt), evidenceRefs: baseEvidence(account, item, 'Box root metadata'), raw: { id: item.id, sourceType: item.sourceType, entryId: item.entryId, status: item.status, createdAt: item.createdAt, updatedAt: item.updatedAt } }));
boxAdapter.capabilities.credentialBackedSync = true;
boxAdapter.list = async account => (await boxWorkSignalClient.fetchDelta(account, null)).records;
boxAdapter.fetchDelta = (account, cursor) => boxWorkSignalClient.fetchDelta(account, cursor);
adapters.set('box', boxAdapter);

const rallyAdapter = buildAdapter('rally', 'Rally user-story and defect metadata adapter', (account, item) => ({ externalId: pick(item.id), sourceType: pick(item.sourceType, 'user_story'), title: titleFromText(item.name, 'Rally work item'), description: '', status: statusFromText(item.status), priority: priorityFromText(item.priority), url: undefined, owners: [], labels: compact(['rally', item.sourceType, item.formattedId]), dueAt: undefined, providerCreatedAt: pick(item.createdAt), providerUpdatedAt: pick(item.updatedAt, item.createdAt), evidenceRefs: baseEvidence(account, item, 'Rally work-item metadata'), raw: { id: item.id, sourceType: item.sourceType, objectId: item.objectId, formattedId: item.formattedId, status: item.status, priority: item.priority, planEstimate: item.planEstimate, blocked: item.blocked, createdAt: item.createdAt, updatedAt: item.updatedAt } }));
rallyAdapter.capabilities.credentialBackedSync = true;
rallyAdapter.list = async account => (await rallyWorkSignalClient.fetchDelta(account, null)).records;
rallyAdapter.fetchDelta = (account, cursor) => rallyWorkSignalClient.fetchDelta(account, cursor);
adapters.set('rally', rallyAdapter);

const gmailAdapter = buildAdapter('gmail', 'Gmail inbox-thread metadata adapter', (account, item) => ({ externalId: pick(item.id), sourceType: pick(item.sourceType, 'thread'), title: titleFromText(item.name, 'Gmail thread'), description: '', status: item.status || 'open', priority: 'unknown', url: undefined, owners: [], labels: compact(['gmail', item.sourceType, 'inbox']), dueAt: undefined, providerCreatedAt: undefined, providerUpdatedAt: pick(item.updatedAt), evidenceRefs: baseEvidence(account, item, 'Gmail inbox-thread metadata'), raw: { id: item.id, sourceType: item.sourceType, threadId: item.threadId, status: item.status, updatedAt: item.updatedAt } }));
gmailAdapter.capabilities.credentialBackedSync = true;
gmailAdapter.list = async account => (await gmailWorkSignalClient.fetchDelta(account, null)).records;
gmailAdapter.fetchDelta = (account, cursor) => gmailWorkSignalClient.fetchDelta(account, cursor);
adapters.set('gmail', gmailAdapter);

const outlookAdapter = buildAdapter('outlook', 'Outlook inbox-conversation metadata adapter', (account, item) => ({ externalId: pick(item.id), sourceType: pick(item.sourceType, 'conversation'), title: titleFromText(item.name, 'Outlook conversation'), description: '', status: item.status || 'open', priority: priorityFromText(item.priority), url: undefined, owners: [], labels: compact(['outlook', item.sourceType, 'inbox']), dueAt: undefined, providerCreatedAt: pick(item.receivedAt), providerUpdatedAt: pick(item.updatedAt, item.receivedAt), evidenceRefs: baseEvidence(account, item, 'Outlook inbox-conversation metadata'), raw: { id: item.id, sourceType: item.sourceType, conversationId: item.conversationId, status: item.status, priority: item.priority, receivedAt: item.receivedAt, updatedAt: item.updatedAt } }));
outlookAdapter.capabilities.credentialBackedSync = true;
outlookAdapter.list = async account => (await outlookWorkSignalClient.fetchDelta(account, null)).records;
outlookAdapter.fetchDelta = (account, cursor) => outlookWorkSignalClient.fetchDelta(account, cursor);
adapters.set('outlook', outlookAdapter);

const podioAdapter = buildAdapter('podio', 'Podio app item metadata adapter', (account, item) => ({ externalId: pick(item.id), sourceType: pick(item.sourceType, 'item'), title: titleFromText(item.name, 'Podio item'), description: '', status: item.status || 'open', priority: 'unknown', url: undefined, owners: [], labels: compact(['podio', item.sourceType]), dueAt: undefined, providerCreatedAt: pick(item.createdAt), providerUpdatedAt: pick(item.updatedAt, item.createdAt), evidenceRefs: baseEvidence(account, item, 'Podio app item metadata'), raw: { id: item.id, sourceType: item.sourceType, itemId: item.itemId, status: item.status, createdAt: item.createdAt, updatedAt: item.updatedAt } }));
podioAdapter.capabilities.credentialBackedSync = true;
podioAdapter.list = async account => (await podioWorkSignalClient.fetchDelta(account, null)).records;
podioAdapter.fetchDelta = (account, cursor) => podioWorkSignalClient.fetchDelta(account, cursor);
adapters.set('podio', podioAdapter);

const intercomAdapter = buildAdapter('intercom', 'Intercom conversation-list metadata adapter', (account, item) => ({ externalId: pick(item.id), sourceType: pick(item.sourceType, 'conversation'), title: titleFromText(item.name, 'Intercom conversation'), description: '', status: item.status || 'open', priority: 'unknown', url: undefined, owners: [], labels: compact(['intercom', item.sourceType]), dueAt: undefined, providerCreatedAt: pick(item.createdAt), providerUpdatedAt: pick(item.updatedAt, item.createdAt), evidenceRefs: baseEvidence(account, item, 'Intercom conversation-list metadata'), raw: { id: item.id, sourceType: item.sourceType, conversationId: item.conversationId, status: item.status, createdAt: item.createdAt, updatedAt: item.updatedAt } }));
intercomAdapter.capabilities.credentialBackedSync = true;
intercomAdapter.list = async account => (await intercomWorkSignalClient.fetchDelta(account, null)).records;
intercomAdapter.fetchDelta = (account, cursor) => intercomWorkSignalClient.fetchDelta(account, cursor);
adapters.set('intercom', intercomAdapter);

const webexAdapter = buildAdapter('webex', 'Webex meeting-list metadata adapter', (account, item) => ({ externalId: pick(item.id), sourceType: pick(item.sourceType, 'meeting'), title: titleFromText(item.name, 'Webex meeting'), description: '', status: item.status || 'scheduled', priority: 'unknown', url: undefined, owners: [], labels: compact(['webex', item.sourceType, item.meetingType]), dueAt: pick(item.startAt), providerCreatedAt: pick(item.createdAt), providerUpdatedAt: pick(item.updatedAt, item.createdAt), evidenceRefs: baseEvidence(account, item, 'Webex meeting metadata'), raw: { id: item.id, sourceType: item.sourceType, meetingId: item.meetingId, status: item.status, meetingType: item.meetingType, startAt: item.startAt, endAt: item.endAt, createdAt: item.createdAt, updatedAt: item.updatedAt } }));
webexAdapter.capabilities.credentialBackedSync = true;
webexAdapter.list = async account => (await webexWorkSignalClient.fetchDelta(account, null)).records;
webexAdapter.fetchDelta = (account, cursor) => webexWorkSignalClient.fetchDelta(account, cursor);
adapters.set('webex', webexAdapter);

const discordAdapter = buildAdapter('discord', 'Discord guild metadata adapter', (account, item) => ({ externalId: pick(item.id), sourceType: pick(item.sourceType, 'guild'), title: titleFromText(item.name, 'Discord server'), description: '', status: item.status || 'open', priority: 'unknown', url: undefined, owners: [], labels: compact(['discord', item.sourceType]), dueAt: undefined, providerCreatedAt: undefined, providerUpdatedAt: undefined, evidenceRefs: baseEvidence(account, item, 'Discord server metadata'), raw: { id: item.id, sourceType: item.sourceType, guildId: item.guildId, status: item.status } }));
discordAdapter.capabilities.credentialBackedSync = true;
discordAdapter.list = async account => (await discordWorkSignalClient.fetchDelta(account, null)).records;
discordAdapter.fetchDelta = (account, cursor) => discordWorkSignalClient.fetchDelta(account, cursor);
adapters.set('discord', discordAdapter);

const mattermostAdapter = buildAdapter('mattermost', 'Mattermost team metadata adapter', (account, item) => ({ externalId: pick(item.id), sourceType: pick(item.sourceType, 'team'), title: titleFromText(item.name, 'Mattermost team'), description: '', status: item.status || 'open', priority: 'unknown', url: undefined, owners: [], labels: compact(['mattermost', item.sourceType]), dueAt: undefined, providerCreatedAt: undefined, providerUpdatedAt: undefined, evidenceRefs: baseEvidence(account, item, 'Mattermost team metadata'), raw: { id: item.id, sourceType: item.sourceType, teamId: item.teamId, status: item.status } }));
mattermostAdapter.capabilities.credentialBackedSync = true;
mattermostAdapter.list = async account => (await mattermostWorkSignalClient.fetchDelta(account, null)).records;
mattermostAdapter.fetchDelta = (account, cursor) => mattermostWorkSignalClient.fetchDelta(account, cursor);
adapters.set('mattermost', mattermostAdapter);

const workfrontAdapter = buildAdapter('workfront', 'Adobe Workfront project metadata adapter', (account, item) => ({
  externalId: pick(item.id),
  sourceType: pick(item.sourceType, 'project'),
  title: titleFromText(item.name, 'Workfront project'),
  description: '',
  status: item.status || 'open',
  priority: item.priority || 'unknown',
  url: undefined,
  owners: [],
  labels: compact(['workfront', item.sourceType]),
  dueAt: item.plannedCompletionDate,
  providerCreatedAt: undefined,
  providerUpdatedAt: item.updatedAt,
  evidenceRefs: baseEvidence(account, item, 'Adobe Workfront project metadata'),
  raw: { id: item.id, sourceType: item.sourceType, projectId: item.projectId, status: item.status, priority: item.priority, percentComplete: item.percentComplete, plannedStartDate: item.plannedStartDate, plannedCompletionDate: item.plannedCompletionDate, updatedAt: item.updatedAt }
}));
workfrontAdapter.capabilities.credentialBackedSync = true;
workfrontAdapter.list = async account => (await workfrontWorkSignalClient.fetchDelta(account, null)).records;
workfrontAdapter.fetchDelta = (account, cursor) => workfrontWorkSignalClient.fetchDelta(account, cursor);
adapters.set('workfront', workfrontAdapter);

const serviceNowAdapter = buildAdapter('servicenow', 'ServiceNow active incident metadata adapter', (account, item) => ({
  externalId: pick(item.id),
  sourceType: pick(item.sourceType, 'incident'),
  title: titleFromText(item.name, 'ServiceNow incident'),
  description: '',
  status: item.status || 'open',
  priority: item.priority || 'unknown',
  url: undefined,
  owners: [],
  labels: compact(['servicenow', item.sourceType]),
  dueAt: item.dueAt,
  providerCreatedAt: item.openedAt,
  providerUpdatedAt: item.updatedAt,
  evidenceRefs: baseEvidence(account, item, 'ServiceNow active incident metadata'),
  raw: { id: item.id, sourceType: item.sourceType, incidentId: item.incidentId, number: item.number, status: item.status, priority: item.priority, openedAt: item.openedAt, dueAt: item.dueAt, updatedAt: item.updatedAt }
}));
serviceNowAdapter.capabilities.credentialBackedSync = true;
serviceNowAdapter.list = async account => (await serviceNowWorkSignalClient.fetchDelta(account, null)).records;
serviceNowAdapter.fetchDelta = (account, cursor) => serviceNowWorkSignalClient.fetchDelta(account, cursor);
adapters.set('servicenow', serviceNowAdapter);

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
