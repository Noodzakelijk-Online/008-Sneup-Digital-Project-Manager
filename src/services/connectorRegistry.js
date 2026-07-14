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
    description: 'Read-only current user-story and defect metadata from Rally SaaS. Sneup excludes descriptions, blocked reasons, users, attachments, custom fields, comments, URLs, and provider writes.',
    auth: apiKey({
      docsUrl: 'https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/administration/it-administration/how-users-authenticate/rally-authentication-features/api-keys.html',
      fields: [
        { name: 'apiKey', label: 'API key', secret: true, required: true }
      ]
    }),
    sync: ['user_stories', 'defects']
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
        { name: 'spaceId', label: 'Backlog space URL', required: true },
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
    description: 'Read-only bounded item metadata from one explicitly selected Podio app. Sneup excludes item field values, comments, files, people, URLs, tags, tasks, workspaces, and provider writes.',
    auth: apiKey({
      docsUrl: 'https://developers.podio.com/authentication/app_auth',
      fields: [
        { name: 'appId', label: 'Podio app ID', required: true },
        { name: 'appToken', label: 'Podio app token', secret: true, required: true }
      ]
    }),
    sync: ['app_items']
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
    description: 'Calendar, Drive, Docs, Sheets, Slides, Meet artifacts, and directory data through Google APIs. Gmail connects separately with a narrower metadata-only scope.',
    auth: oauth2({
      envPrefix: 'GOOGLE',
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scopes: [
        'openid',
        'email',
        'profile',
        'https://www.googleapis.com/auth/calendar.readonly',
        'https://www.googleapis.com/auth/drive.metadata.readonly'
      ],
      extraAuthParams: { access_type: 'offline', prompt: 'consent' },
      docsUrl: 'https://developers.google.com/identity/protocols/oauth2/web-server'
    }),
    sync: ['calendar', 'drive', 'docs', 'sheets', 'slides', 'users']
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
    description: 'Read-only bounded scheduled-meeting metadata through Zoom OAuth. Sneup excludes agendas, join URLs, passwords, hosts, attendees, recordings, transcripts, webinars, and provider writes.',
    auth: oauth2({
      envPrefix: 'ZOOM',
      authorizationUrl: 'https://zoom.us/oauth/authorize',
      tokenUrl: 'https://zoom.us/oauth/token',
      tokenAuth: 'basic',
      scopes: ['meeting:read'],
      docsUrl: 'https://developers.zoom.us/docs/integrations/'
    }),
    sync: ['scheduled_meetings']
  },
  {
    id: 'figma',
    name: 'Figma',
    category: 'whiteboard_design',
    description: 'Read-only bounded project and file metadata for one explicitly selected Figma team through a configured private OAuth app. Sneup excludes file content, nodes, comments, users, thumbnails, URLs, versions, branch data, and provider writes.',
    auth: oauth2({
      envPrefix: 'FIGMA',
      authorizationUrl: 'https://www.figma.com/oauth',
      tokenUrl: 'https://api.figma.com/v1/oauth/token',
      scopes: ['projects:read'],
      docsUrl: 'https://developers.figma.com/docs/rest-api/projects-endpoints/'
    }),
    sync: ['projects', 'files']
  },
  {
    id: 'miro',
    name: 'Miro',
    category: 'whiteboard_design',
    description: 'Read-only bounded board metadata through Miro OAuth. Sneup excludes board descriptions, content, items, frames, sticky notes, diagrams, comments, members, permissions, board links, and provider writes.',
    auth: oauth2({
      envPrefix: 'MIRO',
      authorizationUrl: 'https://miro.com/oauth/authorize',
      tokenUrl: 'https://api.miro.com/v1/oauth/token',
      scopes: ['boards:read'],
      oauthResponseMetadata: [{ field: 'miroTeamId', responseKey: 'team_id', validator: 'miroTeamId', required: true }],
      docsUrl: 'https://developers.miro.com/docs/getting-started-with-oauth'
    }),
    sync: ['boards']
  },
  {
    id: 'dropbox',
    name: 'Dropbox',
    category: 'files_assets',
    description: 'Read-only bounded root-folder metadata through Dropbox OAuth. Sneup excludes file contents, previews, downloads, shared links, Paper docs, revisions, sharing details, paths, and provider writes.',
    auth: oauth2({
      envPrefix: 'DROPBOX',
      authorizationUrl: 'https://www.dropbox.com/oauth2/authorize',
      tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
      scopes: ['files.metadata.read'],
      docsUrl: 'https://developers.dropbox.com/oauth-guide'
    }),
    sync: ['files', 'folders']
  },
  {
    id: 'box',
    name: 'Box',
    category: 'files_assets',
    description: 'Read-only bounded root file and folder metadata through Box OAuth. Sneup excludes file contents, downloads, previews, shared links, paths, descriptions, users, versions, comments, and provider writes.',
    auth: oauth2({
      envPrefix: 'BOX',
      authorizationUrl: 'https://account.box.com/api/oauth2/authorize',
      tokenUrl: 'https://api.box.com/oauth2/token',
      scopes: ['root_readonly'],
      docsUrl: 'https://developer.box.com/reference/get-folders-id-items/'
    }),
    sync: ['files', 'folders']
  },
  {
    id: 'hubspot',
    name: 'HubSpot',
    category: 'crm_support',
    description: 'Read-only bounded deal metadata for delivery commitments. Sneup excludes contacts, companies, tickets, tasks, notes, associations, owners, amounts, currencies, custom fields, and provider writes.',
    auth: oauth2({
      envPrefix: 'HUBSPOT',
      authorizationUrl: 'https://app.hubspot.com/oauth/authorize',
      tokenUrl: 'https://api.hubapi.com/oauth/v1/token',
      scopes: ['crm.objects.deals.read'],
      docsUrl: 'https://developers.hubspot.com/docs/api-reference/latest/crm/objects/deals/guide'
    }),
    sync: ['deals']
  },
  {
    id: 'salesforce',
    name: 'Salesforce',
    category: 'crm_support',
    description: 'Read-only bounded opportunity metadata using Salesforce OAuth. The provider api scope is broad and requires review; Sneup only issues GET requests and excludes accounts, contacts, cases, tasks, events, owners, amounts, currencies, custom fields, and provider writes.',
    auth: oauth2({
      envPrefix: 'SALESFORCE',
      authorizationUrl: 'https://login.salesforce.com/services/oauth2/authorize',
      tokenUrl: 'https://login.salesforce.com/services/oauth2/token',
      scopes: ['api', 'refresh_token'],
      oauthResponseMetadata: [{ field: 'instanceUrl', responseKey: 'instance_url', validator: 'salesforceInstanceUrl', required: true }],
      docsUrl: 'https://help.salesforce.com/s/articleView?id=sf.remoteaccess_oauth_web_server_flow.htm'
    }),
    sync: ['opportunities']
  },
  {
    id: 'intercom',
    name: 'Intercom',
    category: 'crm_support',
    description: 'Read-only bounded conversation-list metadata. Sneup excludes conversation bodies and parts, contacts, companies, teammates, tags, URLs, attachments, tickets, SLAs, and provider writes.',
    auth: oauth2({
      envPrefix: 'INTERCOM',
      authorizationUrl: 'https://app.intercom.com/oauth',
      tokenUrl: 'https://api.intercom.io/auth/eagle/token',
      scopes: [],
      docsUrl: 'https://developers.intercom.com/docs/references/rest-api/api.intercom.io/authentication/'
    }),
    sync: ['conversations']
  },

  // High-value token/API-key connectors used by project managers across 2015-2026.
  { id: 'wrike', name: 'Wrike', category: 'work_management', description: 'Read-only projects and task metadata with owners, schedules, project context, and dependency identifiers.', auth: pat({ docsUrl: 'https://developers.wrike.com/', fields: [{ name: 'token', label: 'Permanent access token', secret: true, required: true }, { name: 'apiUrl', label: 'Wrike API URL (EU only)', secret: false, required: false }] }), sync: ['projects', 'tasks'] },
  { id: 'smartsheet', name: 'Smartsheet', category: 'work_management', description: 'Read-only project sheet rows with selected task, status, priority, owner, and due-date context.', auth: pat({ docsUrl: 'https://developers.smartsheet.com/api/smartsheet/openapi', fields: [{ name: 'token', label: 'API access token', secret: true, required: true }, { name: 'apiUrl', label: 'Smartsheet API URL (EU/AU only)', secret: false, required: false }] }), sync: ['sheets', 'rows'] },
  { id: 'airtable', name: 'Airtable', category: 'automation_data', description: 'Read-only allowlisted task records from a selected base and table.', auth: pat({ docsUrl: 'https://airtable.com/developers/web/api/authentication', fields: [{ name: 'token', label: 'Personal access token', secret: true, required: true }, { name: 'baseId', label: 'Base ID', secret: false, required: true }, { name: 'tableName', label: 'Table name', secret: false, required: true }, { name: 'fieldNames', label: 'Allowed task fields (comma-separated)', secret: false, required: true }] }), sync: ['bases', 'tables', 'records'] },
  { id: 'basecamp', name: 'Basecamp', category: 'work_management', description: 'Read-only project and to-do metadata from one explicitly selected Basecamp account. Sneup excludes messages, schedules, docs, files, comments, client, and hill-chart content.', auth: oauth2({ envPrefix: 'BASECAMP', authorizationUrl: 'https://launchpad.37signals.com/authorization/new', tokenUrl: 'https://launchpad.37signals.com/authorization/token', docsUrl: 'https://github.com/basecamp/bc-api' }), sync: ['projects', 'todos'] },
  { id: 'microsoft_project', name: 'Microsoft Project', category: 'work_management', description: 'Project plans, schedules, resource assignments, milestones, and portfolio reporting.', auth: manual({ docsUrl: 'https://learn.microsoft.com/en-us/project/' }), sync: ['projects', 'schedules', 'resources', 'milestones'] },
  { id: 'microsoft_planner', name: 'Microsoft Planner', category: 'work_management', description: 'Read-only assigned Planner task metadata through Microsoft Graph. Sneup excludes descriptions, checklists, attachments, labels, comments, and provider writes.', auth: oauth2({ envPrefix: 'MICROSOFT', authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token', scopes: ['offline_access', 'User.Read', 'Tasks.Read'], docsUrl: 'https://learn.microsoft.com/en-us/graph/api/planneruser-list-tasks?view=graph-rest-1.0' }), sync: ['assigned_tasks'] },
  { id: 'azure_devops', name: 'Azure DevOps', category: 'software_delivery', description: 'Read-only Azure DevOps work items with project, status, priority, owner, schedule, and dependency context.', auth: pat({ docsUrl: 'https://learn.microsoft.com/en-us/azure/devops/integrate/get-started/authentication/authentication-guidance', fields: [{ name: 'organizationUrl', label: 'Azure DevOps organization URL', placeholder: 'https://dev.azure.com/your-organization', required: true }, { name: 'token', label: 'Personal access token (Work Items Read)', secret: true, required: true }] }), sync: ['projects', 'work_items'] },
  { id: 'bitbucket', name: 'Bitbucket', category: 'software_delivery', description: 'Read-only repository issues and open pull requests with owners and delivery state.', auth: pat({ docsUrl: 'https://developer.atlassian.com/cloud/bitbucket/rest/intro/', fields: [{ name: 'workspace', label: 'Workspace slug', placeholder: 'your-workspace', required: true }, { name: 'token', label: 'API token', secret: true, required: true }] }), sync: ['repositories', 'issues', 'pull_requests'] },
  { id: 'confluence', name: 'Confluence', category: 'docs_knowledge', description: 'Read-only bounded metadata for spaces and pages on one explicitly selected Confluence site. Sneup excludes page bodies, comments, attachments, users, descriptions, URLs, version messages, and provider writes.', auth: oauth2({ envPrefix: 'CONFLUENCE', authorizationUrl: 'https://auth.atlassian.com/authorize', tokenUrl: 'https://auth.atlassian.com/oauth/token', audience: 'api.atlassian.com', scopes: ['read:page:confluence', 'read:space:confluence', 'offline_access'], docsUrl: 'https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-page/' }), sync: ['spaces', 'pages'] },
  { id: 'coda', name: 'Coda', category: 'docs_knowledge', description: 'Read-only table metadata from explicitly selected project documents. Coda row values, columns, packs, pages, and buttons stay out of Sneup.', auth: pat({ docsUrl: 'https://coda.io/developers/apis/v1', fields: [{ name: 'token', label: 'Personal access token', secret: true, required: true }, { name: 'documentIds', label: 'Allowed document IDs (comma-separated)', secret: false, required: true, placeholder: 'AbCDeFGH, QrStUvWx' }] }), sync: ['documents', 'tables'] },
  { id: 'quip', name: 'Quip', category: 'docs_knowledge', description: 'Documents, spreadsheets, folders, threads, and Salesforce-connected collaboration.', auth: pat({ docsUrl: 'https://quip.com/dev/automation/documentation' }), sync: ['documents', 'folders', 'threads'] },
  { id: 'evernote', name: 'Evernote', category: 'docs_knowledge', description: 'Notes, notebooks, tags, meeting notes, research, and lightweight project memory.', auth: manual({ docsUrl: 'https://dev.evernote.com/doc/' }), sync: ['notes', 'notebooks', 'tags'] },
  { id: 'teamwork', name: 'Teamwork', category: 'work_management', description: 'Read-only Teamwork project and task metadata from one HTTPS tenant. Sneup excludes private tasks, descriptions, comments, files, time, company, and billing data.', auth: pat({ docsUrl: 'https://apidocs.teamwork.com/guides/teamwork/authentication', fields: [{ name: 'siteUrl', label: 'Teamwork site URL', placeholder: 'https://your-site.teamwork.com', secret: false, required: true }, { name: 'token', label: 'API key', secret: true, required: true }] }), sync: ['projects', 'tasks'] },
  { id: 'zoho_projects', name: 'Zoho Projects', category: 'work_management', description: 'Read-only bounded active-project metadata from one Zoho Projects portal. Sneup excludes milestones, tasks, issues, timesheets, documents, people, owners, descriptions, custom fields, links, and provider writes.', auth: pat({ scopes: ['ZohoProjects.projects.READ'], docsUrl: 'https://www.zoho.com/projects/help/rest-api/projects-api.html', fields: [{ name: 'portalId', label: 'Zoho Projects portal ID', placeholder: '2063927', required: true }, { name: 'token', label: 'Zoho OAuth access token', secret: true, required: true }] }), sync: ['active_projects'] },
  { id: 'shortcut', name: 'Shortcut', category: 'software_delivery', description: 'Read-only project and story metadata with owners, due dates, state, and dependency context.', auth: pat({ docsUrl: 'https://developer.shortcut.com/api/rest/v3' }), sync: ['projects', 'stories', 'dependencies'] },
  { id: 'pivotal_tracker', name: 'Pivotal Tracker', category: 'software_delivery', description: 'Projects, stories, epics, iterations, labels, comments, and velocity.', auth: pat({ docsUrl: 'https://www.pivotaltracker.com/help/api/rest/v5' }), sync: ['projects', 'stories', 'epics', 'iterations'] },
  { id: 'height', name: 'Height', category: 'work_management', description: 'Tasks, lists, projects, chat-native collaboration, status, and automation rules.', auth: pat({ docsUrl: 'https://height.app/api' }), sync: ['tasks', 'lists', 'projects', 'comments'] },
  { id: 'todoist', name: 'Todoist', category: 'work_management', description: 'Read-only project and task metadata with section context, owners, priorities, and due dates.', auth: pat({ docsUrl: 'https://developer.todoist.com/rest/v2/' }), sync: ['projects', 'tasks', 'sections'] },
  { id: 'meistertask', name: 'MeisterTask', category: 'work_management', description: 'Read-only project, section, and task metadata for account-connected work tracking.', auth: pat({ docsUrl: 'https://developers.meistertask.com/reference' }), sync: ['projects', 'sections', 'tasks'] },
  { id: 'proofhub', name: 'ProofHub', category: 'work_management', description: 'Projects, tasks, discussions, notes, files, timesheets, and approvals.', auth: apiKey({ docsUrl: 'https://github.com/proofhub/api' }), sync: ['projects', 'tasks', 'discussions', 'time'] },
  { id: 'freedcamp', name: 'Freedcamp', category: 'work_management', description: 'Read-only project, task, and milestone metadata for account-connected work tracking.', auth: apiKey({ docsUrl: 'https://freedcamp.com/help_/tutorials/wiki/wiki_public/view/DFaab' }), sync: ['projects', 'tasks', 'milestones'] },
  { id: 'workfront', name: 'Adobe Workfront', category: 'work_management', description: 'Read-only bounded current-project metadata from one Adobe Workfront tenant. Sneup excludes tasks, issues, people, approvals, proofs, resources, custom fields, documents, links, descriptions, and provider writes.', auth: pat({ docsUrl: 'https://experienceleague.adobe.com/en/docs/workfront/adobe-workfront-api/api-general-information/api-basics', fields: [{ name: 'baseUrl', label: 'Workfront tenant URL', placeholder: 'https://your-tenant.my.workfront.com', required: true }, { name: 'token', label: 'Workfront OAuth session token', secret: true, required: true }] }), sync: ['projects'] },
  { id: 'lucid', name: 'Lucidchart / Lucidspark', category: 'whiteboard_design', description: 'Diagrams, boards, org charts, process maps, comments, and workshop decisions.', auth: manual({ docsUrl: 'https://lucid.readme.io/' }), sync: ['documents', 'boards', 'comments'] },
  { id: 'mural', name: 'Mural', category: 'whiteboard_design', description: 'Murals, rooms, facilitation artifacts, comments, templates, and workshop outputs.', auth: manual({ docsUrl: 'https://developers.mural.co/' }), sync: ['murals', 'rooms', 'comments'] },
  { id: 'canva', name: 'Canva', category: 'whiteboard_design', description: 'Brand assets, designs, approvals, folders, and creative deliverables.', auth: manual({ docsUrl: 'https://www.canva.dev/docs/connect/' }), sync: ['designs', 'folders', 'assets'] },
  { id: 'adobe_creative_cloud', name: 'Adobe Creative Cloud', category: 'files_assets', description: 'Creative assets, libraries, links, comments, and reviewable deliverables.', auth: manual({ docsUrl: 'https://developer.adobe.com/' }), sync: ['assets', 'libraries', 'comments'] },
  { id: 'sharepoint', name: 'SharePoint', category: 'files_assets', description: 'Read-only bounded root file and folder metadata from one followed SharePoint site selected after consent. Sneup excludes file contents, web URLs, permissions, pages, lists, people, versions, sharing details, and provider writes.', auth: oauth2({ envPrefix: 'MICROSOFT', authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token', scopes: ['offline_access', 'User.Read', 'Files.Read', 'Sites.Read.All'], docsUrl: 'https://learn.microsoft.com/en-us/graph/api/sites-list-followed?view=graph-rest-1.0' }), sync: ['followed_site_root_items'] },
  { id: 'onedrive', name: 'OneDrive', category: 'files_assets', description: 'Read-only bounded root-file and folder metadata from the signed-in user. Sneup excludes file content, web URLs, permissions, versions, shared links, and provider writes.', auth: oauth2({ envPrefix: 'MICROSOFT', authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token', scopes: ['offline_access', 'Files.Read'], docsUrl: 'https://learn.microsoft.com/en-us/graph/api/driveitem-list-children?view=graph-rest-1.0' }), sync: ['root_items'] },
  { id: 'google_drive', name: 'Google Drive', category: 'files_assets', description: 'Read-only bounded user-Drive file and folder metadata. Sneup excludes file content, web URLs, permissions, owners, shared drives, and provider writes.', auth: oauth2({ envPrefix: 'GOOGLE', authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth', tokenUrl: 'https://oauth2.googleapis.com/token', scopes: ['https://www.googleapis.com/auth/drive.metadata.readonly'], extraAuthParams: { access_type: 'offline', prompt: 'consent' }, docsUrl: 'https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list' }), sync: ['user_drive_items'] },
  { id: 'teams', name: 'Microsoft Teams', category: 'communication', description: 'Read-only bounded joined-team and basic channel metadata through Microsoft Graph. Sneup excludes messages, chats, meetings, files, tabs, members, descriptions, emails, and provider writes.', auth: oauth2({ envPrefix: 'MICROSOFT', authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token', scopes: ['offline_access', 'User.Read', 'Team.ReadBasic.All', 'Channel.ReadBasic.All'], docsUrl: 'https://learn.microsoft.com/en-us/graph/api/user-list-joinedteams?view=graph-rest-1.0' }), sync: ['teams', 'channels'] },
  { id: 'discord', name: 'Discord', category: 'communication', description: 'Read-only bounded server metadata through the connected user’s guilds grant. Sneup excludes channels, messages, DMs, members, roles, permissions, invites, files, voice activity, server icons, and provider writes.', auth: oauth2({ envPrefix: 'DISCORD', authorizationUrl: 'https://discord.com/oauth2/authorize', tokenUrl: 'https://discord.com/api/oauth2/token', tokenAuth: 'basic', scopes: ['identify', 'guilds'], docsUrl: 'https://docs.discord.com/developers/resources/user#get-current-user-guilds' }), sync: ['guilds'] },
  { id: 'mattermost', name: 'Mattermost', category: 'communication', description: 'Read-only bounded team metadata from one public HTTPS Mattermost instance. Sneup excludes channels, posts, threads, DMs, users, roles, permissions, invites, files, reactions, preferences, server configuration, and provider writes.', auth: pat({ docsUrl: 'https://developers.mattermost.com/api-documentation/', fields: [{ name: 'baseUrl', label: 'Mattermost instance URL', placeholder: 'https://chat.example.com', required: true }, { name: 'token', label: 'Personal access token', secret: true, required: true }] }), sync: ['teams'] },
  { id: 'webex', name: 'Webex', category: 'communication', description: 'Read-only bounded meeting metadata using a token limited to meeting:schedules_read. Sneup excludes agendas, passwords, hosts, invitees, join links, recordings, transcripts, messages, spaces, people, and provider writes.', auth: pat({ scopes: ['meeting:schedules_read'], docsUrl: 'https://developer.webex.com/meeting/docs/meetings' }), sync: ['meetings'] },
  { id: 'calendly', name: 'Calendly', category: 'calendar_email', description: 'Read-only bounded event-type metadata using a personal access token with users:read and event_types:read. Sneup excludes scheduled events, invitees, booking links, locations, routing forms, availability, calendars, and provider writes.', auth: pat({ scopes: ['users:read', 'event_types:read'], docsUrl: 'https://developer.calendly.com/scopes' }), sync: ['event_types'] },
  { id: 'gmail', name: 'Gmail', category: 'calendar_email', description: 'Read-only bounded inbox-thread metadata with redacted subject lines. Sneup excludes email bodies, snippets, attachments, sender and recipient headers, message IDs, labels, drafts, settings, and provider writes. Gmail metadata is restricted Google user data; complete Google verification and any required security assessment before production use.', auth: oauth2({ envPrefix: 'GMAIL', authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth', tokenUrl: 'https://oauth2.googleapis.com/token', scopes: ['https://www.googleapis.com/auth/gmail.metadata'], extraAuthParams: { access_type: 'offline', prompt: 'consent' }, docsUrl: 'https://developers.google.com/workspace/gmail/api/auth/scopes' }), sync: ['inbox_threads'] },
  { id: 'outlook', name: 'Outlook', category: 'calendar_email', description: 'Read-only bounded inbox conversation metadata with redacted subject lines. Sneup excludes bodies, previews, attachments, sender and recipient headers, Graph message IDs, labels, drafts, settings, and provider writes.', auth: oauth2({ envPrefix: 'OUTLOOK', authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token', scopes: ['offline_access', 'Mail.ReadBasic'], docsUrl: 'https://learn.microsoft.com/en-us/graph/permissions-reference#mailreadbasic' }), sync: ['inbox_conversations'] },
  { id: 'harvest', name: 'Harvest', category: 'time_finance', description: 'Read-only bounded time-entry metadata for utilization signals. Sneup excludes notes, rates, invoices, and budget detail.', auth: pat({ docsUrl: 'https://help.getharvest.com/api-v2/', fields: [{ name: 'accountId', label: 'Harvest account ID', placeholder: '123456', required: true }, { name: 'token', label: 'Personal access token', secret: true, required: true }] }), sync: ['time_entries', 'projects', 'clients'] },
  { id: 'toggl_track', name: 'Toggl Track', category: 'time_finance', description: 'Read-only bounded project and time-entry utilization metadata. Sneup retains one opaque user ID only for an explicit capacity mapping and excludes descriptions, tags, clients, profiles, rates, and sharing data.', auth: pat({ docsUrl: 'https://engineering.toggl.com/docs/track/', fields: [{ name: 'workspaceId', label: 'Toggl Track workspace ID', placeholder: '1234567', required: true }, { name: 'token', label: 'API token', secret: true, required: true }] }), sync: ['time_entries', 'projects'] },
  { id: 'clockify', name: 'Clockify', category: 'time_finance', description: 'Read-only bounded project and personal time-entry utilization metadata. Sneup retains one opaque authenticated-user ID only for an explicit capacity mapping and excludes descriptions, tags, clients, profiles, rates, and custom fields.', auth: apiKey({ docsUrl: 'https://docs.clockify.me/', fields: [{ name: 'workspaceId', label: 'Clockify workspace ID', placeholder: '64a687e29ae1f428e7ebe303', required: true }, { name: 'apiKey', label: 'API key', secret: true, required: true }] }), sync: ['time_entries', 'projects'] },
  { id: 'everhour', name: 'Everhour', category: 'time_finance', description: 'Read-only bounded recent time-entry metadata for utilization signals. Sneup excludes descriptions, notes, budgets, expenses, invoices, rates, people profiles, and provider writes.', auth: apiKey({ docsUrl: 'https://everhour.docs.apiary.io/', fields: [{ name: 'apiKey', label: 'API key', secret: true, required: true }] }), sync: ['recent_time_entries'] },
  { id: 'float', name: 'Float', category: 'time_finance', description: 'Read-only bounded project and allocation schedule metadata for capacity signals. Sneup excludes people profiles, notes, clients, tags, rates, budgets, time off, and logged time.', auth: apiKey({ docsUrl: 'https://developer.float.com/', fields: [{ name: 'apiToken', label: 'API token', secret: true, required: true }] }), sync: ['projects', 'allocations'] },
  { id: 'resource_guru', name: 'Resource Guru', category: 'time_finance', description: 'Read-only bounded project and allocation schedule metadata for one selected account. Sneup excludes resource profiles, people, notes, clients, rates, availability, timesheets, and provider writes.', auth: oauth2({ envPrefix: 'RESOURCE_GURU', authorizationUrl: 'https://api.resourceguruapp.com/oauth/authorize', tokenUrl: 'https://api.resourceguruapp.com/oauth/token', docsUrl: 'https://resourceguruapp.com/docs/api' }), sync: ['projects', 'bookings'] },
  { id: 'quickbooks', name: 'QuickBooks', category: 'time_finance', description: 'Customers, invoices, estimates, projects, expenses, and project financial context.', auth: manual({ docsUrl: 'https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization' }), sync: ['customers', 'invoices', 'estimates', 'expenses'] },
  { id: 'xero', name: 'Xero', category: 'time_finance', description: 'Contacts, invoices, projects, quotes, expenses, and financial delivery status.', auth: manual({ docsUrl: 'https://developer.xero.com/documentation/guides/oauth2/overview/' }), sync: ['contacts', 'invoices', 'projects', 'quotes'] },
  { id: 'zendesk', name: 'Zendesk', category: 'crm_support', description: 'Read-only bounded incremental ticket metadata using an OAuth access token. Sneup excludes ticket descriptions, comments, requesters, assignees, collaborators, tags, custom fields, organizations, SLAs, macros, and provider writes.', auth: apiKey({ displayType: 'OAuth token', docsUrl: 'https://developer.zendesk.com/api-reference/ticketing/ticket-management/incremental_exports/', fields: [{ name: 'subdomain', label: 'Zendesk subdomain', placeholder: 'your-company', required: true }, { name: 'accessToken', label: 'OAuth access token (tickets:read)', secret: true, required: true }] }), sync: ['tickets'] },
  { id: 'freshdesk', name: 'Freshdesk', category: 'crm_support', description: 'Read-only bounded ticket metadata from one Freshdesk tenant. Sneup excludes descriptions, contacts, companies, agents, comments, tags, custom fields, attachments, SLAs, and provider writes.', auth: apiKey({ docsUrl: 'https://developers.freshdesk.com/api/', fields: [{ name: 'subdomain', label: 'Freshdesk subdomain', placeholder: 'your-company', required: true }, { name: 'apiKey', label: 'API key', secret: true, required: true }] }), sync: ['tickets'] },
  { id: 'servicenow', name: 'ServiceNow', category: 'crm_support', description: 'Read-only bounded active-incident metadata from one ServiceNow tenant. Sneup excludes descriptions beyond redacted short text, callers, assignees, work notes, comments, attachments, CMDB data, requests, changes, tasks, approvals, links, and provider writes.', auth: pat({ docsUrl: 'https://developer.servicenow.com/print_page.do?category=course-module&identifier=app_store_learnv2_rest_yokohama_inbound_rest_integrations%2Capp_store_learnv2_rest_yokohama_cors_rules&module=course&release=yokohama', fields: [{ name: 'baseUrl', label: 'ServiceNow instance URL', placeholder: 'https://your-instance.service-now.com', required: true }, { name: 'token', label: 'OAuth access token', secret: true, required: true }] }), sync: ['active_incidents'] },
  { id: 'pipedrive', name: 'Pipedrive', category: 'crm_support', description: 'Read-only bounded deal metadata using an OAuth access token. Sneup excludes people, organizations, activities, notes, values, currencies, custom fields, lost reasons, and provider writes.', auth: apiKey({ displayType: 'OAuth token', docsUrl: 'https://developers.pipedrive.com/docs/api/v1/Deals', fields: [{ name: 'companyDomain', label: 'Pipedrive company domain', placeholder: 'your-company', required: true }, { name: 'accessToken', label: 'OAuth access token (deals:read)', secret: true, required: true }] }), sync: ['deals'] },
  { id: 'typeform', name: 'Typeform', category: 'automation_data', description: 'Read-only bounded intake-form metadata using a personal access token with forms:read. Sneup excludes responses, questions, fields, logic, hidden parameters, webhooks, workspace members, and provider writes.', auth: pat({ docsUrl: 'https://developer.typeform.com/developers/get-started/scopes/', fields: [{ name: 'token', label: 'Personal access token (forms:read)', secret: true, required: true }] }), sync: ['forms'] },
  { id: 'google_forms', name: 'Google Forms', category: 'automation_data', description: 'Forms, responses, intake, feedback, and lightweight project request capture.', auth: manual({ docsUrl: 'https://developers.google.com/forms/api' }), sync: ['forms', 'responses'] },
  { id: 'survey_monkey', name: 'SurveyMonkey', category: 'automation_data', description: 'Read-only bounded survey metadata through a View Surveys token. Sneup excludes questions, responses, collectors, contacts, links, and provider writes.', auth: pat({ scopes: ['View Surveys'], docsUrl: 'https://api.surveymonkey.com/v3/docs', fields: [{ name: 'accessToken', label: 'Access token (View Surveys)', secret: true, required: true }] }), sync: ['surveys'] },
  { id: 'zapier', name: 'Zapier', category: 'automation_data', description: 'Zaps, webhooks, cross-app automations, handoffs, and event triggers.', auth: manual({ docsUrl: 'https://platform.zapier.com/docs' }), sync: ['webhooks', 'automations'] },
  { id: 'make', name: 'Make',
    category: 'automation_data',
    description: 'Read-only bounded scenario metadata from one explicit Make team. Sneup excludes blueprints, modules, connections, webhooks, execution data, and provider writes.',
    auth: apiKey({ docsUrl: 'https://developers.make.com/api-documentation/api-reference/scenarios', fields: [{ name: 'apiToken', label: 'API token (scenarios:read)', secret: true, required: true }, { name: 'teamId', label: 'Team ID', placeholder: '123456', required: true }, { name: 'zone', label: 'API zone', placeholder: 'eu1', required: false }] }),
    sync: ['scenarios']
  },
  { id: 'n8n', name: 'n8n', category: 'automation_data', description: 'Read-only bounded active-workflow and execution metadata from one public HTTPS n8n instance. Sneup excludes workflow definitions, node configuration, credentials, execution data, error payloads, trigger payloads, and provider writes.', auth: apiKey({ docsUrl: 'https://docs.n8n.io/api/', fields: [{ name: 'baseUrl', label: 'n8n instance URL', placeholder: 'https://your-instance.app.n8n.cloud', secret: false, required: true }, { name: 'apiKey', label: 'API key', secret: true, required: true }] }), sync: ['active_workflows', 'recent_executions'] },
  { id: 'power_bi', name: 'Power BI', category: 'automation_data', description: 'Workspaces, datasets, reports, dashboards, and project performance reporting.', auth: manual({ docsUrl: 'https://learn.microsoft.com/en-us/rest/api/power-bi/' }), sync: ['workspaces', 'datasets', 'reports', 'dashboards'] },
  { id: 'tableau', name: 'Tableau', category: 'automation_data', description: 'Read-only bounded Tableau Cloud project and workbook metadata using a personal access token. Sneup excludes descriptions, views, dashboards, data sources, owners, permissions, URLs, tags, content, and provider content writes.', auth: pat({ docsUrl: 'https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_concepts_auth.htm', fields: [{ name: 'baseUrl', label: 'Tableau Cloud pod URL', placeholder: 'https://10ay.online.tableau.com', required: true }, { name: 'siteContentUrl', label: 'Tableau Cloud site content URL', placeholder: 'marketing-team', required: true }, { name: 'personalAccessTokenName', label: 'Personal access token name', required: true }, { name: 'personalAccessTokenSecret', label: 'Personal access token secret', secret: true, required: true }] }), sync: ['projects', 'workbooks'] },
  { id: 'looker_studio', name: 'Looker Studio', category: 'automation_data', description: 'Reports, dashboards, data sources, and stakeholder reporting artifacts.', auth: manual({ docsUrl: 'https://developers.google.com/looker-studio' }), sync: ['reports', 'data_sources'] },
  { id: 'sentry', name: 'Sentry', category: 'incident_quality', description: 'Read-only bounded project and unresolved issue metadata for one Sentry organization. Sneup excludes event payloads, stack traces, culprits, owners, tags, users, releases, alerts, and provider writes.', auth: pat({ docsUrl: 'https://docs.sentry.io/api/auth/', fields: [{ name: 'organizationSlug', label: 'Sentry organization slug', placeholder: 'your-organization', required: true }, { name: 'token', label: 'Auth token (org:read and event:read)', secret: true, required: true }] }), sync: ['projects', 'unresolved_issues'] },
  { id: 'datadog', name: 'Datadog', category: 'incident_quality', description: 'Read-only bounded monitor and active incident metadata. Sneup excludes monitor queries/messages/tags, downtimes, dashboards, services, SLOs, incident timelines/responders, and provider writes.', auth: apiKey({ docsUrl: 'https://docs.datadoghq.com/api/latest/authentication/', fields: [{ name: 'site', label: 'Datadog site', placeholder: 'datadoghq.com', required: true }, { name: 'apiKey', label: 'API key', secret: true, required: true }, { name: 'appKey', label: 'Application key (monitors_read and incident_read)', secret: true, required: true }] }), sync: ['monitors', 'active_incidents'] },
  { id: 'new_relic', name: 'New Relic', category: 'incident_quality', description: 'Read-only bounded open-violation metadata using a New Relic user key. Sneup excludes alert payloads, condition details, services, deployments, dashboards, users, links, descriptions, and provider writes.', auth: pat({ docsUrl: 'https://docs.newrelic.com/docs/apis/rest-api-v2/get-started/introduction-new-relic-rest-api-v2/', fields: [{ name: 'token', label: 'New Relic user API key', secret: true, required: true }] }), sync: ['open_violations'] },
  { id: 'pagerduty', name: 'PagerDuty', category: 'incident_quality', description: 'Read-only bounded active incident and service metadata. Sneup excludes responders, escalation policies, schedules, notes, integrations, and provider writes.', auth: pat({ docsUrl: 'https://developer.pagerduty.com/docs/rest-api-v2/authentication/', fields: [{ name: 'token', label: 'Read-only REST API token', secret: true, required: true }] }), sync: ['active_incidents', 'services'] },
  { id: 'opsgenie', name: 'Opsgenie', category: 'incident_quality', description: 'Alerts, incidents, schedules, teams, escalation policies, and service ownership.', auth: apiKey({ docsUrl: 'https://docs.opsgenie.com/docs/api-overview' }), sync: ['alerts', 'incidents', 'schedules', 'teams'] },
  { id: 'testRail', name: 'TestRail', category: 'incident_quality', description: 'Read-only bounded active test-run metadata from one explicit project. Sneup excludes cases, results, descriptions, references, custom fields, attachments, and provider writes.', auth: apiKey({ docsUrl: 'https://support.testrail.com/hc/en-us/articles/7077039051284-Accessing-the-TestRail-API', fields: [{ name: 'baseUrl', label: 'TestRail base URL', placeholder: 'https://your-company.testrail.io', required: true }, { name: 'username', label: 'TestRail username', placeholder: 'name@company.com', required: true }, { name: 'apiKey', label: 'API key', secret: true, required: true }, { name: 'projectId', label: 'Project ID', placeholder: '123', required: true }] }), sync: ['active_test_runs'] },
  { id: 'browserstack', name: 'BrowserStack', category: 'incident_quality', description: 'Read-only bounded recent Automate build health. Sneup excludes public URLs, tags, sessions, logs, browser and device data, and provider writes.', auth: apiKey({ docsUrl: 'https://www.browserstack.com/docs/automate/api-reference/selenium/build', fields: [{ name: 'username', label: 'BrowserStack username', placeholder: 'name@company.com', required: true }, { name: 'accessKey', label: 'BrowserStack access key', secret: true, required: true }] }), sync: ['recent_builds'] },
  { id: 'statuspage', name: 'Atlassian Statuspage', category: 'incident_quality', description: 'Read-only bounded component and incident metadata for one status page. Sneup excludes subscribers, update bodies, postmortems, descriptions, and provider writes.', auth: apiKey({ docsUrl: 'https://developer.statuspage.io/', fields: [{ name: 'pageId', label: 'Statuspage page ID', placeholder: 'abc123def456', required: true }, { name: 'apiKey', label: 'Read-only API key', secret: true, required: true }] }), sync: ['components', 'incidents'] },
  { id: 'aha', name: 'Aha!', category: 'work_management', description: 'Read-only product and feature metadata from one Aha! account domain.', auth: apiKey({ docsUrl: 'https://www.aha.io/api', fields: [{ name: 'accountUrl', label: 'Aha! account URL', placeholder: 'https://your-company.aha.io', required: true }, { name: 'apiToken', label: 'API token', secret: true, required: true }] }), sync: ['products', 'features'] },
  { id: 'productboard', name: 'Productboard', category: 'work_management', description: 'Read-only component, feature, and objective metadata for roadmap execution context.', auth: apiKey({ docsUrl: 'https://developer.productboard.com/reference', fields: [{ name: 'apiToken', label: 'API token', secret: true, required: true }] }), sync: ['components', 'features', 'objectives'] },
  { id: 'jira_align', name: 'Jira Align', category: 'software_delivery', description: 'Program initiatives, enterprise epics, value streams, dependencies, and planning windows.', auth: manual({ docsUrl: 'https://www.atlassian.com/software/jira/align', fields: [{ name: 'baseUrl', label: 'Jira Align API URL', required: true }, { name: 'apiToken', label: 'API token', secret: true, required: true }] }), sync: ['programs', 'initiatives', 'work_items', 'dependencies', 'planning_windows'] },
  { id: 'teamgantt', name: 'TeamGantt', category: 'work_management', description: 'Read-only bounded project and task metadata from one explicitly selected company. Sneup excludes descriptions, comments, checklists, resources, time blocks, custom fields, and provider writes.', auth: pat({ docsUrl: 'https://api-docs.teamgantt.com/', fields: [{ name: 'companyId', label: 'TeamGantt company ID', placeholder: '123456', required: true }, { name: 'token', label: 'Personal access token', secret: true, required: true }] }), sync: ['projects', 'tasks'] },
  { id: 'kanbanize', name: 'Businessmap (formerly Kanbanize)', category: 'work_management', description: 'Read-only bounded active-board and card metadata from one Businessmap account. Sneup excludes descriptions, comments, custom fields, files, dependencies, users, time data, workflow configuration, and provider writes.', auth: apiKey({ docsUrl: 'https://knowledgebase.businessmap.io/hc/en-us/articles/360012393692-Businessmap-REST-API', fields: [{ name: 'apiUrl', label: 'Businessmap account URL', placeholder: 'https://your-account.kanbanize.com', required: true }, { name: 'apiToken', label: 'API key', secret: true, required: true }] }), sync: ['boards', 'active_cards'] },
  { id: 'google_chat', name: 'Google Chat', category: 'communication', description: 'Read-only bounded named-space metadata for spaces the connected user belongs to. Sneup excludes messages, members, group chats, direct messages, descriptions, URLs, and provider writes.', auth: oauth2({ envPrefix: 'GOOGLE_CHAT', authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth', tokenUrl: 'https://oauth2.googleapis.com/token', scopes: ['https://www.googleapis.com/auth/chat.spaces.readonly'], docsUrl: 'https://developers.google.com/workspace/chat/api/reference/rest/v1/spaces/list' }), sync: ['spaces'] },
  { id: 'projectplace', name: 'Projectplace', category: 'work_management', description: 'Projects, tasks, templates, workstreams, files, and collaborative planning.', auth: apiKey({ docsUrl: 'https://help.projectplace.com/en/kb/api-api-interface', fields: [{ name: 'baseUrl', label: 'Projectplace API URL', required: true }, { name: 'apiKey', label: 'API key', secret: true, required: true }] }), sync: ['projects', 'tasks', 'workstreams', 'files', 'users'] },
  { id: 'clarizen', name: 'Clarizen', category: 'software_delivery', description: 'Programs, initiatives, dependencies, resource assignments, risks, milestones, and executive reporting.', auth: apiKey({ docsUrl: 'https://api.clarizen.com/api/2/rest', fields: [{ name: 'tenantUrl', label: 'Clarizen tenant URL', required: true }, { name: 'apiKey', label: 'API token', secret: true, required: true }] }), sync: ['projects', 'tasks', 'initiatives', 'assignments', 'risks', 'milestones'] },
  { id: 'scoro', name: 'Scoro', category: 'work_management', description: 'Work orders, tasks, CRM opportunities, estimates, billing, capacity, and team utilization.', auth: apiKey({ docsUrl: 'https://api.scoro.com', fields: [{ name: 'accountId', label: 'Scoro account ID', required: true }, { name: 'apiKey', label: 'API token', secret: true, required: true }] }), sync: ['projects', 'tasks', 'opportunities', 'invoices', 'timesheets'] },
  { id: 'hive', name: 'Hive', category: 'work_management', description: 'Projects, tasks, conversations, checklists, files, and team communication signals.', auth: apiKey({ docsUrl: 'https://developer.hive.com/', fields: [{ name: 'apiToken', label: 'API token', secret: true, required: true }] }), sync: ['projects', 'tasks', 'conversations', 'files', 'checklists'] },
  { id: 'taskworld', name: 'Taskworld', category: 'work_management', description: 'Projects, tasks, milestones, chat, approvals, and team workload management.', auth: apiKey({ docsUrl: 'https://developer.taskworld.com/docs', fields: [{ name: 'apiKey', label: 'API token', secret: true, required: true }] }), sync: ['projects', 'tasks', 'milestones', 'conversations', 'comments'] },
  { id: 'webhook_generic', name: 'Generic Webhook', category: 'automation_data', description: 'Catch events from any tool with outbound webhooks and map them into Sneup signals.', auth: manual({ fields: [{ name: 'sourceName', label: 'Source name', required: true }, { name: 'signingSecret', label: 'Signing secret', secret: true, required: false }] }), sync: ['events'] },
  { id: 'rest_api_generic', name: 'Generic REST API', category: 'automation_data', description: 'Read-only bounded metadata from one public HTTPS JSON collection. Sneup rejects private-network targets, redirects, raw payload retention, pagination guessing, and provider writes.', auth: apiKey({ fields: [{ name: 'baseUrl', label: 'HTTPS API base URL', placeholder: 'https://api.example.com', required: true }, { name: 'endpointPath', label: 'Read-only collection path', placeholder: '/v1/tasks', required: true }, { name: 'recordPath', label: 'JSON record path (optional)', placeholder: 'data.items', required: false }, { name: 'apiKey', label: 'Bearer token', secret: true, required: true }] }), sync: ['custom_resources'] }
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
