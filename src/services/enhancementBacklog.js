const PRIORITY_ORDER = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3
};

const connectorCoverageEvidence = () => {
  const connectorRegistry = require('./connectorRegistry');
  const workSignalAdapterService = require('./workSignalAdapterService');
  const catalogCount = connectorRegistry.getConnectors().length;
  const adapterCount = workSignalAdapterService.listAdapters()
    .filter(adapter => adapter.capabilities?.credentialBackedSync)
    .length;
  return `Sneup currently has ${adapterCount} read-only credential-backed adapters across ${catalogCount} catalog tools in work management, delivery, communication, resourcing, incident response, CRM, and automation.`;
};

const enhancements = [
  {
    id: 'ENH-001',
    priority: 'P0',
    area: 'connectors',
    title: 'Build provider sync adapters from linked accounts',
    evidence: 'Connector accounts can be linked and stored, normalized WorkSignal records exist, and `/api/work-signals/contracts` exposes adapter contracts. Sneup currently has 111 read-only credential-backed adapters across work management, delivery, communication, resourcing, incident response, CRM, and automation. Each live client decrypts credentials only in process, enforces provider-specific request and item limits with cursor lookback where metadata permits it, performs no provider content writes, and records scheduled sync retry and pacing evidence in Job Health. Scheduled passes use a bounded two-workspace pool by default (maximum four when explicitly configured), while one process-wide provider queue serializes the full pacing and retry cycle for each provider across workspaces. Procore adds an OAuth-only construction-project connection that validates one selected company before capped active-project metadata sync, excluding budgets, contracts, RFIs, submittals, drawings, people, addresses, descriptions, attachments, URLs, and writes. Kantata OX uses an administrator-registered OAuth application to read bounded workspace project metadata from a fixed endpoint, redacting email addresses and URLs in titles while excluding stories, people, schedules, resources, budgets, financials, attachments, comments, custom fields, provider URLs, and writes. LiquidPlanner New uses an administrator-created API token and an explicit numeric workspace ID to read bounded active-project metadata with documented continuation-token pagination, retaining only redacted names, opaque IDs, lifecycle state, and dates. Productive uses a personal API token and an explicit numeric organization ID to read bounded JSON:API project metadata, retaining only redacted names, opaque IDs, archive state, and timestamps. The Generic REST API and n8n adapters reject private-network targets, redirects, oversized responses, raw payload retention, and pagination guessing; Everhour retains only bounded recent time-entry utilization metadata, never descriptions, notes, budgets, expenses, invoices, rates, or profile data.',
    impact: 'Turns the connector marketplace from account linking into cross-tool project ingestion.',
    effort: 'XL',
    status: 'in-progress',
    nextStep: 'Collect production evidence for the selected-company Procore connection and prioritize the next catalog-only provider only when its bounded read-only API contract can be verified.',
    acceptanceCriteria: [
      'Each adapter exposes list, fetchDelta, normalize, and applyAction methods.',
      'A scheduled job syncs connected accounts with retries and per-provider rate limits.',
      'Mission control can show external work signals with source attribution.'
    ]
  },
  {
    id: 'ENH-002',
    priority: 'P0',
    area: 'autonomy',
    title: 'Add a human approval queue for autonomous actions',
    evidence: 'Autopilot commands are queued into the durable recommendation and decision queue with approve, reject, change, snooze, delegate, and action-specific payload-review paths. Reviewers cannot alter the action type, Trello target, provider routing, or execution flags; every saved revision returns to pending for a fresh approval, and move/reassign targets are verified against the current board/workspace. Workspace managers can configure bounded per-risk decision ownership and escalation windows for internal queues. High and critical items remain Robert-owned, overdue VA and team items are atomically escalated with audit evidence, and neither routing nor escalation prepares or performs a provider write.',
    impact: 'Allows Sneup to become more autonomous while preserving human control over risky project changes.',
    effort: 'L',
    status: 'done',
    nextStep: 'Collect live operator evidence before adjusting per-risk ownership or escalation windows.',
    acceptanceCriteria: [
      'Every automatable command can be approved, rejected, snoozed, or delegated.',
      'Approvals are auditable with actor, timestamp, target, and source evidence.',
      'Execution is blocked unless approval policy allows it.'
    ]
  },
  {
    id: 'ENH-003',
    priority: 'P0',
    area: 'security',
    title: 'Add real users, workspaces, RBAC, and audit logs',
    evidence: 'The API resolves request identity and workspace context, supports hashed database API tokens and hashed per-user session tokens, Workspace/User/ApiToken/SessionToken models exist, consequential write endpoints require explicit role permissions, audit-bearing mutating routes discard supplied actor aliases and derive attribution only from the authenticated request identity, and workspace identity administration is restricted to the authenticated workspace unless a local or explicitly approved cross-workspace context is present. Workspace/user/session management APIs exist, and the dashboard lets an administrator inspect issued sessions, create/revoke time-bound invitations, retry failed email invitations, and explicitly revoke active sessions with immediate server refresh. A retry revokes the original link atomically, issues a fresh one-time token, retries delivery, and keeps both records in the audit ledger. Terminal invitation records now retain lifecycle evidence only: a workspace-scoped, bounded scheduled job redacts invitee personal data, token material, and delivery failure text after the configured retention period, with aggregate-only audit evidence. Workspace migration preflight reports only aggregate duplicate-key counts and blocks all backfill/index changes until future PolicyRule and JobControl workspace-unique keys are clean; a connected migration conflict fails closed instead of starting demo mode. Job runs and operator pause controls are workspace-scoped, with the legacy global job-control uniqueness index migrated before a shared deployment creates the composite control index. Identity administrators can explicitly send invitations through Resend or create manual one-time links; production invite links require a clean non-local HTTPS origin and delivery blocks redirects. Multi-workspace identity operations are documented, and boards/cards/connector accounts plus core operations-ledger, analytics, chat, team, list/member/comment, intervention, learning, performance, and job collections are workspace-scoped.',
    impact: 'Required before Sneup can safely run as a shared or internet-facing project-management control plane.',
    effort: 'XL',
    status: 'in-progress',
    nextStep: 'Capture the bounded migration preflight and invitation-retention job evidence from a live workspace before exposing Sneup remotely.',
    acceptanceCriteria: [
      'Every API request resolves a user or service identity.',
      'Connector accounts and project data are workspace-scoped.',
      'Sensitive actions emit immutable audit events.'
    ]
  },
  {
    id: 'ENH-004',
    priority: 'P1',
    area: 'trust',
    title: 'Attach evidence and source citations to every recommendation',
    evidence: 'Recommendations preserve sourceEvidence, `/api/recommendations/:recommendationId/evidence` returns source refs plus decisions, approvals, Trello attempts, audit events, follow-ups, worker responses, and related findings, mission-control command/focus/risk/chat payloads carry sourceEvidence, and card-specific completed, blocked, and needs-help chat updates become worker-response evidence only when they match one already-executed communication intervention for the same workspace, worker, and card. Trello source activity timestamps remain distinct from Sneup sync times, persisted card dwell time plus list averages detect genuine stale and stuck work, and card-member sync atomically reconciles each worker workload index when ownership changes or a card closes. Explicit client/vendor waits remain distinct external-follow-up findings rather than being double-counted as internal blockers or Robert decisions; genuine blocker labels and legal, contract, payment, or other decision signals retain their stricter routing. Due follow-ups expose an operator response form that records a classified observed response against that exact executed intervention, derives its workspace/card/member/recommendation links server-side, and never sends a provider message. Notification deliveries retain only validated HTTPS source links, deduplicate their compact preview, and expose the complete local evidence set in a read-only drilldown. The dashboard renders validated HTTPS source links, response-text-free worker accountability, and minimum-evidence outcome verification wherever an upstream card or provider object exposes one.',
    impact: 'Makes Sneup defensible: humans can inspect why a recommendation exists before trusting it.',
    effort: 'M',
    status: 'done',
    nextStep: 'Collect live operator evidence on source coverage and add additional providers only where gaps are confirmed.',
    acceptanceCriteria: [
      'Each recommendation links to source cards, comments, commits, messages, documents, or analytics snapshots.',
      'The dashboard shows source count and newest evidence timestamp.',
      'API consumers can fetch the evidence bundle for a recommendation.'
    ]
  },
  {
    id: 'ENH-005',
    priority: 'P1',
    area: 'forecasting',
    title: 'Upgrade forecasting with capacity calendars and confidence ranges',
    evidence: 'Sneup now stores workspace-scoped capacity profiles with weekly hours, allocation, focus time, planned time off, skills, and explicit provider IDs. Analysis-only portfolio and board forecasts use those profiles plus historical effort, ownership, overdue work, and risk to return P50/P80 ranges, confidence, assumptions, and delivery risks. Capacity managers can also explore a bounded one-to-ten-person temporary scenario without changing live capacity profiles, provider data, work items, or decisions; Sneup records only the analysis event and a count of changed members in the audit ledger. Bounded Harvest, Everhour, Toggl Track, and Clockify time-entry metadata, mapped Float allocations or approved Resource Guru bookings, and mapped Google Workspace or Microsoft 365 organizer metadata calibrate confidence, expose matched weekly evidence in the Capacity view, and flag modeled-capacity mismatches without changing provider data. Toggl and Clockify evidence requires an explicit opaque user-ID mapping and never retains a provider profile. Human-confirmed Float or Resource Guru project IDs now map to one exact board, are audited, reject cross-board duplication, and expose board-scoped scheduling evidence without reducing capacity. Calendar evidence ignores event text, attendees, locations, all-day events, cancelled events, overlong events, and overlapping-time double counting.',
    impact: 'Improves delivery predictions and prevents false certainty in project dates.',
    effort: 'L',
    status: 'in-progress',
    nextStep: 'Tune capacity and meeting-load mismatch thresholds from reviewed production evidence before considering any calibrated, explicitly approved capacity-reduction model.',
    acceptanceCriteria: [
      'Forecasts return P50/P80 date ranges instead of single dates.',
      'Forecasts explain capacity assumptions and known blockers.',
      'Predictions degrade gracefully when evidence is incomplete.'
    ]
  },
  {
    id: 'ENH-006',
    priority: 'P1',
    area: 'desktop',
    title: 'Add first-run setup and signed desktop release polish',
    evidence: 'The Windows installer works and first run now persists a non-secret demo/live preference in Electron user data, then relaunches before Sneup initializes so a live selection attempts the database-backed runtime. A branded icon, publisher certificate, and update channel still require release infrastructure.',
    impact: 'Reduces installation friction and improves trust for Windows 11 users.',
    effort: 'M',
    status: 'in-progress',
    nextStep: 'Configure installer icon assets, publisher signing, and update feed credentials in the release environment, then validate the installed first-run restart path.',
    acceptanceCriteria: [
      'First run explains demo mode versus live mode.',
      'Installer shows a branded icon and signed publisher when a certificate is configured.',
      'The app can check for updates without blocking startup.'
    ]
  },
  {
    id: 'ENH-007',
    priority: 'P1',
    area: 'operations',
    title: 'Add job observability and controls',
    evidence: 'JobRun and JobControl models now track scheduled/manual/skipped runs, stale/failed/paused health, dashboard Job Health controls, and allowlisted pause, resume, and manual trigger endpoints for safe background jobs.',
    impact: 'Makes Sneup operable for real teams and reduces blind spots when sync or analytics jobs fail.',
    effort: 'M',
    status: 'done',
    nextStep: 'Add retry policies and per-job failure runbooks once provider-specific sync adapters are live.',
    acceptanceCriteria: [
      'Each job run records start, finish, duration, status, and error summary.',
      'Operators can pause, resume, and manually trigger safe jobs.',
      'Mission control shows stale data warnings when jobs fail.'
    ]
  },
  {
    id: 'ENH-008',
    priority: 'P2',
    area: 'dashboard',
    title: 'Move dashboard CSS and JavaScript into external assets',
    evidence: 'Dashboard CSS and JavaScript now live in external static assets and Helmet no longer allows inline scripts or styles. The HTML stays revalidatable while the JavaScript, CSS, and icon URLs are content-fingerprinted at startup and served with immutable one-year caching, so a changed asset gets a fresh URL without asking operators to clear cache.',
    impact: 'Improves browser hardening and makes the UI easier to test and maintain.',
    effort: 'M',
    status: 'done',
    nextStep: 'Keep cache-header regression coverage whenever dashboard assets or static delivery change.',
    acceptanceCriteria: [
      'CSP no longer needs `unsafe-inline` for scripts.',
      'Dashboard behavior is unchanged in browser smoke tests.',
      'Static assets are cacheable with explicit versioning.'
    ]
  },
  {
    id: 'ENH-009',
    priority: 'P2',
    area: 'ai-quality',
    title: 'Add an evaluation harness for AI recommendations',
    evidence: 'The executable `npm run evaluate:recommendations` suite now covers overdue blockers, overloaded owners, client commitments, VA-ready work, and ambiguous requests. It requires evidence, concrete Yes/No framing, policy-aligned risk and owners, exact payloads for provider writes, and rejects hidden autonomous execution flags. The Enhancements view exposes the current suite score.',
    impact: 'Prevents regressions as Sneup becomes more autonomous.',
    effort: 'M',
    status: 'done',
    nextStep: 'Add approved, de-identified production recommendations to the scenario corpus after human review.',
    acceptanceCriteria: [
      'Evaluation scenarios cover blockers, overload, overdue work, stakeholder updates, and ambiguous requests.',
      'Every model/prompt change runs the evaluation suite.',
      'Unsafe autonomous-action suggestions fail the suite.'
    ]
  },
  {
    id: 'ENH-010',
    priority: 'P2',
    area: 'notifications',
    title: 'Add multi-channel notification delivery',
    evidence: 'Workspace-scoped Slack, Teams, generic webhook, and Resend email policies store destinations encrypted, require explicit activation, limit delivery to reconciliation evidence gaps, ledger every delivery, prevent duplicate alert delivery within a day, defer warning alerts through auditable bounded UTC quiet hours while critical evidence remains immediate, and can group warning evidence into a bounded daily digest with validated source links. Policies can independently schedule a capped read-only daily operations brief or weekly status report, each deduplicated per policy/occurrence with observable scheduler health. Every queued or deferred external delivery is atomically claimed before sending; a concurrent worker reports the existing claim instead of issuing a duplicate request, and stranded sending claims remain visible for operator evidence rather than being blindly retried. Digest source deliveries are only marked digested after the external destination accepts the bundle.',
    impact: 'Moves Sneup from dashboard-only visibility into the places project managers and teams already work.',
    effort: 'L',
    status: 'done',
    nextStep: 'Add bounded delivery-age alerting only after collecting representative production evidence for sending claims.',
    acceptanceCriteria: [
      'Users can choose channel, severity threshold, digest cadence, and quiet hours.',
      'Notifications link back to source evidence and the approval queue.',
      'Delivery failures are visible in job observability.'
    ]
  },
  {
    id: 'ENH-011',
    priority: 'P2',
    area: 'data-model',
    title: 'Introduce a normalized cross-tool work graph',
    evidence: 'Work signals now project into normalized WorkItem, WorkActor, WorkContainer, WorkComment, WorkDependency, and WorkEvent graph models, provider-native dependencies are extracted from Jira, Asana, GitHub, Trello, and generic dependency fields, unresolved cross-provider dependency edges persist even before the target work item syncs, old dependency edges are marked stale when provider syncs stop observing them, stale edges remain visible but stop boosting active blocker scoring, stale graph edges can be confirmed, refreshed, or dismissed from Sneup without provider writes, connector sync defers stale-edge processing until each provider batch finishes, and persistent JobRun metadata records bounded per-provider stale-edge counts and failures for Job Health. `/api/work-signals/graph` summarizes graph dependency counts, freshness, review outcomes, and connector-level stale-edge quality for the dashboard, graph items can produce dependency-aware Robert/VA/team decision candidates that rank into mission control as review-only commands/risks, queue approval-gated draft recommendations, appear in the read-only daily operations brief with source/provider evidence, can be inspected in Signals through graph item drilldowns showing source item state, dependency edges, freshness, review state, recent graph events, and queued recommendation history, and now enrich board/card operating ledgers with Trello-linked graph context, direct source links, dependency freshness, and provider/type/direction filters.',
    impact: 'Allows Sneup to reason across projects without forcing every provider into Trello-specific schemas.',
    effort: 'XL',
    status: 'in-progress',
    nextStep: 'Use durable stale-edge telemetry to tune connector-specific freshness thresholds after reviewing the bounded Job Health regression watch in a live workspace.',
    acceptanceCriteria: [
      'Trello data can be projected into the normalized graph without losing Trello-specific fields.',
      'At least three non-Trello providers can sync into the graph.',
      'Mission control can read from the graph rather than Trello-only collections.',
      'Provider-native dependency extraction is implemented for supported tools.',
      'Queued graph decisions appear in the daily operations brief.'
    ]
  },
  {
    id: 'ENH-012',
    priority: 'P3',
    area: 'reporting',
    title: 'Generate stakeholder-ready exports',
    evidence: 'The command center now exports weekly status, standup, risk register, and client update reports in Markdown and PDF from the same live or demo operating context, with owners, dates, risks, decisions, and source evidence.',
    impact: 'Saves project managers recurring reporting time and creates visible value quickly.',
    effort: 'M',
    status: 'done',
    nextStep: 'Add scheduled delivery policies after notification channels are configured.',
    acceptanceCriteria: [
      'Reports can export to Markdown and PDF.',
      'Each report includes risks, decisions needed, owners, dates, and source evidence.',
      'Reports can be generated from live data or demo data.'
    ]
  },
  {
    id: 'ENH-013',
    priority: 'P2',
    area: 'connectors',
    title: 'Finalize the PM connector catalog baseline',
    evidence: 'Connector registry coverage now includes Trello, Jira Software/Service Management, Asana, monday.com, ClickUp, Slack, GitHub, Google, Microsoft, and a broad set of planning, comms, docs, files, finance, incident, and stakeholder tools.',
    impact: 'Gives PM teams a practical starting point for mixed-tool adoption and reduces onboarding friction.',
    effort: 'M',
    status: 'done',
    nextStep: 'Add provider-specific adapter implementations and production-ready sync workers for each newly added catalog item.',
    acceptanceCriteria: [
      'Connector catalog metadata remains valid and validated across OAuth, API-key, manual, and webhook auth types.',
      'Provider sync jobs can be enabled in a controlled rollout without schema churn.',
      'Connector health reports include onboarding state and last sync result.'
    ]
  },
  {
    id: 'ENH-014',
    priority: 'P2',
    area: 'resource',
    title: 'Bound in-memory API rate limiting state',
    evidence: 'The API rate bucket map had a fixed cleanup cutoff but no bound on total bucket cardinality under sustained high-cardinality traffic.',
    impact: 'Prevents avoidable memory pressure while preserving request rate enforcement semantics.',
    effort: 'S',
    status: 'done',
    nextStep: 'Expose metrics for rate-bucket counts and tune `SNEUP_RATE_LIMIT_MAX_BUCKETS`/`SNEUP_RATE_LIMIT_PRUNE_SLACK` per deployment profile.',
    acceptanceCriteria: [
      'Rate limiter memory growth is capped even under attack-like path diversity.',
      'Rate limiting behavior stays stable while stale bucket cleanup and LRU-style pruning run.',
      'Operational docs explain tuning values and their safety envelope.'
    ]
  },
  {
    id: 'ENH-015',
    priority: 'P1',
    area: 'connectors',
    title: 'Require explicit scope review before linking provider accounts',
    evidence: 'Every connector exposes a safety profile, signals are read-only, provider writes are blocked, and a user must acknowledge requested provider scopes before Sneup opens OAuth or accepts provider credentials. Non-secret consent evidence is retained on the linked account and workspace audit ledger. Google Calendar, Zoom, Miro, and Google Chat use documented read-only scopes.',
    impact: 'Makes account linking legible and prevents a convenience connection flow from silently requesting broad provider permissions.',
    effort: 'M',
    status: 'done',
    nextStep: 'Credential rotation keeps token-based connector accounts in place, renews scope evidence, records secret-free audit history, and exposes a bounded read-only rotation deadline. Collect operator evidence before changing rotation intervals or consent retention.',
    acceptanceCriteria: [
      'Connector catalog displays requested scopes and safety posture.',
      'OAuth and credential flows require an explicit scope-review acknowledgement.',
      'Connector ingestion does not perform provider writes.'
    ]
  },
  {
    id: 'ENH-016',
    priority: 'P0',
    area: 'autonomy',
    title: 'Make approved Trello action execution single-claim and fail-safe',
    evidence: 'Approved Trello writes atomically claim the recommendation from approved to executing, reject forged no-approval write records, remain claimed if post-write ledger finalization fails, and expose an operator-only reconciliation path that records observed provider evidence without issuing another Trello request.',
    impact: 'Prevents duplicate comments, moves, assignments, labels, and other consequential provider writes under concurrent requests or partial internal failures.',
    effort: 'M',
    status: 'done',
    nextStep: 'Add digest and quiet-hour controls to the delivered reconciliation alert policies.',
    acceptanceCriteria: [
      'Only one executor can claim an approved provider write.',
      'Provider writes cannot be executed from a record that disables required approval.',
      'Post-write internal failures cannot relabel a successful provider action as failed or retry it automatically.',
      'An operator can reconcile a claimed action with evidence without another provider write.'
    ]
  },
  {
    id: 'ENH-017',
    priority: 'P1',
    area: 'autonomy',
    title: 'Add workspace-scoped Trello action safety controls',
    evidence: 'Workspace managers can inspect and configure the effective safety posture for every supported Trello write action. Rules may pause an action, raise its risk, or route it to a stricter owner, but cannot disable approval. Optional pause review times become visibly overdue without ever re-enabling a provider write, the workspace safety history can be filtered by policy and bounded time window, and the operations ledger rechecks policy before its atomic execution claim.',
    impact: 'Lets humans immediately stop or tighten specific autonomous action types without bypassing the approval ledger or disabling the broader system.',
    effort: 'M',
    status: 'done',
    nextStep: 'Add bounded retention controls for policy evidence after collecting live operator requirements.',
    acceptanceCriteria: [
      'Each workspace has an independent action policy for every supported Trello write type.',
      'A policy cannot lower the baseline risk, weaken the baseline decision owner, or disable provider-write approval.',
      'A paused action type is rejected by the executor before a provider request can start.',
      'Relaxing an existing policy requires an explicit confirmation and produces an audit record.'
    ]
  },
  {
    id: 'ENH-018',
    priority: 'P1',
    area: 'autonomy',
    title: 'Suppress repeated scheduled intervention candidates',
    evidence: 'Scheduled board, follow-up, and escalation scans reuse an equivalent pending, approval-gated, executing, or recently executed intervention using one workspace-scoped policy lookup per scan. Each scheduled signal can retain the 24-hour baseline or extend it to 168 hours; manual requests remain separate, and cooldowns never prepare or perform a provider write.',
    impact: 'Prevents recurring signals from filling Robert\'s approval queue or repeatedly proposing the same worker communication.',
    effort: 'S',
    status: 'done',
    nextStep: 'Add filterable cooldown-policy history and retention controls after collecting live operator evidence.',
    acceptanceCriteria: [
      'Equivalent scheduled card, follow-up, escalation, and team signals reuse their active or recent intervention with one policy read per scan.',
      'Each scheduled signal can only retain or extend the 24-hour cooldown baseline, up to 168 hours.',
      'The suppression window never executes a provider write or relaxes approval requirements.',
      'Manual requests remain distinct from scheduled signal suppression.'
    ]
  },
  {
    id: 'ENH-019',
    priority: 'P1',
    area: 'operations',
    title: 'Make scheduled follow-up transitions durable and auditable',
    evidence: 'The scheduled worker atomically moves overdue workspace-scoped follow-up plans from scheduled to due and writes an audit event. Workspace timing policies set the internal no-response follow-up baseline from 24 to 168 hours and escalation baseline from 48 to 168 hours, while requiring escalation to remain at or after follow-up. Scheduled scans load that policy once per pass, and approved action follow-up plans inherit it. Candidate paths remain approval-gated and never contact a provider.',
    impact: 'Gives operators a durable lifecycle trail while preventing one workspace from processing another workspace\'s queued work or a transient failure from silently suppressing a retry.',
    effort: 'S',
    status: 'done',
    nextStep: 'Add filterable timing-policy history and retention controls after collecting live operator evidence.',
    acceptanceCriteria: [
      'Overdue scheduled follow-up plans transition to due once and include audit evidence.',
      'Scheduled intervention follow-up and escalation scans stay within the requested workspace.',
      'Workspace timing can retain or extend the follow-up and escalation baselines without placing escalation before follow-up.',
      'Scheduled scans load workspace timing once per pass and approved actions schedule follow-ups from the same policy.',
      'A failed candidate path leaves the original intervention eligible for a later safe retry.',
      'Overdue internal VA and team decisions move to Robert exactly once with audit evidence and no provider write.'
    ]
  },
  {
    id: 'ENH-020',
    priority: 'P2',
    area: 'resource',
    title: 'Load command-center data only when its view is opened',
    evidence: 'The initial overview no longer fans out to every hidden dashboard view. Sneup loads the overview, operations brief, and job health immediately, then loads each ledger, connector, signal, forecast, report, and workspace surface on demand. Mission control reads every open board and card using exact field projections and plain objects, preserving whole-workspace coverage while excluding descriptions, comments, attachments, histories, checklist text, label metadata, and document wrappers that its summary never uses. It groups analytics in MongoDB to retain only the latest snapshot per board instead of hydrating every historical record. Full and incremental Trello syncs use a bounded two-board pool by default, capped at four, preserving per-board failure isolation while exposing board count and worker capacity in Job Health. The approval ledger also collapses 12 separately authenticated workspace reads into one audit-scoped aggregate request while preserving bounded section limits and section-level availability evidence. That aggregate opts into Mongoose plain-object reads for its serialized evidence, avoiding document hydration while leaving existing detail and mutation paths unchanged. Repeated navigation or refresh clicks share an in-progress view load, and a newer connector catalog request cancels the superseded request before it can consume more work or render stale results. Jobs without any recorded run now render as awaiting their first run and do not inflate stale-alert counts, so a new workspace or local setup does not create false operational alarms. Explicit refreshes and workspace changes invalidate the cache so operators always receive fresh scoped data.',
    impact: 'Cuts avoidable initial API, authentication, transport, and whole-workspace dashboard-read memory work while keeping every board and card represented in the command view.',
    effort: 'S',
    status: 'done',
    nextStep: 'Add bounded threshold alerts only after collecting representative live workspace baselines.',
    acceptanceCriteria: [
      'Initial overview loading avoids requests for hidden feature views.',
      'Opening a navigation view loads its data exactly when needed.',
      'Refresh and workspace changes invalidate cached view data.',
      'The approval ledger loads its bounded workspace sections through one audit-scoped request without hiding a partial failure.'
    ]
  },
  {
    id: 'ENH-021',
    priority: 'P0',
    area: 'security',
    title: 'Reject predictable token-hashing secrets in live production',
    evidence: 'Live production startup now requires separate, non-placeholder 32+ character peppers for database API tokens, desktop sessions, and workspace invitations. Each token model also rejects an absent or weak production pepper at hash time. The `npm run check:release-security` gate verifies all persisted-token and connector secrets are present, strong, and distinct by purpose without printing their values, while loopback-only demo mode remains credential-free.',
    impact: 'Prevents persisted access and invitation tokens from depending on shared or predictable development fallback values.',
    effort: 'S',
    status: 'done',
    nextStep: 'Add the release-security command to the production deployment workflow once release infrastructure is configured.',
    acceptanceCriteria: [
      'A non-demo production runtime refuses missing, weak, or placeholder token peppers.',
      'API token, session token, invitation token, connector encryption, and OAuth state each use an independent configured secret.',
      'Demo mode remains usable without production secrets.'
    ]
  },
  {
    id: 'ENH-022',
    priority: 'P0',
    area: 'security',
    title: 'Sanitize runtime logs before they leave the application boundary',
    evidence: 'The shared Winston boundary now redacts secrets, authorization headers, cookies, credential-bearing query parameters, request payloads, retained work content, and raw Error request configuration. Worker chat processing records only opaque IDs and channel metadata, never a message excerpt or username.',
    impact: 'Prevents debug and failure telemetry from becoming a second copy of provider credentials or private worker/project content.',
    effort: 'S',
    status: 'done',
    nextStep: 'Review production log retention and transport access controls before introducing external log aggregation.',
    acceptanceCriteria: [
      'Provider credentials and request configuration are redacted before Winston serializes them.',
      'Chat message content is not written to application logs.',
      'Diagnostic error name, status, and code remain available without raw request content.'
    ]
  },
  {
    id: 'ENH-023',
    priority: 'P1',
    area: 'operations',
    title: 'Capture matched worker chat updates in the operating ledger',
    evidence: 'Completed, blocked, and needs-help chat updates now become bounded WorkerResponse records only when they match an unanswered executed comment, follow-up, or escalation for the same workspace, worker, and card. The linked recommendation, intervention, follow-up outcome, and audit trail update without any provider write; generic or ambiguous chat remains unlinked. A signed Generic Webhook inbound bridge now accepts only an administrator-audited source-worker/source-card mapping to a workspace member already assigned to the mapped card, and records matched or unmatched intake without retaining response text in webhook evidence.',
    impact: 'Closes the accountability loop automatically while preventing generic worker conversation from silently resolving unrelated follow-ups.',
    effort: 'S',
    status: 'done',
    nextStep: 'Collect reviewed production evidence for inbound source-to-worker/card mappings before adding provider-native event parsers.',
    acceptanceCriteria: [
      'A card-specific chat update can update the matching executed intervention and follow-up evidence.',
      'Unmatched or context-free chat does not close a ledger item.',
      'Chat ingestion never sends a provider write.'
    ]
  },
  {
    id: 'ENH-024',
    priority: 'P1',
    area: 'resource',
    title: 'Batch board performance snapshots without increasing worker load',
    evidence: 'Daily, weekly, and monthly board performance runs now read the board member set once, then create one bounded board-scoped snapshot of assigned-card, intervention, and comment evidence for all members. The tracker reuses that snapshot for every member record, excludes other-board work from the board score, skips data reads for boards without members, and recalculates board ranks once after the snapshot is persisted. Scheduled board processing remains serial, so the read reduction does not increase database concurrency.',
    impact: 'Reduces repeated database reads and background runtime for multi-member boards while keeping the same performance records, workload metrics, and operator-facing features.',
    effort: 'S',
    status: 'done',
    nextStep: 'Collect Job Health duration and database-read telemetry from representative live boards before changing the scheduled board-processing concurrency.',
    acceptanceCriteria: [
      'A board run reads member, card, intervention, and comment evidence once per board rather than once per member.',
      'Board metrics exclude cards and interventions from another board.',
      'Boards without members avoid unnecessary collection reads.',
      'The optimization does not increase scheduled board worker concurrency.'
    ]
  }
];

