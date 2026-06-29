const WRITE_ACTIONS = new Set([
  'comment',
  'follow_up',
  'reassign',
  'escalate',
  'move_card',
  'add_label',
  'set_due_date',
  'add_checklist',
  'performance_notification'
]);

const HIGH_RISK_ACTIONS = new Set([
  'move_card',
  'set_due_date',
  'escalate'
]);

const DEFAULT_REASONS = {
  comment: 'Posting a Trello comment can notify workers and change the project record.',
  follow_up: 'Posting a follow-up can notify workers and should be deliberate.',
  reassign: 'Changing card ownership affects worker accountability and workload.',
  escalate: 'Escalation changes accountability and may notify senior owners.',
  move_card: 'Moving cards changes workflow state.',
  add_label: 'Adding labels changes visible card classification.',
  set_due_date: 'Changing due dates affects delivery commitments.',
  add_checklist: 'Adding checklist items changes the required work on a card.',
  performance_notification: 'Performance notifications affect worker accountability.'
};

const classifyAction = (actionType, options = {}) => {
  const severity = options.severity || 'medium';
  const highRisk = HIGH_RISK_ACTIONS.has(actionType) || severity === 'critical';
  const mediumRisk = WRITE_ACTIONS.has(actionType);

  if (!mediumRisk) {
    return {
      actionType,
      riskLevel: 'low',
      requiresApproval: false,
      ownerType: 'system',
      approvalReason: 'Internal analysis-only action.'
    };
  }

  const riskLevel = highRisk ? 'high' : severity === 'high' ? 'high' : 'medium';

  return {
    actionType,
    riskLevel,
    requiresApproval: true,
    ownerType: highRisk ? 'robert' : 'team',
    approvalReason: DEFAULT_REASONS[actionType] || 'This action can modify Trello or worker accountability.'
  };
};

const classifyIntervention = (intervention) => classifyAction(intervention.type, {
  severity: intervention.severity,
  metadata: intervention.metadata
});

module.exports = {
  classifyAction,
  classifyIntervention
};
