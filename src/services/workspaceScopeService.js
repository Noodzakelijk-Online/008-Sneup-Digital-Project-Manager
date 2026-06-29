const crypto = require('crypto');
const mongoose = require('mongoose');
const Workspace = require('../models/Workspace');
const Board = require('../models/Board');
const Card = require('../models/Card');
const List = require('../models/List');
const Member = require('../models/Member');
const Comment = require('../models/Comment');
const Analytics = require('../models/Analytics');
const Intervention = require('../models/Intervention');
const Learning = require('../models/Learning');
const Performance = require('../models/Performance');
const Conversation = require('../models/Conversation');
const ConnectorAccount = require('../models/ConnectorAccount');
const Recommendation = require('../models/Recommendation');
const Approval = require('../models/Approval');
const DecisionQueueItem = require('../models/DecisionQueueItem');
const TrelloActionAttempt = require('../models/TrelloActionAttempt');
const AuditEvent = require('../models/AuditEvent');
const FollowUpPlan = require('../models/FollowUpPlan');
const WorkerResponse = require('../models/WorkerResponse');
const CardFinding = require('../models/CardFinding');
const BoardHealthSnapshot = require('../models/BoardHealthSnapshot');

const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;

const getDefaultWorkspaceKey = () => Workspace.defaultWorkspaceKey();
const getDefaultWorkspaceName = () => Workspace.defaultWorkspaceName();

const slugifyWorkspaceKey = (value) => {
  const slug = String(value || 'default')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'default';
};

const objectIdFromWorkspaceKey = (value) => {
  const key = String(value || getDefaultWorkspaceKey());
  if (OBJECT_ID_PATTERN.test(key)) {
    return new mongoose.Types.ObjectId(key);
  }

  const hex = crypto.createHash('sha1').update(key).digest('hex').slice(0, 24);
  return new mongoose.Types.ObjectId(hex);
};

const normalizeWorkspaceObjectId = (value) => objectIdFromWorkspaceKey(value || getDefaultWorkspaceKey());

const getDefaultWorkspaceObjectId = () => objectIdFromWorkspaceKey(getDefaultWorkspaceKey());

const getRequestWorkspaceObjectId = (req) => normalizeWorkspaceObjectId(req?.auth?.workspaceId);

const scopeQuery = (req, query = {}) => ({
  ...query,
  workspaceId: getRequestWorkspaceObjectId(req)
});

const defaultWorkspaceQuery = (query = {}) => ({
  ...query,
  workspaceId: getDefaultWorkspaceObjectId()
});

const ensureDefaultWorkspace = async () => {
  const workspaceId = getDefaultWorkspaceObjectId();
  const key = getDefaultWorkspaceKey();
  return Workspace.findByIdAndUpdate(
    workspaceId,
    {
      $setOnInsert: {
        _id: workspaceId,
        name: getDefaultWorkspaceName(),
        slug: slugifyWorkspaceKey(key),
        status: 'active',
        plan: 'local',
        metadata: {
          source: 'default-workspace-bootstrap',
          workspaceKey: key
        }
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

const backfillModelWorkspace = async (Model, workspaceId) => {
  const result = await Model.updateMany(
    {
      $or: [
        { workspaceId: { $exists: false } },
        { workspaceId: null }
      ]
    },
    { $set: { workspaceId } }
  );

  return result.modifiedCount || result.nModified || 0;
};

const backfillDefaultWorkspace = async () => {
  const workspaceId = getDefaultWorkspaceObjectId();
  await ensureDefaultWorkspace();

  const results = await Promise.all([
    ['boards', Board],
    ['cards', Card],
    ['lists', List],
    ['members', Member],
    ['comments', Comment],
    ['analytics', Analytics],
    ['interventions', Intervention],
    ['learning', Learning],
    ['performance', Performance],
    ['conversations', Conversation],
    ['connectorAccounts', ConnectorAccount],
    ['recommendations', Recommendation],
    ['approvals', Approval],
    ['decisionQueueItems', DecisionQueueItem],
    ['trelloActionAttempts', TrelloActionAttempt],
    ['auditEvents', AuditEvent],
    ['followUpPlans', FollowUpPlan],
    ['workerResponses', WorkerResponse],
    ['cardFindings', CardFinding],
    ['boardHealthSnapshots', BoardHealthSnapshot]
  ].map(async ([key, Model]) => [key, await backfillModelWorkspace(Model, workspaceId)]));

  const counts = Object.fromEntries(results);
  const totalModified = Object.values(counts).reduce((total, count) => total + count, 0);

  return {
    workspaceId: String(workspaceId),
    ...counts,
    totalModified
  };
};

module.exports = {
  backfillDefaultWorkspace,
  defaultWorkspaceQuery,
  ensureDefaultWorkspace,
  getDefaultWorkspaceKey,
  getDefaultWorkspaceName,
  getDefaultWorkspaceObjectId,
  getRequestWorkspaceObjectId,
  normalizeWorkspaceObjectId,
  objectIdFromWorkspaceKey,
  scopeQuery,
  slugifyWorkspaceKey
};
