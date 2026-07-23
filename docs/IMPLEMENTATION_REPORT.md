# Sneup Implementation Report

## Connector Coverage

Sneup now includes an account connector marketplace for project-management tools used by human project managers from 2015 through 2026.

- Total connectors: 112 (107 bounded credential-backed readers; 5 catalog-only legacy, retired, or unavailable entries)
- Categories: 11
- Coverage includes work management, software delivery, communication, calendar/email, docs/knowledge, files/assets, whiteboards/design, time/finance/resourcing, CRM/support/stakeholders, automation/data, and incident/quality/monitoring.
- Major OAuth-ready providers include Jira, Asana, monday.com, ClickUp, Linear, Notion, Microsoft 365, Google Workspace, Google Forms, Mural, Canva, QuickBooks Online, Power BI, Slack, GitHub, GitLab, Zoom, Figma, Miro, Dropbox, Box, SharePoint, Xero, HubSpot, Salesforce, and Intercom. Power BI requests reviewed delegated `Report.Read.All` only and reads a capped report catalog without report contents, dashboards, datasets, workspace membership, descriptions, URLs, embeds, owners, subscriptions, users, or provider writes. Canva uses PKCE with an encrypted verifier in signed state, requests only `design:meta:read`, and reads capped design metadata without design content, pages, thumbnails, temporary links, owners, folders, assets, comments, approvals, or provider writes. QuickBooks Online uses reviewed Accounting API consent, retains only the selected opaque `realmId` returned in the OAuth callback, and reads capped sales-invoice status/date metadata without customers, invoice numbers, values, balances, payment data, descriptions, line items, addresses, URLs, attachments, taxes, or provider writes. Mural requests only `workspaces:read` and `murals:read`, requires selection of one authorized workspace, and reads capped active-mural metadata without mural content, widgets, comments, templates, rooms, people, URLs, sharing details, or provider writes. Google Forms requests only `drive.metadata.readonly` and reads a capped metadata index without form bodies, questions, responses, owners, URLs, sharing details, shared drives, or provider writes. SharePoint requires an explicit review of delegated `Sites.Read.All`, exposes only followed sites for selection, and then reads one bounded root-metadata page without file content, URLs, permissions, pages, lists, people, versions, sharing details, or provider writes. Xero requests only `accounting.invoices.read` plus offline access, requires selection of one authorized organisation, and reads capped sales-invoice status/date metadata without retaining contacts, invoice numbers, values, payment data, descriptions, line items, URLs, or provider writes.
- Token/manual connectors cover Trello, Wrike, Smartsheet, Airtable, Microsoft Project, Planner, Azure DevOps, Bitbucket, Confluence, Coda, Teamwork, Zoho Projects, Shortcut, Todoist, Zapier, Make, Tableau, Sentry, PagerDuty, Opsgenie, Jira Align, and more. Opsgenie is a live API-key connector that requires an explicit US or EU endpoint, confirms the bounded current open-alert count, and reads one matching metadata collection with GET only; it excludes descriptions, aliases, responders, owners, teams, schedules, escalation policies, incidents, integrations, URLs, and provider writes. Basecamp is a live OAuth connector that requires selection of one authorized Basecamp 3 account and reads bounded project/to-do metadata with GET only; it excludes messages, schedules, documents, files, comments, client data, and hill-chart content. Coda is a live personal-access-token connector that requires an explicit document allowlist and reads table metadata only; it deliberately excludes row values, columns, pages, packs, and button actions. Teamwork is a live API-key connector that accepts only one HTTPS `*.teamwork.com` tenant, reads bounded project/task metadata with GET, and excludes private tasks, descriptions, comments, files, time, company, and billing data. Jira Align accepts a user-created tenant API token for one HTTPS `*.jiraalign.com` host, reads capped API v2 portfolio/program metadata with GET only and no resource expansion, and excludes descriptions, people, custom fields, dependencies, work items, planning details, URLs, and provider writes. Catalog-only entries explicitly state why Sneup cannot accept a new account link: Evernote is legacy-only, Pivotal Tracker is retired, Adobe Creative Cloud Libraries is not accepting new integrations, and Height/Projectplace lack a verified bounded read-only contract.

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

- Add a publisher certificate for Windows installer signing.
- Add per-user/team authorization if Sneup becomes multi-user or internet-facing.

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
- NLP imports only the tokenization, sentence splitting, TF-IDF, English AFINN sentiment, and Porter stemming modules used by Sneup. The Windows build excludes Natural's unused language packs, classifiers, WordNet, and unused storage-client dependencies while preserving the existing NLP implementations.

Installer footprint:

- The verified Windows installer is 110.0 MB and its app archive is 65.4 MB. The targeted NLP packaging pass reduced the app archive from 109.6 MB by 40.3% and the installer from 119.2 MB by 7.7%.
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
- `npm test -- --runInBand` passed 575 tests across 62 suites.
- `npm audit --omit=dev` reported 0 vulnerabilities.
- Local HTTP smoke tests passed for health, connector catalog, and mission control.
- Browser smoke test loaded the dashboard, opened connectors, filtered the connector marketplace, and observed no console errors.
- The current resource pass passed `npm run lint`, a production-only `npm audit` with zero findings, and a fresh Windows NSIS build after inspecting its packaged archive.
