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
  'azure_devops', 'workfront', 'servicenow', 'zoho_projects', 'new_relic', 'tableau', 'sharepoint', 'xero', 'google_forms', 'mural', 'canva', 'quickbooks', 'power_bi', 'looker_studio', 'jira_align', 'scoro', 'plane', 'openproject', 'hive', 'clarizen', 'lucid', 'taskworld', 'taskade', 'motion', 'ganttpro', 'paymo', 'kantata', 'liquidplanner', 'productive', 'procore',
  'wrike', 'opsgenie',
  'smartsheet',
  'airtable', 'todoist', 'shortcut', 'bitbucket', 'harvest', 'everhour', 'timeneye', 'coda', 'quip', 'teamwork', 'teamgantt', 'kanbanize', 'basecamp', 'redmine', 'microsoft_planner', 'microsoft_project', 'youtrack', 'taiga', 'backlog', 'freedcamp', 'proofhub', 'meistertask', 'aha', 'productboard', 'toggl_track', 'clockify', 'float', 'resource_guru', 'sentry', 'pagerduty', 'statuspage', 'rest_api_generic', 'datadog', 'zendesk', 'freshdesk', 'pipedrive', 'hubspot', 'typeform', 'salesforce', 'survey_monkey', 'zapier', 'zoom', 'miro', 'dropbox', 'onedrive', 'google_drive', 'calendly', 'teams', 'google_chat', 'figma', 'confluence', 'box', 'rally', 'gmail', 'outlook', 'podio', 'intercom', 'webex', 'discord', 'mattermost', 'testRail', 'browserstack', 'make', 'n8n'
];
// Resolve each provider client only when its adapter performs a sync.
const lazyClient = (modulePath) => new Proxy(Object.create(null), {
  get(_target, property) {
    const client = require(modulePath);
    const value = client[property];
    return typeof value === 'function' ? value.bind(client) : value;
  }
});

const githubWorkSignalClient = lazyClient('./githubWorkSignalClient');
const gitlabWorkSignalClient = lazyClient('./gitlabWorkSignalClient');
const trelloWorkSignalClient = lazyClient('./trelloWorkSignalClient');
const jiraWorkSignalClient = lazyClient('./jiraWorkSignalClient');
const asanaWorkSignalClient = lazyClient('./asanaWorkSignalClient');
const kantataWorkSignalClient = lazyClient('./kantataWorkSignalClient');
const slackWorkSignalClient = lazyClient('./slackWorkSignalClient');
const googleWorkspaceWorkSignalClient = lazyClient('./googleWorkspaceWorkSignalClient');
const microsoft365WorkSignalClient = lazyClient('./microsoft365WorkSignalClient');
const linearWorkSignalClient = lazyClient('./linearWorkSignalClient');
const notionWorkSignalClient = lazyClient('./notionWorkSignalClient');
const mondayWorkSignalClient = lazyClient('./mondayWorkSignalClient');
const clickUpWorkSignalClient = lazyClient('./clickupWorkSignalClient');
const procoreWorkSignalClient = lazyClient('./procoreWorkSignalClient');
const liquidPlannerWorkSignalClient = lazyClient('./liquidPlannerWorkSignalClient');
const productiveWorkSignalClient = lazyClient('./productiveWorkSignalClient');
const azureDevOpsWorkSignalClient = lazyClient('./azureDevOpsWorkSignalClient');
const wrikeWorkSignalClient = lazyClient('./wrikeWorkSignalClient');
const smartsheetWorkSignalClient = lazyClient('./smartsheetWorkSignalClient');
const airtableWorkSignalClient = lazyClient('./airtableWorkSignalClient');
const todoistWorkSignalClient = lazyClient('./todoistWorkSignalClient');
const shortcutWorkSignalClient = lazyClient('./shortcutWorkSignalClient');
const bitbucketWorkSignalClient = lazyClient('./bitbucketWorkSignalClient');
const harvestWorkSignalClient = lazyClient('./harvestWorkSignalClient');
const everhourWorkSignalClient = lazyClient('./everhourWorkSignalClient');
const timeneyeWorkSignalClient = lazyClient('./timeneyeWorkSignalClient');
const codaWorkSignalClient = lazyClient('./codaWorkSignalClient');
const quipWorkSignalClient = lazyClient('./quipWorkSignalClient');
const hiveWorkSignalClient = lazyClient('./hiveWorkSignalClient');
const clarizenWorkSignalClient = lazyClient('./clarizenWorkSignalClient');
const lucidWorkSignalClient = lazyClient('./lucidWorkSignalClient');
const taskworldWorkSignalClient = lazyClient('./taskworldWorkSignalClient');
const taskadeWorkSignalClient = lazyClient('./taskadeWorkSignalClient');
const motionWorkSignalClient = lazyClient('./motionWorkSignalClient');
const ganttProWorkSignalClient = lazyClient('./ganttProWorkSignalClient');
const paymoWorkSignalClient = lazyClient('./paymoWorkSignalClient');
const teamworkWorkSignalClient = lazyClient('./teamworkWorkSignalClient');
const teamGanttWorkSignalClient = lazyClient('./teamganttWorkSignalClient');
const businessmapWorkSignalClient = lazyClient('./businessmapWorkSignalClient');
const basecampWorkSignalClient = lazyClient('./basecampWorkSignalClient');
const redmineWorkSignalClient = lazyClient('./redmineWorkSignalClient');
const microsoftPlannerWorkSignalClient = lazyClient('./microsoftPlannerWorkSignalClient');
const microsoftProjectWorkSignalClient = lazyClient('./microsoftProjectWorkSignalClient');
const youTrackWorkSignalClient = lazyClient('./youTrackWorkSignalClient');
const taigaWorkSignalClient = lazyClient('./taigaWorkSignalClient');
const backlogWorkSignalClient = lazyClient('./backlogWorkSignalClient');
const freedcampWorkSignalClient = lazyClient('./freedcampWorkSignalClient');
const proofHubWorkSignalClient = lazyClient('./proofHubWorkSignalClient');
const meisterTaskWorkSignalClient = lazyClient('./meisterTaskWorkSignalClient');
const ahaWorkSignalClient = lazyClient('./ahaWorkSignalClient');
const productboardWorkSignalClient = lazyClient('./productboardWorkSignalClient');
const togglTrackWorkSignalClient = lazyClient('./togglTrackWorkSignalClient');
const clockifyWorkSignalClient = lazyClient('./clockifyWorkSignalClient');
const floatWorkSignalClient = lazyClient('./floatWorkSignalClient');
const resourceGuruWorkSignalClient = lazyClient('./resourceGuruWorkSignalClient');
const sentryWorkSignalClient = lazyClient('./sentryWorkSignalClient');
const pagerDutyWorkSignalClient = lazyClient('./pagerDutyWorkSignalClient');
const opsgenieWorkSignalClient = lazyClient('./opsgenieWorkSignalClient');
const statuspageWorkSignalClient = lazyClient('./statuspageWorkSignalClient');
const genericRestApiWorkSignalClient = lazyClient('./genericRestApiWorkSignalClient');
const n8nWorkSignalClient = lazyClient('./n8nWorkSignalClient');
const makeWorkSignalClient = lazyClient('./makeWorkSignalClient');
const testRailWorkSignalClient = lazyClient('./testRailWorkSignalClient');
const browserStackWorkSignalClient = lazyClient('./browserStackWorkSignalClient');
const oneDriveWorkSignalClient = lazyClient('./oneDriveWorkSignalClient');
const surveyMonkeyWorkSignalClient = lazyClient('./surveyMonkeyWorkSignalClient');
const googleDriveWorkSignalClient = lazyClient('./googleDriveWorkSignalClient');
const datadogWorkSignalClient = lazyClient('./datadogWorkSignalClient');
const zendeskWorkSignalClient = lazyClient('./zendeskWorkSignalClient');
const freshdeskWorkSignalClient = lazyClient('./freshdeskWorkSignalClient');
const pipedriveWorkSignalClient = lazyClient('./pipedriveWorkSignalClient');
const hubSpotWorkSignalClient = lazyClient('./hubSpotWorkSignalClient');
const typeformWorkSignalClient = lazyClient('./typeformWorkSignalClient');
const salesforceWorkSignalClient = lazyClient('./salesforceWorkSignalClient');
const zoomWorkSignalClient = lazyClient('./zoomWorkSignalClient');
const miroWorkSignalClient = lazyClient('./miroWorkSignalClient');
const dropboxWorkSignalClient = lazyClient('./dropboxWorkSignalClient');
const calendlyWorkSignalClient = lazyClient('./calendlyWorkSignalClient');
const teamsWorkSignalClient = lazyClient('./teamsWorkSignalClient');
const googleChatWorkSignalClient = lazyClient('./googleChatWorkSignalClient');
const figmaWorkSignalClient = lazyClient('./figmaWorkSignalClient');
const confluenceWorkSignalClient = lazyClient('./confluenceWorkSignalClient');
const boxWorkSignalClient = lazyClient('./boxWorkSignalClient');
const podioWorkSignalClient = lazyClient('./podioWorkSignalClient');
const intercomWorkSignalClient = lazyClient('./intercomWorkSignalClient');
const webexWorkSignalClient = lazyClient('./webexWorkSignalClient');
const discordWorkSignalClient = lazyClient('./discordWorkSignalClient');
const mattermostWorkSignalClient = lazyClient('./mattermostWorkSignalClient');
const workfrontWorkSignalClient = lazyClient('./workfrontWorkSignalClient');
const serviceNowWorkSignalClient = lazyClient('./serviceNowWorkSignalClient');
const zohoProjectsWorkSignalClient = lazyClient('./zohoProjectsWorkSignalClient');
const newRelicWorkSignalClient = lazyClient('./newRelicWorkSignalClient');
const rallyWorkSignalClient = lazyClient('./rallyWorkSignalClient');
const gmailWorkSignalClient = lazyClient('./gmailWorkSignalClient');
const outlookWorkSignalClient = lazyClient('./outlookWorkSignalClient');
const tableauWorkSignalClient = lazyClient('./tableauWorkSignalClient');
const sharePointWorkSignalClient = lazyClient('./sharePointWorkSignalClient');
const xeroWorkSignalClient = lazyClient('./xeroWorkSignalClient');
const googleFormsWorkSignalClient = lazyClient('./googleFormsWorkSignalClient');
const muralWorkSignalClient = lazyClient('./muralWorkSignalClient');
const canvaWorkSignalClient = lazyClient('./canvaWorkSignalClient');
const quickBooksWorkSignalClient = lazyClient('./quickBooksWorkSignalClient');
const powerBiWorkSignalClient = lazyClient('./powerBiWorkSignalClient');
const dataStudioWorkSignalClient = lazyClient('./dataStudioWorkSignalClient');
const zapierWorkSignalClient = lazyClient('./zapierWorkSignalClient');
const jiraAlignWorkSignalClient = lazyClient('./jiraAlignWorkSignalClient');
const scoroWorkSignalClient = lazyClient('./scoroWorkSignalClient');
const planeWorkSignalClient = lazyClient('./planeWorkSignalClient');
const openProjectWorkSignalClient = lazyClient('./openProjectWorkSignalClient');

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

