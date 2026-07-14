const PRIORITY_ORDER = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3
};

const enhancements = [
  {
    id: 'ENH-001',
    priority: 'P0',
    area: 'connectors',
    title: 'Build provider sync adapters from linked accounts',
    evidence: 'Connector accounts can be linked and stored, normalized WorkSignal records now exist, and `/api/work-signals/contracts` exposes adapter contracts. Sneup currently has 58 read-only credential-backed adapters: Trello; Jira Software/Service Management; Asana; Slack; GitHub; GitLab; Google Workspace; Microsoft 365; Linear; Notion; monday.com; ClickUp; Azure DevOps; Wrike; Smartsheet; Airtable; Todoist; Shortcut; Bitbucket; Harvest; Coda; Teamwork; Basecamp; Redmine; Microsoft Planner; YouTrack; Taiga; Backlog; Freedcamp; MeisterTask; Aha!; Productboard; Toggl Track; Clockify; Float; Resource Guru; Sentry; Datadog; PagerDuty; Atlassian Statuspage; Zendesk; Freshdesk; Pipedrive; HubSpot; Typeform; Salesforce; Zoom; Miro; Dropbox; Box; Calendly; Microsoft Teams; Google Chat; Figma; Confluence; Rally; and a bounded Generic REST API collection adapter. Each live client decrypts credentials only in process, enforces provider-specific request/item limits and cursor lookback where metadata permits it, performs no provider writes, and records scheduled sync retry/pacing evidence in Job Health. The generic adapter also rejects private-network targets, redirects, oversized responses, raw payload retention, and pagination guessing.',
    impact: 'Turns the connector marketplace from account linking into cross-tool project ingestion.',
    effort: 'XL',
    status: 'in-progress',
    nextStep: 'Add the next credential-backed provider client, preserving bounded read-only sync and provider-specific health evidence.',
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
    evidence: 'Autopilot commands can now be queued into the durable recommendation and decision queue with approve, reject, change, snooze, delegate, and action-specific payload-review paths. Reviewers cannot alter the action type, Trello target, provider routing, or execution flags; every saved revision returns to pending for a fresh approval, and move/reassign targets are verified against the current board/workspace.',
    impact: 'Allows Sneup to become more autonomous while preserving human control over risky project changes.',
    effort: 'L',
    status: 'done',
    nextStep: 'Add policy-driven default snooze durations.',
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
    evidence: 'The API resolves request identity and workspace context, supports hashed database API tokens and hashed per-user session tokens, Workspace/User/ApiToken/SessionToken models exist, consequential write endpoints require explicit role permissions, workspace/user/session management APIs exist, and the dashboard lets an administrator inspect issued sessions, create/revoke time-bound invitations, and explicitly revoke active sessions with immediate server refresh. Identity administrators can explicitly send invitations through Resend or create manual one-time links; production invite links require a clean non-local HTTPS origin and delivery blocks redirects. Multi-workspace identity operations are documented, and boards/cards/connector accounts plus core operations-ledger, analytics, chat, team, list/member/comment, intervention, learning, and performance collections are workspace-scoped.',
    impact: 'Required before Sneup can safely run as a shared or internet-facing project-management control plane.',
    effort: 'XL',
    status: 'in-progress',
    nextStep: 'Add production migration scripts for existing shared deployments and invitation delivery retry controls with ledger evidence.',
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
    evidence: 'Recommendations preserve sourceEvidence, `/api/recommendations/:recommendationId/evidence` returns source refs plus decisions, approvals, Trello attempts, audit events, follow-ups, worker responses, and related findings, mission-control command/focus/risk/chat payloads now carry sourceEvidence, and the dashboard renders validated HTTPS source links, response-text-free worker accountability, and minimum-evidence outcome verification wherever an upstream card or provider object exposes one.',
    impact: 'Makes Sneup defensible: humans can inspect why a recommendation exists before trusting it.',
    effort: 'M',
    status: 'in-progress',
    nextStep: 'Add source drilldowns to future chat and notification surfaces, retaining the same validated provider-link policy.',
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
    evidence: 'Sneup now stores workspace-scoped capacity profiles with weekly hours, allocation, focus time, planned time off, skills, and explicit provider IDs. Analysis-only portfolio and board forecasts use those profiles plus historical effort, ownership, overdue work, and risk to return P50/P80 ranges, confidence, assumptions, and delivery risks. Bounded Harvest time-entry metadata, mapped Float allocations or approved Resource Guru bookings, and mapped Google Workspace or Microsoft 365 organizer metadata calibrate confidence, expose matched weekly evidence in the Capacity view, and flag modeled-capacity mismatches without changing provider data. Calendar evidence ignores event text, attendees, locations, all-day events, cancelled events, overlong events, and overlapping-time double counting.',
    impact: 'Improves delivery predictions and prevents false certainty in project dates.',
    effort: 'L',
    status: 'in-progress',
    nextStep: 'Tune capacity and meeting-load mismatch thresholds from reviewed production evidence, then add provider/project-to-board mappings before treating allocations as remaining capacity.',
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
    evidence: 'Dashboard CSS and JavaScript now live in external static assets and Helmet no longer allows inline scripts or styles.',
    impact: 'Improves browser hardening and makes the UI easier to test and maintain.',
    effort: 'M',
    status: 'done',
    nextStep: 'Add static asset cache/versioning once the dashboard build pipeline exists.',
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
    evidence: 'Workspace-scoped Slack, Teams, and generic webhook policies now store destinations encrypted, require explicit activation, limit delivery to reconciliation evidence gaps, ledger every delivery, prevent duplicate alert delivery within a day, defer warning alerts through auditable bounded UTC quiet hours while critical evidence remains immediate, and can group warning evidence into a bounded daily digest with validated source links. Digest source deliveries are only marked digested after the external destination accepts the bundle.',
    impact: 'Moves Sneup from dashboard-only visibility into the places project managers and teams already work.',
    effort: 'L',
    status: 'in-progress',
    nextStep: 'Add email delivery while retaining explicit policy activation and delivery-ledger controls.',
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
    evidence: 'Work signals now project into normalized WorkItem, WorkActor, WorkContainer, WorkComment, WorkDependency, and WorkEvent graph models, provider-native dependencies are extracted from Jira, Asana, GitHub, Trello, and generic dependency fields, unresolved cross-provider dependency edges persist even before the target work item syncs, old dependency edges are marked stale when provider syncs stop observing them, stale edges remain visible but stop boosting active blocker scoring, stale graph edges can be confirmed, refreshed, or dismissed from Sneup without provider writes, `/api/work-signals/graph` summarizes graph dependency counts, freshness, review outcomes, and connector-level stale-edge quality for the dashboard, graph items can produce dependency-aware Robert/VA/team decision candidates that rank into mission control as review-only commands/risks, queue approval-gated draft recommendations, appear in the read-only daily operations brief with source/provider evidence, can be inspected in Signals through graph item drilldowns showing source item state, dependency edges, freshness, review state, recent graph events, and queued recommendation history, and now enrich board/card operating ledgers with Trello-linked graph context, direct source links, dependency freshness, and provider/type/direction filters.',
    impact: 'Allows Sneup to reason across projects without forcing every provider into Trello-specific schemas.',
    effort: 'XL',
    status: 'in-progress',
    nextStep: 'Use durable stale-edge telemetry to tune connector-specific freshness thresholds and flag sync regressions before they distort project decisions.',
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
    nextStep: 'Credential rotation now keeps token-based connector accounts in place, renews scope evidence, and records secret-free audit history. Add retention controls for consent evidence.',
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
    evidence: 'Workspace managers can inspect and configure the effective safety posture for every supported Trello write action. Rules may pause an action, raise its risk, or route it to a stricter owner, but cannot disable approval. Optional pause review times become visibly overdue without ever re-enabling a provider write, and the operations ledger rechecks policy before its atomic execution claim.',
    impact: 'Lets humans immediately stop or tighten specific autonomous action types without bypassing the approval ledger or disabling the broader system.',
    effort: 'M',
    status: 'done',
    nextStep: 'Add filterable policy history and retention controls for policy evidence.',
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
    evidence: 'Scheduled board scans reuse an equivalent pending, approval-gated, executing, or recently executed intervention for 24 hours before they can create another recommendation or Trello write candidate. Manual requests remain separate.',
    impact: 'Prevents recurring signals from filling Robert\'s approval queue or repeatedly proposing the same worker communication.',
    effort: 'S',
    status: 'done',
    nextStep: 'Add bounded per-signal cooldown configuration that can only lengthen the default.',
    acceptanceCriteria: [
      'Equivalent scheduled card and team signals reuse their active or recent intervention.',
      'The suppression window never executes a provider write or relaxes approval requirements.',
      'Manual requests remain distinct from scheduled signal suppression.'
    ]
  },
  {
    id: 'ENH-019',
    priority: 'P1',
    area: 'operations',
    title: 'Make scheduled follow-up transitions durable and auditable',
    evidence: 'The scheduled worker now atomically moves overdue workspace-scoped follow-up plans from scheduled to due and writes an audit event. Legacy intervention follow-up and escalation candidate scans are workspace-scoped and only record their queued state after a successful approval-gated candidate path.',
    impact: 'Gives operators a durable lifecycle trail while preventing one workspace from processing another workspace\'s queued work or a transient failure from silently suppressing a retry.',
    effort: 'S',
    status: 'done',
    nextStep: 'Add configurable, workspace-scoped escalation timing policies with bounded defaults.',
    acceptanceCriteria: [
      'Overdue scheduled follow-up plans transition to due once and include audit evidence.',
      'Scheduled intervention follow-up and escalation scans stay within the requested workspace.',
      'A failed candidate path leaves the original intervention eligible for a later safe retry.'
    ]
  },
  {
    id: 'ENH-020',
    priority: 'P2',
    area: 'resource',
    title: 'Load command-center data only when its view is opened',
    evidence: 'The initial overview no longer fans out to every hidden dashboard view. Sneup loads the overview, operations brief, and job health immediately, then loads each ledger, connector, signal, forecast, report, and workspace surface on demand. Explicit refreshes and workspace changes invalidate the cache so operators always receive fresh scoped data.',
    impact: 'Cuts avoidable initial API and database work while keeping each view responsive when Robert opens it.',
    effort: 'S',
    status: 'done',
    nextStep: 'Add bounded response timing telemetry to quantify live workspace load improvements.',
    acceptanceCriteria: [
      'Initial overview loading avoids requests for hidden feature views.',
      'Opening a navigation view loads its data exactly when needed.',
      'Refresh and workspace changes invalidate cached view data.'
    ]
  },
  {
    id: 'ENH-021',
    priority: 'P0',
    area: 'security',
    title: 'Reject predictable token-hashing secrets in live production',
    evidence: 'Live production startup now requires separate, non-placeholder 32+ character peppers for database API tokens, desktop sessions, and workspace invitations. Each token model also rejects an absent or weak production pepper at hash time, while loopback-only demo mode remains credential-free.',
    impact: 'Prevents persisted access and invitation tokens from depending on shared or predictable development fallback values.',
    effort: 'S',
    status: 'done',
    nextStep: 'Add release-environment checks that verify these secrets are supplied by the deployment platform without exposing their values.',
    acceptanceCriteria: [
      'A non-demo production runtime refuses missing, weak, or placeholder token peppers.',
      'API token, session token, and invitation token hashing each use an independent configured secret.',
      'Demo mode remains usable without production secrets.'
    ]
  }
];

const sortEnhancements = (items) => [...items].sort((left, right) => {
  const priorityDiff = PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority];
  if (priorityDiff !== 0) return priorityDiff;
  return left.id.localeCompare(right.id);
});

const listEnhancements = (filters = {}) => {
  const filtered = enhancements.filter(item => {
    if (filters.priority && item.priority !== filters.priority) return false;
    if (filters.area && item.area !== filters.area) return false;
    if (filters.status && item.status !== filters.status) return false;
    return true;
  });

  return sortEnhancements(filtered);
};

const getEnhancement = (id) =>
  enhancements.find(item => item.id.toLowerCase() === String(id).toLowerCase()) || null;

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
