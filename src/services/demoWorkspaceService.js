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

function getDemoOperationsLedger(now = new Date()) {
  const generatedAt = new Date(now);
  const dueAt = new Date(generatedAt.getTime() - (2 * 60 * 60 * 1000));
  const observedAt = new Date(generatedAt.getTime() - (24 * 60 * 60 * 1000));
  const recoveryRecommendationId = 'demo-recommendation-recovery';
  const sourceEvidence = [{
    type: 'board',
    entityId: 'demo-board-growth',
    label: 'Demo board snapshot',
    observedAt
  }];

  return {
    workspaceId: 'demo',
    generatedAt,
    demoMode: true,
    decisions: [{
      _id: 'demo-decision-recovery',
      recommendationId: recoveryRecommendationId,
      ownerType: 'robert',
      boardId: { _id: 'demo-board-growth', name: 'Growth Experiments' },
      cardId: { _id: 'demo-card-growth-recovery', name: 'Approve launch checklist for Sneup onboarding' },
      title: 'Approve recovery plan for Growth Experiments',
      question: 'Approve recovery plan for Growth Experiments: Yes/No.',
      recommendedAnswer: 'yes',
      options: ['yes', 'no', 'change'],
      riskLevel: 'critical',
      reason: 'Campaign dependencies are blocked and production capacity is overloaded.',
      sourceEvidence,
      status: 'open',
      createdAt: observedAt
    }],
    recommendations: [{
      _id: recoveryRecommendationId,
      boardId: { _id: 'demo-board-growth', name: 'Growth Experiments' },
      cardId: { _id: 'demo-card-growth-recovery', name: 'Approve launch checklist for Sneup onboarding' },
      title: 'Approve recovery plan for Growth Experiments',
      description: 'Campaign dependencies are blocked and production capacity is overloaded.',
      recommendedAction: 'Review the recovery plan and decide whether to request an owner update.',
      actionType: 'follow_up',
      actionPayload: { draftOnly: true, executable: false },
      riskLevel: 'critical',
      confidence: 0.75,
      requiresApproval: true,
      approvalReason: 'Demo preview only. Live provider actions always require a current human approval.',
      ownerType: 'robert',
      sourceEvidence,
      status: 'pending',
      createdAt: observedAt
    }],
    actions: [],
    auditEvents: [{
      _id: 'demo-audit-recovery',
      action: 'demo_recommendation_queued',
      source: 'demo',
      riskLevel: 'critical',
      actor: 'sneup',
      entityType: 'recommendation',
      createdAt: observedAt
    }],
    followUps: [{
      _id: 'demo-follow-up-launch',
      boardId: { _id: 'demo-board-client-launches', name: 'Client Launches' },
      cardId: { _id: 'demo-card-launch-checklist', name: 'Approve launch checklist for Sneup onboarding' },
      memberId: { _id: 'demo-member-nina', fullName: 'Nina Jacobs' },
      reason: 'Verify launch checklist response.',
      nextAction: 'Review the owner response before escalating.',
      status: 'due',
      dueAt,
      createdAt: observedAt
    }],
    accountability: {
      summary: {
        members: 2,
        membersNeedingAttention: 1,
        overdueFollowUps: 1
      },
      members: [{
        memberId: 'demo-member-nina',
        name: 'Nina Jacobs',
        workloadLevel: 'overloaded',
        attention: 'needs_attention',
        followUpsCreated: 1,
        responseCount: 0,
        responseCoverage: 0,
        overdueFollowUps: 1,
        escalatedFollowUps: 0,
        blockedResponses: 0,
        ignoredResponses: 0
      }, {
        memberId: 'demo-member-sara',
        name: 'Sara Visser',
        workloadLevel: 'balanced',
        attention: 'clear',
        followUpsCreated: 0,
        responseCount: 0,
        responseCoverage: null,
        overdueFollowUps: 0,
        escalatedFollowUps: 0,
        blockedResponses: 0,
        ignoredResponses: 0
      }]
    },
    outcomes: [{
      _id: 'demo-outcome-recovery',
      recommendationId: { _id: recoveryRecommendationId, title: 'Approve recovery plan for Growth Experiments' },
      actionType: 'follow_up',
      status: 'awaiting_evidence',
      summary: 'Demo outcome evidence remains pending until a live approved action is completed.',
      evaluatedAt: generatedAt,
      createdAt: observedAt
    }],
    findings: [{
      _id: 'demo-finding-growth',
      boardId: { _id: 'demo-board-growth', name: 'Growth Experiments' },
      cardId: { _id: 'demo-card-growth-recovery', name: 'Approve launch checklist for Sneup onboarding' },
      title: 'Campaign dependencies are blocking delivery.',
      findingType: 'blocked',
      waitingOn: 'robert',
      severity: 'critical',
      signalScore: 96,
      recommendedAction: 'Review the recovery plan and confirm the next owner action.',
      sourceEvidence,
      lastObservedAt: observedAt
    }],
    healthSnapshots: [{
      _id: 'demo-health-growth',
      boardId: { _id: 'demo-board-growth', name: 'Growth Experiments' },
      healthStatus: 'critical',
      healthScore: 42,
      counts: { findings: 3, robertQueueCandidates: 1, vaReadyCandidates: 1 },
      summary: 'Production capacity is saturated and three blockers need review.',
      generatedAt
    }],
    reconciliationHealth: {
      summary: { requiresOperator: 0, critical: 0, warning: 0 },
      alerts: [],
      thresholds: { warningHours: 4, criticalHours: 24 }
    },
    notificationPolicies: [],
    notificationDeliveries: [],
    errors: []
  };
}

module.exports = {
  getDemoSecurityContext,
  getDemoOperationsLedger,
  getDemoWorkspace,
  isDemoMode
};