const kantataAdapter = buildAdapter('kantata', 'Kantata OX project metadata adapter', (account, item) => ({
  externalId: pick(item.id),
  sourceType: 'project',
  title: titleFromText(item.name, 'Kantata OX project'),
  description: '',
  status: item.status || 'open',
  priority: 'unknown',
  url: undefined,
  owners: [],
  labels: compact(['kantata', item.sourceType, item.status]),
  dueAt: item.dueAt,
  providerCreatedAt: item.createdAt,
  providerUpdatedAt: item.updatedAt || item.createdAt,
  evidenceRefs: [{
    provider: account.connectorId,
    externalId: String(pick(item.id, 'unknown')),
    label: 'Kantata OX project metadata',
    type: account.connectorId
  }],
  raw: {
    id: item.id,
    sourceType: item.sourceType,
    projectId: item.projectId,
    status: item.status,
    startAt: item.startAt,
    dueAt: item.dueAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  }
}));
kantataAdapter.capabilities.credentialBackedSync = true;
kantataAdapter.list = async (account) => (await kantataWorkSignalClient.fetchDelta(account, null)).records;
kantataAdapter.fetchDelta = (account, cursor) => kantataWorkSignalClient.fetchDelta(account, cursor);
adapters.set('kantata', kantataAdapter);

const liquidPlannerAdapter = buildAdapter('liquidplanner', 'LiquidPlanner active-project metadata adapter', (account, item) => ({
  externalId: pick(item.id),
  sourceType: 'project',
  title: titleFromText(item.name, 'LiquidPlanner project'),
  description: '',
  status: item.status || 'open',
  priority: 'unknown',
  url: undefined,
  owners: [],
  labels: compact(['liquidplanner', 'project', item.status]),
  dueAt: item.dueAt,
  providerCreatedAt: item.createdAt,
  providerUpdatedAt: item.updatedAt || item.createdAt,
  evidenceRefs: [{
    provider: account.connectorId,
    externalId: String(pick(item.id, 'unknown')),
    label: 'LiquidPlanner active-project metadata',
    type: account.connectorId
  }],
  raw: {
    id: item.id,
    sourceType: item.sourceType,
    projectId: item.projectId,
    workspaceId: item.workspaceId,
    status: item.status,
    startAt: item.startAt,
    dueAt: item.dueAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  }
}));
liquidPlannerAdapter.capabilities.credentialBackedSync = true;
liquidPlannerAdapter.list = async (account) => (await liquidPlannerWorkSignalClient.fetchDelta(account, null)).records;
liquidPlannerAdapter.fetchDelta = (account, cursor) => liquidPlannerWorkSignalClient.fetchDelta(account, cursor);
adapters.set('liquidplanner', liquidPlannerAdapter);

const productiveAdapter = buildAdapter('productive', 'Productive project metadata adapter', (account, item) => ({
  externalId: pick(item.id), sourceType: 'project', title: titleFromText(item.name, 'Productive project'), description: '', status: item.status || 'open', priority: 'unknown', url: undefined, owners: [], labels: compact(['productive', 'project', item.status]), dueAt: undefined, providerCreatedAt: item.createdAt, providerUpdatedAt: item.updatedAt || item.createdAt,
  evidenceRefs: [{ provider: account.connectorId, externalId: String(pick(item.id, 'unknown')), label: 'Productive project metadata', type: account.connectorId }],
  raw: { id: item.id, sourceType: item.sourceType, projectId: item.projectId, status: item.status, createdAt: item.createdAt, updatedAt: item.updatedAt }
}));
productiveAdapter.capabilities.credentialBackedSync = true;
productiveAdapter.list = async account => (await productiveWorkSignalClient.fetchDelta(account, null)).records;
productiveAdapter.fetchDelta = (account, cursor) => productiveWorkSignalClient.fetchDelta(account, cursor);
adapters.set('productive', productiveAdapter);

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
  const isGoogleTask = item.googleSource === 'tasks';
  const mime = String(item.mimeType || item.kind || '').toLowerCase();
  const sourceType = isGoogleTask ? pick(item.sourceType, 'task') : mime.includes('calendar') || item.start ? 'event'
    : mime.includes('mail') || item.threadId ? 'message'
      : 'document';
  const nativeId = pick(item.id, item.threadId, 'unknown');
  const externalId = pick(item.externalId, isGoogleTask
    ? `google_tasks:${item.taskListId || 'default'}:${item.taskId || nativeId}`
    : sourceType === 'event'
    ? `calendar:${item.calendar?.id || 'default'}:${nativeId}`
    : `drive:${nativeId}`);
  return {
    externalId,
    sourceType,
    title: pick(item.title, item.name, item.summary, item.subject),
    description: isGoogleTask ? '' : pick(item.description, item.snippet, ''),
    status: isGoogleTask ? item.status || 'open' : item.trashed ? 'archived' : statusFromText(item.status),
    priority: priorityFromText(item.priority, item.labels),
    url: isGoogleTask ? undefined : pick(item.url, item.webViewLink, item.htmlLink),
    owners: isGoogleTask ? [] : userNames(item.owners || item.creator || item.organizer),
    labels: isGoogleTask ? compact(['google_tasks', item.sourceType, item.taskList?.name]) : labelNames(pick(item.labels, item.labelIds)),
    dueAt: isGoogleTask ? item.dueAt : pick(item.dueAt, item.end?.dateTime, item.end?.date),
    providerCreatedAt: isGoogleTask ? undefined : pick(item.providerCreatedAt, item.createdTime, item.created),
    providerUpdatedAt: isGoogleTask ? pick(item.updatedAt) : pick(item.providerUpdatedAt, item.modifiedTime, item.updated),
    evidenceRefs: baseEvidence(account, item, 'Google Workspace item'),
    raw: isGoogleTask ? { id: item.id, sourceType: item.sourceType, taskId: item.taskId, taskListId: item.taskListId, taskList: item.taskList, status: item.status, dueAt: item.dueAt, completedAt: item.completedAt, updatedAt: item.updatedAt } : item
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

const procoreAdapter = buildAdapter('procore', 'Procore active construction-project metadata adapter', (account, item) => ({
  externalId: pick(item.id),
  sourceType: pick(item.sourceType, 'project'),
  title: titleFromText(item.name, 'Procore project'),
  description: '',
  status: statusFromText(item.status),
  priority: 'unknown',
  url: undefined,
  owners: [],
  labels: compact(['procore', 'construction', item.sourceType, item.status]),
  dueAt: pick(item.dueAt),
  providerCreatedAt: pick(item.createdAt),
  providerUpdatedAt: pick(item.updatedAt, item.createdAt),
  evidenceRefs: baseEvidence(account, item, 'Procore active project metadata'),
  raw: {
    id: item.id,
    sourceType: item.sourceType,
    projectId: item.projectId,
    companyId: item.companyId,
    status: item.status,
    startAt: item.startAt,
    dueAt: item.dueAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  }
}));
procoreAdapter.capabilities.credentialBackedSync = true;
procoreAdapter.list = async account => (await procoreWorkSignalClient.fetchDelta(account, null)).records;
procoreAdapter.fetchDelta = (account, cursor) => procoreWorkSignalClient.fetchDelta(account, cursor);
adapters.set('procore', procoreAdapter);

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
  externalId: pick(record.externalId, record.id),
  sourceType: 'task',
  title: titleFromText(pick(record.title, record.name), 'Airtable task'),
  description: '',
  status: statusFromText(record.status),
  priority: priorityFromText(record.priority),
  url: undefined,
  owners: userNames(record.owners),
  labels: compact(['airtable', record.base?.name, record.table?.name, record.status]),
  dueAt: record.dueAt,
  providerCreatedAt: record.createdTime,
  providerUpdatedAt: record.updatedTime || record.createdTime,
  evidenceRefs: [{
    provider: account.connectorId,
    externalId: String(pick(record.externalId, record.id, 'unknown')),
    label: 'Airtable allowlisted task metadata',
    type: account.connectorId
  }],
  raw: {
    id: record.id,
    externalId: record.externalId,
    status: record.status,
    priority: record.priority,
    owners: record.owners,
    dueAt: record.dueAt,
    createdTime: record.createdTime,
    updatedTime: record.updatedTime,
    base: record.base ? { id: record.base.id, name: record.base.name } : undefined,
    table: record.table ? { name: record.table.name } : undefined
  }
}));
airtableAdapter.capabilities.credentialBackedSync = true;
airtableAdapter.list = async (account) => (await airtableWorkSignalClient.fetchDelta(account, null)).records;
airtableAdapter.fetchDelta = (account, cursor) => airtableWorkSignalClient.fetchDelta(account, cursor);
adapters.set('airtable', airtableAdapter);
const todoistAdapter = buildAdapter('todoist', 'Todoist task adapter', (account, task) => ({
  externalId: pick(task.id),
  sourceType: 'task',
  title: titleFromText(task.content, 'Todoist task'),
  description: '',
  status: 'open',
  priority: priorityFromText({ 4: 'critical', 3: 'high', 2: 'normal', 1: 'low' }[Number(task.priority)]),
  url: undefined,
  owners: userNames(task.assigneeId),
  labels: compact(['todoist', task.project?.name, task.sectionId ? `section:${task.sectionId}` : undefined]),
  dueAt: task.due,
  providerCreatedAt: task.createdAt,
  providerUpdatedAt: task.createdAt,
  evidenceRefs: [{
    provider: account.connectorId,
    externalId: String(pick(task.id, 'unknown')),
    label: 'Todoist task metadata',
    type: account.connectorId
  }],
  raw: {
    id: task.id,
    projectId: task.projectId,
    sectionId: task.sectionId,
    priority: task.priority,
    assigneeId: task.assigneeId,
    due: task.due,
    createdAt: task.createdAt,
    project: task.project ? { id: task.project.id, name: task.project.name } : undefined
  }
}));
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
  providerCreatedAt: pick(entry.spentDate, entry.createdAt),
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

