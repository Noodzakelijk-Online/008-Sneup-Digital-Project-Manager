const mongoose = require('mongoose');
const AuditEvent = require('../models/AuditEvent');
const interventionPolicy = require('./interventionPolicy');
const { normalizeWorkspaceObjectId } = require('./workspaceScopeService');
const logger = require('../utils/logger');

const RISK_LEVELS = ['low', 'medium', 'high', 'critical'];
const OWNER_TYPES = ['robert', 'va', 'team', 'system'];
const OWNER_STRICTNESS = Object.freeze({ system: 0, va: 1, team: 1, robert: 2 });
const MAX_REASON_LENGTH = 500;

const clampText = (value, maximum = MAX_REASON_LENGTH) => String(value || '').trim().slice(0, maximum);
const riskRank = (riskLevel) => RISK_LEVELS.indexOf(riskLevel);
const ownerRank = (ownerType) => OWNER_STRICTNESS[ownerType] ?? -1;
const actionLabel = (actionType) => String(actionType || '').replaceAll('_', ' ');
const getPolicyRuleModel = () => require('../models/PolicyRule');
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
    if (!interventionPolicy.getWriteActionTypes().includes(actionType)) {
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

  async listEffectivePolicies(options = {}) {
    this.requireDatabase();
    const workspaceId = this.resolveWorkspaceId(options.workspaceId);
    const PolicyRule = getPolicyRuleModel();
    const rules = await PolicyRule.find({ workspaceId }).sort({ actionType: 1 });
    const rulesByAction = new Map(rules.map(rule => [rule.actionType, rule]));

    return interventionPolicy.getWriteActionTypes().map((actionType) => {
      const base = interventionPolicy.classifyAction(actionType);
      return this.serializePolicy(actionType, this.mergePolicy(base, rulesByAction.get(actionType)));
    });
  }

  async listPolicyHistory(options = {}) {
    this.requireDatabase();
    const workspaceId = this.resolveWorkspaceId(options.workspaceId);
    const limit = Math.min(Math.max(Number.parseInt(options.limit, 10) || 25, 1), 100);
    return AuditEvent.find({
      workspaceId,
      entityType: 'policy_rule',
      action: 'trello_action_policy_updated'
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

  async updateActionPolicy(actionType, body = {}, options = {}) {
    this.requireDatabase();
    this.assertActionType(actionType);
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
}

module.exports = new PolicyRuleService();
module.exports.PolicyRuleService = PolicyRuleService;
module.exports.RISK_LEVELS = RISK_LEVELS;
module.exports.OWNER_TYPES = OWNER_TYPES;
module.exports.OWNER_STRICTNESS = OWNER_STRICTNESS;
