# Enhancement Findings

This backlog turns the high-level improvement plan into concrete engineering findings. It is also exposed through `GET /api/enhancements`.

## Priority Summary

- P0: 4 findings that block serious production use.
- P1: 4 findings that materially improve trust, operability, and desktop adoption, plus 1 completed operations control finding.
- P2: 6 findings that harden scale, quality, and workflow reach.
- P3: 1 reporting enhancement with fast user-visible value.

## Findings

| ID | Priority | Area | Finding | Next step |
| --- | --- | --- | --- | --- |
| ENH-001 | P0 | Connectors | Linked accounts now have bounded read-only API clients for 20 first-wave providers, including GitLab issue and merge-request metadata with `read_api`; Job Health retains the provider's issue and merge-request counts. | Add the next credential-backed provider client, preserving bounded read-only sync and provider-specific health evidence. |
| ENH-002 | P0 | Autonomy | Approval review now uses action-specific fields instead of free-form JSON; Trello targets, provider routing, execution flags, and action type stay protected, every edit requires fresh approval, and move/reassign targets are verified in the current board/workspace. | Add policy-driven default snooze durations. |
| ENH-003 | P0 | Security | Shared production use needs users, workspaces, RBAC, and audit logs. | Add workspace-scoped identity and audit models, then gate every sensitive route. |
| ENH-004 | P1 | Trust | Recommendations include inspectable, validated source evidence. | Extend source drilldowns into chat and notifications. |
| ENH-005 | P1 | Forecasting | Sneup now models workspace-scoped weekly capacity, allocation, focus time, planned time off, skills, and historical card effort to return analysis-only P50/P80 delivery ranges with confidence, explicit assumptions, and delivery risks. | Add connector-native time and calendar ingestion as optional capacity evidence. |
| ENH-006 | P1 | Desktop | Installer first-run setup is delivered; release polish remains. | Configure icon, publisher signing, and update feed. |
| ENH-007 | P1 | Operations | Background jobs now have observability and controls. | Done: JobRun/JobControl records, stale/failed/paused dashboard health, and allowlisted pause/resume/manual trigger endpoints. |
| ENH-008 | P2 | Dashboard | Inline dashboard assets keep CSP weaker than needed. | Split HTML, CSS, and JS, then remove inline script allowance. |
| ENH-009 | P2 | AI quality | AI recommendations need regression evaluation. | Build representative scenarios and score correctness, evidence use, safety, and actionability. |
| ENH-010 | P2 | Notifications | Slack, Teams, and generic webhook policies are encrypted, explicit, severity-filtered, daily-idempotent, and delivery-ledgered for reconciliation evidence gaps. | Add email, digest cadence, quiet hours, and source-evidence deep links. |
| ENH-011 | P2 | Data model | Work signals now project into normalized WorkItem, WorkActor, WorkContainer, WorkComment, WorkDependency, and WorkEvent graph records, with graph-derived Robert/VA/team decision candidates. | Add provider-native dependency extraction and queue-to-operations-brief promotion. |
| ENH-012 | P3 | Reporting | Stakeholder-ready reports export in Markdown and PDF. | Add scheduled delivery policies after notification channels are configured. |
| ENH-013 | P2 | Connectors | PM connectors are onboarded but many providers still need adapter sync implementations. | Finish the production-safe connector onboarding baseline, validate metadata consistency, and ship first-wave adapters for the added catalog providers. |
| ENH-014 | P2 | Resource | In-memory rate limiting can still grow under extreme unique traffic. | Bound rate bucket cardinality and expose operational tuning guidance and metrics. |
| ENH-015 | P1 | Connector safety | Account linking now stops at a scope-review gate, exposes requested scopes, narrows four provider permissions to read-only equivalents, and blocks provider writes within Sneup. | Add workspace-scoped credential encryption configuration and provider-specific consent evidence to the audit ledger. |
| ENH-016 | P0 | Autonomy safety | Approved Trello writes use an atomic execution claim, reject forged no-approval write records, retain the claim after post-write bookkeeping faults, and provide an operator-only evidence-backed reconciliation flow that never sends a second provider request. Aging health exposes warning and critical evidence gaps to the operator without retrying provider writes. | Add optional delivered alert policies after notification channels are configured. |

## Recommended Build Order

1. ENH-003, because auth/workspaces define safe ownership boundaries.
2. ENH-001 and ENH-011 together, because real connector sync requires a normalized work graph.
3. ENH-002 and ENH-004, because autonomy should be reviewable and evidence-backed.
4. ENH-007, because production sync needs operational visibility.
5. ENH-006, ENH-008, ENH-009, ENH-010, ENH-012 as polish and workflow expansion.