const everhourAdapter = buildAdapter('everhour', 'Everhour bounded time-entry utilization adapter', (account, entry) => ({ externalId: pick(entry.id), sourceType: 'time_entry', title: titleFromText([entry.project?.name || 'Everhour project', entry.task?.name || 'Tracked time'].join(' - ')), description: '', status: 'done', priority: 'normal', owners: userNames(entry.user), labels: compact(['everhour', entry.project?.name, entry.task?.name, entry.billable === true ? 'billable' : 'non-billable']), dueAt: undefined, providerCreatedAt: pick(entry.spentDate, entry.createdAt), providerUpdatedAt: pick(entry.updatedAt, entry.createdAt, entry.spentDate), evidenceRefs: baseEvidence(account, entry, 'Everhour time-entry metadata'), raw: { id: entry.id, timeEntryId: entry.timeEntryId, spentDate: entry.spentDate, hours: entry.hours, billable: entry.billable === true, user: entry.user, project: entry.project, task: entry.task, createdAt: entry.createdAt, updatedAt: entry.updatedAt } }));
everhourAdapter.capabilities.credentialBackedSync = true;
everhourAdapter.list = async account => (await everhourWorkSignalClient.fetchDelta(account, null)).records;
everhourAdapter.fetchDelta = (account, cursor) => everhourWorkSignalClient.fetchDelta(account, cursor);
adapters.set('everhour', everhourAdapter);

const timeneyeAdapter = buildAdapter('timeneye', 'Lucen Track personal time-entry utilization adapter', (account, entry) => ({ externalId: pick(entry.id), sourceType: 'time_entry', title: `Lucen Track entry ${entry.timeEntryId || entry.id}`, description: '', status: 'done', priority: 'unknown', owners: [], labels: compact(['timeneye', 'time_entry', entry.projectId ? `project:${entry.projectId}` : undefined, entry.phaseId ? `phase:${entry.phaseId}` : undefined, entry.todoId ? `todo:${entry.todoId}` : undefined]), dueAt: undefined, providerCreatedAt: pick(entry.createdAt, entry.spentDate), providerUpdatedAt: pick(entry.updatedAt, entry.createdAt, entry.spentDate), evidenceRefs: baseEvidence(account, entry, 'Lucen Track utilization metadata'), raw: { id: entry.id, sourceType: 'time_entry', timeEntryId: entry.timeEntryId, userId: entry.userId, projectId: entry.projectId, phaseId: entry.phaseId, todoId: entry.todoId, spentDate: entry.spentDate, hours: entry.hours, createdAt: entry.createdAt, updatedAt: entry.updatedAt } }));
timeneyeAdapter.capabilities.credentialBackedSync = true;
timeneyeAdapter.list = async account => (await timeneyeWorkSignalClient.fetchDelta(account, null)).records;
timeneyeAdapter.fetchDelta = (account, cursor) => timeneyeWorkSignalClient.fetchDelta(account, cursor);
adapters.set('timeneye', timeneyeAdapter);

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

const teamGanttEvidence = (account, item) => [{
  provider: account.connectorId,
  externalId: String(pick(item.id, item.taskId, item.projectId, 'unknown')),
  label: 'TeamGantt metadata',
  type: account.connectorId
}];
const teamGanttProject = value => value && value.id && value.name ? { id: String(value.id), name: titleFromText(value.name, 'TeamGantt project') } : undefined;
const teamGanttAdapter = buildAdapter('teamgantt', 'TeamGantt project and task metadata adapter', (account, item) => ({
  externalId: pick(item.id),
  sourceType: pick(item.sourceType, 'task'),
  title: titleFromText(item.name, 'TeamGantt work item'),
  description: '',
  status: statusFromText(item.status),
  priority: priorityFromText(item.priority),
  owners: [],
  labels: compact(['teamgantt', item.sourceType, item.project?.name, item.status, item.priority]),
  dueAt: pick(item.dueAt),
  providerCreatedAt: pick(item.createdAt),
  providerUpdatedAt: pick(item.updatedAt, item.createdAt),
  evidenceRefs: teamGanttEvidence(account, item),
  raw: { id: item.id, sourceType: item.sourceType, projectId: item.projectId, taskId: item.taskId, parentGroupId: item.parentGroupId, project: teamGanttProject(item.project), status: item.status, priority: item.priority, percentComplete: item.percentComplete, startAt: item.startAt, dueAt: item.dueAt, createdAt: item.createdAt, updatedAt: item.updatedAt }
}));
teamGanttAdapter.capabilities.credentialBackedSync = true;
teamGanttAdapter.list = async account => (await teamGanttWorkSignalClient.fetchDelta(account, null)).records;
teamGanttAdapter.fetchDelta = (account, cursor) => teamGanttWorkSignalClient.fetchDelta(account, cursor);
adapters.set('teamgantt', teamGanttAdapter);

const businessmapAdapter = buildAdapter('kanbanize', 'Businessmap board and card metadata adapter', (account, item) => ({
  externalId: pick(item.id),
  sourceType: pick(item.sourceType, 'card'),
  title: titleFromText(item.name, 'Businessmap work item'),
  description: '',
  status: statusFromText(item.status),
  priority: priorityFromText(item.priority),
  owners: [],
  labels: compact(['businessmap', 'kanbanize', item.sourceType, item.board?.name, item.status, item.priority]),
  dueAt: pick(item.dueAt),
  providerCreatedAt: pick(item.createdAt),
  providerUpdatedAt: pick(item.updatedAt, item.createdAt),
  evidenceRefs: baseEvidence(account, item, 'Businessmap metadata'),
  raw: { id: item.id, sourceType: item.sourceType, boardId: item.boardId, cardId: item.cardId, board: item.board, status: item.status, priority: item.priority, customId: item.customId, workflowId: item.workflowId, columnId: item.columnId, laneId: item.laneId, dueAt: item.dueAt, createdAt: item.createdAt, updatedAt: item.updatedAt }
}));
businessmapAdapter.capabilities.credentialBackedSync = true;
businessmapAdapter.list = async account => (await businessmapWorkSignalClient.fetchDelta(account, null)).records;
businessmapAdapter.fetchDelta = (account, cursor) => businessmapWorkSignalClient.fetchDelta(account, cursor);
adapters.set('kanbanize', businessmapAdapter);

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

const microsoftProjectAdapter = buildAdapter('microsoft_project', 'Microsoft Project basic Planner plan and task metadata adapter', (account, item) => ({
  externalId: pick(item.id), sourceType: pick(item.sourceType, 'task'), title: titleFromText(item.name, 'Microsoft Project task'), description: '', status: item.status || 'open', priority: item.priority || 'unknown', url: undefined, owners: [], labels: compact(['microsoft_project', item.sourceType, item.projectId ? `project:${item.projectId}` : undefined, Number(item.percentComplete) >= 100 ? 'completed' : undefined]), dueAt: item.dueAt, providerCreatedAt: item.createdAt, providerUpdatedAt: item.updatedAt || item.completedAt || item.createdAt, evidenceRefs: baseEvidence(account, item, 'Microsoft Project basic Planner plan and task metadata'), raw: { id: item.id, sourceType: item.sourceType, projectId: item.projectId, taskId: item.taskId, status: item.status, priority: item.priority, percentComplete: item.percentComplete, dueAt: item.dueAt, completedAt: item.completedAt, createdAt: item.createdAt, updatedAt: item.updatedAt }
}));
microsoftProjectAdapter.capabilities.credentialBackedSync = true;
microsoftProjectAdapter.list = async account => (await microsoftProjectWorkSignalClient.fetchDelta(account, null)).records;
microsoftProjectAdapter.fetchDelta = (account, cursor) => microsoftProjectWorkSignalClient.fetchDelta(account, cursor);
adapters.set('microsoft_project', microsoftProjectAdapter);

