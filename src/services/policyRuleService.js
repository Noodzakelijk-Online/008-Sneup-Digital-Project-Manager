const mongoose = require('mongoose');
const AuditEvent = require('../models/AuditEvent');
const interventionPolicy = require('./interventionPolicy');
const { normalizeWorkspaceObjectId } = require('./workspaceScopeService');
const logger = require('../utils/logger');

const RISK_LEVELS = ['low', 'medium', 'high', 'critical'];
const OWNER_TYPES = ['robert', 'va', 'team', 'system'];
const OWNER_STRICTNESS = Object.freeze({ system: 0, va: 1, team: 1, robert: 2 });
const MAX_REASON_LENGTH = 500;
const DECISION_QUEUE_SNOOZE_ACTION = 'decision_queue_snooze';
const DECISION_QUEUE_ROUTING_ACTION = 'decision_queue_routing';
const SCHEDULED_INTERVENTION_COOLDOWN_ACTION = 'scheduled_intervention_cooldown';
const DEFAULT_SNOOZE_HOURS = 24;
const MIN_SNOOZE_HOURS = 1;
const MAX_SNOOZE_HOURS = 168;
const DEFAULT_INTERVENTION_COOLDOWN_HOURS = 24;
const SCHEDULED_INTERVENTION_TRIGGERS = Object.freeze([
  'card_stuck',
  'no_activity',
  'overdue',
  'member_overloaded',
  'blocking_others',
  'no_response_to_followup',
  'performance_milestone'
]);
const DEFAULT_QUEUE_ROUTING = Object.freeze({
  low: Object.freeze({ ownerType: 'va', escalationHours: 24 }),
  medium: Object.freeze({ ownerType: 'team', escalationHours: 24 }),
  high: Object.freeze({ ownerType: 'robert', escalationHours: 6 }),
  critical: Object.freeze({ ownerType: 'robert', escalationHours: 2 })
});

const clampText = (value, maximum = MAX_REASON_LENGTH) => String(value || '').trim().slice(0, maximum);
const riskRank = (riskLevel) => RISK_LEVELS.indexOf(riskLevel);
const ownerRank = (ownerType) => OWNER_STRICTNESS[ownerType] ?? -1;
const actionLabel = (actionType) => String(actionType || '').replaceAll('_', ' ');
const getPolicyRuleModel = () => require('../models/PolicyRule');
const isDecisionQueueSnoozeAction = actionType => actionType === DECISION_QUEUE_SNOOZE_ACTION;
const isDecisionQueueRoutingAction = actionType => actionType === DECISION_QUEUE_ROUTING_ACTION;
const isScheduledInterventionCooldownAction = actionType => actionType === SCHEDULED_INTERVENTION_COOLDOWN_ACTION;
const isWorkflowAction = actionType => isDecisionQueueSnoozeAction(actionType)
  || isDecisionQueueRoutingAction(actionType)
  || isScheduledInterventionCooldownAction(actionType);
const parseSnoozeHours = value => {
  const parsed = typeof value === 'string' && !value.trim() ? Number.NaN : Number(value);
  return Number.isInteger(parsed) && parsed >= MIN_SNOOZE_HOURS && parsed <= MAX_SNOOZE_HOURS ? parsed : null;
};
const parseScheduledCooldownHours = value => {
  const parsed = typeof value === 'string' && !value.trim() ? Number.NaN : Number(value);
  return Number.isInteger(parsed) && parsed >= DEFAULT_INTERVENTION_COOLDOWN_HOURS && parsed <= MAX_SNOOZE_HOURS ? parsed : null;
};
const toValidDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

class PolicyRuleService {
  isDatabaseReady() {
    return mongoose.connection.readyState === 1;
  }

  requireDatabase() {
    if (!this.isDatabaseReady()) {
      const error = new Error('Database connection is required for action safety policies');
      error.statusCode = 503;
      throw error;
    }
  }

  resolveWorkspaceId(workspaceId) {
    return normalizeWorkspaceObjectId(workspaceId);
  }

