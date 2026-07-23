jest.mock('../src/models/Member', () => ({
  find: jest.fn(),
  findOne: jest.fn()
}));
jest.mock('../src/models/Card', () => ({ find: jest.fn() }));
jest.mock('../src/models/Intervention', () => ({ find: jest.fn() }));
jest.mock('../src/models/Comment', () => ({ find: jest.fn() }));
jest.mock('../src/utils/logger', () => ({ info: jest.fn(), error: jest.fn() }));
jest.mock('../src/services/workspaceScopeService', () => ({
  getDefaultWorkspaceObjectId: () => 'default-workspace',
  normalizeWorkspaceObjectId: value => value
}));
jest.mock('../src/models/Performance', () => {
  const records = [];

  class Performance {
    constructor(values) {
      Object.assign(this, values);
      this._id = `performance-${records.length + 1}`;
      this.comparison = { teamAverage: {} };
      this.calculated = { performanceScore: '0' };
      this.save = jest.fn(async () => this);
      records.push(this);
    }

    calculate() {
      this.calculated.performanceScore = String(this.metrics.cardsCompleted * 10);
      return this;
    }

    checkAndAddFlags() {
      return this;
    }
  }

  Performance.findOne = jest.fn();
  Performance.find = jest.fn(() => ({
    sort: jest.fn(() => [...records].sort((left, right) =>
      Number(right.calculated.performanceScore) - Number(left.calculated.performanceScore)))
  }));
  Performance.__records = records;
  return Performance;
});

const Member = require('../src/models/Member');
const Card = require('../src/models/Card');
const Intervention = require('../src/models/Intervention');
const Comment = require('../src/models/Comment');
const Performance = require('../src/models/Performance');
const { PerformanceTracker } = require('../src/services/performanceTracker');

describe('PerformanceTracker board batching', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Performance.__records.splice(0, Performance.__records.length);
    Performance.findOne.mockResolvedValue(null);
  });

  test('reads one board-scoped snapshot and uses it for every member performance record', async () => {
    const now = new Date();
    const earlier = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    const boardId = 'board-1';
    const workspaceId = 'workspace-1';
    const members = [
      { _id: 'member-1', username: 'Ava' },
      { _id: 'member-2', username: 'Ben' }
    ];
    Member.find.mockResolvedValue(members);
    Card.find.mockResolvedValue([
      { _id: 'card-open', members: ['member-1'], closed: false, due: earlier, dueComplete: false, createdAt: earlier, isOverdue: () => true },
      { _id: 'card-shared', members: ['member-1', 'member-2'], closed: true, closedAt: now, due: new Date(now.getTime() + 24 * 60 * 60 * 1000), createdAt: earlier }
    ]);
    Intervention.find.mockResolvedValue([
      { memberId: 'member-1', type: 'comment', createdAt: earlier, response: { respondedAt: now }, escalation: { escalated: false } },
      { memberId: 'member-1', type: 'add_label', createdAt: earlier, response: { respondedAt: now }, escalation: { escalated: false } },
      { memberId: 'member-2', type: 'follow_up', createdAt: earlier, escalation: { escalated: true } }
    ]);
    Comment.find.mockResolvedValue([{ memberId: 'member-1' }]);

    const tracker = new PerformanceTracker();
    const performances = await tracker.calculateBoardPerformance(boardId, 'daily', { workspaceId });

    expect(performances).toHaveLength(2);
    expect(Member.find).toHaveBeenCalledTimes(1);
    expect(Member.findOne).not.toHaveBeenCalled();
    expect(Card.find).toHaveBeenCalledTimes(1);
    expect(Card.find).toHaveBeenCalledWith(expect.objectContaining({
      boardId,
      workspaceId,
      members: { $in: ['member-1', 'member-2'] }
    }));
    expect(Intervention.find).toHaveBeenCalledTimes(1);
    expect(Intervention.find).toHaveBeenCalledWith(expect.objectContaining({
      boardId,
      workspaceId,
      memberId: { $in: ['member-1', 'member-2'] }
    }));
    expect(Comment.find).toHaveBeenCalledTimes(1);
    expect(Performance.findOne).toHaveBeenCalledTimes(2);
    expect(Performance.find).toHaveBeenCalledTimes(1);

    expect(performances[0].metrics).toMatchObject({
      cardsAssigned: 1,
      cardsCompleted: 1,
      cardsOverdue: 1,
      interventionsReceived: 2,
      commentsPosted: 1,
      averageResponseTime: 48
    });
    expect(performances[0].comparison.teamAverage.cardsCompleted).toBe(1);
    expect(performances[1].metrics).toMatchObject({
      cardsAssigned: 0,
      cardsCompleted: 1,
      interventionsReceived: 1,
      interventionsResponded: 0,
      escalationsReceived: 1,
      averageResponseTime: 0
    });
    expect(performances.map(performance => performance.comparison.rank)).toEqual([1, 2]);
  });

  test('does not query cards, interventions, comments, or rankings for a board without members', async () => {
    Member.find.mockResolvedValue([]);

    const tracker = new PerformanceTracker();
    await expect(tracker.calculateBoardPerformance('board-empty', 'daily', { workspaceId: 'workspace-1' })).resolves.toEqual([]);

    expect(Card.find).not.toHaveBeenCalled();
    expect(Intervention.find).not.toHaveBeenCalled();
    expect(Comment.find).not.toHaveBeenCalled();
    expect(Performance.find).not.toHaveBeenCalled();
  });
});