const quipAdapter = buildAdapter('quip', 'Quip thread index metadata adapter', (account, item) => ({
  externalId: pick(item.id), sourceType: pick(item.sourceType, 'thread'), title: titleFromText(item.name, 'Quip thread'), description: '', status: item.status || 'open', priority: 'unknown', url: undefined, owners: [], labels: compact(['quip', item.sourceType, item.threadType]), dueAt: undefined, providerCreatedAt: item.createdAt, providerUpdatedAt: item.updatedAt || item.createdAt, evidenceRefs: baseEvidence(account, item, 'Quip thread index metadata'), raw: { id: item.id, sourceType: item.sourceType, threadId: item.threadId, threadType: item.threadType, status: item.status, createdAt: item.createdAt, updatedAt: item.updatedAt }
}));
quipAdapter.capabilities.credentialBackedSync = true;
quipAdapter.list = async account => (await quipWorkSignalClient.fetchDelta(account, null)).records;
quipAdapter.fetchDelta = (account, cursor) => quipWorkSignalClient.fetchDelta(account, cursor);
adapters.set('quip', quipAdapter);

const hiveAdapter = buildAdapter('hive', 'Hive project metadata adapter', (account, item) => ({
  externalId: pick(item.id), sourceType: pick(item.sourceType, 'project'), title: titleFromText(item.name, 'Hive project'), description: '', status: item.status || 'open', priority: 'unknown', url: undefined, owners: [], labels: compact(['hive', item.sourceType, item.projectId ? `project:${item.projectId}` : undefined]), dueAt: undefined, providerCreatedAt: item.createdAt, providerUpdatedAt: item.updatedAt || item.createdAt, evidenceRefs: baseEvidence(account, item, 'Hive project metadata'), raw: { id: item.id, sourceType: item.sourceType, projectId: item.projectId, status: item.status, createdAt: item.createdAt, updatedAt: item.updatedAt }
}));
hiveAdapter.capabilities.credentialBackedSync = true;
hiveAdapter.list = async account => (await hiveWorkSignalClient.fetchDelta(account, null)).records;
hiveAdapter.fetchDelta = (account, cursor) => hiveWorkSignalClient.fetchDelta(account, cursor);
adapters.set('hive', hiveAdapter);

const clarizenAdapter = buildAdapter('clarizen', 'Planview AdaptiveWork project metadata adapter', (account, item) => ({
  externalId: pick(item.id), sourceType: pick(item.sourceType, 'project'), title: titleFromText(item.name, 'AdaptiveWork project'), description: '', status: item.status || 'open', priority: 'unknown', url: undefined, owners: [], labels: compact(['clarizen', item.sourceType, item.projectId ? `project:${item.projectId}` : undefined]), dueAt: undefined, providerCreatedAt: item.startAt, providerUpdatedAt: item.startAt, evidenceRefs: baseEvidence(account, item, 'Planview AdaptiveWork project metadata'), raw: { id: item.id, sourceType: item.sourceType, projectId: item.projectId, status: item.status, startAt: item.startAt }
}));
clarizenAdapter.capabilities.credentialBackedSync = true;
clarizenAdapter.list = async account => (await clarizenWorkSignalClient.fetchDelta(account, null)).records;
clarizenAdapter.fetchDelta = (account, cursor) => clarizenWorkSignalClient.fetchDelta(account, cursor);
adapters.set('clarizen', clarizenAdapter);

const lucidAdapter = buildAdapter('lucid', 'Lucid document metadata adapter', (account, item) => ({
  externalId: pick(item.id), sourceType: pick(item.sourceType, 'document'), title: titleFromText(item.name, 'Lucid document'), description: '', status: item.status || 'open', priority: 'unknown', url: undefined, owners: [], labels: compact(['lucid', item.sourceType, item.product]), dueAt: undefined, providerCreatedAt: item.createdAt, providerUpdatedAt: item.updatedAt || item.createdAt, evidenceRefs: baseEvidence(account, item, 'Lucid document metadata'), raw: { id: item.id, sourceType: item.sourceType, documentId: item.documentId, product: item.product, status: item.status, createdAt: item.createdAt, updatedAt: item.updatedAt }
}));
lucidAdapter.capabilities.credentialBackedSync = true;
lucidAdapter.list = async account => (await lucidWorkSignalClient.fetchDelta(account, null)).records;
lucidAdapter.fetchDelta = (account, cursor) => lucidWorkSignalClient.fetchDelta(account, cursor);
adapters.set('lucid', lucidAdapter);

const taskworldAdapter = buildAdapter('taskworld', 'Taskworld project metadata adapter', (account, item) => ({
  externalId: pick(item.id), sourceType: pick(item.sourceType, 'project'), title: titleFromText(item.name, 'Taskworld project'), description: '', status: item.status || 'open', priority: 'unknown', url: undefined, owners: [], labels: compact(['taskworld', item.sourceType, item.projectId ? `project:${item.projectId}` : undefined]), dueAt: undefined, providerCreatedAt: item.createdAt, providerUpdatedAt: item.updatedAt || item.createdAt, evidenceRefs: baseEvidence(account, item, 'Taskworld project metadata'), raw: { id: item.id, sourceType: item.sourceType, projectId: item.projectId, status: item.status, createdAt: item.createdAt, updatedAt: item.updatedAt }
}));
taskworldAdapter.capabilities.credentialBackedSync = true;
taskworldAdapter.list = async account => (await taskworldWorkSignalClient.fetchDelta(account, null)).records;
taskworldAdapter.fetchDelta = (account, cursor) => taskworldWorkSignalClient.fetchDelta(account, cursor);
adapters.set('taskworld', taskworldAdapter);

const taskadeAdapter = buildAdapter('taskade', 'Taskade project and task metadata adapter', (account, item) => ({
  externalId: pick(item.id), sourceType: pick(item.sourceType, 'task'), title: titleFromText(item.name, 'Taskade work item'), description: '', status: statusFromText(item.status), priority: 'unknown', url: undefined, owners: [], labels: compact(['taskade', item.sourceType, item.projectId ? `project:${item.projectId}` : undefined, item.status]), dueAt: undefined, providerCreatedAt: undefined, providerUpdatedAt: undefined, evidenceRefs: baseEvidence(account, item, 'Taskade metadata'), raw: { id: item.id, sourceType: item.sourceType, projectId: item.projectId, taskId: item.taskId, status: item.status }
}));
taskadeAdapter.capabilities.credentialBackedSync = true;
taskadeAdapter.list = async account => (await taskadeWorkSignalClient.fetchDelta(account, null)).records;
taskadeAdapter.fetchDelta = (account, cursor) => taskadeWorkSignalClient.fetchDelta(account, cursor);
adapters.set('taskade', taskadeAdapter);

const ganttProAdapter = buildAdapter('ganttpro', 'GanttPRO project and task metadata adapter', (account, item) => ({
  externalId: pick(item.id), sourceType: pick(item.sourceType, 'task'), title: titleFromText(item.name, 'GanttPRO work item'), description: '', status: statusFromText(item.status), priority: 'unknown', url: undefined, owners: [], labels: compact(['ganttpro', item.sourceType, item.projectId ? `project:${item.projectId}` : undefined, item.status]), dueAt: item.dueAt, providerCreatedAt: item.createdAt, providerUpdatedAt: item.updatedAt || item.createdAt, evidenceRefs: baseEvidence(account, item, 'GanttPRO metadata'), raw: { id: item.id, sourceType: item.sourceType, projectId: item.projectId, taskId: item.taskId, status: item.status, progressPercent: item.progressPercent, startAt: item.startAt, dueAt: item.dueAt, createdAt: item.createdAt, updatedAt: item.updatedAt }
}));
ganttProAdapter.capabilities.credentialBackedSync = true;
ganttProAdapter.list = async account => (await ganttProWorkSignalClient.fetchDelta(account, null)).records;
ganttProAdapter.fetchDelta = (account, cursor) => ganttProWorkSignalClient.fetchDelta(account, cursor);
adapters.set('ganttpro', ganttProAdapter);

const paymoAdapter = buildAdapter('paymo', 'Paymo active project and task metadata adapter', (account, item) => ({
  externalId: pick(item.id), sourceType: pick(item.sourceType, 'task'), title: titleFromText(item.name, 'Paymo work item'), description: '', status: statusFromText(item.status), priority: item.priority || 'unknown', url: undefined, owners: [], labels: compact(['paymo', item.sourceType, item.projectId ? `project:${item.projectId}` : undefined, item.status]), dueAt: item.dueAt, providerCreatedAt: item.createdAt, providerUpdatedAt: item.updatedAt || item.createdAt, evidenceRefs: baseEvidence(account, item, 'Paymo metadata'), raw: { id: item.id, sourceType: item.sourceType, projectId: item.projectId, taskId: item.taskId, status: item.status, priority: item.priority, dueAt: item.dueAt, createdAt: item.createdAt, updatedAt: item.updatedAt }
}));
paymoAdapter.capabilities.credentialBackedSync = true;
paymoAdapter.list = async account => (await paymoWorkSignalClient.fetchDelta(account, null)).records;
paymoAdapter.fetchDelta = (account, cursor) => paymoWorkSignalClient.fetchDelta(account, cursor);
adapters.set('paymo', paymoAdapter);

