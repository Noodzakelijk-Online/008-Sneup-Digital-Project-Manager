const Board = require('../src/models/Board');
const trelloClient = require('../src/services/trelloClient');
const {
  getBoardSyncConcurrency,
  runSerialized,
  syncAllBoards,
  syncBoard,
  syncRecentActivity
} = require('../src/services/trelloSync');

const workspaceId = '507f1f77bcf86cd799439011';

const waitFor = async (predicate) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  throw new Error('Timed out waiting for Trello board sync workers');
};

const gateWorker = () => {
  const starts = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  return {
    starts,
    release,
    sync: async (board) => {
      starts.push(typeof board === 'string' ? board : board.trelloId);
      await gate;
    }
  };
};

describe('Trello board sync concurrency', () => {
  afterEach(() => jest.restoreAllMocks());

  test('clamps configured Trello board sync concurrency to a safe range', () => {
    expect(getBoardSyncConcurrency('0')).toBe(1);
    expect(getBoardSyncConcurrency('99')).toBe(4);
    expect(getBoardSyncConcurrency('invalid')).toBe(2);
  });

  test('serializes writes for the same shared record and releases its queue afterward', async () => {
    const queues = new Map();
    const starts = [];
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const first = runSerialized(queues, 'workspace-1:member-1', async () => {
      starts.push('first');
      await gate;
    });
    const second = runSerialized(queues, 'workspace-1:member-1', async () => {
      starts.push('second');
    });

    await waitFor(() => starts.length === 1);
    expect(starts).toEqual(['first']);
    release();
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
    expect(starts).toEqual(['first', 'second']);
    expect(queues.size).toBe(0);
  });

  test('serializes duplicate sync requests for the same board', async () => {
    const worker = gateWorker();
    const first = syncBoard('board-1', { workspaceId, syncBoardNow: worker.sync });
    const second = syncBoard('board-1', { workspaceId, syncBoardNow: worker.sync });

    await waitFor(() => worker.starts.length === 1);
    expect(worker.starts).toEqual(['board-1']);
    worker.release();
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
    expect(worker.starts).toEqual(['board-1', 'board-1']);
  });

  test('runs full board syncs through a bounded pool and retains per-board results', async () => {
    jest.spyOn(trelloClient.boardApi, 'getBoards').mockResolvedValue([
      { id: 'board-1' },
      { id: 'board-2' },
      { id: 'board-3' }
    ]);
    const worker = gateWorker();

    const sync = syncAllBoards({ workspaceId, concurrency: 2, syncBoard: worker.sync });
    await waitFor(() => worker.starts.length === 2);
    expect(worker.starts).toEqual(['board-1', 'board-2']);

    worker.release();
    await expect(sync).resolves.toMatchObject({
      processedCount: 3,
      successCount: 3,
      failureCount: 0,
      metadata: {
        trelloBoardCount: 3,
        boardSyncConcurrency: 2,
        workspaceId
      }
    });
    expect(worker.starts).toEqual(['board-1', 'board-2', 'board-3']);
  });

  test('uses the same bounded pool for incremental board refreshes', async () => {
    jest.spyOn(Board, 'find').mockResolvedValue([
      { trelloId: 'board-1', name: 'First' },
      { trelloId: 'board-2', name: 'Second' },
      { trelloId: 'board-3', name: 'Third' }
    ]);
    const worker = gateWorker();

    const sync = syncRecentActivity({ workspaceId, concurrency: 2, syncCards: worker.sync });
    await waitFor(() => worker.starts.length === 2);
    expect(worker.starts).toEqual(['board-1', 'board-2']);

    worker.release();
    await expect(sync).resolves.toMatchObject({
      processedCount: 3,
      successCount: 3,
      failureCount: 0,
      metadata: {
        trelloBoardCount: 3,
        boardSyncConcurrency: 2,
        workspaceId
      }
    });
    expect(worker.starts).toEqual(['board-1', 'board-2', 'board-3']);
  });
});
