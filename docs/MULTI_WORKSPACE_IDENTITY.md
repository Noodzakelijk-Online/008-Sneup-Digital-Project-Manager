# Multi-Workspace Identity Operations

Sneup now separates three access modes:

- Environment API key: service-level access through `SNEUP_API_KEY`.
- Database API token: long-lived service or automation credential stored as a hash in `ApiToken`.
- User session token: human user credential stored as a hash in `SessionToken`.

Raw API/session secrets are only shown at creation time. MongoDB stores prefixes and HMAC hashes, not the raw token.

## Workspace Selection

Every authenticated request resolves a workspace context into `req.auth`.

- Normal database API tokens and user sessions use their assigned workspace.
- Local requests, service contexts, and owner contexts may override the workspace with `X-Sneup-Workspace-Id`.
- Optional `X-Sneup-Workspace-Name` is only used when override is allowed.
- Non-owner user sessions cannot jump between workspaces with headers.

Use:

```http
GET /api/workspaces/current
Authorization: Bearer <token>
```

to inspect the resolved actor, role, permission set, and workspace override allowance.

## User Sessions

Admins, owners, service tokens, or local owner contexts can issue and revoke per-user session tokens:

```http
POST /api/workspaces/:workspaceId/users/:userId/session
Authorization: Bearer <admin-or-service-token>
Content-Type: application/json

{
  "name": "Robert laptop",
  "expiresInHours": 168
}
```

The response includes `sessionToken` and `authorizationHeader` once. Store it in the client and send it as:

```http
Authorization: Bearer sneup_session_...
```

Session tokens only work when:

- the session is `active`;
- the session has not expired;
- the linked user is `active`;
- the linked workspace still exists.

Revoke a session with:

```http
POST /api/workspaces/:workspaceId/users/:userId/sessions/:sessionId/revoke
Authorization: Bearer <admin-or-service-token>
```

List active and historical user sessions with:

```http
GET /api/workspaces/:workspaceId/users/:userId/sessions
Authorization: Bearer <admin-or-service-token>
```

Issuing and revoking sessions emits high-risk audit events in the operations ledger.

## Migration Notes

For existing deployments, inspect before applying a workspace migration. Both commands use `SNEUP_DEFAULT_WORKSPACE_ID` and never print credentials:

```powershell
npm run migrate:workspace
npm run migrate:workspace -- --apply
```

The first command is read-only JSON evidence: it reports each collection's records missing `workspaceId`, the target workspace, and the bounded concurrency used. The `--apply` command creates the default workspace if needed, then attaches only legacy records where `workspaceId` is absent or `null`. It does not overwrite a record already assigned to another workspace.

Use `--concurrency <1-16>` for constrained MongoDB deployments, or set `SNEUP_WORKSPACE_BACKFILL_CONCURRENCY` (default `4`). Sneup keeps the compatibility backfill at successful database startup, now with the same bounded concurrency; the explicit command is the recommended production preflight and change record.

Recommended production checks before exposing Sneup remotely:

- Set `SNEUP_API_KEY` and `SNEUP_REQUIRE_API_KEY=true`.
- Set `SNEUP_API_TOKEN_PEPPER` and `SNEUP_SESSION_TOKEN_PEPPER` to stable, private values.
- Configure `SNEUP_ALLOWED_ORIGINS` for the dashboard origin.
- Create an owner/admin user and issue a short-lived session token.
- Confirm `GET /api/security/context` returns the expected actor, role, and workspace.
- Confirm `GET /api/workspaces/current` does not allow workspace override for ordinary user sessions.

Important MongoDB indexes:

- `Workspace.slug`
- `User.workspaceId + email`
- `ApiToken.workspaceId + tokenPrefix`
- `SessionToken.workspaceId + userId + status`
- `SessionToken.tokenPrefix + status`
- workspace-scoped indexes on Trello/project collections

The app defines these indexes in Mongoose schemas. Production migrations should still monitor index build time and old duplicate data before enforcing uniqueness in shared databases.