const motionAdapter = buildAdapter('motion', 'Motion project and task metadata adapter', (account, item) => ({
  externalId: pick(item.id), sourceType: pick(item.sourceType, 'task'), title: titleFromText(item.name, 'Motion task'), description: '', status: item.status || 'open', priority: priorityFromText(item.priority), url: undefined, owners: [], labels: compact(['motion', item.sourceType, item.projectId ? `project:${item.projectId}` : undefined, item.schedulingIssue === true ? 'scheduling_issue' : undefined]), dueAt: item.dueAt, providerCreatedAt: item.createdAt, providerUpdatedAt: item.updatedAt || item.createdAt, evidenceRefs: baseEvidence(account, item, 'Motion project and task metadata'), raw: { id: item.id, sourceType: item.sourceType, projectId: item.projectId, taskId: item.taskId, status: item.status, priority: item.priority, dueAt: item.dueAt, startOn: item.startOn, durationMinutes: item.durationMinutes, assigneeIds: item.assigneeIds, scheduledStart: item.scheduledStart, scheduledEnd: item.scheduledEnd, schedulingIssue: item.schedulingIssue, createdAt: item.createdAt, updatedAt: item.updatedAt }
}));
motionAdapter.capabilities.credentialBackedSync = true;
motionAdapter.list = async account => (await motionWorkSignalClient.fetchDelta(account, null)).records;
motionAdapter.fetchDelta = (account, cursor) => motionWorkSignalClient.fetchDelta(account, cursor);
adapters.set('motion', motionAdapter);

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

const freedcampAdapter = buildAdapter('freedcamp', 'Freedcamp project, task, and milestone metadata adapter', (account, item) => ({ externalId: pick(item.id), sourceType: pick(item.sourceType, 'task'), title: titleFromText(item.name, 'Freedcamp work item'), description: '', status: statusFromText(item.status), priority: priorityFromText(item.priority), url: undefined, owners: [], labels: compact(['freedcamp', item.sourceType, item.project?.name, item.status, item.priority]), dueAt: pick(item.dueAt), providerCreatedAt: pick(item.createdAt), providerUpdatedAt: pick(item.updatedAt, item.createdAt), evidenceRefs: baseEvidence(account, item, 'Freedcamp metadata'), raw: { id: item.id, sourceType: item.sourceType, projectId: item.projectId, taskId: item.taskId, milestoneId: item.milestoneId, listId: item.listId, project: item.project, status: item.status, priority: item.priority, dueAt: item.dueAt, completedAt: item.completedAt, createdAt: item.createdAt, updatedAt: item.updatedAt } }));
freedcampAdapter.capabilities.credentialBackedSync = true;
freedcampAdapter.list = async account => (await freedcampWorkSignalClient.fetchDelta(account, null)).records;
freedcampAdapter.fetchDelta = (account, cursor) => freedcampWorkSignalClient.fetchDelta(account, cursor);
adapters.set('freedcamp', freedcampAdapter);

const proofHubAdapter = buildAdapter('proofhub', 'ProofHub project, task-list, and task metadata adapter', (account, item) => ({ externalId: pick(item.id), sourceType: pick(item.sourceType, 'task'), title: titleFromText(item.name, 'ProofHub work item'), description: '', status: statusFromText(item.status), priority: 'unknown', url: undefined, owners: [], labels: compact(['proofhub', item.sourceType, item.projectId ? `project:${item.projectId}` : undefined, item.taskListId ? `task_list:${item.taskListId}` : undefined, item.status]), dueAt: pick(item.dueAt), providerCreatedAt: pick(item.createdAt), providerUpdatedAt: pick(item.updatedAt, item.createdAt), evidenceRefs: baseEvidence(account, item, 'ProofHub metadata'), raw: { id: item.id, sourceType: item.sourceType, projectId: item.projectId, taskListId: item.taskListId, taskId: item.taskId, status: item.status, dueAt: item.dueAt, completedAt: item.completedAt, createdAt: item.createdAt, updatedAt: item.updatedAt } }));
proofHubAdapter.capabilities.credentialBackedSync = true;
proofHubAdapter.list = async account => (await proofHubWorkSignalClient.fetchDelta(account, null)).records;
proofHubAdapter.fetchDelta = (account, cursor) => proofHubWorkSignalClient.fetchDelta(account, cursor);
adapters.set('proofhub', proofHubAdapter);

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

const togglTrackAdapter = buildAdapter('toggl_track', 'Toggl Track project and utilization metadata adapter', (account, item) => ({ externalId: pick(item.id), sourceType: pick(item.sourceType, 'time_entry'), title: item.sourceType === 'project' ? titleFromText(item.name, 'Toggl Track project') : `Toggl Track entry ${item.timeEntryId || item.id}`, description: '', status: item.sourceType === 'project' ? statusFromText(item.status) : 'done', priority: 'unknown', owners: [], labels: compact(['toggl_track', item.sourceType, item.projectId ? `project:${item.projectId}` : undefined, item.status, item.billable === true ? 'billable' : undefined]), dueAt: undefined, providerCreatedAt: pick(item.createdAt, item.startedAt), providerUpdatedAt: pick(item.updatedAt, item.startedAt, item.createdAt), evidenceRefs: baseEvidence(account, item, 'Toggl Track utilization metadata'), raw: { id: item.id, sourceType: item.sourceType, projectId: item.projectId, timeEntryId: item.timeEntryId, workspaceId: item.workspaceId, userId: item.userId, status: item.status, isActive: item.isActive, startedAt: item.startedAt, stoppedAt: item.stoppedAt, durationSeconds: item.durationSeconds, billable: item.billable, createdAt: item.createdAt, updatedAt: item.updatedAt } }));
togglTrackAdapter.capabilities.credentialBackedSync = true;
togglTrackAdapter.list = async account => (await togglTrackWorkSignalClient.fetchDelta(account, null)).records;
togglTrackAdapter.fetchDelta = (account, cursor) => togglTrackWorkSignalClient.fetchDelta(account, cursor);
adapters.set('toggl_track', togglTrackAdapter);

const clockifyAdapter = buildAdapter('clockify', 'Clockify project and personal utilization metadata adapter', (account, item) => ({ externalId: pick(item.id), sourceType: pick(item.sourceType, 'time_entry'), title: item.sourceType === 'project' ? titleFromText(item.name, 'Clockify project') : `Clockify entry ${item.timeEntryId || item.id}`, description: '', status: item.sourceType === 'project' ? item.archived ? 'archived' : 'open' : 'done', priority: 'unknown', owners: [], labels: compact(['clockify', item.sourceType, item.projectId ? `project:${item.projectId}` : undefined, item.taskId ? `task:${item.taskId}` : undefined, item.billable === true ? 'billable' : undefined]), dueAt: undefined, providerCreatedAt: pick(item.startedAt), providerUpdatedAt: pick(item.stoppedAt, item.startedAt), evidenceRefs: baseEvidence(account, item, 'Clockify utilization metadata'), raw: { id: item.id, sourceType: item.sourceType, projectId: item.projectId, timeEntryId: item.timeEntryId, taskId: item.taskId, workspaceId: item.workspaceId, userId: item.userId, archived: item.archived, billable: item.billable, startedAt: item.startedAt, stoppedAt: item.stoppedAt, durationSeconds: item.durationSeconds } }));
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

const opsgenieAdapter = buildAdapter('opsgenie', 'Opsgenie open alert metadata adapter', (account, item) => ({ externalId: pick(item.id), sourceType: 'alert', title: titleFromText(item.name, 'Opsgenie alert'), description: '', status: item.status || 'open', priority: item.priority === 'P1' ? 'critical' : item.priority === 'P2' ? 'high' : item.priority === 'P3' ? 'normal' : item.priority === 'P4' || item.priority === 'P5' ? 'low' : 'unknown', owners: [], labels: compact(['opsgenie', 'alert', item.priority]), dueAt: undefined, providerCreatedAt: item.createdAt, providerUpdatedAt: pick(item.updatedAt, item.lastOccurredAt, item.createdAt), evidenceRefs: [{ provider: account.connectorId, externalId: String(pick(item.id, 'unknown')), label: 'Opsgenie alert metadata', type: account.connectorId }], raw: { id: item.id, sourceType: 'alert', alertId: item.alertId, tinyId: item.tinyId, status: item.status, priority: item.priority, occurrenceCount: item.occurrenceCount, createdAt: item.createdAt, updatedAt: item.updatedAt, lastOccurredAt: item.lastOccurredAt } }));
opsgenieAdapter.capabilities.credentialBackedSync = true;
opsgenieAdapter.list = async account => (await opsgenieWorkSignalClient.fetchDelta(account, null)).records;
opsgenieAdapter.fetchDelta = (account, cursor) => opsgenieWorkSignalClient.fetchDelta(account, cursor);
adapters.set('opsgenie', opsgenieAdapter);

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

const n8nAdapter = buildAdapter('n8n', 'n8n bounded active workflow and execution metadata adapter', (account, item) => ({ externalId: pick(item.id), sourceType: pick(item.sourceType, 'execution'), title: titleFromText(item.name, item.sourceType === 'workflow' ? 'n8n workflow' : 'n8n workflow execution'), description: '', status: item.sourceType === 'workflow' ? (item.active ? 'in_progress' : 'archived') : item.status === 'success' ? 'done' : ['error', 'crashed'].includes(item.status) ? 'blocked' : item.status === 'running' ? 'in_progress' : item.status === 'waiting' ? 'waiting' : 'unknown', priority: item.sourceType === 'execution' && ['error', 'crashed'].includes(item.status) ? 'high' : 'unknown', owners: [], labels: compact(['n8n', item.sourceType, item.status, item.workflowId ? `workflow:${item.workflowId}` : undefined]), dueAt: undefined, providerCreatedAt: pick(item.createdAt, item.startedAt), providerUpdatedAt: pick(item.stoppedAt, item.updatedAt, item.startedAt, item.createdAt), evidenceRefs: baseEvidence(account, item, 'n8n metadata'), raw: { id: item.id, sourceType: item.sourceType, workflowId: item.workflowId, executionId: item.executionId, active: item.active, status: item.status, finished: item.finished, createdAt: item.createdAt, updatedAt: item.updatedAt, startedAt: item.startedAt, stoppedAt: item.stoppedAt } }));
n8nAdapter.capabilities.credentialBackedSync = true;
n8nAdapter.list = async account => (await n8nWorkSignalClient.fetchDelta(account, null)).records;
n8nAdapter.fetchDelta = (account, cursor) => n8nWorkSignalClient.fetchDelta(account, cursor);
adapters.set('n8n', n8nAdapter);

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

