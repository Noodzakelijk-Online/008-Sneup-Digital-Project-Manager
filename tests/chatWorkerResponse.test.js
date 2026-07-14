const mongoose = require('mongoose');
const Recommendation = require('../src/models/Recommendation');
const Intervention = require('../src/models/Intervention');
const { OperationsLedgerService } = require('../src/services/operationsLedgerService');

describe('chat worker-response ledger bridge', () => {
  afterEach(() => jest.restoreAllMocks());

  const createService = () => {
    const service = new OperationsLedgerService();
    service.isDatabaseReady = () => true;
    service.resolveWorkspaceId = value => value;
    service.recordWorkerResponse = jest.fn().mockResolvedValue({ _id: new mongoose.Types.ObjectId(), responseType: 'completed' });
    return service;
  };

  test('records a card chat update only against the newest unanswered executed communication', async () => {
    const workspaceId = new mongoose.Types.ObjectId();
    const memberId = new mongoose.Types.ObjectId();
    const cardId = new mongoose.Types.ObjectId();
    const intervention = {
      _id: new mongoose.Types.ObjectId(),
      workspaceId,
      memberId,
      cardId,
      boardId: new mongoose.Types.ObjectId()
    };
    const recommendation = { _id: new mongoose.Types.ObjectId() };
    const interventionQuery = { sort: jest.fn().mockResolvedValue(intervention) };
    const recommendationQuery = { sort: jest.fn().mockResolvedValue(recommendation) };
    jest.spyOn(Intervention, 'findOne').mockReturnValue(interventionQuery);
    jest.spyOn(Recommendation, 'findOne').mockReturnValue(recommendationQuery);
    const service = createService();

    const result = await service.recordChatWorkerResponse({
      workspaceId,
      memberId,
      cardId,
      responseType: 'completed',
      responseText: 'Completed and ready for review.',
      source: 'web_chat'
    });

    expect(Intervention.findOne).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId,
      memberId,
      cardId,
      type: { $in: ['comment', 'follow_up', 'escalate'] },
      status: 'executed',
      'response.respondedAt': { $exists: false }
    }));
    expect(service.recordWorkerResponse).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId,
      recommendationId: recommendation._id,
      interventionId: intervention._id,
      cardId,
      memberId,
      responseType: 'completed',
      source: 'web_chat'
    }));
    expect(result).toMatchObject({ recorded: true, interventionId: intervention._id, recommendationId: recommendation._id });
  });

  test('leaves generic or already-answered chat updates unlinked', async () => {
    const service = createService();
    const workspaceId = new mongoose.Types.ObjectId();
    const memberId = new mongoose.Types.ObjectId();
    const cardId = new mongoose.Types.ObjectId();
    const interventionQuery = { sort: jest.fn().mockResolvedValue(null) };
    jest.spyOn(Intervention, 'findOne').mockReturnValue(interventionQuery);

    await expect(service.recordChatWorkerResponse({
      workspaceId,
      memberId,
      cardId,
      responseType: 'completed',
      responseText: 'Done'
    })).resolves.toEqual({ recorded: false, reason: 'no_matching_executed_intervention' });
    await expect(service.recordChatWorkerResponse({
      workspaceId,
      memberId,
      responseType: 'completed',
      responseText: 'Done'
    })).resolves.toEqual({ recorded: false, reason: 'missing_exact_chat_response_context' });
    expect(service.recordWorkerResponse).not.toHaveBeenCalled();
  });
});

describe('conversational worker-response routing', () => {
  afterEach(() => {
    jest.dontMock('../src/services/operationsLedgerService');
    jest.dontMock('../src/services/teamManager');
    jest.dontMock('../src/utils/logger');
    jest.resetModules();
  });

  test('maps a card-specific completed update into the bounded ledger bridge', async () => {
    jest.resetModules();
    const recordChatWorkerResponse = jest.fn().mockResolvedValue({ recorded: true, response: { _id: 'response-1' } });
    jest.doMock('../src/services/operationsLedgerService', () => ({ recordChatWorkerResponse }));
    jest.doMock('../src/services/teamManager', () => ({ analyzeTeamWorkload: jest.fn() }));
    jest.doMock('../src/utils/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

    const conversationalAI = require('../src/services/conversationalAI');
    const ai = new conversationalAI.ConversationalAI();
    const workspaceId = new mongoose.Types.ObjectId().toString();
    const member = { _id: 'member-1', workspaceId, boards: [] };

    await expect(ai.executeActions('provide_update', member, 'Completed and ready for review.', 'card-1', {
      workspaceId,
      channel: 'web_chat'
    })).resolves.toMatchObject({ workerResponse: { recorded: true } });

    const [body] = recordChatWorkerResponse.mock.calls[0];
    expect(String(body.workspaceId)).toBe(workspaceId);
    expect(body).toEqual(expect.objectContaining({
      memberId: 'member-1',
      cardId: 'card-1',
      responseText: 'Completed and ready for review.',
      responseType: 'completed',
      source: 'web_chat',
      actor: 'worker:member-1'
    }));
  });
});
