const buildResponse = () => {
  const response = {
    status: jest.fn(),
    json: jest.fn()
  };
  response.status.mockReturnValue(response);
  return response;
};

const loadRecordResponseHandler = ({ intervention, recommendation } = {}) => {
  jest.resetModules();
  const router = { param: jest.fn(), post: jest.fn() };
  const findIntervention = jest.fn().mockResolvedValue(intervention);
  const sortRecommendation = jest.fn().mockResolvedValue(recommendation);
  const findRecommendation = jest.fn().mockReturnValue({ sort: sortRecommendation });
  const recordWorkerResponse = jest.fn().mockResolvedValue({ _id: 'response-1', responseType: 'completed' });

  jest.doMock('express', () => ({ Router: jest.fn(() => router) }));
  jest.doMock('../src/models/Intervention', () => ({ findOne: findIntervention }));
  jest.doMock('../src/models/Recommendation', () => ({ findOne: findRecommendation }));
  jest.doMock('../src/services/operationsLedgerService', () => ({ recordWorkerResponse }));
  jest.doMock('../src/services/workspaceScopeService', () => ({ getRequestWorkspaceObjectId: jest.fn(() => 'workspace-1') }));
  jest.doMock('../src/utils/requestSecurity', () => ({
    requirePermission: jest.fn(() => jest.fn()),
    validateObjectIdParam: jest.fn(() => jest.fn())
  }));

  require('../src/routes/interventions');
  const call = router.post.mock.calls.find(([path]) => path === '/:interventionId/record-response');
  return {
    handler: call[2],
    findIntervention,
    findRecommendation,
    recordWorkerResponse
  };
};

describe('intervention worker-response route', () => {
  afterEach(() => {
    jest.dontMock('express');
    jest.dontMock('../src/models/Intervention');
    jest.dontMock('../src/models/Recommendation');
    jest.dontMock('../src/services/operationsLedgerService');
    jest.dontMock('../src/services/workspaceScopeService');
    jest.dontMock('../src/utils/requestSecurity');
    jest.resetModules();
  });

  test('rejects response evidence before a communication intervention has executed', async () => {
    const { handler, findRecommendation, recordWorkerResponse } = loadRecordResponseHandler({
      intervention: { _id: 'intervention-1', status: 'awaiting_approval', type: 'comment', memberId: 'member-1' }
    });
    const response = buildResponse();

    await handler({ params: { interventionId: 'intervention-1' }, body: {}, auth: { actorId: 'operator-1' } }, response);

    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      error: 'A worker response can only be recorded after the intervention is executed'
    }));
    expect(findRecommendation).not.toHaveBeenCalled();
    expect(recordWorkerResponse).not.toHaveBeenCalled();
  });

  test('derives worker response links from the executed intervention instead of request references', async () => {
    const { handler, findRecommendation, recordWorkerResponse } = loadRecordResponseHandler({
      intervention: {
        _id: 'intervention-1',
        workspaceId: 'workspace-1',
        status: 'executed',
        type: 'follow_up',
        boardId: 'board-canonical',
        cardId: 'card-canonical',
        memberId: 'member-canonical',
        response: {}
      },
      recommendation: { _id: 'recommendation-canonical' }
    });
    const response = buildResponse();

    await handler({
      params: { interventionId: 'intervention-1' },
      body: {
        boardId: 'board-forged',
        cardId: 'card-forged',
        memberId: 'member-forged',
        recommendationId: 'recommendation-forged',
        responseType: 'completed',
        source: 'manual'
      },
      auth: { actorId: 'operator-1' }
    }, response);

    expect(findRecommendation).toHaveBeenCalledWith({
      interventionId: 'intervention-1',
      workspaceId: 'workspace-1'
    });
    expect(recordWorkerResponse).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'workspace-1',
      interventionId: 'intervention-1',
      recommendationId: 'recommendation-canonical',
      boardId: 'board-canonical',
      cardId: 'card-canonical',
      memberId: 'member-canonical',
      actor: 'operator-1'
    }));
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});
