# Sneup - Autonomous AI-Powered Digital Project Manager for Trello

**Sneup** is an intelligent, autonomous project management system that manages 50+ Trello boards simultaneously with deep context understanding, bottleneck identification, task completion tracking, and autonomous team management.

## Features

### Autonomous Management
- **Automatic Synchronization**: Syncs all Trello boards with configurable intervals
- **Real-time Updates**: Webhook integration for instant change detection
- **Self-Learning System**: Learns from patterns and feedback to improve recommendations

### Deep Context Understanding
- **Cross-Board Intelligence**: Identifies relationships between cards across different boards
- **Workflow Pattern Recognition**: Analyzes and learns workflow patterns
- **Team Pattern Analysis**: Understands team member specialties and work styles

### Advanced Analytics
- **Bottleneck Detection**: Automatically identifies workflow bottlenecks with severity levels
- **Project Health Monitoring**: Continuous assessment of project health and risk factors
- **Velocity Tracking**: Measures team velocity and cycle time
- **Predictive Analytics**: Estimates completion dates and identifies risk areas

### Intelligent Team Management
- **Workload Balancing**: Analyzes team workload and suggests rebalancing
- **Smart Task Assignment**: Automatically assigns tasks based on member availability and specialties
- **At-Risk Card Detection**: Identifies cards at risk and suggests interventions
- **Team Performance Tracking**: Monitors individual and team performance metrics

### Natural Language Processing
- **Sentiment Analysis**: Analyzes sentiment in comments and communications
- **Keyword Extraction**: Identifies key topics and themes
- **Action Item Detection**: Automatically detects action items in comments
- **Communication Pattern Analysis**: Understands team communication styles

## Technology Stack

All components are battle-tested, production-ready open source libraries:

