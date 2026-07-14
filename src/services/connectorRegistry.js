const CATEGORIES = {
  work_management: 'Project and work management',
  software_delivery: 'Software delivery',
  communication: 'Communication',
  calendar_email: 'Calendar and email',
  docs_knowledge: 'Docs and knowledge',
  files_assets: 'Files and assets',
  whiteboard_design: 'Whiteboard and design',
  time_finance: 'Time, finance, and resourcing',
  crm_support: 'CRM, support, and stakeholders',
  automation_data: 'Automation, forms, and data',
  incident_quality: 'Incident, quality, and monitoring'
};

const oauth2 = (overrides) => ({
  type: 'oauth2',
  scopes: [],
  tokenAuth: 'body',
  ...overrides
});

const apiKey = (overrides = {}) => ({
  type: 'api_key',
  fields: [
    {
      name: 'apiKey',
      label: 'API key',
      secret: true,
      required: true
    }
  ],
  ...overrides
});

const pat = (overrides = {}) => ({
  type: 'personal_access_token',
  fields: [
    {
      name: 'token',
      label: 'Personal access token',
      secret: true,
      required: true
    }
  ],
  ...overrides
});

const manual = (overrides = {}) => ({
  type: 'manual',
  fields: [
    {
      name: 'workspaceUrl',
      label: 'Workspace URL',
      secret: false,
      required: true
    }
  ],
  ...overrides
});