  assertActionType(actionType) {
    if (!interventionPolicy.getWriteActionTypes().includes(actionType) && !isWorkflowAction(actionType)) {
      const error = new Error('Action type is not eligible for a Trello safety policy');
      error.statusCode = 400;
      throw error;
    }
  }

  mergePolicy(basePolicy, rule, now = new Date()) {
    if (!rule) {
      return {
        ...basePolicy,
        enabled: true,
        configured: false,
        baselineRiskLevel: basePolicy.riskLevel,
        baselineOwnerType: basePolicy.ownerType,
        pauseExpiresAt: null,
        pauseReviewOverdue: false
      };
    }

    const configuredRisk = RISK_LEVELS.includes(rule.riskLevel) ? rule.riskLevel : basePolicy.riskLevel;
    const riskLevel = riskRank(configuredRisk) > riskRank(basePolicy.riskLevel)
      ? configuredRisk
      : basePolicy.riskLevel;

    const enabled = rule.enabled !== false;
    const pauseExpiresAt = toValidDate(rule.pauseExpiresAt);
    return {
      ...basePolicy,
      riskLevel,
      // A policy rule may only make the existing safety posture stricter.
      requiresApproval: basePolicy.requiresApproval || rule.requiresApproval !== false,
      ownerType: OWNER_TYPES.includes(rule.ownerType) && ownerRank(rule.ownerType) >= ownerRank(basePolicy.ownerType)
        ? rule.ownerType
        : basePolicy.ownerType,
      approvalReason: rule.reason || basePolicy.approvalReason,
      enabled,
      configured: true,
      baselineRiskLevel: basePolicy.riskLevel,
      baselineOwnerType: basePolicy.ownerType,
      policyRuleId: rule._id ? String(rule._id) : null,
      updatedAt: rule.updatedAt,
      updatedBy: rule.updatedBy || 'system',
      reason: rule.reason || '',
      pauseExpiresAt: !enabled && pauseExpiresAt ? pauseExpiresAt.toISOString() : null,
      // An expiry asks a human to review the pause; it never re-enables provider writes.
      pauseReviewOverdue: !enabled && Boolean(pauseExpiresAt) && pauseExpiresAt.getTime() <= now.getTime()
    };
  }

  serializePolicy(actionType, policy) {
    return {
      actionType,
      label: actionLabel(actionType),
      enabled: policy.enabled !== false,
      configured: Boolean(policy.configured),
      riskLevel: policy.riskLevel,
      baselineRiskLevel: policy.baselineRiskLevel || policy.riskLevel,
      baselineOwnerType: policy.baselineOwnerType || policy.ownerType,
      requiresApproval: policy.requiresApproval !== false,
      ownerType: policy.ownerType,
      approvalReason: policy.approvalReason,
      policyRuleId: policy.policyRuleId || null,
      updatedAt: policy.updatedAt || null,
      updatedBy: policy.updatedBy || null,
      reason: policy.reason || '',
      pauseExpiresAt: policy.pauseExpiresAt || null,
      pauseReviewOverdue: Boolean(policy.pauseReviewOverdue)
    };
  }

  decisionQueueSnoozeBaseline() {
    return {
      actionType: DECISION_QUEUE_SNOOZE_ACTION,
      label: 'Decision queue snooze',
      policyKind: 'workflow',
      enabled: true,
      configured: false,
      riskLevel: 'low',
      baselineRiskLevel: 'low',
      ownerType: 'robert',
      baselineOwnerType: 'robert',
      requiresApproval: false,
      approvalReason: 'Snoozing only reschedules an internal decision queue item; it never prepares or performs a provider write.',
      defaultSnoozeHours: DEFAULT_SNOOZE_HOURS,
      baselineDefaultSnoozeHours: DEFAULT_SNOOZE_HOURS,
      policyRuleId: null,
      updatedAt: null,
      updatedBy: null,
      reason: ''
    };
  }

