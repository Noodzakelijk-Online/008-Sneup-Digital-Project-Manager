# Sneup Implementation Report

## Connector Coverage

Sneup now includes an account connector marketplace for project-management tools used by human project managers from 2015 through 2026.

- Total connectors: 105
- Categories: 11
- Coverage includes work management, software delivery, communication, calendar/email, docs/knowledge, files/assets, whiteboards/design, time/finance/resourcing, CRM/support/stakeholders, automation/data, and incident/quality/monitoring.
- Major OAuth-ready providers include Jira, Asana, monday.com, ClickUp, Linear, Notion, Microsoft 365, Google Workspace, Google Forms, Slack, GitHub, GitLab, Zoom, Figma, Miro, Dropbox, Box, SharePoint, Xero, HubSpot, Salesforce, and Intercom. Google Forms requests only `drive.metadata.readonly` and reads a capped metadata index without form bodies, questions, responses, owners, URLs, sharing details, shared drives, or provider writes. SharePoint requires an explicit review of delegated `Sites.Read.All`, exposes only followed sites for selection, and then reads one bounded root-metadata page without file content, URLs, permissions, pages, lists, people, versions, sharing details, or provider writes. Xero requests only `accounting.invoices.read` plus offline access, requires selection of one authorized organisation, and reads capped sales-invoice status/date metadata without retaining contacts, invoice numbers, values, payment data, descriptions, line items, URLs, or provider writes.
- Token/manual connectors cover Trello, Wrike, Smartsheet, Airtable, Microsoft Project, Planner, Azure DevOps, Bitbucket, Confluence, Coda, Teamwork, Zoho Projects, Shortcut, Pivotal Tracker, Height, Todoist, Zapier, Make, Power BI, Tableau, Sentry, PagerDuty, and more. Basecamp is a live OAuth connector that requires selection of one authorized Basecamp 3 account and reads bounded project/to-do metadata with GET only; it excludes messages, schedules, documents, files, comments, client data, and hill-chart content. Coda is a live personal-access-token connector that requires an explicit document allowlist and reads table metadata only; it deliberately excludes row values, columns, pages, packs, and button actions. Teamwork is a live API-key connector that accepts only one HTTPS `*.teamwork.com` tenant, reads bounded project/task metadata with GET, and excludes private tasks, descriptions, comments, files, time, company, and billing data.

## Security Work

Fixed or mitigated:

- API access gate for non-local API access.
- Rate limiting, stricter CORS, request body limits, and local-only default host.
- Trello webhook HMAC verification.
- ObjectId and numeric query validation.
- Encrypted connector credentials and signed OAuth state.
- OAuth redirect URI host hardening.
- Regex escaping for card-name dependency searches.
- Optional OpenAI startup, with local fallback responses.

Remaining hardening:

- Move inline dashboard CSS/JS into external files and remove `unsafe-inline` from CSP.
- Add a publisher certificate for Windows installer signing.
- Add per-user/team authorization if Sneup becomes multi-user or internet-facing.

- Harden API rate limiting bucket lifecycle so in-memory state is bounded under high-cardinality request flows.

## Resource Usage Work

Reduced avoidable resource use:

- Relationship analysis is now capped by `RELATIONSHIP_ANALYSIS_LIMIT` and runs in targeted card/board modes.
- Mission-control analytics lookup now batches latest analytics by board.
- Mission-control card counting now indexes cards by board/list/member instead of repeatedly scanning the whole list.
- Background workers pause automatically when MongoDB is not connected.
- OpenAI client is not constructed unless `OPENAI_API_KEY` is present.
- Duplicate Mongoose index declarations were removed to reduce startup warnings and index churn.
- The command center loads hidden views on demand and exposes bounded, recent response-time p50/p95 summaries for the known view APIs. The telemetry retains neither request data nor unbounded history.
- API rate limiting has a hard bounded bucket map, expires stale state first, evicts least-recently-used pressure state only when needed, and exposes aggregate capacity metrics without request identifiers.

Installer footprint:

- The Windows installer is about 115 MB because it bundles Electron and the app runtime.
- A smaller future desktop footprint would require a different shell such as Tauri, WebView2-only packaging, or a PWA install path.

## Windows Installer

Added:

- Electron desktop wrapper in `desktop/main.js`.
- Secure preload bridge in `desktop/preload.js`.
- `npm run desktop` for local desktop testing.
- `npm run build:installer` / `npm run dist:win` for Windows NSIS packaging.
- Generated installer: `release/Sneup-Setup-2.0.0.exe`.

The desktop app starts Sneup on `127.0.0.1` and opens the command center in an app window. On first run it starts in demo mode. The workspace choice stores only the non-secret `demo` or `live` startup preference in the Electron user-data directory, then relaunches before Sneup initializes. Live mode attempts the database-backed workspace and retains the existing safe catalog/demo fallback if the database is unavailable. An explicitly set `SNEUP_DEMO_MODE` environment variable takes precedence over the local preference.

## Verification

- Syntax checks passed for changed JavaScript files.
- `npm run lint` passed with the new Node/ES2022 ESLint config.
- `npm test -- --runInBand` passed 6 focused security and connector tests.
- `npm audit --omit=dev` reported 0 vulnerabilities.
- Local HTTP smoke tests passed for health, connector catalog, and mission control.
- Browser smoke test loaded the dashboard, opened connectors, filtered the connector marketplace, and observed no console errors.