const CONNECTORS = [
  {
    id: 'trello',
    name: 'Trello',
    category: 'work_management',
    description: 'Boards, lists, cards, members, labels, comments, checklists, due dates, and webhooks.',
    auth: apiKey({
      docsUrl: 'https://developer.atlassian.com/cloud/trello/guides/rest-api/api-introduction/',
      fields: [
        { name: 'apiKey', label: 'API key', secret: true, required: true },
        { name: 'apiToken', label: 'API token', secret: true, required: true }
      ]
    }),
    sync: ['boards', 'lists', 'cards', 'members', 'comments', 'webhooks']
  },
  {
    id: 'jira_software',
    name: 'Jira Software',
    category: 'software_delivery',
    description: 'Epics, issues, sprints, releases, dependencies, comments, changelogs, and project health.',
    auth: oauth2({
      envPrefix: 'JIRA',
      authorizationUrl: 'https://auth.atlassian.com/authorize',
      tokenUrl: 'https://auth.atlassian.com/oauth/token',
      audience: 'api.atlassian.com',
      scopes: ['read:jira-work', 'read:jira-user', 'offline_access'],
      docsUrl: 'https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/'
    }),
    sync: ['projects', 'issues', 'sprints', 'versions', 'comments', 'users']
  },
  {
    id: 'jira_service_management',
    name: 'Jira Service Management',
    category: 'software_delivery',
    description: 'Service requests, incidents, change requests, queues, SLAs, and customer outcomes through Atlassian service products.',
    auth: oauth2({
      envPrefix: 'JIRA_SERVICE',
      authorizationUrl: 'https://auth.atlassian.com/authorize',
      tokenUrl: 'https://auth.atlassian.com/oauth/token',
      audience: 'api.atlassian.com',
      scopes: ['read:jira-work', 'read:servicedesk-data', 'offline_access'],
      docsUrl: 'https://developer.atlassian.com/cloud/jira/service-desk/rest/api-group-servicedesk/'
    }),
    sync: ['projects', 'queues', 'requests', 'incidents', 'customers', 'users']
  },
  {
    id: 'rally',
    name: 'Rally',
    category: 'software_delivery',
    description: 'Backlog items, features, defects, tasks, sprints, release plans, and dependencies for agile portfolios.',
    auth: apiKey({
      docsUrl: 'https://help.rallydev.com/rally-api',
      fields: [
        { name: 'baseUrl', label: 'Rally base URL', required: true },
        { name: 'apiKey', label: 'API key', secret: true, required: true }
      ]
    }),
    sync: ['projects', 'workspaces', 'iterations', 'user_stories', 'defects', 'users']
  },
  {
    id: 'redmine',
    name: 'Redmine',
    category: 'work_management',
    description: 'Projects, issues, trackers, versions, forums, wiki pages, and activity streams.',
    auth: apiKey({
      docsUrl: 'https://www.redmine.org/projects/redmine/wiki/Rest_api',
      fields: [
        { name: 'baseUrl', label: 'Redmine base URL', required: true },
        { name: 'apiKey', label: 'API key', secret: true, required: true }
      ]
    }),
    sync: ['projects', 'issues', 'versions', 'time_entries', 'wiki', 'users']
  },
  {
    id: 'backlog',
    name: 'Backlog',
    category: 'work_management',
    description: 'Epics, stories, bugs, sprints, releases, users, and burndown signals from Nulab Backlog.',
    auth: apiKey({
      docsUrl: 'https://developer.nulab.com/docs/backlog/',
      fields: [
        { name: 'spaceId', label: 'Nulab space ID', required: true },
        { name: 'apiKey', label: 'API key', secret: true, required: true }
      ]
    }),
    sync: ['projects', 'issues', 'milestones', 'wiki', 'users']
  },
  {
    id: 'taiga',
    name: 'Taiga',
    category: 'work_management',
    description: 'Projects, epics, user stories, milestones, sprints, tasks, and workflow policies.',
    auth: apiKey({
      docsUrl: 'https://docs.taiga.io/api/',
      fields: [
        { name: 'baseUrl', label: 'Taiga base URL', required: true },
        { name: 'token', label: 'Access token', secret: true, required: true }
      ]
    }),
    sync: ['projects', 'epics', 'user_stories', 'tasks', 'sprints', 'users']
  },
  {
    id: 'youtrack',
    name: 'YouTrack',
    category: 'software_delivery',
    description: 'Projects, issues, agile boards, sprints, users, comments, and release planning data.',
    auth: apiKey({
      docsUrl: 'https://www.jetbrains.com/help/youtrack/server/api.html',
      fields: [
        { name: 'baseUrl', label: 'YouTrack base URL', required: true },
        { name: 'token', label: 'Permanent token', secret: true, required: true }
      ]
    }),
    sync: ['projects', 'issues', 'users', 'agiles', 'boards', 'comments']
  },
  {
    id: 'podio',
    name: 'Podio',
    category: 'work_management',
    description: 'Workspaces, apps, items, tasks, and project workflows from Podio team operations.',
    auth: apiKey({
      docsUrl: 'https://developers.podio.com/api/',
      fields: [
        { name: 'baseUrl', label: 'Podio API URL', required: true },
        { name: 'apiKey', label: 'Client API key', secret: true, required: true }
      ]
    }),
    sync: ['workspaces', 'apps', 'items', 'tasks', 'users']
  },
  {
    id: 'asana',
    name: 'Asana',
    category: 'work_management',
    description: 'Portfolios, projects, tasks, sections, goals, teams, custom fields, and status updates.',
    auth: oauth2({
      envPrefix: 'ASANA',
      authorizationUrl: 'https://app.asana.com/-/oauth_authorize',
      tokenUrl: 'https://app.asana.com/-/oauth_token',
      scopes: ['workspaces:read', 'projects:read', 'project_sections:read', 'tasks:read'],
      docsUrl: 'https://developers.asana.com/docs/oauth'
    }),
    sync: ['workspaces', 'portfolios', 'projects', 'tasks', 'goals', 'users']
  },
  {
    id: 'monday',
    name: 'monday.com',
    category: 'work_management',
    description: 'Read-only monday.com board items with group, status, people, priority, and date metadata.',
    auth: oauth2({
      envPrefix: 'MONDAY',
      authorizationUrl: 'https://auth.monday.com/oauth2/authorize',
      tokenUrl: 'https://auth.monday.com/oauth2/token',
      scopes: ['boards:read'],
      docsUrl: 'https://developer.monday.com/apps/docs/oauth'
    }),
    sync: ['boards', 'items']
  },
  {
    id: 'clickup',
    name: 'ClickUp',
    category: 'work_management',
    description: 'Read-only ClickUp task metadata across authorized workspaces, with status, priority, owners, dates, labels, and dependency context.',
    auth: oauth2({
      envPrefix: 'CLICKUP',
      authorizationUrl: 'https://app.clickup.com/api',
      tokenUrl: 'https://api.clickup.com/api/v2/oauth/token',
      scopes: [],
      docsUrl: 'https://developer.clickup.com/docs/authentication'
    }),
    sync: ['workspaces', 'tasks']
  },
  {
    id: 'linear',
    name: 'Linear',
    category: 'software_delivery',
    description: 'Read-only Linear issues with team, project, cycle, workflow, assignee, and label context.',
    auth: oauth2({
      envPrefix: 'LINEAR',
      authorizationUrl: 'https://linear.app/oauth/authorize',
      tokenUrl: 'https://api.linear.app/oauth/token',
      scopes: ['read'],
      docsUrl: 'https://linear.app/developers/oauth-2-0-authentication'
    }),
    sync: ['teams', 'issues', 'projects', 'cycles', 'labels']
  },
  {
    id: 'notion',
    name: 'Notion',
    category: 'docs_knowledge',
    description: 'Read-only shared Notion pages and data-source metadata for project trackers, docs, and knowledge bases.',
    auth: oauth2({
      envPrefix: 'NOTION',
      authorizationUrl: 'https://api.notion.com/v1/oauth/authorize',
      tokenUrl: 'https://api.notion.com/v1/oauth/token',
      tokenAuth: 'basic',
      scopes: [],
      extraAuthParams: { owner: 'user' },
      docsUrl: 'https://developers.notion.com/docs/authorization'
    }),
    sync: ['pages', 'databases']
  },
  {
    id: 'microsoft_365',
    name: 'Microsoft 365',
    category: 'calendar_email',
    description: 'Read-only Outlook Calendar, Microsoft To Do, and signed-in-user OneDrive metadata through Microsoft Graph.',
    auth: oauth2({
      envPrefix: 'MICROSOFT',
      authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      scopes: [
        'offline_access',
        'User.Read',
        'Calendars.Read',
        'Files.Read',
        'Tasks.Read'
      ],
      docsUrl: 'https://learn.microsoft.com/en-us/entra/identity-platform/scopes-oidc'
    }),
    sync: ['calendar', 'todo', 'files']
  },
  {
    id: 'google_workspace',
    name: 'Google Workspace',
    category: 'calendar_email',
    description: 'Gmail, Calendar, Drive, Docs, Sheets, Slides, Meet artifacts, and directory data through Google APIs.',
    auth: oauth2({
      envPrefix: 'GOOGLE',
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scopes: [
        'openid',
        'email',
        'profile',
        'https://www.googleapis.com/auth/calendar.readonly',
        'https://www.googleapis.com/auth/drive.metadata.readonly',
        'https://www.googleapis.com/auth/gmail.readonly'
      ],
      extraAuthParams: { access_type: 'offline', prompt: 'consent' },
      docsUrl: 'https://developers.google.com/identity/protocols/oauth2/web-server'
    }),
    sync: ['mail', 'calendar', 'drive', 'docs', 'sheets', 'slides', 'users']
  },
  {
    id: 'slack',
    name: 'Slack',
    category: 'communication',
    description: 'Channels, messages, users, files, huddles metadata, project signals, and workflow notifications.',
    auth: oauth2({
      envPrefix: 'SLACK',
      authorizationUrl: 'https://slack.com/oauth/v2/authorize',
      tokenUrl: 'https://slack.com/api/oauth.v2.access',
      scopes: ['channels:read', 'channels:history', 'groups:read', 'groups:history', 'users:read', 'team:read'],
      docsUrl: 'https://api.slack.com/authentication/oauth-v2'
    }),
    sync: ['channels', 'messages', 'users', 'files', 'notifications']
  },
  {
    id: 'github',
    name: 'GitHub',
    category: 'software_delivery',
    description: 'Repositories, issues, pull requests, projects, milestones, discussions, actions, and releases.',
    auth: oauth2({
      envPrefix: 'GITHUB',
      authorizationUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      scopes: ['repo', 'read:org', 'project', 'workflow'],
      docsUrl: 'https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps'
    }),
    sync: ['repositories', 'issues', 'pull_requests', 'projects', 'actions', 'releases']
  },
  {
    id: 'gitlab',
    name: 'GitLab',
    category: 'software_delivery',
    description: 'Groups, projects, issues, epics, merge requests, milestones, pipelines, and releases.',
    auth: oauth2({
      envPrefix: 'GITLAB',
      authorizationUrl: 'https://gitlab.com/oauth/authorize',
      tokenUrl: 'https://gitlab.com/oauth/token',
      scopes: ['read_api', 'read_user'],
      docsUrl: 'https://docs.gitlab.com/integration/oauth_provider/'
    }),
    sync: ['groups', 'projects', 'issues', 'epics', 'merge_requests', 'pipelines']
  },
  {
    id: 'zoom',
    name: 'Zoom',
    category: 'communication',
    description: 'Meetings, recordings, webinars, users, transcripts, and stakeholder meeting cadence.',
    auth: oauth2({
      envPrefix: 'ZOOM',
      authorizationUrl: 'https://zoom.us/oauth/authorize',
      tokenUrl: 'https://zoom.us/oauth/token',
      tokenAuth: 'basic',
      scopes: ['meeting:read', 'recording:read', 'user:read'],
      docsUrl: 'https://developers.zoom.us/docs/integrations/'
    }),
    sync: ['meetings', 'recordings', 'webinars', 'users']
  },
  {
    id: 'figma',
    name: 'Figma',
    category: 'whiteboard_design',
    description: 'Design files, projects, teams, comments, branches, prototypes, and design review status.',
    auth: oauth2({
      envPrefix: 'FIGMA',
      authorizationUrl: 'https://www.figma.com/oauth',
      tokenUrl: 'https://api.figma.com/v1/oauth/token',
      scopes: ['files:read'],
      docsUrl: 'https://www.figma.com/developers/api#oauth2'
    }),
    sync: ['files', 'projects', 'comments', 'users']
  },
  {
    id: 'miro',
    name: 'Miro',
    category: 'whiteboard_design',
    description: 'Boards, frames, cards, sticky notes, diagrams, comments, and workshop artifacts.',
    auth: oauth2({
      envPrefix: 'MIRO',
      authorizationUrl: 'https://miro.com/oauth/authorize',
      tokenUrl: 'https://api.miro.com/v1/oauth/token',
      scopes: ['boards:read', 'identity:read'],
      docsUrl: 'https://developers.miro.com/docs/getting-started-with-oauth'
    }),
    sync: ['boards', 'items', 'comments', 'users']
  },
  {
    id: 'dropbox',
    name: 'Dropbox',
    category: 'files_assets',
    description: 'Files, folders, shared links, paper docs, approvals, and client deliverable assets.',
    auth: oauth2({
      envPrefix: 'DROPBOX',
      authorizationUrl: 'https://www.dropbox.com/oauth2/authorize',
      tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
      scopes: ['files.metadata.read', 'files.content.read', 'sharing.read'],
      docsUrl: 'https://developers.dropbox.com/oauth-guide'
    }),
    sync: ['files', 'folders', 'shared_links']
  },
  {
    id: 'box',
    name: 'Box',
    category: 'files_assets',
    description: 'Enterprise content, folders, files, comments, tasks, approvals, and retention-aware project assets.',
    auth: oauth2({
      envPrefix: 'BOX',
      authorizationUrl: 'https://account.box.com/api/oauth2/authorize',
      tokenUrl: 'https://api.box.com/oauth2/token',
      scopes: [],
      docsUrl: 'https://developer.box.com/guides/authentication/oauth2/'
    }),
    sync: ['files', 'folders', 'comments', 'tasks']
  },
  {
    id: 'hubspot',
    name: 'HubSpot',
    category: 'crm_support',
    description: 'Deals, companies, contacts, tickets, tasks, notes, timelines, and customer-facing project signals.',
    auth: oauth2({
      envPrefix: 'HUBSPOT',
      authorizationUrl: 'https://app.hubspot.com/oauth/authorize',
      tokenUrl: 'https://api.hubapi.com/oauth/v1/token',
      scopes: ['crm.objects.contacts.read', 'crm.objects.companies.read', 'crm.objects.deals.read', 'tickets'],
      docsUrl: 'https://developers.hubspot.com/docs/api/oauth-quickstart-guide'
    }),
    sync: ['contacts', 'companies', 'deals', 'tickets', 'tasks']
  },
  {
    id: 'salesforce',
    name: 'Salesforce',
    category: 'crm_support',
    description: 'Accounts, opportunities, contacts, cases, tasks, events, and executive stakeholder context.',
    auth: oauth2({
      envPrefix: 'SALESFORCE',
      authorizationUrl: 'https://login.salesforce.com/services/oauth2/authorize',
      tokenUrl: 'https://login.salesforce.com/services/oauth2/token',
      scopes: ['api', 'refresh_token'],
      docsUrl: 'https://help.salesforce.com/s/articleView?id=sf.remoteaccess_oauth_web_server_flow.htm'
    }),
    sync: ['accounts', 'opportunities', 'contacts', 'cases', 'tasks', 'events']
  },
  {
    id: 'intercom',
    name: 'Intercom',
    category: 'crm_support',
    description: 'Companies, contacts, conversations, tickets, SLAs, and customer escalation context.',
    auth: oauth2({
      envPrefix: 'INTERCOM',
      authorizationUrl: 'https://app.intercom.com/oauth',
      tokenUrl: 'https://api.intercom.io/auth/eagle/token',
      scopes: [],
      docsUrl: 'https://developers.intercom.com/docs/references/rest-api/api.intercom.io/authentication/'
    }),
    sync: ['contacts', 'companies', 'conversations', 'tickets']
  },

  // High-value token/API-key connectors used by project managers across 2015-2026.
  { id: 'wrike', name: 'Wrike', category: 'work_management', description: 'Read-only projects and task metadata with owners, schedules, project context, and dependency identifiers.', auth: pat({ docsUrl: 'https://developers.wrike.com/', fields: [{ name: 'token', label: 'Permanent access token', secret: true, required: true }, { name: 'apiUrl', label: 'Wrike API URL (EU only)', secret: false, required: false }] }), sync: ['projects', 'tasks'] },
  { id: 'smartsheet', name: 'Smartsheet', category: 'work_management', description: 'Read-only project sheet rows with selected task, status, priority, owner, and due-date context.', auth: pat({ docsUrl: 'https://developers.smartsheet.com/api/smartsheet/openapi', fields: [{ name: 'token', label: 'API access token', secret: true, required: true }, { name: 'apiUrl', label: 'Smartsheet API URL (EU/AU only)', secret: false, required: false }] }), sync: ['sheets', 'rows'] },
  { id: 'airtable', name: 'Airtable', category: 'automation_data', description: 'Read-only allowlisted task records from a selected base and table.', auth: pat({ docsUrl: 'https://airtable.com/developers/web/api/authentication', fields: [{ name: 'token', label: 'Personal access token', secret: true, required: true }, { name: 'baseId', label: 'Base ID', secret: false, required: true }, { name: 'tableName', label: 'Table name', secret: false, required: true }, { name: 'fieldNames', label: 'Allowed task fields (comma-separated)', secret: false, required: true }] }), sync: ['bases', 'tables', 'records'] },
  { id: 'basecamp', name: 'Basecamp', category: 'work_management', description: 'Projects, to-dos, messages, schedules, docs, files, hill charts, and clients.', auth: manual({ docsUrl: 'https://github.com/basecamp/api' }), sync: ['projects', 'todos', 'messages', 'schedules', 'files'] },
  { id: 'microsoft_project', name: 'Microsoft Project', category: 'work_management', description: 'Project plans, schedules, resource assignments, milestones, and portfolio reporting.', auth: manual({ docsUrl: 'https://learn.microsoft.com/en-us/project/' }), sync: ['projects', 'schedules', 'resources', 'milestones'] },
  { id: 'microsoft_planner', name: 'Microsoft Planner', category: 'work_management', description: 'Plans, buckets, tasks, assignments, checklist items, labels, and due dates through Graph.', auth: manual({ docsUrl: 'https://learn.microsoft.com/en-us/graph/api/resources/planner-overview' }), sync: ['plans', 'buckets', 'tasks', 'assignments'] },
  { id: 'azure_devops', name: 'Azure DevOps', category: 'software_delivery', description: 'Read-only Azure DevOps work items with project, status, priority, owner, schedule, and dependency context.', auth: pat({ docsUrl: 'https://learn.microsoft.com/en-us/azure/devops/integrate/get-started/authentication/authentication-guidance', fields: [{ name: 'organizationUrl', label: 'Azure DevOps organization URL', placeholder: 'https://dev.azure.com/your-organization', required: true }, { name: 'token', label: 'Personal access token (Work Items Read)', secret: true, required: true }] }), sync: ['projects', 'work_items'] },
  { id: 'bitbucket', name: 'Bitbucket', category: 'software_delivery', description: 'Read-only repository issues and open pull requests with owners and delivery state.', auth: pat({ docsUrl: 'https://developer.atlassian.com/cloud/bitbucket/rest/intro/', fields: [{ name: 'workspace', label: 'Workspace slug', placeholder: 'your-workspace', required: true }, { name: 'token', label: 'API token', secret: true, required: true }] }), sync: ['repositories', 'issues', 'pull_requests'] },
  { id: 'confluence', name: 'Confluence', category: 'docs_knowledge', description: 'Spaces, pages, decisions, meeting notes, comments, owners, and project knowledge.', auth: manual({ docsUrl: 'https://developer.atlassian.com/cloud/confluence/oauth-2-3lo-apps/' }), sync: ['spaces', 'pages', 'comments', 'attachments'] },
  { id: 'coda', name: 'Coda', category: 'docs_knowledge', description: 'Read-only table metadata from explicitly selected project documents. Coda row values, columns, packs, pages, and buttons stay out of Sneup.', auth: pat({ docsUrl: 'https://coda.io/developers/apis/v1', fields: [{ name: 'token', label: 'Personal access token', secret: true, required: true }, { name: 'documentIds', label: 'Allowed document IDs (comma-separated)', secret: false, required: true, placeholder: 'AbCDeFGH, QrStUvWx' }] }), sync: ['documents', 'tables'] },
  { id: 'quip', name: 'Quip', category: 'docs_knowledge', description: 'Documents, spreadsheets, folders, threads, and Salesforce-connected collaboration.', auth: pat({ docsUrl: 'https://quip.com/dev/automation/documentation' }), sync: ['documents', 'folders', 'threads'] },
  { id: 'evernote', name: 'Evernote', category: 'docs_knowledge', description: 'Notes, notebooks, tags, meeting notes, research, and lightweight project memory.', auth: manual({ docsUrl: 'https://dev.evernote.com/doc/' }), sync: ['notes', 'notebooks', 'tags'] },
  { id: 'teamwork', name: 'Teamwork', category: 'work_management', description: 'Projects, task lists, tasks, milestones, time, companies, and client work.', auth: pat({ docsUrl: 'https://apidocs.teamwork.com/' }), sync: ['projects', 'tasks', 'milestones', 'time', 'companies'] },
  { id: 'zoho_projects', name: 'Zoho Projects', category: 'work_management', description: 'Projects, milestones, task lists, tasks, issues, timesheets, and documents.', auth: pat({ docsUrl: 'https://www.zoho.com/projects/help/rest-api/' }), sync: ['projects', 'milestones', 'tasks', 'issues', 'time'] },
  { id: 'shortcut', name: 'Shortcut', category: 'software_delivery', description: 'Read-only project and story metadata with owners, due dates, state, and dependency context.', auth: pat({ docsUrl: 'https://developer.shortcut.com/api/rest/v3' }), sync: ['projects', 'stories', 'dependencies'] },
  { id: 'pivotal_tracker', name: 'Pivotal Tracker', category: 'software_delivery', description: 'Projects, stories, epics, iterations, labels, comments, and velocity.', auth: pat({ docsUrl: 'https://www.pivotaltracker.com/help/api/rest/v5' }), sync: ['projects', 'stories', 'epics', 'iterations'] },
  { id: 'height', name: 'Height', category: 'work_management', description: 'Tasks, lists, projects, chat-native collaboration, status, and automation rules.', auth: pat({ docsUrl: 'https://height.app/api' }), sync: ['tasks', 'lists', 'projects', 'comments'] },
  { id: 'todoist', name: 'Todoist', category: 'work_management', description: 'Read-only project and task metadata with section context, owners, priorities, and due dates.', auth: pat({ docsUrl: 'https://developer.todoist.com/rest/v2/' }), sync: ['projects', 'tasks', 'sections'] },
  { id: 'meistertask', name: 'MeisterTask', category: 'work_management', description: 'Projects, sections, tasks, checklists, comments, attachments, and automations.', auth: pat({ docsUrl: 'https://developers.meistertask.com/' }), sync: ['projects', 'tasks', 'sections', 'comments'] },
  { id: 'proofhub', name: 'ProofHub', category: 'work_management', description: 'Projects, tasks, discussions, notes, files, timesheets, and approvals.', auth: apiKey({ docsUrl: 'https://github.com/proofhub/api' }), sync: ['projects', 'tasks', 'discussions', 'time'] },
  { id: 'freedcamp', name: 'Freedcamp', category: 'work_management', description: 'Projects, tasks, discussions, milestones, files, time, and issue tracking.', auth: apiKey({ docsUrl: 'https://freedcamp.com/Freedcamp_LxR/Freedcamp_Devel_yOf/wiki/wiki_public/view/6Yxab' }), sync: ['projects', 'tasks', 'milestones', 'files'] },
  { id: 'workfront', name: 'Adobe Workfront', category: 'work_management', description: 'Programs, portfolios, projects, tasks, approvals, proofs, resources, and enterprise PMO reporting.', auth: apiKey({ docsUrl: 'https://developer.adobe.com/workfront/api-explorer/' }), sync: ['programs', 'projects', 'tasks', 'approvals', 'resources'] },
  { id: 'lucid', name: 'Lucidchart / Lucidspark', category: 'whiteboard_design', description: 'Diagrams, boards, org charts, process maps, comments, and workshop decisions.', auth: manual({ docsUrl: 'https://lucid.readme.io/' }), sync: ['documents', 'boards', 'comments'] },
  { id: 'mural', name: 'Mural', category: 'whiteboard_design', description: 'Murals, rooms, facilitation artifacts, comments, templates, and workshop outputs.', auth: manual({ docsUrl: 'https://developers.mural.co/' }), sync: ['murals', 'rooms', 'comments'] },
  { id: 'canva', name: 'Canva', category: 'whiteboard_design', description: 'Brand assets, designs, approvals, folders, and creative deliverables.', auth: manual({ docsUrl: 'https://www.canva.dev/docs/connect/' }), sync: ['designs', 'folders', 'assets'] },
  { id: 'adobe_creative_cloud', name: 'Adobe Creative Cloud', category: 'files_assets', description: 'Creative assets, libraries, links, comments, and reviewable deliverables.', auth: manual({ docsUrl: 'https://developer.adobe.com/' }), sync: ['assets', 'libraries', 'comments'] },
  { id: 'sharepoint', name: 'SharePoint', category: 'files_assets', description: 'Sites, libraries, files, pages, permissions, and document-heavy project work.', auth: manual({ docsUrl: 'https://learn.microsoft.com/en-us/graph/api/resources/sharepoint' }), sync: ['sites', 'libraries', 'files', 'pages'] },
  { id: 'onedrive', name: 'OneDrive', category: 'files_assets', description: 'Files, folders, shared links, versions, and personal project deliverables.', auth: manual({ docsUrl: 'https://learn.microsoft.com/en-us/onedrive/developer/' }), sync: ['files', 'folders', 'shared_links'] },
  { id: 'google_drive', name: 'Google Drive', category: 'files_assets', description: 'Files, folders, shared drives, permissions, and project deliverable inventory.', auth: manual({ docsUrl: 'https://developers.google.com/drive/api/guides/about-sdk' }), sync: ['files', 'folders', 'shared_drives'] },
  { id: 'teams', name: 'Microsoft Teams', category: 'communication', description: 'Teams, channels, chats, meetings, files, tabs, and project notifications.', auth: manual({ docsUrl: 'https://learn.microsoft.com/en-us/graph/teams-concept-overview' }), sync: ['teams', 'channels', 'messages', 'meetings'] },
  { id: 'discord', name: 'Discord', category: 'communication', description: 'Servers, channels, messages, members, and community/project operations.', auth: pat({ docsUrl: 'https://discord.com/developers/docs/intro' }), sync: ['guilds', 'channels', 'messages', 'members'] },
  { id: 'mattermost', name: 'Mattermost', category: 'communication', description: 'Teams, channels, messages, users, files, and self-hosted project communication.', auth: pat({ docsUrl: 'https://api.mattermost.com/' }), sync: ['teams', 'channels', 'messages', 'users'] },
  { id: 'webex', name: 'Webex', category: 'communication', description: 'Meetings, messages, spaces, people, recordings, and stakeholder sessions.', auth: pat({ docsUrl: 'https://developer.webex.com/docs/api/getting-started' }), sync: ['meetings', 'messages', 'spaces', 'people'] },
  { id: 'calendly', name: 'Calendly', category: 'calendar_email', description: 'Event types, scheduled events, invitees, routing forms, and stakeholder booking signals.', auth: pat({ docsUrl: 'https://developer.calendly.com/' }), sync: ['events', 'event_types', 'invitees'] },
  { id: 'gmail', name: 'Gmail', category: 'calendar_email', description: 'Threads, messages, labels, project follow-ups, client requests, and stakeholder context.', auth: manual({ docsUrl: 'https://developers.google.com/gmail/api/guides' }), sync: ['threads', 'messages', 'labels'] },
  { id: 'outlook', name: 'Outlook', category: 'calendar_email', description: 'Mail, calendar, contacts, meeting cadence, and stakeholder communication.', auth: manual({ docsUrl: 'https://learn.microsoft.com/en-us/graph/outlook-mail-concept-overview' }), sync: ['mail', 'calendar', 'contacts'] },
  { id: 'harvest', name: 'Harvest', category: 'time_finance', description: 'Read-only bounded time-entry metadata for utilization signals. Sneup excludes notes, rates, invoices, and budget detail.', auth: pat({ docsUrl: 'https://help.getharvest.com/api-v2/', fields: [{ name: 'accountId', label: 'Harvest account ID', placeholder: '123456', required: true }, { name: 'token', label: 'Personal access token', secret: true, required: true }] }), sync: ['time_entries', 'projects', 'clients'] },
  { id: 'toggl_track', name: 'Toggl Track', category: 'time_finance', description: 'Time entries, projects, clients, tags, billable tracking, and utilization.', auth: apiKey({ docsUrl: 'https://developers.track.toggl.com/' }), sync: ['time_entries', 'projects', 'clients', 'tags'] },
  { id: 'clockify', name: 'Clockify', category: 'time_finance', description: 'Workspaces, projects, tasks, time entries, users, and utilization reports.', auth: apiKey({ docsUrl: 'https://docs.clockify.me/' }), sync: ['workspaces', 'projects', 'tasks', 'time_entries'] },
  { id: 'everhour', name: 'Everhour', category: 'time_finance', description: 'Time, estimates, budgets, expenses, invoices, and project profitability.', auth: apiKey({ docsUrl: 'https://everhour.docs.apiary.io/' }), sync: ['time', 'budgets', 'projects', 'expenses'] },
  { id: 'float', name: 'Float', category: 'time_finance', description: 'Resource schedules, people, projects, allocations, capacity, and time off.', auth: apiKey({ docsUrl: 'https://developer.float.com/' }), sync: ['people', 'projects', 'allocations', 'time_off'] },
  { id: 'resource_guru', name: 'Resource Guru', category: 'time_finance', description: 'Resources, bookings, schedules, availability, and utilization.', auth: apiKey({ docsUrl: 'https://developers.resourceguruapp.com/' }), sync: ['resources', 'bookings', 'availability'] },
  { id: 'quickbooks', name: 'QuickBooks', category: 'time_finance', description: 'Customers, invoices, estimates, projects, expenses, and project financial context.', auth: manual({ docsUrl: 'https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization' }), sync: ['customers', 'invoices', 'estimates', 'expenses'] },
  { id: 'xero', name: 'Xero', category: 'time_finance', description: 'Contacts, invoices, projects, quotes, expenses, and financial delivery status.', auth: manual({ docsUrl: 'https://developer.xero.com/documentation/guides/oauth2/overview/' }), sync: ['contacts', 'invoices', 'projects', 'quotes'] },
  { id: 'zendesk', name: 'Zendesk', category: 'crm_support', description: 'Tickets, organizations, users, SLAs, macros, and support-driven project inputs.', auth: apiKey({ docsUrl: 'https://developer.zendesk.com/api-reference/ticketing/introduction/', fields: [{ name: 'subdomain', label: 'Zendesk subdomain', required: true }, { name: 'email', label: 'Agent email', required: true }, { name: 'apiToken', label: 'API token', secret: true, required: true }] }), sync: ['tickets', 'organizations', 'users', 'slas'] },
  { id: 'freshdesk', name: 'Freshdesk', category: 'crm_support', description: 'Tickets, contacts, companies, SLAs, agents, and support escalations.', auth: apiKey({ docsUrl: 'https://developers.freshdesk.com/api/' }), sync: ['tickets', 'contacts', 'companies', 'agents'] },
  { id: 'servicenow', name: 'ServiceNow', category: 'crm_support', description: 'Incidents, changes, requests, tasks, approvals, CMDB context, and enterprise workflows.', auth: manual({ docsUrl: 'https://developer.servicenow.com/dev.do' }), sync: ['incidents', 'changes', 'requests', 'tasks'] },
  { id: 'pipedrive', name: 'Pipedrive', category: 'crm_support', description: 'Deals, activities, organizations, people, notes, and client delivery commitments.', auth: apiKey({ docsUrl: 'https://developers.pipedrive.com/docs/api/v1' }), sync: ['deals', 'activities', 'organizations', 'people'] },
  { id: 'typeform', name: 'Typeform', category: 'automation_data', description: 'Forms, responses, surveys, intake requests, research signals, and stakeholder feedback.', auth: pat({ docsUrl: 'https://www.typeform.com/developers/' }), sync: ['forms', 'responses', 'webhooks'] },
  { id: 'google_forms', name: 'Google Forms', category: 'automation_data', description: 'Forms, responses, intake, feedback, and lightweight project request capture.', auth: manual({ docsUrl: 'https://developers.google.com/forms/api' }), sync: ['forms', 'responses'] },
  { id: 'survey_monkey', name: 'SurveyMonkey', category: 'automation_data', description: 'Surveys, collectors, responses, customer feedback, and research programs.', auth: pat({ docsUrl: 'https://developer.surveymonkey.com/api/v3/' }), sync: ['surveys', 'collectors', 'responses'] },
  { id: 'zapier', name: 'Zapier', category: 'automation_data', description: 'Zaps, webhooks, cross-app automations, handoffs, and event triggers.', auth: manual({ docsUrl: 'https://platform.zapier.com/docs' }), sync: ['webhooks', 'automations'] },
  { id: 'make', name: 'Make',
    category: 'automation_data',
    description: 'Scenarios, webhooks, integrations, automations, and operational workflows.',
    auth: apiKey({ docsUrl: 'https://www.make.com/en/api-documentation' }),
    sync: ['scenarios', 'webhooks', 'executions']
  },
  { id: 'n8n', name: 'n8n', category: 'automation_data', description: 'Workflows, credentials, executions, triggers, and self-hosted automation.', auth: apiKey({ docsUrl: 'https://docs.n8n.io/api/' }), sync: ['workflows', 'executions', 'credentials'] },
  { id: 'power_bi', name: 'Power BI', category: 'automation_data', description: 'Workspaces, datasets, reports, dashboards, and project performance reporting.', auth: manual({ docsUrl: 'https://learn.microsoft.com/en-us/rest/api/power-bi/' }), sync: ['workspaces', 'datasets', 'reports', 'dashboards'] },
  { id: 'tableau', name: 'Tableau', category: 'automation_data', description: 'Sites, projects, workbooks, views, dashboards, and executive reporting.', auth: pat({ docsUrl: 'https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_concepts_auth.htm' }), sync: ['sites', 'projects', 'workbooks', 'views'] },
  { id: 'looker_studio', name: 'Looker Studio', category: 'automation_data', description: 'Reports, dashboards, data sources, and stakeholder reporting artifacts.', auth: manual({ docsUrl: 'https://developers.google.com/looker-studio' }), sync: ['reports', 'data_sources'] },
  { id: 'sentry', name: 'Sentry', category: 'incident_quality', description: 'Issues, releases, alerts, projects, ownership, and product quality risk.', auth: pat({ docsUrl: 'https://docs.sentry.io/api/auth/' }), sync: ['issues', 'projects', 'releases', 'alerts'] },
  { id: 'datadog', name: 'Datadog', category: 'incident_quality', description: 'Monitors, incidents, dashboards, services, SLOs, and delivery reliability signals.', auth: apiKey({ docsUrl: 'https://docs.datadoghq.com/api/latest/authentication/' }), sync: ['monitors', 'incidents', 'dashboards', 'slos'] },
  { id: 'new_relic', name: 'New Relic', category: 'incident_quality', description: 'Alerts, incidents, services, deployments, dashboards, and reliability status.', auth: apiKey({ docsUrl: 'https://docs.newrelic.com/docs/apis/intro-apis/new-relic-api-keys/' }), sync: ['alerts', 'incidents', 'services', 'deployments'] },
  { id: 'pagerduty', name: 'PagerDuty', category: 'incident_quality', description: 'Incidents, services, schedules, escalation policies, on-call, and operational risk.', auth: pat({ docsUrl: 'https://developer.pagerduty.com/docs/rest-api-v2/authentication/' }), sync: ['incidents', 'services', 'schedules', 'escalations'] },
  { id: 'opsgenie', name: 'Opsgenie', category: 'incident_quality', description: 'Alerts, incidents, schedules, teams, escalation policies, and service ownership.', auth: apiKey({ docsUrl: 'https://docs.opsgenie.com/docs/api-overview' }), sync: ['alerts', 'incidents', 'schedules', 'teams'] },
  { id: 'testRail', name: 'TestRail', category: 'incident_quality', description: 'Test cases, runs, plans, milestones, defects, and QA delivery status.', auth: apiKey({ docsUrl: 'https://support.testrail.com/hc/en-us/articles/7077039051284-Accessing-the-TestRail-API' }), sync: ['test_cases', 'runs', 'plans', 'milestones'] },
  { id: 'browserstack', name: 'BrowserStack', category: 'incident_quality', description: 'Builds, sessions, test observability, browser coverage, and QA evidence.', auth: apiKey({ docsUrl: 'https://www.browserstack.com/docs/api' }), sync: ['builds', 'sessions', 'projects'] },
  { id: 'statuspage', name: 'Atlassian Statuspage', category: 'incident_quality', description: 'Components, incidents, subscribers, maintenance windows, and customer-facing status.', auth: apiKey({ docsUrl: 'https://developer.statuspage.io/' }), sync: ['components', 'incidents', 'maintenance'] },
  { id: 'aha', name: 'Aha!', category: 'work_management', description: 'Roadmaps, initiatives, features, releases, goals, and customer demand signals.', auth: apiKey({ docsUrl: 'https://www.aha.io/api', fields: [{ name: 'apiToken', label: 'API token', secret: true, required: true }] }), sync: ['products', 'initiatives', 'features', 'goals', 'releases', 'requirements'] },
  { id: 'productboard', name: 'Productboard', category: 'work_management', description: 'Roadmap items, components, goals, feature ideas, and stakeholder priority signals.', auth: apiKey({ docsUrl: 'https://developer.productboard.com/', fields: [{ name: 'apiToken', label: 'API token', secret: true, required: true }] }), sync: ['components', 'features', 'ideas', 'objectives', 'roadmaps'] },
  { id: 'jira_align', name: 'Jira Align', category: 'software_delivery', description: 'Program initiatives, enterprise epics, value streams, dependencies, and planning windows.', auth: manual({ docsUrl: 'https://www.atlassian.com/software/jira/align', fields: [{ name: 'baseUrl', label: 'Jira Align API URL', required: true }, { name: 'apiToken', label: 'API token', secret: true, required: true }] }), sync: ['programs', 'initiatives', 'work_items', 'dependencies', 'planning_windows'] },
  { id: 'teamgantt', name: 'TeamGantt', category: 'work_management', description: 'Projects, schedules, tasks, dependencies, milestones, and team capacities.', auth: apiKey({ docsUrl: 'https://help.teamgantt.com/en/articles/900-introducing-the-teamgantt-api' }), sync: ['projects', 'tasks', 'schedules', 'dependencies', 'milestones', 'timesheets'] },
  { id: 'kanbanize', name: 'Kanbanize', category: 'work_management', description: 'Boards, cards, swimlanes, dependencies, WIP policies, and release planning.', auth: apiKey({ docsUrl: 'https://kanbanize.com/ctrl_login/docs/1/api/index.html', fields: [{ name: 'apiUrl', label: 'Kanbanize API URL', required: true }, { name: 'apiToken', label: 'API token', secret: true, required: true }] }), sync: ['boards', 'cards', 'swimlanes', 'dependencies', 'workflows'] },
  { id: 'google_chat', name: 'Google Chat', category: 'communication', description: 'Rooms, messages, mentions, spaces, and PM-ready team communication.', auth: oauth2({ envPrefix: 'GOOGLE_CHAT', authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth', tokenUrl: 'https://oauth2.googleapis.com/token', scopes: ['https://www.googleapis.com/auth/chat.messages.readonly'], docsUrl: 'https://developers.google.com/chat/api/guides/auth' }), sync: ['spaces', 'members', 'messages', 'threads'] },
  { id: 'projectplace', name: 'Projectplace', category: 'work_management', description: 'Projects, tasks, templates, workstreams, files, and collaborative planning.', auth: apiKey({ docsUrl: 'https://help.projectplace.com/en/kb/api-api-interface', fields: [{ name: 'baseUrl', label: 'Projectplace API URL', required: true }, { name: 'apiKey', label: 'API key', secret: true, required: true }] }), sync: ['projects', 'tasks', 'workstreams', 'files', 'users'] },
  { id: 'clarizen', name: 'Clarizen', category: 'software_delivery', description: 'Programs, initiatives, dependencies, resource assignments, risks, milestones, and executive reporting.', auth: apiKey({ docsUrl: 'https://api.clarizen.com/api/2/rest', fields: [{ name: 'tenantUrl', label: 'Clarizen tenant URL', required: true }, { name: 'apiKey', label: 'API token', secret: true, required: true }] }), sync: ['projects', 'tasks', 'initiatives', 'assignments', 'risks', 'milestones'] },
  { id: 'scoro', name: 'Scoro', category: 'work_management', description: 'Work orders, tasks, CRM opportunities, estimates, billing, capacity, and team utilization.', auth: apiKey({ docsUrl: 'https://api.scoro.com', fields: [{ name: 'accountId', label: 'Scoro account ID', required: true }, { name: 'apiKey', label: 'API token', secret: true, required: true }] }), sync: ['projects', 'tasks', 'opportunities', 'invoices', 'timesheets'] },
  { id: 'hive', name: 'Hive', category: 'work_management', description: 'Projects, tasks, conversations, checklists, files, and team communication signals.', auth: apiKey({ docsUrl: 'https://developer.hive.com/', fields: [{ name: 'apiToken', label: 'API token', secret: true, required: true }] }), sync: ['projects', 'tasks', 'conversations', 'files', 'checklists'] },
  { id: 'taskworld', name: 'Taskworld', category: 'work_management', description: 'Projects, tasks, milestones, chat, approvals, and team workload management.', auth: apiKey({ docsUrl: 'https://developer.taskworld.com/docs', fields: [{ name: 'apiKey', label: 'API token', secret: true, required: true }] }), sync: ['projects', 'tasks', 'milestones', 'conversations', 'comments'] },
  { id: 'webhook_generic', name: 'Generic Webhook', category: 'automation_data', description: 'Catch events from any tool with outbound webhooks and map them into Sneup signals.', auth: manual({ fields: [{ name: 'sourceName', label: 'Source name', required: true }, { name: 'signingSecret', label: 'Signing secret', secret: true, required: false }] }), sync: ['events'] },
  { id: 'rest_api_generic', name: 'Generic REST API', category: 'automation_data', description: 'Connect any project tool with a REST API, bearer token, and JSON endpoints.', auth: apiKey({ fields: [{ name: 'baseUrl', label: 'Base URL', required: true }, { name: 'apiKey', label: 'Bearer token or API key', secret: true, required: true }] }), sync: ['custom_resources'] }
];

const CONNECTORS_BY_ID = CONNECTORS.reduce((index, connector) => {
  index[connector.id] = connector;
  return index;
}, {});

const CONNECTOR_CATEGORY_COUNTS = Object.entries(CATEGORIES).reduce((acc, [id]) => {
  acc[id] = 0;
  return acc;
}, {});

for (const connector of CONNECTORS) {
  if (CONNECTOR_CATEGORY_COUNTS[connector.category] !== undefined) {
    CONNECTOR_CATEGORY_COUNTS[connector.category] += 1;
  }
}

const CATEGORIES_WITH_COUNTS = Object.entries(CATEGORIES).map(([id, name]) => ({
  id,
  name,
  count: CONNECTOR_CATEGORY_COUNTS[id] || 0
}));

const getConnectors = () => CONNECTORS;

const getConnector = (id) => CONNECTORS_BY_ID[id];

const getCategories = () => CATEGORIES_WITH_COUNTS.map((category) => ({ ...category }));

module.exports = {
  CATEGORIES,
  getCategories,
  getConnector,
  getConnectors
};