  mergeDecisionQueueSnoozePolicy(rule) {
    const baseline = this.decisionQueueSnoozeBaseline();
    if (!rule) return baseline;
    const configuredHours = parseSnoozeHours(rule.conditions?.defaultSnoozeHours);
    return {
      ...baseline,
      configured: true,
      defaultSnoozeHours: configuredHours || DEFAULT_SNOOZE_HOURS,
      policyRuleId: rule._id ? String(rule._id) : null,
      updatedAt: rule.updatedAt || null,
      updatedBy: rule.updatedBy || 'system',
      reason: rule.reason || ''
    };
  }

  decisionQueueRoutingBaseline() {
    return {
      actionType: DECISION_QUEUE_ROUTING_ACTION,
      label: 'Decision queue routing',
      policyKind: 'workflow',
      workflowType: 'decision_queue_routing',
      enabled: true,
      configured: false,
      riskLevel: 'low',
      baselineRiskLevel: 'low',
      ownerType: 'robert',
      baselineOwnerType: 'robert',
      requiresApproval: false,
      approvalReason: 'Routing and escalation windows only organize internal decision queues; they never prepare or perform a provider write.',
      routingByRisk: DEFAULT_QUEUE_ROUTING,
      baselineRoutingByRisk: DEFAULT_QUEUE_ROUTING,
      policyRuleId: null,
      updatedAt: null,
      updatedBy: null,
      reason: ''
    };
  }

  normalizeDecisionQueueRouting(candidate = {}) {
    return Object.fromEntries(RISK_LEVELS.map((riskLevel) => {
      const baseline = DEFAULT_QUEUE_ROUTING[riskLevel];
      const entry = candidate?.[riskLevel] || {};
      const requestedOwner = OWNER_TYPES.includes(entry.ownerType) ? entry.ownerType : baseline.ownerType;
      const ownerType = riskLevel === 'high' || riskLevel === 'critical'
        ? 'robert'
        : ownerRank(requestedOwner) >= ownerRank(baseline.ownerType) && requestedOwner !== 'system'
          ? requestedOwner
          : baseline.ownerType;
      return [riskLevel, {
        ownerType,
        escalationHours: parseSnoozeHours(entry.escalationHours) || baseline.escalationHours
      }];
    }));
  }

  mergeDecisionQueueRoutingPolicy(rule) {
    const baseline = this.decisionQueueRoutingBaseline();
    if (!rule) return baseline;
    return {
      ...baseline,
      configured: true,
      routingByRisk: this.normalizeDecisionQueueRouting(rule.conditions?.routingByRisk),
      policyRuleId: rule._id ? String(rule._id) : null,
      updatedAt: rule.updatedAt || null,
      updatedBy: rule.updatedBy || 'system',
      reason: rule.reason || ''
    };
  }

  resolveDecisionQueueRouting({ riskLevel, requestedOwner, policy } = {}) {
    const resolvedRisk = RISK_LEVELS.includes(riskLevel) ? riskLevel : 'medium';
    const effectivePolicy = policy || this.decisionQueueRoutingBaseline();
    const routing = effectivePolicy.routingByRisk?.[resolvedRisk] || DEFAULT_QUEUE_ROUTING[resolvedRisk];
    const requested = OWNER_TYPES.includes(requestedOwner) ? requestedOwner : null;
    const ownerType = resolvedRisk === 'high' || resolvedRisk === 'critical' || requested === 'robert'
      ? 'robert'
      : routing.ownerType;
    return {
      riskLevel: resolvedRisk,
      ownerType,
      escalationHours: routing.escalationHours
    };
  }

  scheduledInterventionCooldownBaseline() {
    const cooldownHoursByTrigger = Object.fromEntries(
      SCHEDULED_INTERVENTION_TRIGGERS.map(trigger => [trigger, DEFAULT_INTERVENTION_COOLDOWN_HOURS])
    );
    return {
      actionType: SCHEDULED_INTERVENTION_COOLDOWN_ACTION,
      label: 'Scheduled intervention cooldowns',
      policyKind: 'workflow',
      workflowType: 'scheduled_intervention_cooldown',
      enabled: true,
      configured: false,
      riskLevel: 'low',
      baselineRiskLevel: 'low',
      ownerType: 'robert',
      baselineOwnerType: 'robert',
      requiresApproval: false,
      approvalReason: 'Cooldowns only suppress duplicate internal recommendations; they never execute, approve, or prepare a provider write.',
      cooldownHoursByTrigger,
      baselineCooldownHoursByTrigger: cooldownHoursByTrigger,
      policyRuleId: null,
      updatedAt: null,
      updatedBy: null,
      reason: ''
    };
  }