const scoroAdapter = buildAdapter('scoro', 'Scoro project and task metadata adapter', (account, item) => ({
  externalId: pick(item.id), sourceType: pick(item.sourceType, 'task'), title: titleFromText(item.name, 'Scoro work item'), description: '', status: item.status || 'open', priority: item.priority || 'unknown', url: undefined, owners: [], labels: compact(['scoro', item.sourceType, item.projectId ? `project:${item.projectId}` : undefined]), dueAt: item.dueAt, providerCreatedAt: item.createdAt || item.startAt, providerUpdatedAt: item.updatedAt, evidenceRefs: baseEvidence(account, item, 'Scoro project and task metadata'), raw: { id: item.id, sourceType: item.sourceType, projectId: item.projectId, taskId: item.taskId, status: item.status, priority: item.priority, startAt: item.startAt, dueAt: item.dueAt, createdAt: item.createdAt, updatedAt: item.updatedAt, completedAt: item.completedAt }
}));
scoroAdapter.capabilities.credentialBackedSync = true;
scoroAdapter.list = async account => (await scoroWorkSignalClient.fetchDelta(account, null)).records;
scoroAdapter.fetchDelta = (account, cursor) => scoroWorkSignalClient.fetchDelta(account, cursor);
adapters.set('scoro', scoroAdapter);

const planeAdapter = buildAdapter('plane', 'Plane project and work-item metadata adapter', (account, item) => ({
  externalId: pick(item.id), sourceType: pick(item.sourceType, 'work_item'), title: titleFromText(item.name, 'Plane work item'), description: '', status: item.status || 'open', priority: item.priority || 'unknown', url: undefined, owners: [], labels: compact(['plane', item.sourceType, item.projectId ? `project:${item.projectId}` : undefined]), dueAt: item.dueAt, providerCreatedAt: item.createdAt, providerUpdatedAt: item.updatedAt, evidenceRefs: baseEvidence(account, item, 'Plane project and work-item metadata'), raw: { id: item.id, sourceType: item.sourceType, projectId: item.projectId, workItemId: item.workItemId, status: item.status, priority: item.priority, dueAt: item.dueAt, createdAt: item.createdAt, updatedAt: item.updatedAt, completedAt: item.completedAt, archivedAt: item.archivedAt }
}));
planeAdapter.capabilities.credentialBackedSync = true;
planeAdapter.list = async account => (await planeWorkSignalClient.fetchDelta(account, null)).records;
planeAdapter.fetchDelta = (account, cursor) => planeWorkSignalClient.fetchDelta(account, cursor);
adapters.set('plane', planeAdapter);

const openProjectAdapter = buildAdapter('openproject', 'OpenProject project and work-package metadata adapter', (account, item) => ({
  externalId: pick(item.id), sourceType: pick(item.sourceType, 'work_package'), title: titleFromText(item.name, 'OpenProject work package'), description: '', status: item.status || 'open', priority: item.priority || 'unknown', url: undefined, owners: [], labels: compact(['openproject', item.sourceType, item.projectId ? `project:${item.projectId}` : undefined]), dueAt: item.dueAt, providerCreatedAt: item.createdAt || item.startAt, providerUpdatedAt: item.updatedAt, evidenceRefs: baseEvidence(account, item, 'OpenProject project and work-package metadata'), raw: { id: item.id, sourceType: item.sourceType, projectId: item.projectId, workPackageId: item.workPackageId, identifier: item.identifier, status: item.status, priority: item.priority, percentageDone: item.percentageDone, startAt: item.startAt, dueAt: item.dueAt, createdAt: item.createdAt, updatedAt: item.updatedAt }
}));
openProjectAdapter.capabilities.credentialBackedSync = true;
openProjectAdapter.list = async account => (await openProjectWorkSignalClient.fetchDelta(account, null)).records;
openProjectAdapter.fetchDelta = (account, cursor) => openProjectWorkSignalClient.fetchDelta(account, cursor);
adapters.set('openproject', openProjectAdapter);

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

const zohoProjectsAdapter = buildAdapter('zoho_projects', 'Zoho Projects active project metadata adapter', (account, item) => ({ externalId: pick(item.id), sourceType: pick(item.sourceType, 'project'), title: titleFromText(item.name, 'Zoho project'), description: '', status: item.status || 'open', priority: 'unknown', url: undefined, owners: [], labels: compact(['zoho_projects', item.sourceType]), dueAt: item.endAt, providerCreatedAt: item.startAt, providerUpdatedAt: item.updatedAt, evidenceRefs: baseEvidence(account, item, 'Zoho Projects active project metadata'), raw: { id: item.id, sourceType: item.sourceType, projectId: item.projectId, status: item.status, percentComplete: item.percentComplete, startAt: item.startAt, endAt: item.endAt, updatedAt: item.updatedAt } }));
zohoProjectsAdapter.capabilities.credentialBackedSync = true;
zohoProjectsAdapter.list = async account => (await zohoProjectsWorkSignalClient.fetchDelta(account, null)).records;
zohoProjectsAdapter.fetchDelta = (account, cursor) => zohoProjectsWorkSignalClient.fetchDelta(account, cursor);
adapters.set('zoho_projects', zohoProjectsAdapter);

const newRelicAdapter = buildAdapter('new_relic', 'New Relic open violation metadata adapter', (account, item) => ({ externalId: pick(item.id), sourceType: pick(item.sourceType, 'violation'), title: titleFromText(item.name, 'New Relic violation'), description: '', status: item.status || 'open', priority: item.priority || 'unknown', url: undefined, owners: [], labels: compact(['new_relic', item.sourceType]), dueAt: undefined, providerCreatedAt: item.openedAt, providerUpdatedAt: item.updatedAt, evidenceRefs: baseEvidence(account, item, 'New Relic open violation metadata'), raw: { id: item.id, sourceType: item.sourceType, violationId: item.violationId, status: item.status, priority: item.priority, openedAt: item.openedAt, updatedAt: item.updatedAt } }));
newRelicAdapter.capabilities.credentialBackedSync = true;
newRelicAdapter.list = async account => (await newRelicWorkSignalClient.fetchDelta(account, null)).records;
newRelicAdapter.fetchDelta = (account, cursor) => newRelicWorkSignalClient.fetchDelta(account, cursor);
adapters.set('new_relic', newRelicAdapter);

const makeAdapter = buildAdapter('make', 'Make scenario metadata adapter', (account, item) => ({
  externalId: pick(item.id),
  sourceType: pick(item.sourceType, 'workflow'),
  title: titleFromText(item.name, 'Make scenario'),
  description: '',
  status: item.status || 'unknown',
  priority: 'unknown',
  url: undefined,
  owners: [],
  labels: compact(['make', item.sourceType, item.active ? 'active' : 'paused']),
  dueAt: undefined,
  providerCreatedAt: item.createdAt,
  providerUpdatedAt: item.updatedAt,
  evidenceRefs: baseEvidence(account, item, 'Make scenario metadata'),
  raw: { id: item.id, sourceType: item.sourceType, scenarioId: item.scenarioId, teamId: item.teamId, folderId: item.folderId, status: item.status, active: item.active, createdAt: item.createdAt, updatedAt: item.updatedAt }
}));
makeAdapter.capabilities.credentialBackedSync = true;
makeAdapter.list = async account => (await makeWorkSignalClient.fetchDelta(account, null)).records;
makeAdapter.fetchDelta = (account, cursor) => makeWorkSignalClient.fetchDelta(account, cursor);
adapters.set('make', makeAdapter);

const tableauAdapter = buildAdapter('tableau', 'Tableau Cloud project and workbook metadata adapter', (account, item) => ({
  externalId: pick(item.id),
  sourceType: pick(item.sourceType, 'workbook'),
  title: titleFromText(item.name, 'Tableau work item'),
  description: '',
  status: item.status || 'unknown',
  priority: 'unknown',
  url: undefined,
  owners: [],
  labels: compact(['tableau', item.sourceType]),
  dueAt: undefined,
  providerCreatedAt: item.createdAt,
  providerUpdatedAt: item.updatedAt || item.createdAt,
  evidenceRefs: baseEvidence(account, item, 'Tableau Cloud metadata'),
  raw: { id: item.id, sourceType: item.sourceType, projectId: item.projectId, projectName: item.projectName, workbookId: item.workbookId, status: item.status, createdAt: item.createdAt, updatedAt: item.updatedAt }
}));
tableauAdapter.capabilities.credentialBackedSync = true;
tableauAdapter.list = async account => (await tableauWorkSignalClient.fetchDelta(account, null)).records;
tableauAdapter.fetchDelta = (account, cursor) => tableauWorkSignalClient.fetchDelta(account, cursor);
adapters.set('tableau', tableauAdapter);

