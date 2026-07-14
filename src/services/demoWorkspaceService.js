function isDemoMode(environment = process.env) {
  return String(environment.SNEUP_DEMO_MODE || '').toLowerCase() === 'true';
}

function getDemoWorkspace() {
  return {
    id: 'demo',
    name: 'Demo workspace',
    slug: 'demo-workspace',
    status: 'active',
    plan: 'local',
    settings: {
      requireApprovalForTrelloWrites: true,
      defaultDecisionOwner: 'robert'
    },
    demoMode: true
  };
}

function getDemoSecurityContext() {
  return {
    authenticated: true,
    authMethod: 'demo',
    actorType: 'demo',
    actorId: 'demo-operator',
    displayName: 'Demo operator',
    workspaceId: 'demo',
    workspaceName: 'Demo workspace',
    roles: ['viewer'],
    permissions: [],
    tokenId: null,
    userId: null,
    localRequest: false,
    workspaceOverrideAllowed: false,
    demoMode: true
  };
}

module.exports = {
  getDemoSecurityContext,
  getDemoWorkspace,
  isDemoMode
};
