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
    evidence: 'Connector accounts can be linked and stored, normalized WorkSignal records now exist, `/api/work-signals/contracts` exposes adapter contracts, first-wave read-only adapters exist for Trello, Jira, Asana, Slack, GitHub, Google Workspace, Microsoft 365, Linear, Notion, and monday.com. Trello API-key accounts ingest boards and cards, Jira OAuth accounts discover a single authorized Cloud site before ingesting issues, Asana OAuth accounts select one workspace before ingesting project tasks and dependency context, Slack OAuth accounts ingest bounded accessible channel history with no message-posting scope, GitHub OAuth accounts ingest repository issues and pull requests, Google Workspace OAuth accounts ingest Calendar events plus Drive metadata, Microsoft OAuth accounts ingest Calendar summaries, To Do task metadata, and signed-in-user OneDrive root metadata, Linear OAuth accounts ingest issue context, Notion OAuth accounts ingest only explicitly shared page and data-source metadata, and monday.com OAuth accounts ingest board-item metadata using only the `boards:read` scope. Every live client uses decrypted in-process credentials only, bounded request/item limits, cursor lookback, retry/pacing controls, and no provider writes. A scheduled connector work-signal job records provider retry/pacing evidence in Job Health.',
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
    evidence: 'Autopilot commands can now be queued into the durable recommendation and decision queue with approve, reject, change, snooze, delegate, and payload-edit paths.',
    impact: 'Allows Sneup to become more autonomous while preserving human control over risky project changes.',
    effort: 'L',
    status: 'done',
    nextStep: 'Replace prompt-based payload editing with a structured review form and add policy-driven default snooze durations.',
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
    evidence: 'The API resolves request identity and workspace context, supports hashed database API tokens and hashed per-user session tokens, Workspace/User/ApiToken/SessionToken models exist, consequential write endpoints require explicit role permissions, workspace/user/session management APIs exist, the dashboard exposes current workspace selection for local/service contexts, multi-workspace identity operations are documented, and boards/cards/connector accounts plus core operations-ledger, analytics, chat, team, list/member/comment, intervention, learning, and performance collections are workspace-scoped.',
    impact: 'Required before Sneup can safely run as a shared or internet-facing project-management control plane.',
    effort: 'XL',
    status: 'in-progress',
    nextStep: 'Add invitation/email delivery, session revocation UI, and production migration scripts for existing shared deployments.',
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
    evidence: 'Recommendations preserve sourceEvidence, `/api/recommendations/:recommendationId/evidence` returns source refs plus decisions, approvals, Trello attempts, audit events, follow-ups, worker responses, and related findings, mission-control command/focus/risk/chat payloads now carry sourceEvidence, and the dashboard exposes evidence counts plus compact evidence rows.',
    impact: 'Makes Sneup defensible: humans can inspect why a recommendation exists before trusting it.',
    effort: 'M',
    status: 'in-progress',
    nextStep: 'Add clickable source drilldowns for command queue, focus, risk, and chat evidence refs, including direct card/comment/provider object links where the upstream connector exposes them.',
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
    evidence: 'Current health and priority logic uses card counts, due dates, risk levels, and simple workload scoring.',
    impact: 'Improves delivery predictions and prevents false certainty in project dates.',
    effort: 'L',
    status: 'needs-research',
    nextStep: 'Model availability, holidays, focus time, role skills, historical throughput, and dependency uncertainty.',
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
    evidence: 'The Windows installer works, but there is no branded icon, publisher certificate, auto-update channel, or guided setup.',
    impact: 'Reduces installation friction and improves trust for Windows 11 users.',
    effort: 'M',
    status: 'ready',
    nextStep: 'Add first-run wizard for MongoDB/demo mode/API keys, installer icon assets, publisher signing, and update feed configuration.',
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
    evidence: 'AI fallback and OpenAI generation exist, but there is no test set measuring answer quality, safety, or actionability.',
    impact: 'Prevents regressions as Sneup becomes more autonomous.',
    effort: 'M',
    status: 'needs-research',
    nextStep: 'Create representative project scenarios and score recommendations for correctness, evidence use, tone, and action safety.',
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
    evidence: 'Sneup detects commands and risks, but it does not yet deliver them to Slack, Teams, email, or calendar workflows.',
    impact: 'Moves Sneup from dashboard-only visibility into the places project managers and teams already work.',
    effort: 'L',
    status: 'ready',
    nextStep: 'Implement NotificationPolicy and NotificationDelivery models with Slack, Teams, email, and webhook senders.',
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
    evidence: 'Mission control has useful status data, but there is no export flow for clients, executives, or team rituals.',
    impact: 'Saves project managers recurring reporting time and creates visible value quickly.',
    effort: 'M',
    status: 'ready',
    nextStep: 'Add weekly status, standup, risk register, and client update exporters.',
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