const testRailAdapter = buildAdapter('testRail', 'TestRail active test-run metadata adapter', (account, item) => ({
  externalId: pick(item.id),
  sourceType: pick(item.sourceType, 'test_run'),
  title: titleFromText(item.name, 'TestRail test run'),
  description: '',
  status: item.status || 'unknown',
  priority: item.priority || 'unknown',
  url: undefined,
  owners: [],
  labels: compact(['testrail', item.sourceType, item.completed ? 'completed' : 'active']),
  dueAt: item.dueAt,
  providerCreatedAt: item.createdAt,
  providerUpdatedAt: item.updatedAt,
  evidenceRefs: baseEvidence(account, item, 'TestRail test-run metadata'),
  raw: { id: item.id, sourceType: item.sourceType, runId: item.runId, projectId: item.projectId, status: item.status, priority: item.priority, passedCount: item.passedCount, failedCount: item.failedCount, blockedCount: item.blockedCount, untestedCount: item.untestedCount, completed: item.completed, dueAt: item.dueAt, createdAt: item.createdAt, updatedAt: item.updatedAt, completedAt: item.completedAt }
}));
testRailAdapter.capabilities.credentialBackedSync = true;
testRailAdapter.list = async account => (await testRailWorkSignalClient.fetchDelta(account, null)).records;
testRailAdapter.fetchDelta = (account, cursor) => testRailWorkSignalClient.fetchDelta(account, cursor);
adapters.set('testRail', testRailAdapter);

const browserStackAdapter = buildAdapter('browserstack', 'BrowserStack Automate recent build metadata adapter', (account, item) => ({
  externalId: pick(item.id),
  sourceType: pick(item.sourceType, 'execution'),
  title: titleFromText(item.name, 'BrowserStack test build'),
  description: '',
  status: item.status || 'unknown',
  priority: item.priority || 'unknown',
  url: undefined,
  owners: [],
  labels: compact(['browserstack', item.sourceType, item.completed ? 'completed' : 'running']),
  dueAt: undefined,
  providerCreatedAt: undefined,
  providerUpdatedAt: undefined,
  evidenceRefs: baseEvidence(account, item, 'BrowserStack Automate build metadata'),
  raw: { id: item.id, sourceType: item.sourceType, buildId: item.buildId, status: item.status, priority: item.priority, durationMs: item.durationMs, completed: item.completed }
}));
browserStackAdapter.capabilities.credentialBackedSync = true;
browserStackAdapter.list = async account => (await browserStackWorkSignalClient.fetchDelta(account, null)).records;
browserStackAdapter.fetchDelta = (account, cursor) => browserStackWorkSignalClient.fetchDelta(account, cursor);
adapters.set('browserstack', browserStackAdapter);

const oneDriveAdapter = buildAdapter('onedrive', 'OneDrive root item metadata adapter', (account, item) => ({
  externalId: pick(item.id),
  sourceType: pick(item.sourceType, 'file'),
  title: titleFromText(item.name, 'OneDrive item'),
  description: '',
  status: item.status || 'open',
  priority: 'unknown',
  url: undefined,
  owners: [],
  labels: compact(['onedrive', item.sourceType]),
  dueAt: undefined,
  providerCreatedAt: item.createdAt,
  providerUpdatedAt: item.updatedAt,
  evidenceRefs: baseEvidence(account, item, 'OneDrive root item metadata'),
  raw: { id: item.id, sourceType: item.sourceType, itemId: item.itemId, status: item.status, createdAt: item.createdAt, updatedAt: item.updatedAt }
}));
oneDriveAdapter.capabilities.credentialBackedSync = true;
oneDriveAdapter.list = async account => (await oneDriveWorkSignalClient.fetchDelta(account, null)).records;
oneDriveAdapter.fetchDelta = (account, cursor) => oneDriveWorkSignalClient.fetchDelta(account, cursor);
adapters.set('onedrive', oneDriveAdapter);

const sharePointAdapter = buildAdapter('sharepoint', 'SharePoint selected-site root metadata adapter', (account, item) => ({
  externalId: pick(item.id),
  sourceType: pick(item.sourceType, 'file'),
  title: titleFromText(item.name, 'SharePoint item'),
  description: '',
  status: item.status || 'open',
  priority: 'unknown',
  url: undefined,
  owners: [],
  labels: compact(['sharepoint', item.sourceType]),
  dueAt: undefined,
  providerCreatedAt: item.createdAt,
  providerUpdatedAt: item.updatedAt,
  evidenceRefs: baseEvidence(account, item, 'SharePoint selected-site root metadata'),
  raw: { id: item.id, sourceType: item.sourceType, itemId: item.itemId, siteId: item.siteId, status: item.status, createdAt: item.createdAt, updatedAt: item.updatedAt }
}));
sharePointAdapter.capabilities.credentialBackedSync = true;
sharePointAdapter.list = async account => (await sharePointWorkSignalClient.fetchDelta(account, null)).records;
sharePointAdapter.fetchDelta = (account, cursor) => sharePointWorkSignalClient.fetchDelta(account, cursor);
adapters.set('sharepoint', sharePointAdapter);

const xeroAdapter = buildAdapter('xero', 'Xero selected-organisation sales invoice metadata adapter', (account, item) => ({
  externalId: pick(item.id),
  sourceType: 'sales_invoice',
  title: 'Xero sales invoice',
  description: '',
  status: item.status || 'open',
  priority: 'unknown',
  url: undefined,
  owners: [],
  labels: compact(['xero', 'sales_invoice', item.status]),
  dueAt: item.dueAt,
  providerCreatedAt: item.createdAt,
  providerUpdatedAt: item.updatedAt,
  evidenceRefs: baseEvidence(account, item, 'Xero selected-organisation sales invoice metadata'),
  raw: { id: item.id, sourceType: 'sales_invoice', invoiceId: item.invoiceId, tenantId: item.tenantId, status: item.status, dueAt: item.dueAt, createdAt: item.createdAt, updatedAt: item.updatedAt }
}));
xeroAdapter.capabilities.credentialBackedSync = true;
xeroAdapter.list = async account => (await xeroWorkSignalClient.fetchDelta(account, null)).records;
xeroAdapter.fetchDelta = (account, cursor) => xeroWorkSignalClient.fetchDelta(account, cursor);
adapters.set('xero', xeroAdapter);

const googleFormsAdapter = buildAdapter('google_forms', 'Google Forms intake metadata adapter', (account, item) => ({
  externalId: pick(item.id),
  sourceType: 'form',
  title: titleFromText(item.name, 'Google Form'),
  description: '',
  status: item.status || 'open',
  priority: 'unknown',
  url: undefined,
  owners: [],
  labels: compact(['google_forms', 'form']),
  dueAt: undefined,
  providerCreatedAt: item.createdAt,
  providerUpdatedAt: item.updatedAt,
  evidenceRefs: baseEvidence(account, item, 'Google Forms intake metadata'),
  raw: { id: item.id, sourceType: 'form', formId: item.formId, status: item.status, createdAt: item.createdAt, updatedAt: item.updatedAt }
}));
googleFormsAdapter.capabilities.credentialBackedSync = true;
googleFormsAdapter.list = async account => (await googleFormsWorkSignalClient.fetchDelta(account, null)).records;
googleFormsAdapter.fetchDelta = (account, cursor) => googleFormsWorkSignalClient.fetchDelta(account, cursor);
adapters.set('google_forms', googleFormsAdapter);

const muralAdapter = buildAdapter('mural', 'Mural selected-workspace active mural metadata adapter', (account, item) => ({ externalId: pick(item.id), sourceType: 'mural', title: titleFromText(item.name, 'Mural'), description: '', status: item.status || 'open', priority: 'unknown', url: undefined, owners: [], labels: compact(['mural', 'active']), dueAt: undefined, providerCreatedAt: item.createdAt, providerUpdatedAt: item.updatedAt, evidenceRefs: baseEvidence(account, item, 'Mural selected-workspace metadata'), raw: { id: item.id, muralId: item.muralId, workspaceId: item.workspaceId, status: item.status, createdAt: item.createdAt, updatedAt: item.updatedAt } }));
muralAdapter.capabilities.credentialBackedSync = true;
muralAdapter.list = async account => (await muralWorkSignalClient.fetchDelta(account, null)).records;
muralAdapter.fetchDelta = (account, cursor) => muralWorkSignalClient.fetchDelta(account, cursor);
adapters.set('mural', muralAdapter);

const canvaAdapter = buildAdapter('canva', 'Canva bounded design metadata adapter', (account, item) => ({ externalId: pick(item.id), sourceType: 'design', title: titleFromText(item.name, 'Canva design'), description: '', status: item.status || 'open', priority: 'unknown', url: undefined, owners: [], labels: compact(['canva', 'design']), dueAt: undefined, providerCreatedAt: item.createdAt, providerUpdatedAt: item.updatedAt, evidenceRefs: baseEvidence(account, item, 'Canva design metadata'), raw: { id: item.id, sourceType: 'design', designId: item.designId, status: item.status, createdAt: item.createdAt, updatedAt: item.updatedAt } }));
canvaAdapter.capabilities.credentialBackedSync = true;
canvaAdapter.list = async account => (await canvaWorkSignalClient.fetchDelta(account, null)).records;
canvaAdapter.fetchDelta = (account, cursor) => canvaWorkSignalClient.fetchDelta(account, cursor);
adapters.set('canva', canvaAdapter);