  normalizeScheduledInterventionCooldowns(candidate = {}) {
    return Object.fromEntries(SCHEDULED_INTERVENTION_TRIGGERS.map((trigger) => [
      trigger,
      parseScheduledCooldownHours(candidate?.[trigger]) || DEFAULT_INTERVENTION_COOLDOWN_HOURS
    ]));
  }

  mergeScheduledInterventionCooldownPolicy(rule) {
    const baseline = this.scheduledInterventionCooldownBaseline();
    if (!rule) return baseline;
    return {
      ...baseline,
      configured: true,
      cooldownHoursByTrigger: this.normalizeScheduledInterventionCooldowns(rule.conditions?.cooldownHoursByTrigger),
      policyRuleId: rule._id ? String(rule._id) : null,
      updatedAt: rule.updatedAt || null,
      updatedBy: rule.updatedBy || 'system',
      reason: rule.reason || ''
    };
  }

  resolveScheduledInterventionCooldown({ trigger, policy } = {}) {
    const effectivePolicy = policy || this.scheduledInterventionCooldownBaseline();
    return parseScheduledCooldownHours(effectivePolicy.cooldownHoursByTrigger?.[trigger])
      || DEFAULT_INTERVENTION_COOLDOWN_HOURS;
  }

  async listEffectivePolicies(options = {}) {
    this.requireDatabase();
    const workspaceId = this.resolveWorkspaceId(options.workspaceId);
    const PolicyRule = getPolicyRuleModel();
    const rules = await PolicyRule.find({ workspaceId }).sort({ actionType: 1 });
    const rulesByAction = new Map(rules.map(rule => [rule.actionType, rule]));

    const writePolicies = interventionPolicy.getWriteActionTypes().map((actionType) => {
      const base = interventionPolicy.classifyAction(actionType);
      return this.serializePolicy(actionType, this.mergePolicy(base, rulesByAction.get(actionType)));
    });
    return [
      ...writePolicies,
      this.mergeDecisionQueueSnoozePolicy(rulesByAction.get(DECISION_QUEUE_SNOOZE_ACTION)),
      this.mergeDecisionQueueRoutingPolicy(rulesByAction.get(DECISION_QUEUE_ROUTING_ACTION)),
      this.mergeScheduledInterventionCooldownPolicy(rulesByAction.get(SCHEDULED_INTERVENTION_COOLDOWN_ACTION))
    ];
  }

  async listPolicyHistory(options = {}) {
    this.requireDatabase();
    const workspaceId = this.resolveWorkspaceId(options.workspaceId);
    const limit = Math.min(Math.max(Number.parseInt(options.limit, 10) || 25, 1), 100);
    return AuditEvent.find({
      workspaceId,
      entityType: 'policy_rule',
      action: {
        $in: [
          'trello_action_policy_updated',
          'decision_queue_snooze_policy_updated',
          'decision_queue_routing_policy_updated',
          'scheduled_intervention_cooldown_policy_updated'
        ]
      }
    })
      .sort({ createdAt: -1 })
      .limit(limit);
  }

  async resolveEffectivePolicy(actionType, options = {}) {
    this.requireDatabase();
    const base = interventionPolicy.classifyAction(actionType, options);
    if (!interventionPolicy.getWriteActionTypes().includes(actionType)) {
      return this.mergePolicy(base, null);
    }

    const workspaceId = this.resolveWorkspaceId(options.workspaceId);
    const PolicyRule = getPolicyRuleModel();
    const rule = await PolicyRule.findOne({ workspaceId, actionType });
    return this.mergePolicy(base, rule);
  }