| Component | Library | Stars | Purpose |
|-----------|---------|-------|---------|
| Trello API | [trello.js](https://github.com/mrrefactoring/trello.js) | 20 | Modern TypeScript Trello client |
| NLP | [natural](https://github.com/NaturalNode/natural) | 10.9k | Text analysis, sentiment, keywords |
| Scheduling | [node-schedule](https://github.com/node-schedule/node-schedule) | 9.2k | Cron jobs for sync and analysis |
| Database | [mongoose](https://github.com/Automattic/mongoose) | 26k+ | MongoDB ODM for data persistence |
| Web Framework | [express](https://github.com/expressjs/express) | 65k+ | API and webhook endpoints |
| Logging | [winston](https://github.com/winstonjs/winston) | 23k+ | Production logging |

## Installation

### Prerequisites

- **Node.js** 14.0.0 or higher
- **MongoDB** 4.0 or higher
- **Trello Account** with API access

### Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/Noodzakelijk-Online/sneup.git
   cd sneup
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   ```bash
   cp .env.example .env
   ```

   Edit `.env` and add your configuration:
   ```env
   # Trello API Credentials
   TRELLO_API_KEY=your_trello_api_key_here
   TRELLO_API_TOKEN=your_trello_api_token_here
   
   # MongoDB Configuration
   MONGODB_URI=mongodb://localhost:27017/sneup
   
   # Server Configuration
   PORT=3000
   NODE_ENV=development
   
   # Webhook Configuration (optional)
   WEBHOOK_CALLBACK_URL=https://your-domain.com/api/webhooks/trello
   ```

4. **Get Trello API credentials**
   - Visit [https://trello.com/app-key](https://trello.com/app-key)
   - Copy your API Key
   - Generate a Token by clicking the "Token" link
   - Add both to your `.env` file

5. **Start MongoDB**
   ```bash
   # Using Docker
   docker run -d -p 27017:27017 --name mongodb mongo:latest
   
   # Or use your local MongoDB installation
   mongod
   ```

6. **Start Sneup**
   ```bash
   npm start
   ```

   For development with auto-reload:
   ```bash
   npm run dev
   ```

### Production token-secret boundary

For a live production workspace, set independent random values of at least 32 characters for `SNEUP_API_TOKEN_PEPPER`, `SNEUP_SESSION_TOKEN_PEPPER`, and `SNEUP_INVITE_TOKEN_PEPPER`. Sneup refuses to start a non-demo production runtime when any of these is absent, weak, or still a placeholder. This prevents database API tokens, desktop sessions, and invitation tokens from being hashed with predictable development defaults. Before an invitation can be issued in production, configure `SNEUP_PUBLIC_URL` as a non-local HTTPS origin with no credentials, query parameters, or fragment; this keeps the one-time invite token out of a preconfigured URL component.

Before a live release, run `npm run check:release-security` with the deployment environment loaded. It confirms, without printing their values, that the three token peppers plus `CONNECTOR_ENCRYPTION_KEY` and `CONNECTOR_STATE_SECRET` are present, non-placeholder, at least 32 characters, and distinct by purpose. The command fails for demo or non-production environments so a release pipeline cannot accidentally treat a local configuration as deployment evidence.

Runtime logs redact credentials, authorization headers, cookies, credential-bearing query parameters, provider request configuration, and retained work content before Winston serializes an event. Chat processing logs opaque IDs and routing metadata only, never a worker message excerpt or username.

Terminal workspace invitations are retained as lifecycle evidence only. The daily `identity.invitation_retention` job redacts the invite email, display name, token prefix, token hash, and delivery failure code after `SNEUP_INVITE_RETENTION_DAYS` (default `90`, bounded from `7` to `3650`) while preserving status, role, dates, and aggregate workspace audit evidence. Tune the bounded batch with `SNEUP_INVITE_RETENTION_BATCH_SIZE` (default `100`, maximum `250`) and the scheduled run with `SNEUP_INVITE_RETENTION_CRON`.

The Windows installer uses the bundled Sneup icon. Release signing and automatic updates remain release-infrastructure tasks: configure a publisher certificate and update feed in the release environment before distributing a trusted production build.

## API Endpoints

### Boards

- `GET /api/boards` - Get all boards
- `GET /api/boards/:boardId` - Get specific board with lists and cards
- `POST /api/boards/:boardId/sync` - Manually sync a board
- `GET /api/boards/:boardId/context` - Get board context and relationships
- `GET /api/boards/:boardId/cards/:cardId` - Get card details with context and NLP analysis
- `GET /api/boards/:boardId/relationships` - Get card relationships
- `GET /api/boards/:boardId/workflow` - Get workflow patterns

### Analytics

- `GET /api/analytics/board/:boardId/latest` - Get latest analytics
- `GET /api/analytics/board/:boardId/history?days=30` - Get analytics history
- `POST /api/analytics/board/:boardId/generate` - Generate analytics
- `GET /api/analytics/critical` - Get critical boards
- `GET /api/analytics/board/:boardId/bottlenecks` - Get bottlenecks
- `GET /api/analytics/board/:boardId/health` - Get project health
- `GET /api/analytics/board/:boardId/velocity` - Get velocity metrics

### Team Management

- `GET /api/team/board/:boardId/workload` - Get workload analysis
- `GET /api/team/board/:boardId/auto-assign` - Get auto-assignment suggestions
- `GET /api/team/board/:boardId/at-risk` - Get at-risk cards
- `GET /api/team/board/:boardId/report` - Generate team report
- `GET /api/team/accountability` - Summarize workspace follow-ups, responses, overdue work, and escalations by member without returning response text
- `GET /api/outcomes` - List minimum-evidence intervention outcome records without exposing worker response text
- `POST /api/outcomes/recommendations/:recommendationId/evaluate` - Verify a successful Trello action against synced card state or a recorded worker response; this never sends a Trello write
- `POST /api/team/recommendation/execute` - Queue a workload recommendation for approval
- `GET /api/team/patterns` - Get team patterns

### Security and Workspace Context

- `GET /api/security/context` - Show the resolved actor, workspace, role, and permission context for the current request
- `GET /api/workspaces/current` - Show the current workspace and resolved workspace override capability
- `GET /api/workspaces` - List workspaces for identity administrators
- `POST /api/workspaces` - Create a workspace
- `POST /api/workspaces/:workspaceId/update` - Update workspace metadata, plan, status, or settings
- `GET /api/workspaces/:workspaceId/users` - List workspace users
- `POST /api/workspaces/:workspaceId/users` - Create a workspace user
- `POST /api/workspaces/:workspaceId/users/:userId/update` - Update a workspace user
- `GET /api/workspaces/:workspaceId/users/:userId/sessions` - List hashed user session records
- `POST /api/workspaces/:workspaceId/users/:userId/session` - Issue a one-time-visible user session token
- `POST /api/workspaces/:workspaceId/users/:userId/sessions/:sessionId/revoke` - Revoke a user session token
- `GET /api/workspaces/:workspaceId/invitations` - List time-bound workspace invitations
- `POST /api/workspaces/:workspaceId/invitations` - Create an invitation and return its one-time-visible secure link; email delivery is explicit and optional
- `POST /api/workspaces/:workspaceId/invitations/:inviteId/retry-delivery` - Replace a failed email invitation with a fresh one-time link, retry delivery, and ledger the replacement
- `POST /api/workspaces/:workspaceId/invitations/:inviteId/revoke` - Revoke a pending invitation
- `POST /api/workspaces/invitations/accept` - Accept a secure invitation token and issue a short-lived onboarding session

See `docs/MULTI_WORKSPACE_IDENTITY.md` for workspace selection, session token, and production migration notes.

### Workspace Action Safety

- `GET /api/policy-rules` - List the effective workspace safety posture for each supported Trello write action
- `GET /api/policy-rules/history` - List recent workspace action-safety changes from the audit ledger
- `PUT /api/policy-rules/:actionType` - Pause an action type, optionally set a future `pauseExpiresAt` review time, or raise its risk/decision-owner posture (`policy-rules:manage`)

Trello writes remain approval-gated regardless of a workspace rule. A rule can pause a write action, raise its risk, or route its decision to a stricter owner. An optional future pause review time makes an overdue pause visible, but it never re-enables an action automatically. Re-enabling a paused action or relaxing a prior workspace rule requires explicit confirmation and creates an audit event. The Workspace command center shows the latest bounded policy history. The executor resolves this policy immediately before its atomic execution claim, so a pause also blocks recommendations approved before the policy changed. Approved payloads also expire before execution (critical: 4 hours, high: 24 hours, medium: 72 hours, low: 168 hours by default); Sneup returns an expired item to the internal decision queue, records the expiry, and requires review of the unchanged protected payload before any provider write. Operators can shorten or extend each risk window only within 1 to 168 hours through `SNEUP_APPROVAL_TTL_CRITICAL_HOURS`, `SNEUP_APPROVAL_TTL_HIGH_HOURS`, `SNEUP_APPROVAL_TTL_MEDIUM_HOURS`, and `SNEUP_APPROVAL_TTL_LOW_HOURS`.

### Connectors and Work Signals

- `GET /api/connectors` - List connector catalog entries and linked accounts
- `GET /api/connectors/accounts` - List linked connector accounts
- `POST /api/connectors/:connectorId/connect` - Begin an OAuth connector flow
- `POST /api/connectors/:connectorId/accounts` - Save an API-key, token, manual, basic, or webhook connector account
- `POST /api/connectors/accounts/:accountId/validate` - Mark a connector account as validated
- `GET /api/connectors/accounts/:accountId/jira-sites` - List Jira Cloud sites authorized by a linked Jira account
- `POST /api/connectors/accounts/:accountId/jira-site` - Select the Jira Cloud site Sneup may read from
- `GET /api/connectors/accounts/:accountId/asana-workspaces` - List Asana workspaces authorized by a linked Asana account
- `POST /api/connectors/accounts/:accountId/asana-workspace` - Select the Asana workspace Sneup may read from
- `GET /api/connectors/accounts/:accountId/sharepoint-sites` - List followed SharePoint sites authorized by a linked SharePoint account
- `POST /api/connectors/accounts/:accountId/sharepoint-site` - Select the one SharePoint site Sneup may read from
- `GET /api/connectors/accounts/:accountId/xero-tenants` - List Xero organisations authorized by a linked Xero account
- `POST /api/connectors/accounts/:accountId/xero-tenant` - Select the one Xero organisation Sneup may read from
- `GET /api/connectors/accounts/:accountId/mural-workspaces` - List Mural workspaces authorized by a linked Mural account
- `POST /api/connectors/accounts/:accountId/mural-workspace` - Select the one Mural workspace Sneup may read from
- `DELETE /api/connectors/accounts/:accountId` - Remove a linked connector account
- `GET /api/work-signals/contracts` - List normalized sync adapter contracts for all connectors
- `GET /api/work-signals/adapters` - List implemented first-wave read-only provider adapters
- `GET /api/work-signals` - List normalized cross-tool work signals for the current workspace
- `GET /api/work-signals/graph` - Summarize normalized WorkItem/WorkActor/WorkContainer graph records, dependency types, freshness, review outcomes, and connector stale-edge quality
- `GET /api/work-signals/graph/decisions` - List graph-derived Robert/VA/team decision candidates
- `GET /api/work-signals/graph/items/:itemId` - Inspect a graph item with dependency edges, recent graph events, and queued recommendation history
- `POST /api/work-signals/graph/items/:itemId/queue` - Queue a graph item as an approval-gated recommendation
- `POST /api/work-signals/graph/dependencies/:dependencyId/review` - Confirm, refresh, or dismiss a stale dependency edge inside Sneup without provider writes
- `POST /api/work-signals/accounts/:accountId/upsert` - Upsert one normalized work signal from a linked connector account
- `POST /api/work-signals/accounts/:accountId/sync` - Run a read-only adapter sync for one connected account with bounded provider pacing and transient-failure retries

Live credential-backed ingestion is available for Trello, Jira, Asana, Slack, GitHub, Google Workspace, Microsoft 365, Linear, Notion, monday.com, ClickUp, Azure DevOps, Wrike, Smartsheet, Airtable, Todoist, Shortcut, Bitbucket, Harvest, Everhour, Coda, Teamwork, TeamGantt, Businessmap, Basecamp, Redmine, Make, and n8n. The monday.com reader uses the `boards:read` scope only, reads board and item metadata through the GraphQL API, excludes item descriptions and updates, and fails visibly at configured board or item limits rather than silently skipping work. The ClickUp reader syncs authorized-workspace task metadata with bounded pages and update-time lookback, discarding task descriptions before graph storage. The Azure DevOps reader uses a PAT restricted to Work Items Read, requires a public `https://dev.azure.com/organization` URL, runs bounded WIQL reads, and retrieves selected work-item fields plus relation metadata only. The Wrike reader uses only GET requests for bounded project and task metadata, requests the minimal owner/parent/dependency identifiers needed for graph context, and intentionally excludes descriptions, comments, custom fields, and attachments. The Smartsheet reader makes bounded GET requests for sheet, column, and selected-row metadata, filters deltas by row modification time, and never requests attachments, discussions, row links, or arbitrary cell columns. The Airtable reader needs an explicit base, table, and allowlisted task fields; it uses only paginated record GET requests and never discovers or stores unrelated fields. The Todoist reader fetches only bounded project and task metadata using GET requests, omits task descriptions before graph storage, and fails visibly at configured project or task limits. The Shortcut reader uses only GET requests for a bounded number of projects and stories, retains story links as dependency metadata, and excludes descriptions, comments, files, labels, and custom fields before graph storage. The Bitbucket reader requires one workspace slug and an API token with repository, issue, and pull-request read access; it uses only bounded GET pages and strips descriptions, comments, diffs, deployment data, and arbitrary repository fields before graph storage. The Harvest reader requires a numeric account ID and personal access token, reads only bounded paginated time-entry metadata with `GET`, and deliberately excludes notes, rates, invoice status, and budget data. The Everhour reader uses a GET-only bounded recent time-entry request with its API key header and deliberately excludes descriptions, notes, budgets, expenses, invoices, rates, and person/profile discovery. The Coda reader requires an explicit comma-separated document allowlist and reads only bounded table metadata with `GET`; it never requests table rows, column values, pages, packs, or button actions. The Teamwork reader requires one HTTPS `*.teamwork.com` tenant URL and API key, reads bounded project and task metadata with GET and update-time lookback, and excludes private tasks, descriptions, comments, files, time, company, and billing data. The TeamGantt reader requires an explicit company ID and personal access token, uses bounded GET-only project and paginated task requests, limits each response to 2 MB by default, redacts email addresses and URLs in retained titles, and excludes descriptions, comments, checklists, resources, time blocks, custom fields, provider URLs, and provider writes. The Basecamp reader selects one authorized account and ingests bounded project and to-do metadata with GET only. The Redmine reader requires a public HTTPS base URL and API key, disables redirects and proxy use, reads bounded project and issue metadata with update-time lookback, retains issue-relation identifiers for the work graph, and excludes descriptions, journals, custom fields, attachments, time entries, wiki, and forum content. The Make reader accepts only `scenarios:read`, one explicit numeric team ID, and an allowlisted Make region; it uses one bounded GET request for scenario metadata and excludes blueprints, modules, connections, webhooks, execution data, and provider writes. The n8n reader accepts one public HTTPS instance URL and API key, uses GET-only bounded reads for active workflow and execution metadata, pins DNS lookups to public addresses, and excludes workflow definitions, node configuration, credentials, execution data, and error payloads before graph storage.

TestRail is available for one explicit public HTTPS tenant, username, API key, and numeric project ID. Sneup uses one bounded GET request for active test-run metadata, rejects paginated overflow, pins DNS to public addresses, and excludes cases, results, descriptions, references, custom fields, attachments, and provider writes.

BrowserStack is available with a username and access key. Sneup performs one fixed-host, bounded Automate build-list GET, fails closed when its page cap is reached, and retains only build ID, redacted name, status, priority, completion state, and bounded duration. It excludes public URLs, tags, sessions, logs, browser and device data, and provider writes.

OneDrive is available as a separate Microsoft OAuth connection with `Files.Read` only. Sneup makes one bounded GET to the signed-in user's drive root, fails visibly if Graph signals a further page, and retains only redacted item names, type, and created/updated metadata. It excludes file content, web URLs, permissions, versions, shared links, and provider writes.

SharePoint is available as a separate Microsoft OAuth connection. It explicitly presents the delegated `Sites.Read.All` grant for review, lists only sites the signed-in user follows, requires one site to be selected, and then makes one capped root-metadata GET with `Files.Read`. It retains only redacted file or folder names, opaque identifiers, and timestamps; file contents, web URLs, permissions, pages, lists, people, versions, and sharing details are excluded.

Xero is available as a separate OAuth connection with `accounting.invoices.read`. Sneup lists authorized organisations, requires one selection, and makes one capped GET for sales-invoice status and date metadata. It retains only opaque invoice and organisation identifiers, status, and dates; contacts, invoice numbers, amounts, payment data, descriptions, line items, URLs, and provider writes are excluded.

Google Forms is available as a separate Google OAuth connection with `drive.metadata.readonly`. Sneup makes one capped Drive metadata request for Google Forms owned by or shared to the signed-in user and retains only redacted form names, opaque identifiers, and timestamps. It excludes form bodies, questions, responses, owners, URLs, collaborators, sharing details, shared drives, and provider writes.

Mural is available as a separate OAuth connection with `workspaces:read` and `murals:read`. Sneup requires the user to select one currently authorized workspace, then makes one capped request for active mural metadata. It retains only redacted mural names, opaque identifiers, and timestamps; mural content, widgets, comments, templates, rooms, people, URLs, sharing details, and provider writes are excluded.

Canva is available as a separate PKCE OAuth connection with `design:meta:read`. Sneup stores each one-time PKCE verifier encrypted inside its signed server state, then makes one capped design-metadata request. It retains only redacted design names, opaque identifiers, and timestamps; design content, pages, thumbnails, temporary links, owners, folders, assets, comments, approvals, and provider writes are excluded.

QuickBooks Online is available as a reviewed OAuth connection with the Accounting API scope. Sneup validates and binds to the opaque company `realmId` returned in its signed OAuth callback, then makes one capped sales-invoice metadata request. It retains only opaque invoice and company IDs, status, and dates; customers, invoice numbers, amounts, balances, payments, estimates, expenses, projects, line items, descriptions, addresses, links, attachments, taxes, and provider writes are excluded.

Power BI is available as a reviewed Microsoft OAuth connection with `Report.Read.All`. Sneup makes one capped GET request to the report catalog and retains only opaque report IDs, redacted report names, and report type; report contents, dashboards, datasets, workspace membership, descriptions, URLs, embeds, owners, subscriptions, users, and provider writes are excluded.

SurveyMonkey is available with a View Surveys access token. Sneup makes one bounded survey-list GET and retains only redacted survey title and ID. It excludes questions, responses, collectors, contacts, links, and provider writes.

Google Drive is available as a separate metadata-only Google OAuth connection. Sneup reads one bounded user-Drive page, rejects incomplete pagination, and retains only redacted file or folder names plus timestamps. It excludes file content, web URLs, permissions, owners, shared drives, and provider writes.

Tableau Cloud is available with a pod URL, site content URL, and personal access token. Sneup signs in only to establish a short-lived API session, reads one bounded project page and one bounded workbook page with GET, then invalidates the session. It retains only redacted names, opaque identifiers, project linkage, and timestamps; descriptions, views, dashboards, data sources, owners, permissions, URLs, tags, content, and provider content writes are excluded.

Businessmap (formerly Kanbanize) is additionally available with its API-v2 account endpoint and API key. Sneup accepts one public `https://account.kanbanize.com` URL, uses GET-only bounded active-board and paginated active-card reads, and excludes descriptions, comments, custom fields, files, dependencies, users, time data, workflow configuration, and provider writes.

Microsoft Planner uses a dedicated Microsoft OAuth account with `Tasks.Read` only. It reads bounded assigned-task metadata from `/me/planner/tasks`, excludes descriptions, checklists, attachments, labels, comments, and provider writes, and retains only plan/bucket identifiers for work-graph context.

YouTrack uses a permanent token and a public HTTPS base URL. It makes only paginated `GET /api/issues` metadata reads, requests an allowlisted response shape, strips descriptions, comments, attachments, and custom-field values before storage, and fails visibly at its configured issue cap.

Taiga uses a bearer access token and a public HTTPS base URL. It reads only the signed-in member's bounded project, user-story, and task metadata with `GET`, filters deltas locally with a short lookback, excludes descriptions, comments, attachments, custom attributes, and provider writes, and fails visibly at configured collection caps.

Backlog uses a project-member API key and a public `*.backlog.com` or `*.backlogtool.com` space URL. It reads bounded active-project and issue metadata with `GET`, checks provider counts before paging, excludes descriptions, comments, attachments, and custom fields, and never makes provider writes.

Freedcamp uses an account API key in the `X-API-KEY` header and reads bounded project, task, and milestone metadata with `GET`. It validates the provider's pagination signal, excludes descriptions, comments, files, custom fields, and tags, and never makes provider writes.

Zendesk uses an OAuth access token rather than a retiring static API token. It reads the bounded, cursor-based incremental ticket export with `GET`, excludes deleted tickets and all ticket body, comment, requester, assignee, collaborator, tag, custom-field, organization, SLA, and macro content, retains only small ticket metadata plus problem-ticket dependency identifiers, and never makes provider writes.

MeisterTask uses a personal access token with bearer authorization and reads bounded active project and section metadata plus task metadata with `GET`. It pins pagination to ascending IDs, excludes notes, comments, checklists, attachments, labels, tokens, and tracked-time detail, and never makes provider writes.

Aha! uses a user-scoped API token against one public `*.aha.io` account domain. It makes bounded `GET` requests for product and feature metadata using server-side field allowlists, excludes descriptions, notes, comments, attachments, custom fields, and provider writes, and fails visibly at configured collection caps.

Productboard uses a personal API token with bearer authorization. It reads bounded component, feature, and objective metadata through the v2 entities endpoint with a server-side field allowlist, validates opaque provider cursors before use, excludes descriptions, owners, tags, notes, custom fields, relationships, and never makes provider writes.

Toggl Track uses an API token with HTTP Basic authentication and requires one numeric workspace ID. It reads bounded project metadata plus a short, bounded personal time-entry window with `GET`, keeps only workspace-scoped utilization metadata and an opaque user ID for an explicit human-confirmed capacity mapping, honors the provider's 1,000-entry ceiling, and excludes descriptions, tags, clients, people, rates, sharing data, notes, and provider writes.

Clockify uses an API key and requires one workspace ID. It reads only the authenticated user's bounded, paginated project and time-entry metadata with `GET`, retains the opaque authenticated user ID only for an explicit human-confirmed capacity mapping, validates the provider pagination signal, excludes descriptions, tags, clients, people profiles, rates, custom fields, and provider writes, and fails visibly at configured collection caps.

Float uses a bearer API token. It reads bounded paginated project and date-filtered allocation metadata with server-side field allowlists, excludes people profiles and names, notes, clients, tags, rates, budgets, time off, logged time, and provider writes, and fails visibly at configured collection caps.

Resource Guru uses authorization-code OAuth and requires selection of one authorized Resource Guru account before syncing. It reads bounded project and date-filtered booking metadata with GET only, excludes resource profiles and names, notes, clients, rates, availability, timesheets, and provider writes, and fails visibly at configured collection caps.

Sentry uses an auth token scoped to `org:read` and `event:read` plus one explicit organization slug. It reads bounded project and unresolved issue metadata with GET only, validates Sentry's pagination signal, excludes event payloads, stack traces, culprits, owners, tags, users, releases, alerts, and provider writes, and fails visibly at configured collection caps.

PagerDuty uses a read-only REST API token. It reads bounded active incident and service metadata with GET only, validates native offset pagination, excludes responders, escalation policies, schedules, notes, integrations, and provider writes, and fails visibly at configured collection caps.

Atlassian Statuspage uses a page-scoped API key and explicit page ID. It reads bounded component and incident metadata with GET only, validates fixed-page pagination, excludes subscribers, incident update bodies, postmortems, component descriptions, and provider writes, and fails visibly at configured collection caps.

Generic REST API connects one configured public HTTPS JSON collection with a bearer token. It resolves the configured host before each sync, rejects private-network targets and redirects, pins the request to vetted public addresses, enforces response and record caps, stores only normalized ID/title/status/priority/timestamp metadata, and never makes provider writes or guesses pagination.

Datadog uses an API key plus an application key limited to `monitors_read` and `incident_read`, and an explicit documented Datadog site. It reads bounded monitor and active/stable incident metadata with GET only, excludes monitor queries/messages/tags, downtimes, dashboards, services, SLOs, incident timelines/responders, and provider writes.

### Operations Ledger and Approvals

- `GET /api/recommendations` - List approval-gated recommendations
- `GET /api/recommendations/:recommendationId` - Get a recommendation
- `GET /api/recommendations/:recommendationId/evidence` - Get source, decision, Trello action, follow-up, response, and audit evidence for a recommendation
- `POST /api/recommendations/:recommendationId/approve` - Approve a recommendation payload
- `POST /api/recommendations/:recommendationId/reject` - Reject a recommendation
- `POST /api/recommendations/:recommendationId/change` - Request changes to a recommendation
- `POST /api/recommendations/:recommendationId/execute-approved` - Execute an approved Trello action and record the attempt
- `GET /api/decision-queue/robert` - Robert-only high-risk decision queue
- `GET /api/decision-queue/team` - Team approval queue
- `GET /api/decision-queue/va` - VA queue scaffold
- `GET /api/autopilot/operations-brief` - Read-only daily operations brief across decisions, findings, follow-ups, failures, and board health
- `GET /api/trello-actions` - List Trello write attempts and failures
- `GET /api/audit` - List audit events
- `GET /api/follow-ups` - List follow-up plans
- `GET /api/follow-ups/due` - List due follow-up plans
- `GET /api/boards/:boardId/operations-ledger` - Board-level recommendation/action/audit ledger with Trello-linked and unresolved cross-provider graph context, source links, dependency freshness, and dependency filters
- `GET /api/boards/:boardId/operating-ledger` - Alias for board-level operating ledger
- `GET /api/boards/:boardId/decision-queue` - Board-specific decision queue
- `POST /api/boards/:boardId/analyze` - Safely analyze synced cards and persist findings/health snapshots
- `GET /api/boards/:boardId/findings` - Board-specific card findings
- `GET /api/boards/:boardId/health-snapshots` - Board health snapshot history
- `GET /api/cards/:cardId/operations-ledger` - Card-level recommendation/action/follow-up ledger with Trello-linked and unresolved cross-provider graph context, source links, dependency freshness, and dependency filters
- `GET /api/cards/:cardId/operating-ledger` - Alias for card-level operating ledger
- `GET /api/cards/:cardId/audit` - Card audit events
- `GET /api/cards/:cardId/findings` - Card findings and missing next-action/stale/blocked signals
- `GET /api/findings` - Global card finding list
- `GET /api/findings/board-health` - Global board health snapshot list
- `GET /api/jobs` - Job observability dashboard for sync, analytics, intervention, performance, and webhook jobs
- `GET /api/jobs/health` - Compact job health and stale-data summary
- `GET /api/jobs/runs` - Recent job run history with duration, counts, and failures
- `POST /api/jobs/:jobName/pause` - Pause a registered background job so scheduled runs are recorded as skipped
- `POST /api/jobs/:jobName/resume` - Resume a paused background job
- `POST /api/jobs/:jobName/trigger` - Manually trigger an allowlisted safe job
- `POST /api/interventions/:interventionId/record-response` - Record worker response to an intervention
- `POST /api/chat/message` - Record card-specific completed, blocked, or needs-help chat updates against an already executed matching communication intervention; generic chat never closes a follow-up

### Webhooks

- `POST /api/webhooks/trello` - Trello webhook endpoint
- `HEAD /api/webhooks/trello` - Webhook verification

## Architecture

```
sneup/
|-- src/
|   |-- models/          # Mongoose data models
|   |   |-- Board.js
|   |   |-- List.js
|   |   |-- Card.js
|   |   |-- Member.js
|   |   |-- Comment.js
|   |   |-- Analytics.js
|   |   `-- Learning.js
|   |-- services/        # Business logic services
|   |   |-- trelloClient.js      # Trello API wrapper
|   |   |-- trelloSync.js        # Synchronization service
|   |   |-- nlpService.js        # NLP analysis
|   |   |-- contextAnalyzer.js   # Context intelligence
|   |   |-- analyticsService.js  # Analytics generation
|   |   `-- teamManager.js       # Team management
|   |-- routes/          # Express API routes
|   |   |-- boards.js
|   |   |-- analytics.js
|   |   |-- team.js
|   |   `-- webhooks.js
|   |-- utils/           # Utility functions
|   |   |-- logger.js
|   |   `-- database.js
|   `-- index.js         # Application entry point
|-- config/              # Configuration files
|-- logs/                # Application logs
|-- .env.example         # Environment template
|-- package.json
`-- README.md
```

## Scheduled Jobs

Sneup runs several automated jobs:

- **Full Sync**: Daily at 1 AM (configurable via `FULL_SYNC_CRON`)
- **Incremental Sync**: Every 15 minutes (configurable via `INCREMENTAL_SYNC_CRON`)
- **Analytics Generation**: Every hour (configurable via `ANALYTICS_CRON`)
- **Bottleneck Detection**: Every 30 minutes (configurable via `BOTTLENECK_DETECTION_CRON`)

## Data Models

### Board
Represents a Trello board with members, lists, and sync status.

### List
Represents a list within a board with position and card count.

### Card
Represents a card with full history, risk assessment, and relationships.

### Member
Represents a team member with workload level, specialties, and performance metrics.

### Comment
Represents a comment with sentiment analysis and action item detection.

### Analytics
Stores analytics snapshots including bottlenecks, velocity, and project health.

### Learning
Stores patterns, feedback, and recommendations for continuous improvement.

## Development

### Running Tests
```bash
npm test
npm run evaluate:recommendations
```

### Linting
```bash
npm run lint
```

### Project Structure Guidelines
- **Models**: Define data schemas and business logic methods
- **Services**: Implement core business logic and external integrations
- **Routes**: Handle HTTP requests and responses
- **Utils**: Provide reusable utility functions

## Deployment

### Using Docker

```dockerfile
FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
```

Build and run:
```bash
docker build -t sneup .
docker run -d -p 3000:3000 --env-file .env sneup
```

### Using PM2

```bash
npm install -g pm2
pm2 start src/index.js --name sneup
pm2 save
pm2 startup
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `TRELLO_API_KEY` | Trello API key | Required |
| `TRELLO_API_TOKEN` | Trello API token | Required |
| `MONGODB_URI` | MongoDB connection string | `mongodb://localhost:27017/sneup` |
| `PORT` | Server port | `3000` |
| `NODE_ENV` | Environment | `development` |
| `WEBHOOK_CALLBACK_URL` | Webhook URL | Optional |
| `FULL_SYNC_CRON` | Full sync schedule | `0 1 * * *` |
| `INCREMENTAL_SYNC_CRON` | Incremental sync schedule | `*/15 * * * *` |
| `ANALYTICS_CRON` | Analytics schedule | `0 * * * *` |
| `LOG_LEVEL` | Logging level | `info` |

## Troubleshooting

### MongoDB Connection Issues
- Ensure MongoDB is running
- Check `MONGODB_URI` in `.env`
- Verify network connectivity

### Trello API Issues
- Verify API key and token are correct
- Check API rate limits
- Ensure proper permissions on boards

### Webhook Issues
- Verify `WEBHOOK_CALLBACK_URL` is publicly accessible
- Check webhook registration in Trello
- Review webhook logs

## Contributing

Contributions are welcome! Please follow these guidelines:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Credits

Built with these amazing open source projects:

- **trello.js** by MrRefactoring
- **natural** by NaturalNode
- **node-schedule** by node-schedule team
- **mongoose** by Automattic
- **express** by Express team
- **winston** by Winston team

## Support

For issues, questions, or feature requests, please open an issue on GitHub.

## Roadmap

- [ ] Dashboard UI with React
- [x] Email notifications
- [x] Policy-controlled daily reconciliation digests
- [x] Slack, Teams, and generic reconciliation-alert webhooks
- [ ] Advanced machine learning for predictions
- [ ] Multi-language support
- [ ] Mobile app

---

**Sneup** - Making project management autonomous and intelligent.

## Connector Sync Safety

Connector work-signal ingestion is read-only. Trello-linked accounts fetch accessible boards and cards through the Trello API; Jira-linked accounts discover their authorized site and query issues through the Atlassian Cloud API; Asana-linked accounts select an authorized workspace and query its project tasks; Slack-linked accounts query accessible channel history; GitHub-linked accounts fetch accessible repositories plus issues and pull requests through the GitHub API; Google Workspace-linked accounts request only bounded Calendar scheduling metadata and Drive metadata, excluding event descriptions, attendees, locations, conferencing, and attachments before signal storage; Microsoft 365-linked accounts read Calendar summaries, To Do task metadata, and signed-in-user OneDrive root-item metadata through Graph; Linear-linked accounts query bounded issue pages with team, project, cycle, workflow, assignee, and label context; Notion-linked accounts query only pages and data sources explicitly shared with the connection, without fetching page blocks or comments. Sneup never writes to these providers from this sync path. Linked credentials stay encrypted at rest and are decrypted only in-process for a non-redirecting outbound provider call.

## Reconciliation Alert Delivery

Workspace managers can configure Slack, Teams, generic HTTPS webhook, or Resend email policies from the Approvals ledger. Destinations are encrypted with `CONNECTOR_ENCRYPTION_KEY`, excluded from API responses and audit payloads, and only send after the policy is explicitly activated. Email requires `RESEND_API_KEY` and `SNEUP_NOTIFICATION_EMAIL_FROM`, accepts exactly one plain recipient address, and sends only through Resend's fixed API endpoint. Sneup accepts webhook destinations only at public HTTPS URLs without credentials or custom ports, atomically claims each queued or deferred delivery before any external request, rejects redirects, and deduplicates each reconciliation evidence gap for a policy per UTC day. A concurrent worker observes the existing sending claim instead of issuing a duplicate notification; unresolved sending claims remain in the ledger for operator evidence rather than automatic retry.

An active policy may instead group warning reconciliation gaps into one bounded daily digest at a chosen UTC hour. Critical evidence is never put into a digest. Each digest retains the included delivery IDs, preserves credential-free HTTPS source evidence, and marks those source deliveries as digested only after the external destination accepts the bundle. Webhook and email payloads contain only validated source links. The scheduled `notifications.reconciliation_alerts` job surfaces immediate, deferred, and digest delivery failures in Job Health.

Provider syncs are deliberately bounded so one account cannot monopolize memory or provider quota. Configure `SNEUP_TRELLO_MAX_BOARDS`, `SNEUP_TRELLO_MAX_CARDS_PER_BOARD`, and `SNEUP_TRELLO_MAX_TOTAL_CARDS` for Trello workspaces, `SNEUP_JIRA_MAX_ISSUES` and `SNEUP_JIRA_PAGE_SIZE` for Jira workspaces, `SNEUP_ASANA_MAX_PROJECTS`, `SNEUP_ASANA_MAX_TASKS_PER_PROJECT`, and `SNEUP_ASANA_MAX_TOTAL_TASKS` for Asana workspaces, `SNEUP_SLACK_MAX_CHANNELS`, `SNEUP_SLACK_MAX_MESSAGES_PER_CHANNEL`, and `SNEUP_SLACK_MAX_TOTAL_MESSAGES` for Slack workspaces, `SNEUP_GITHUB_MAX_REPOSITORIES`, `SNEUP_GITHUB_MAX_ITEMS_PER_REPOSITORY`, and `SNEUP_GITHUB_MAX_TOTAL_ITEMS` for GitHub workspaces, `SNEUP_MICROSOFT_MAX_EVENTS`, `SNEUP_MICROSOFT_MAX_TASK_LISTS`, `SNEUP_MICROSOFT_MAX_TASKS_PER_LIST`, `SNEUP_MICROSOFT_MAX_TOTAL_TASKS`, and `SNEUP_MICROSOFT_MAX_FILES` for Microsoft 365 workspaces, `SNEUP_LINEAR_MAX_ISSUES` plus `SNEUP_LINEAR_PAGE_SIZE` for Linear workspaces, and `SNEUP_NOTION_MAX_RESULTS` plus `SNEUP_NOTION_PAGE_SIZE` for Notion connections. If a run reaches a configured cap, Sneup fails the sync visibly rather than silently advancing the cursor and dropping work. Jira multi-site accounts and Asana multi-workspace accounts must explicitly select a source before syncing, so work from an unintended workspace cannot enter Sneup.