const quickBooksAdapter = buildAdapter('quickbooks', 'QuickBooks selected-company sales-invoice metadata adapter', (account, item) => ({ externalId: pick(item.id), sourceType: 'sales_invoice', title: 'QuickBooks sales invoice', description: '', status: item.status || 'open', priority: 'unknown', url: undefined, owners: [], labels: compact(['quickbooks', 'sales_invoice', item.status]), dueAt: item.dueAt, providerCreatedAt: item.createdAt, providerUpdatedAt: item.updatedAt, evidenceRefs: baseEvidence(account, item, 'QuickBooks sales-invoice metadata'), raw: { id: item.id, sourceType: 'sales_invoice', invoiceId: item.invoiceId, realmId: item.realmId, status: item.status, dueAt: item.dueAt, createdAt: item.createdAt, updatedAt: item.updatedAt } }));
quickBooksAdapter.capabilities.credentialBackedSync = true;
quickBooksAdapter.list = async account => (await quickBooksWorkSignalClient.fetchDelta(account, null)).records;
quickBooksAdapter.fetchDelta = (account, cursor) => quickBooksWorkSignalClient.fetchDelta(account, cursor);
adapters.set('quickbooks', quickBooksAdapter);

const powerBiAdapter = buildAdapter('power_bi', 'Power BI bounded report-catalog metadata adapter', (account, item) => ({ externalId: pick(item.id), sourceType: 'report', title: titleFromText(item.name, 'Power BI report'), description: '', status: 'open', priority: 'unknown', url: undefined, owners: [], labels: compact(['power_bi', 'report', item.reportType]), dueAt: undefined, providerCreatedAt: undefined, providerUpdatedAt: undefined, evidenceRefs: [{ provider: account.connectorId, externalId: String(pick(item.id, 'unknown')), label: 'Power BI report metadata', type: account.connectorId }], raw: { id: item.id, sourceType: 'report', reportId: item.reportId, reportType: item.reportType } }));
powerBiAdapter.capabilities.credentialBackedSync = true;
powerBiAdapter.list = async account => (await powerBiWorkSignalClient.fetchDelta(account, null)).records;
powerBiAdapter.fetchDelta = (account, cursor) => powerBiWorkSignalClient.fetchDelta(account, cursor);
adapters.set('power_bi', powerBiAdapter);

const dataStudioAdapter = buildAdapter('looker_studio', 'Data Studio bounded asset-metadata adapter', (account, item) => ({
  externalId: pick(item.id),
  sourceType: pick(item.sourceType, 'report'),
  title: titleFromText(item.name, 'Data Studio asset'),
  description: '',
  status: item.status || 'open',
  priority: 'unknown',
  url: undefined,
  owners: [],
  labels: compact(['looker_studio', item.sourceType]),
  dueAt: undefined,
  providerCreatedAt: item.createdAt,
  providerUpdatedAt: item.updatedAt,
  evidenceRefs: [{ provider: account.connectorId, externalId: String(pick(item.id, 'unknown')), label: 'Data Studio asset metadata', type: account.connectorId }],
  raw: { id: item.id, assetId: item.assetId, sourceType: item.sourceType, status: item.status, createdAt: item.createdAt, updatedAt: item.updatedAt }
}));
dataStudioAdapter.capabilities.credentialBackedSync = true;
dataStudioAdapter.list = async account => (await dataStudioWorkSignalClient.fetchDelta(account, null)).records;
dataStudioAdapter.fetchDelta = (account, cursor) => dataStudioWorkSignalClient.fetchDelta(account, cursor);
adapters.set('looker_studio', dataStudioAdapter);

const zapierAdapter = buildAdapter('zapier', 'Zapier bounded automation-metadata adapter', (account, item) => ({
  externalId: pick(item.id),
  sourceType: 'automation',
  title: titleFromText(item.name, 'Zapier automation'),
  description: '',
  status: item.status || 'inactive',
  priority: 'unknown',
  url: undefined,
  owners: [],
  labels: compact(['zapier', 'automation', item.status]),
  dueAt: undefined,
  providerCreatedAt: undefined,
  providerUpdatedAt: item.updatedAt,
  evidenceRefs: [{ provider: account.connectorId, externalId: String(pick(item.id, 'unknown')), label: 'Zapier automation metadata', type: account.connectorId }],
  raw: { id: item.id, zapId: item.zapId, sourceType: 'automation', status: item.status, lastSuccessfulRunAt: item.lastSuccessfulRunAt, updatedAt: item.updatedAt }
}));
zapierAdapter.capabilities.credentialBackedSync = true;
zapierAdapter.list = async account => (await zapierWorkSignalClient.fetchDelta(account, null)).records;
zapierAdapter.fetchDelta = (account, cursor) => zapierWorkSignalClient.fetchDelta(account, cursor);
adapters.set('zapier', zapierAdapter);

const jiraAlignAdapter = buildAdapter('jira_align', 'Jira Align bounded portfolio and program metadata adapter', (account, item) => ({
  externalId: pick(item.id),
  sourceType: pick(item.sourceType, 'program'),
  title: titleFromText(item.name, 'Jira Align item'),
  description: '',
  status: 'open',
  priority: 'unknown',
  url: undefined,
  owners: [],
  labels: compact(['jira_align', item.sourceType]),
  dueAt: undefined,
  providerCreatedAt: undefined,
  providerUpdatedAt: item.updatedAt,
  evidenceRefs: [{ provider: account.connectorId, externalId: String(pick(item.id, 'unknown')), label: 'Jira Align portfolio and program metadata', type: account.connectorId }],
  raw: { id: item.id, jiraAlignId: item.jiraAlignId, sourceType: item.sourceType, updatedAt: item.updatedAt }
}));
jiraAlignAdapter.capabilities.credentialBackedSync = true;
jiraAlignAdapter.list = async account => (await jiraAlignWorkSignalClient.fetchDelta(account, null)).records;
jiraAlignAdapter.fetchDelta = (account, cursor) => jiraAlignWorkSignalClient.fetchDelta(account, cursor);
adapters.set('jira_align', jiraAlignAdapter);

const surveyMonkeyAdapter = buildAdapter('survey_monkey', 'SurveyMonkey survey metadata adapter', (account, item) => ({
  externalId: pick(item.id),
  sourceType: pick(item.sourceType, 'survey'),
  title: titleFromText(item.name, 'SurveyMonkey survey'),
  description: '',
  status: item.status || 'open',
  priority: 'unknown',
  url: undefined,
  owners: [],
  labels: compact(['survey_monkey', item.sourceType]),
  dueAt: undefined,
  providerCreatedAt: undefined,
  providerUpdatedAt: undefined,
  evidenceRefs: baseEvidence(account, item, 'SurveyMonkey survey metadata'),
  raw: { id: item.id, sourceType: item.sourceType, surveyId: item.surveyId, status: item.status }
}));
surveyMonkeyAdapter.capabilities.credentialBackedSync = true;
surveyMonkeyAdapter.list = async account => (await surveyMonkeyWorkSignalClient.fetchDelta(account, null)).records;
surveyMonkeyAdapter.fetchDelta = (account, cursor) => surveyMonkeyWorkSignalClient.fetchDelta(account, cursor);
adapters.set('survey_monkey', surveyMonkeyAdapter);

const googleDriveAdapter = buildAdapter('google_drive', 'Google Drive user item metadata adapter', (account, item) => ({
  externalId: pick(item.id),
  sourceType: pick(item.sourceType, 'file'),
  title: titleFromText(item.name, 'Google Drive item'),
  description: '',
  status: item.status || 'open',
  priority: 'unknown',
  url: undefined,
  owners: [],
  labels: compact(['google_drive', item.sourceType]),
  dueAt: undefined,
  providerCreatedAt: item.createdAt,
  providerUpdatedAt: item.updatedAt,
  evidenceRefs: baseEvidence(account, item, 'Google Drive user item metadata'),
  raw: { id: item.id, sourceType: item.sourceType, itemId: item.itemId, status: item.status, createdAt: item.createdAt, updatedAt: item.updatedAt }
}));
googleDriveAdapter.capabilities.credentialBackedSync = true;
googleDriveAdapter.list = async account => (await googleDriveWorkSignalClient.fetchDelta(account, null)).records;
googleDriveAdapter.fetchDelta = (account, cursor) => googleDriveWorkSignalClient.fetchDelta(account, cursor);
adapters.set('google_drive', googleDriveAdapter);

const genericWebhookAdapter = {
  connectorId: 'webhook_generic',
  label: 'Generic HMAC-verified inbound webhook adapter',
  capabilities: {
    list: false,
    fetchDelta: false,
    normalize: true,
    applyAction: false,
    credentialBackedSync: true,
    inboundWebhook: true
  },
  async list() {
    return [];
  },
  async fetchDelta() {
    const error = new Error('Generic Webhook accepts verified inbound events and cannot be pulled.');
    error.statusCode = 405;
    throw error;
  },
  normalize(account, event = {}) {
    const externalId = pick(event.id, event.externalId);
    return {
      externalId: String(externalId || ''),
      sourceType: pick(event.type, event.sourceType, 'task'),
      title: titleFromText(event.title, 'Untitled webhook event'),
      description: '',
      status: pick(event.status, 'open'),
      priority: pick(event.priority, 'unknown'),
      url: undefined,
      owners: [],
      labels: ['generic_webhook'],
      dueAt: undefined,
      providerCreatedAt: event.occurredAt,
      providerUpdatedAt: pick(event.updatedAt, event.occurredAt),
      evidenceRefs: [{
        provider: account.connectorId,
        externalId: String(externalId || 'unknown'),
        label: 'Verified generic webhook metadata',
        type: account.connectorId
      }],
      raw: {
        eventId: externalId,
        sourceType: event.type,
        status: event.status,
        priority: event.priority,
        occurredAt: event.occurredAt,
        updatedAt: event.updatedAt
      }
    };
  },
  async applyAction() {
    const error = new Error('Work signal adapters are read-only and cannot write to external providers');
    error.statusCode = 403;
    throw error;
  }
};
adapters.set('webhook_generic', genericWebhookAdapter);

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
      methods: ['list', 'fetchDelta', 'normalize', 'applyAction'].filter(method => adapter.capabilities[method])
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
