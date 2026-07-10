# Enhancement Findings

This backlog turns the high-level improvement plan into concrete engineering findings. It is also exposed through `GET /api/enhancements`.

## Priority Summary

- P0: 3 findings that block serious production use.
- P1: 3 findings that materially improve trust, operability, and desktop adoption, plus 1 completed operations control finding.
- P2: 6 findings that harden scale, quality, and workflow reach.
- P3: 1 reporting enhancement with fast user-visible value.

## Findings

| ID | Priority | Area | Finding | Next step |
| --- | --- | --- | --- | --- |
| ENH-001 | P0 | Connectors | Linked accounts now have first-wave read-only provider sync adapters. | Replace metadata-fed deltas with provider API clients, retries, and per-provider rate limits. |
| ENH-002 | P0 | Autonomy | Autopilot needs a durable human approval queue. | Add ActionApproval model, approval routes, and command queue controls. |
| ENH-003 | P0 | Security | Shared production use needs users, workspaces, RBAC, and audit logs. | Add workspace-scoped identity and audit models, then gate every sensitive route. |
| ENH-004 | P1 | Trust | Recommendations need source evidence. | Add EvidenceRef objects to command queue, risks, focus items, and chat answers. |
| ENH-005 | P1 | Forecasting | Forecasting needs capacity calendars and confidence ranges. | Model availability, holidays, skills, throughput, dependencies, and uncertainty. |
| ENH-006 | P1 | Desktop | Installer first-run setup is delivered; release polish remains. | Configure icon, publisher signing, and update feed. |
| ENH-007 | P1 | Operations | Background jobs now have observability and controls. | Done: JobRun/JobControl records, stale/failed/paused dashboard health, and allowlisted pause/resume/manual trigger endpoints. |
| ENH-008 | P2 | Dashboard | Inline dashboard assets keep CSP weaker than needed. | Split HTML, CSS, and JS, then remove inline script allowance. |
| ENH-009 | P2 | AI quality | AI recommendations need regression evaluation. | Build representative scenarios and score correctness, evidence use, safety, and actionability. |
| ENH-010 | P2 | Notifications | Risks and commands need delivery into team channels. | Add notification policies and Slack, Teams, email, and webhook senders. |
| ENH-011 | P2 | Data model | Work signals now project into normalized WorkItem, WorkActor, WorkContainer, WorkComment, WorkDependency, and WorkEvent graph records, with graph-derived Robert/VA/team decision candidates. | Add provider-native dependency extraction and queue-to-operations-brief promotion. |
| ENH-012 | P3 | Reporting | Stakeholder-ready exports are missing. | Add Markdown/PDF reports for standups, weekly status, risk registers, and client updates. |
| ENH-013 | P2 | Connectors | PM connectors are onboarded but many providers still need adapter sync implementations. | Finish the production-safe connector onboarding baseline, validate metadata consistency, and ship first-wave adapters for the added catalog providers. |
| ENH-014 | P2 | Resource | In-memory rate limiting can still grow under extreme unique traffic. | Bound rate bucket cardinality and expose operational tuning guidance and metrics. |

## Recommended Build Order

1. ENH-003, because auth/workspaces define safe ownership boundaries.
2. ENH-001 and ENH-011 together, because real connector sync requires a normalized work graph.
3. ENH-002 and ENH-004, because autonomy should be reviewable and evidence-backed.
4. ENH-007, because production sync needs operational visibility.
5. ENH-006, ENH-008, ENH-009, ENH-010, ENH-012 as polish and workflow expansion.