  async getDecisionQueueSnoozePolicy(options = {}) {
    this.requireDatabase();
    const workspaceId = this.resolveWorkspaceId(options.workspaceId);
    const PolicyRule = getPolicyRuleModel();
    const rule = await PolicyRule.findOne({ workspaceId, actionType: DECISION_QUEUE_SNOOZE_ACTION });
    return this.mergeDecisionQueueSnoozePolicy(rule);
  }

  async getDecisionQueueRoutingPolicy(options = {}) {
    this.requireDatabase();
    const workspaceId = this.resolveWorkspaceId(options.workspaceId);
    const PolicyRule = getPolicyRuleModel();
    const rule = await PolicyRule.findOne({ workspaceId, actionType: DECISION_QUEUE_ROUTING_ACTION });
    return this.mergeDecisionQueueRoutingPolicy(rule);
  }

  async getScheduledInterventionCooldownPolicy(options = {}) {
    this.requireDatabase();
    const workspaceId = this.resolveWorkspaceId(options.workspaceId);
    const PolicyRule = getPolicyRuleModel();
    const rule = await PolicyRule.findOne({ workspaceId, actionType: SCHEDULED_INTERVENTION_COOLDOWN_ACTION });
    return this.mergeScheduledInterventionCooldownPolicy(rule);
  }

