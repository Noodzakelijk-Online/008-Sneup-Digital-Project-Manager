# Feature Improvement Plan

## Highest-Value Product Upgrades

Detailed findings are tracked in [ENHANCEMENT_FINDINGS.md](ENHANCEMENT_FINDINGS.md) and exposed by `GET /api/enhancements`.

1. Connector sync engine
   - Turn linked accounts into scheduled read/write sync jobs per provider.
   - Normalize external tasks, messages, files, comments, owners, due dates, dependencies, and statuses into Sneup's internal work graph.

2. Human-in-the-loop autonomy
   - Add approval queues for comments, assignments, escalations, and due-date changes.
   - Let teams choose advisory, assisted, or control mode per workspace.

3. Cross-tool project memory
   - Build a unified project timeline across Trello, Jira, Slack, email, docs, meetings, files, incidents, and CRM signals.
   - Add source citations for every recommendation so humans can trust the why.

4. Executive and team rituals
   - Auto-generate standups, weekly steering notes, risk registers, client status updates, and owner-specific focus plans.
   - Add one-click exports to email, Slack, Teams, PDF, and project docs.

5. Capacity and forecasting
   - Add skills, holidays, focus time, utilization, dependencies, and historical throughput into forecasting.
   - Show confidence intervals rather than single-date promises.

6. Enterprise security
   - Add real user auth, RBAC, workspace tenancy, audit logs, secret rotation, SCIM/SAML, and signed desktop releases.
   - Add connector-specific least-privilege scope checks before allowing a provider to connect.

7. Installer polish
   - Add a branded icon, signed installer certificate, auto-update channel, first-run setup wizard, and optional bundled local database.