const sortEnhancements = (items) => [...items].sort((left, right) => {
  const priorityDiff = PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority];
  if (priorityDiff !== 0) return priorityDiff;
  return left.id.localeCompare(right.id);
});

const hydrateEnhancement = (item) => {
  const hydrated = { ...item, acceptanceCriteria: [...item.acceptanceCriteria] };
  if (item.id === 'ENH-001') {
    hydrated.evidence = item.evidence.replace(
      /Sneup currently has \d+ read-only credential-backed adapters across work management, delivery, communication, resourcing, incident response, CRM, and automation\./,
      connectorCoverageEvidence()
    );
  }
  return hydrated;
};

const listEnhancements = (filters = {}) => {
  const filtered = enhancements.map(hydrateEnhancement).filter(item => {
    if (filters.priority && item.priority !== filters.priority) return false;
    if (filters.area && item.area !== filters.area) return false;
    if (filters.status && item.status !== filters.status) return false;
    return true;
  });

  return sortEnhancements(filtered);
};

const getEnhancement = (id) => {
  const enhancement = enhancements.find(item => item.id.toLowerCase() === String(id).toLowerCase());
  return enhancement ? hydrateEnhancement(enhancement) : null;
};

const getSummary = (items = enhancements) => items.reduce((summary, item) => {
  summary.total += 1;
  summary.byPriority[item.priority] = (summary.byPriority[item.priority] || 0) + 1;
  summary.byArea[item.area] = (summary.byArea[item.area] || 0) + 1;
  summary.byStatus[item.status] = (summary.byStatus[item.status] || 0) + 1;
  return summary;
}, {
  total: 0,
  byPriority: {},
  byArea: {},
  byStatus: {}
});

module.exports = {
  getEnhancement,
  getSummary,
  listEnhancements
};