  async updateActionPolicy(actionType, body = {}, options = {}) {
    this.requireDatabase();
    this.assertActionType(actionType);
    if (isDecisionQueueSnoozeAction(actionType)) {
      return this.updateDecisionQueueSnoozePolicy(body, options);
    }
    if (isDecisionQueueRoutingAction(actionType)) {
      return this.updateDecisionQueueRoutingPolicy(body, options);
    }
    if (isScheduledInterventionCooldownAction(actionType)) {
      return this.updateScheduledInterventionCooldownPolicy(body, options);
    }
    const workspaceId = this.resolveWorkspaceId(options.workspaceId);
    const base = interventionPolicy.classifyAction(actionType);
    const actor = options.actor || 'sneup-operator';
    const PolicyRule = getPolicyRuleModel();
    const existing = await PolicyRule.findOne({ workspaceId, actionType });
    const requestedRisk = body.riskLevel === undefined ? existing?.riskLevel || base.riskLevel : body.riskLevel;
    const requestedOwner = body.ownerType === undefined ? existing?.ownerType || base.ownerType : body.ownerType;
    const requestedEnabled = body.enabled === undefined ? existing?.enabled !== false : body.enabled;
    const requestedReason = body.reason === undefined ? existing?.reason || '' : clampText(body.reason);

    if (!RISK_LEVELS.includes(requestedRisk) || riskRank(requestedRisk) < riskRank(base.riskLevel)) {
      const error = new Error(`riskLevel cannot be lower than the ${base.riskLevel} baseline for ${actionLabel(actionType)}`);
      error.statusCode = 400;
      throw error;
    }
    if (!OWNER_TYPES.includes(requestedOwner)) {
      const error = new Error(`ownerType must be one of: ${OWNER_TYPES.join(', ')}`);
      error.statusCode = 400;
      throw error;
    }
    if (ownerRank(requestedOwner) < ownerRank(base.ownerType)) {
      const error = new Error(`ownerType cannot be less strict than the ${base.ownerType} baseline for ${actionLabel(actionType)}`);
      error.statusCode = 400;
      throw error;
    }
    if (body.requiresApproval === false) {
      const error = new Error('Trello action safety policies cannot bypass approval');
      error.statusCode = 400;
      throw error;
    }
    if (typeof requestedEnabled !== 'boolean') {
      const error = new Error('enabled must be true or false');
      error.statusCode = 400;
      throw error;
    }
    const pauseExpiryValue = body.pauseExpiresAt === undefined ? existing?.pauseExpiresAt : body.pauseExpiresAt;
    const requestedPauseExpiresAt = requestedEnabled ? null : toValidDate(pauseExpiryValue);
    if (!requestedEnabled && pauseExpiryValue && !requestedPauseExpiresAt) {
      const error = new Error('pauseExpiresAt must be a valid date and time');
      error.statusCode = 400;
      throw error;
    }
    if (requestedPauseExpiresAt && requestedPauseExpiresAt.getTime() <= Date.now()) {
      const error = new Error('pauseExpiresAt must be in the future; an expired pause remains blocked until reviewed');
      error.statusCode = 400;
      throw error;
    }

    const isRelaxingExistingPolicy = Boolean(existing) && (
      riskRank(requestedRisk) < riskRank(existing.riskLevel)
      || ownerRank(requestedOwner) < ownerRank(existing.ownerType)
      || (existing.enabled === false && requestedEnabled === true)
    );
    if (isRelaxingExistingPolicy && body.confirmRelaxation !== true) {
      const error = new Error('Re-enabling or relaxing a Trello action safety policy requires explicit confirmation');
      error.statusCode = 400;
      throw error;
    }

    const beforePolicy = this.serializePolicy(actionType, this.mergePolicy(base, existing));

    const rule = await PolicyRule.findOneAndUpdate(
      { workspaceId, actionType },
      {
        $set: {
          name: `${actionLabel(actionType)} safety policy`,
          riskLevel: requestedRisk,
          requiresApproval: true,
          ownerType: requestedOwner,
          enabled: requestedEnabled,
          pauseExpiresAt: requestedPauseExpiresAt,
          reason: requestedReason || undefined,
          updatedBy: actor,
          conditions: {
            ...(existing?.conditions || {}),
            lastRelaxationConfirmedAt: isRelaxingExistingPolicy ? new Date() : existing?.conditions?.lastRelaxationConfirmedAt || null
          }
        },
        $setOnInsert: { workspaceId, actionType }
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    const effectivePolicy = this.mergePolicy(base, rule);
    try {
      await AuditEvent.create({
        workspaceId,
        entityType: 'policy_rule',
        entityId: rule._id,
        action: 'trello_action_policy_updated',
        actor,
        source: 'api',
        riskLevel: effectivePolicy.riskLevel,
        beforeState: beforePolicy,
        afterState: {
          ...this.serializePolicy(actionType, effectivePolicy),
          relaxationConfirmed: isRelaxingExistingPolicy
        }
      });
    } catch (error) {
      logger.error('Action policy audit write failed:', error);
    }

    return this.serializePolicy(actionType, effectivePolicy);
  }

  async updateDecisionQueueRoutingPolicy(body = {}, options = {}) {
    this.requireDatabase();
    const workspaceId = this.resolveWorkspaceId(options.workspaceId);
    const actor = options.actor || 'sneup-operator';
    const PolicyRule = getPolicyRuleModel();
    const existing = await PolicyRule.findOne({ workspaceId, actionType: DECISION_QUEUE_ROUTING_ACTION });
    const beforePolicy = this.mergeDecisionQueueRoutingPolicy(existing);
    const suppliedRouting = body.routingByRisk;
    if (suppliedRouting !== undefined && (!suppliedRouting || typeof suppliedRouting !== 'object' || Array.isArray(suppliedRouting))) {
      const error = new Error('routingByRisk must be an object keyed by risk level');
      error.statusCode = 400;
      throw error;
    }

    const routingByRisk = {};
    for (const riskLevel of RISK_LEVELS) {
      const previous = beforePolicy.routingByRisk[riskLevel];
      const requested = suppliedRouting?.[riskLevel] || {};
      const ownerType = requested.ownerType === undefined ? previous.ownerType : requested.ownerType;
      const escalationHours = requested.escalationHours === undefined
        ? previous.escalationHours
        : parseSnoozeHours(requested.escalationHours);

      if (!['va', 'team', 'robert'].includes(ownerType)) {
        const error = new Error(`${riskLevel} ownerType must be va, team, or robert`);
        error.statusCode = 400;
        throw error;
      }
      if ((riskLevel === 'high' || riskLevel === 'critical') && ownerType !== 'robert') {
        const error = new Error(`${riskLevel} decision queue items must remain Robert-owned`);
        error.statusCode = 400;
        throw error;
      }
      if (!escalationHours) {
        const error = new Error(`${riskLevel} escalationHours must be a whole number between ${MIN_SNOOZE_HOURS} and ${MAX_SNOOZE_HOURS}`);
        error.statusCode = 400;
        throw error;
      }
      routingByRisk[riskLevel] = { ownerType, escalationHours };
    }

    const rule = await PolicyRule.findOneAndUpdate(
      { workspaceId, actionType: DECISION_QUEUE_ROUTING_ACTION },
      {
        $set: {
          name: 'Decision queue routing workflow policy',
          riskLevel: 'low',
          requiresApproval: false,
          ownerType: 'robert',
          enabled: true,
          pauseExpiresAt: null,
          reason: body.reason === undefined ? existing?.reason || '' : clampText(body.reason),
          updatedBy: actor,
          conditions: {
            ...(existing?.conditions || {}),
            routingByRisk
          }
        },
        $setOnInsert: { workspaceId, actionType: DECISION_QUEUE_ROUTING_ACTION }
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    const policy = this.mergeDecisionQueueRoutingPolicy(rule);
    try {
      await AuditEvent.create({
        workspaceId,
        entityType: 'policy_rule',
        entityId: rule._id,
        action: 'decision_queue_routing_policy_updated',
        actor,
        source: 'api',
        riskLevel: 'low',
        beforeState: beforePolicy,
        afterState: policy
      });
    } catch (error) {
      logger.error('Decision queue routing policy audit write failed:', error);
    }

    return policy;
  }

  async updateScheduledInterventionCooldownPolicy(body = {}, options = {}) {
    this.requireDatabase();
    const workspaceId = this.resolveWorkspaceId(options.workspaceId);
    const actor = options.actor || 'sneup-operator';
    const PolicyRule = getPolicyRuleModel();
    const existing = await PolicyRule.findOne({ workspaceId, actionType: SCHEDULED_INTERVENTION_COOLDOWN_ACTION });
    const beforePolicy = this.mergeScheduledInterventionCooldownPolicy(existing);
    const suppliedCooldowns = body.cooldownHoursByTrigger;
    if (suppliedCooldowns !== undefined && (!suppliedCooldowns || typeof suppliedCooldowns !== 'object' || Array.isArray(suppliedCooldowns))) {
      const error = new Error('cooldownHoursByTrigger must be an object keyed by scheduled intervention trigger');
      error.statusCode = 400;
      throw error;
    }

    const cooldownHoursByTrigger = {};
    for (const trigger of SCHEDULED_INTERVENTION_TRIGGERS) {
      const previous = beforePolicy.cooldownHoursByTrigger[trigger];
      const requestedHours = suppliedCooldowns?.[trigger] === undefined
        ? previous
        : parseScheduledCooldownHours(suppliedCooldowns[trigger]);
      if (!requestedHours) {
        const error = new Error(`${trigger} cooldown must be a whole number between ${DEFAULT_INTERVENTION_COOLDOWN_HOURS} and ${MAX_SNOOZE_HOURS} hours`);
        error.statusCode = 400;
        throw error;
      }
      cooldownHoursByTrigger[trigger] = requestedHours;
    }

    const rule = await PolicyRule.findOneAndUpdate(
      { workspaceId, actionType: SCHEDULED_INTERVENTION_COOLDOWN_ACTION },
      {
        $set: {
          name: 'Scheduled intervention cooldown workflow policy',
          riskLevel: 'low',
          requiresApproval: false,
          ownerType: 'robert',
          enabled: true,
          pauseExpiresAt: null,
          reason: body.reason === undefined ? existing?.reason || '' : clampText(body.reason),
          updatedBy: actor,
          conditions: {
            ...(existing?.conditions || {}),
            cooldownHoursByTrigger
          }
        },
        $setOnInsert: { workspaceId, actionType: SCHEDULED_INTERVENTION_COOLDOWN_ACTION }
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    const policy = this.mergeScheduledInterventionCooldownPolicy(rule);
    try {
      await AuditEvent.create({
        workspaceId,
        entityType: 'policy_rule',
        entityId: rule._id,
        action: 'scheduled_intervention_cooldown_policy_updated',
        actor,
        source: 'api',
        riskLevel: 'low',
        beforeState: beforePolicy,
        afterState: policy
      });
    } catch (error) {
      logger.error('Scheduled intervention cooldown policy audit write failed:', error);
    }

    return policy;
  }

  async updateDecisionQueueSnoozePolicy(body = {}, options = {}) {
    this.requireDatabase();
    const workspaceId = this.resolveWorkspaceId(options.workspaceId);
    const actor = options.actor || 'sneup-operator';
    const PolicyRule = getPolicyRuleModel();
    const existing = await PolicyRule.findOne({ workspaceId, actionType: DECISION_QUEUE_SNOOZE_ACTION });
    const requestedHours = body.defaultSnoozeHours === undefined
      ? parseSnoozeHours(existing?.conditions?.defaultSnoozeHours) || DEFAULT_SNOOZE_HOURS
      : parseSnoozeHours(body.defaultSnoozeHours);
    if (!requestedHours) {
      const error = new Error(`defaultSnoozeHours must be a whole number between ${MIN_SNOOZE_HOURS} and ${MAX_SNOOZE_HOURS}`);
      error.statusCode = 400;
      throw error;
    }

    const beforePolicy = this.mergeDecisionQueueSnoozePolicy(existing);
    const rule = await PolicyRule.findOneAndUpdate(
      { workspaceId, actionType: DECISION_QUEUE_SNOOZE_ACTION },
      {
        $set: {
          name: 'Decision queue snooze workflow policy',
          riskLevel: 'low',
          requiresApproval: false,
          ownerType: 'robert',
          enabled: true,
          pauseExpiresAt: null,
          reason: body.reason === undefined ? existing?.reason || '' : clampText(body.reason),
          updatedBy: actor,
          conditions: {
            ...(existing?.conditions || {}),
            defaultSnoozeHours: requestedHours
          }
        },
        $setOnInsert: { workspaceId, actionType: DECISION_QUEUE_SNOOZE_ACTION }
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    const policy = this.mergeDecisionQueueSnoozePolicy(rule);
    try {
      await AuditEvent.create({
        workspaceId,
        entityType: 'policy_rule',
        entityId: rule._id,
        action: 'decision_queue_snooze_policy_updated',
        actor,
        source: 'api',
        riskLevel: 'low',
        beforeState: beforePolicy,
        afterState: policy
      });
    } catch (error) {
      logger.error('Decision queue snooze policy audit write failed:', error);
    }

    return policy;
  }
}

module.exports = new PolicyRuleService();
module.exports.PolicyRuleService = PolicyRuleService;
module.exports.RISK_LEVELS = RISK_LEVELS;
module.exports.OWNER_TYPES = OWNER_TYPES;
module.exports.OWNER_STRICTNESS = OWNER_STRICTNESS;
module.exports.DECISION_QUEUE_SNOOZE_ACTION = DECISION_QUEUE_SNOOZE_ACTION;
module.exports.DECISION_QUEUE_ROUTING_ACTION = DECISION_QUEUE_ROUTING_ACTION;
module.exports.SCHEDULED_INTERVENTION_COOLDOWN_ACTION = SCHEDULED_INTERVENTION_COOLDOWN_ACTION;
module.exports.DEFAULT_SNOOZE_HOURS = DEFAULT_SNOOZE_HOURS;
module.exports.MIN_SNOOZE_HOURS = MIN_SNOOZE_HOURS;
module.exports.MAX_SNOOZE_HOURS = MAX_SNOOZE_HOURS;
module.exports.DEFAULT_QUEUE_ROUTING = DEFAULT_QUEUE_ROUTING;
module.exports.DEFAULT_INTERVENTION_COOLDOWN_HOURS = DEFAULT_INTERVENTION_COOLDOWN_HOURS;
module.exports.SCHEDULED_INTERVENTION_TRIGGERS = SCHEDULED_INTERVENTION_TRIGGERS;
