const WRITE_CAPABLE_SCOPE = /(?:^|[.:/])(?:write|manage|admin|delete|create|update)(?:$|[.:/])|\b(?:repo|workflow|api)\b/i;

const hasSecretField = (connector) => (connector.auth?.fields || []).some((field) => field.secret);

const isProviderScopeReviewRequired = (connector) => (connector.auth?.scopes || []).some((scope) => WRITE_CAPABLE_SCOPE.test(scope));

const buildConnectorSafetyProfile = (connector) => {
  const providerScopeReviewRequired = isProviderScopeReviewRequired(connector);
  const credentialReviewRequired = connector.auth?.type === 'oauth2' || hasSecretField(connector);
  const scopeReviewRequired = providerScopeReviewRequired || credentialReviewRequired;
  const reviewReasons = [];

  if (providerScopeReviewRequired) {
    reviewReasons.push('This provider uses one or more broad scopes. Confirm the provider consent screen before linking the account.');
  }
  if (credentialReviewRequired) {
    reviewReasons.push('Sneup stores credentials only with configured encryption and uses them for bounded, read-only signal ingestion.');
  }
  if (!scopeReviewRequired) {
    reviewReasons.push('This connector only records the selected workspace link; no provider credential is stored.');
  }

  return {
    ingestion: 'read_only',
    providerWritesBlocked: true,
    proposedProviderActions: 'approval_required',
    scopeReviewRequired,
    providerScopeReviewRequired,
    scopeRisk: providerScopeReviewRequired ? 'review' : credentialReviewRequired ? 'guarded' : 'read_only',
    reviewReasons,
    requestedScopes: connector.auth?.scopes || [],
    summary: providerScopeReviewRequired
      ? 'Read-only ingestion is enforced in Sneup; review the provider consent screen for broad scopes.'
      : 'Read-only ingestion only. Any provider write must be created as an exact, approval-gated Sneup action.'
  };
};

const summarizeConnectorSafety = (connectors) => {
  const profiles = connectors.map(buildConnectorSafetyProfile);
  return {
    total: profiles.length,
    readOnlyIngestion: profiles.filter((profile) => profile.ingestion === 'read_only').length,
    providerWritesBlocked: profiles.filter((profile) => profile.providerWritesBlocked).length,
    scopeReviews: profiles.filter((profile) => profile.scopeReviewRequired).length,
    providerScopeReviews: profiles.filter((profile) => profile.providerScopeReviewRequired).length
  };
};

module.exports = {
  buildConnectorSafetyProfile,
  summarizeConnectorSafety
};
