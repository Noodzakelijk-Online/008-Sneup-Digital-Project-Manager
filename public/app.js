const state = {
  snapshot: null,
  operationsBrief: null,
  jobDashboard: null,
  connectors: [],
  categories: [],
  accounts: [],
  workSignals: [],
  workGraph: null,
  workGraphCandidates: [],
  workSignalContracts: [],
  workSignalError: '',
  securityContext: null,
  currentWorkspace: null,
  workspaces: [],
  workspaceUsers: [],
  activeWorkspaceId: localStorage.getItem('sneup.workspaceId') || '',
  enhancements: [],
  enhancementSummary: {},
  enhancementPriority: 'all',
  enhancementArea: 'all',
  enhancementStatus: 'all',
  ledger: {
    decisions: [],
    recommendations: [],
    actions: [],
    auditEvents: [],
    followUps: [],
    findings: [],
    healthSnapshots: [],
    errors: []
  },
  category: 'all',
  search: '',
  queueFilter: 'all',
  signalFilter: 'all'
};

const els = {
  timestamp: document.getElementById('timestamp'),
  metrics: document.getElementById('metrics'),
  brief: document.getElementById('brief'),
  operationsBriefItems: document.getElementById('operationsBriefItems'),
  operationsBriefCount: document.getElementById('operationsBriefCount'),
  jobHealthList: document.getElementById('jobHealthList'),
  jobHealthCount: document.getElementById('jobHealthCount'),
  commandQueue: document.getElementById('commandQueue'),
  commandMode: document.getElementById('commandMode'),
  automationCount: document.getElementById('automationCount'),
  dailyPlan: document.getElementById('dailyPlan'),
  focusQueue: document.getElementById('focusQueue'),
  focusCount: document.getElementById('focusCount'),
  teamLoad: document.getElementById('teamLoad'),
  teamCount: document.getElementById('teamCount'),
  boards: document.getElementById('boards'),
  boardCount: document.getElementById('boardCount'),
  riskCount: document.getElementById('riskCount'),
  approvalCount: document.getElementById('approvalCount'),
  ledgerMetrics: document.getElementById('ledgerMetrics'),
  decisionQueue: document.getElementById('decisionQueue'),
  recommendationList: document.getElementById('recommendationList'),
  recommendationCount: document.getElementById('recommendationCount'),
  trelloAttempts: document.getElementById('trelloAttempts'),
  trelloAttemptCount: document.getElementById('trelloAttemptCount'),
  findingsList: document.getElementById('findingsList'),
  findingsCount: document.getElementById('findingsCount'),
  boardHealthList: document.getElementById('boardHealthList'),
  boardHealthCount: document.getElementById('boardHealthCount'),
  followUps: document.getElementById('followUps'),
  followUpCount: document.getElementById('followUpCount'),
  auditTrail: document.getElementById('auditTrail'),
  auditCount: document.getElementById('auditCount'),
  connectorCount: document.getElementById('connectorCount'),
  connectorGrid: document.getElementById('connectorGrid'),
  categoryList: document.getElementById('categoryList'),
  connectorSearch: document.getElementById('connectorSearch'),
  connectorHeading: document.getElementById('connectorHeading'),
  connectedCount: document.getElementById('connectedCount'),
  enhancementCount: document.getElementById('enhancementCount'),
  enhancementMetrics: document.getElementById('enhancementMetrics'),
  enhancementStatusSummary: document.getElementById('enhancementStatusSummary'),
  enhancementsList: document.getElementById('enhancementsList'),
  enhancementAreaFilter: document.getElementById('enhancementAreaFilter'),
  workSignalCount: document.getElementById('workSignalCount'),
  workSignalMetrics: document.getElementById('workSignalMetrics'),
  workSignalList: document.getElementById('workSignalList'),
  workSignalContractCount: document.getElementById('workSignalContractCount'),
  workSignalContracts: document.getElementById('workSignalContracts'),
  workspaceSelect: document.getElementById('workspaceSelect'),
  workspaceCount: document.getElementById('workspaceCount'),
  workspaceMetrics: document.getElementById('workspaceMetrics'),
  workspaceMode: document.getElementById('workspaceMode'),
  workspaceList: document.getElementById('workspaceList'),
  workspaceUserCount: document.getElementById('workspaceUserCount'),
  workspaceUsers: document.getElementById('workspaceUsers'),
  modal: document.getElementById('connectorModal'),
  modalTitle: document.getElementById('modalTitle'),
  modalBody: document.getElementById('modalBody')
};

document.querySelectorAll('[data-view-button]').forEach((button) => {
  button.addEventListener('click', () => showView(button.dataset.viewButton));
});

document.getElementById('refreshButton').addEventListener('click', loadAll);
document.getElementById('approvalButton').addEventListener('click', () => showView('approvals'));
document.getElementById('connectorButton').addEventListener('click', () => showView('connectors'));
els.workspaceSelect.addEventListener('change', async (event) => {
  state.activeWorkspaceId = event.target.value;
  if (state.activeWorkspaceId) {
    localStorage.setItem('sneup.workspaceId', state.activeWorkspaceId);
  } else {
    localStorage.removeItem('sneup.workspaceId');
  }
  await loadAll();
});
document.getElementById('closeModal').addEventListener('click', closeModal);
els.modal.addEventListener('click', (event) => {
  if (event.target === els.modal) closeModal();
});
els.connectorSearch.addEventListener('input', (event) => {
  state.search = event.target.value.toLowerCase();
  renderConnectors();
});
document.querySelectorAll('[data-queue-filter]').forEach((button) => {
  button.addEventListener('click', () => {
    state.queueFilter = button.dataset.queueFilter;
    renderOperationsLedger();
  });
});
document.querySelectorAll('[data-signal-filter]').forEach((button) => {
  button.addEventListener('click', () => {
    state.signalFilter = button.dataset.signalFilter;
    renderWorkSignals();
  });
});
document.querySelectorAll('[data-enhancement-priority]').forEach((button) => {
  button.addEventListener('click', () => {
    state.enhancementPriority = button.dataset.enhancementPriority;
    renderEnhancementFilters();
    loadEnhancements();
  });
});
document.querySelectorAll('[data-enhancement-status]').forEach((button) => {
  button.addEventListener('click', () => {
    state.enhancementStatus = button.dataset.enhancementStatus;
    renderEnhancementFilters();
    loadEnhancements();
  });
});
els.enhancementAreaFilter.addEventListener('change', () => {
  state.enhancementArea = els.enhancementAreaFilter.value;
  loadEnhancements();
});

function showView(viewName) {
  document.querySelectorAll('[data-view-button]').forEach((button) => {
    button.classList.toggle('active', button.dataset.viewButton === viewName);
  });
  document.querySelectorAll('.view').forEach((view) => view.classList.remove('active'));
  document.getElementById(`${viewName}View`).classList.add('active');
  const titles = {
    overview: 'Autonomous project command',
    approvals: 'Approval and operations ledger',
    connectors: 'Account connectors',
    enhancements: 'Enhancement backlog',
    signals: 'Cross-tool work signals',
    workspaces: 'Workspace administration'
  };
  document.getElementById('pageTitle').textContent = titles[viewName] || titles.overview;
}

async function loadAll() {
  await loadSecurityContext();
  renderEnhancementFilters();
  await Promise.all([
    loadMissionControl(),
    loadOperationsBrief(),
    loadJobDashboard(),
    loadConnectors(),
    loadEnhancements(),
    loadWorkSignals(),
    loadOperationsLedger(),
    loadWorkspaceAdmin()
  ]);
}

function renderEnhancementFilters() {
  document.querySelectorAll('[data-enhancement-priority]').forEach((button) => {
    button.classList.toggle('active', button.dataset.enhancementPriority === state.enhancementPriority);
  });
  document.querySelectorAll('[data-enhancement-status]').forEach((button) => {
    button.classList.toggle('active', button.dataset.enhancementStatus === state.enhancementStatus);
  });
}

async function loadEnhancements() {
  try {
    const params = new URLSearchParams();
    if (state.enhancementPriority !== 'all') params.set('priority', state.enhancementPriority);
    if (state.enhancementArea !== 'all') params.set('area', state.enhancementArea);
    if (state.enhancementStatus !== 'all') params.set('status', state.enhancementStatus);
    const response = await fetchApi(`/api/enhancements${params.toString() ? `?${params}` : ''}`);
    state.enhancements = response.enhancements || [];
    state.enhancementSummary = response.summary || {};
    renderEnhancements();
  } catch (error) {
    state.enhancements = [];
    state.enhancementSummary = {};
    renderEnhancements(error.message);
  }
}

function apiOptions(options = {}) {
  const headers = {
    ...(options.headers || {})
  };

  if (state.activeWorkspaceId) {
    headers['X-Sneup-Workspace-Id'] = state.activeWorkspaceId;
  }

  return {
    ...options,
    headers
  };
}

async function apiFetch(url, options) {
  return fetch(url, apiOptions(options));
}

async function fetchApi(url, options) {
  const response = await apiFetch(url, options);
  const data = await response.json();
  if (!data.success) throw new Error(data.error || `Request failed: ${url}`);
  return data;
}

async function loadSecurityContext() {
  try {
    const data = await fetchApi('/api/security/context');
    state.securityContext = data.context;
    if (!state.activeWorkspaceId && data.context?.workspaceId) {
      state.activeWorkspaceId = data.context.workspaceId;
    }
  } catch (error) {
    state.securityContext = null;
  }
}

async function loadMissionControl() {
  try {
    const response = await apiFetch('/api/autopilot/mission-control');
    const data = await response.json();
    if (!data.success) throw new Error(data.error || 'Mission control unavailable');
    state.snapshot = data.snapshot;
    renderOverview();
  } catch (error) {
    els.brief.innerHTML = `<h2>Mission control unavailable</h2><p>${escapeHtml(error.message)}</p>${renderConfidence(0)}`;
  }
}

async function loadOperationsBrief() {
  try {
    const response = await apiFetch('/api/autopilot/operations-brief');
    const data = await response.json();
    if (!data.success) throw new Error(data.error || 'Operations brief unavailable');
    state.operationsBrief = data.brief;
    renderOperationsBrief();
  } catch (error) {
    state.operationsBrief = null;
    els.operationsBriefCount.textContent = '0 decisions';
    els.operationsBriefItems.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
  }
}

async function loadJobDashboard() {
  try {
    const response = await apiFetch('/api/jobs');
    const data = await response.json();
    if (!data.success) throw new Error(data.error || 'Job health unavailable');
    state.jobDashboard = data.dashboard;
    renderJobDashboard();
  } catch (error) {
    state.jobDashboard = null;
    els.jobHealthCount.textContent = '0 tracked';
    els.jobHealthList.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
  }
}

async function loadConnectors() {
  try {
    const response = await apiFetch('/api/connectors');
    const data = await response.json();
    if (!data.success) throw new Error(data.error || 'Connectors unavailable');
    state.connectors = data.connectors || [];
    state.categories = data.categories || [];
    state.accounts = data.accounts || [];
    renderConnectors();
  } catch (error) {
    els.connectorGrid.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
  }
}

async function loadWorkSignals() {
  try {
    const [signalsData, contractsData, graphData, graphDecisionData] = await Promise.all([
      fetchApi('/api/work-signals?limit=100'),
      fetchApi('/api/work-signals/contracts'),
      fetchApi('/api/work-signals/graph?limit=20'),
      fetchApi('/api/work-signals/graph/decisions?limit=20')
    ]);
    state.workSignals = signalsData.signals || [];
    state.workSignalContracts = contractsData.contracts || [];
    state.workGraph = graphData.graph || null;
    state.workGraphCandidates = graphDecisionData.candidates || [];
    state.workSignalError = '';
    renderWorkSignals();
  } catch (error) {
    state.workSignals = [];
    state.workGraph = null;
    state.workGraphCandidates = [];
    state.workSignalContracts = [];
    state.workSignalError = error.message;
    renderWorkSignals();
  }
}

async function loadWorkspaceAdmin() {
  try {
    const current = await fetchApi('/api/workspaces/current');
    state.currentWorkspace = current.workspace;

    if (!current.auth?.workspaceOverrideAllowed) {
      state.workspaces = [current.workspace];
      state.workspaceUsers = [];
      renderWorkspaces();
      return;
    }

    const workspaceData = await fetchApi('/api/workspaces?limit=100');
    state.workspaces = workspaceData.workspaces || [];
    const selectedWorkspace = state.workspaces.find(workspace => workspace.id === state.activeWorkspaceId)
      || state.workspaces.find(workspace => workspace.id === current.workspace?.id)
      || state.workspaces[0]
      || current.workspace;
    if (selectedWorkspace?.id && state.activeWorkspaceId !== selectedWorkspace.id) {
      state.activeWorkspaceId = selectedWorkspace.id;
      localStorage.setItem('sneup.workspaceId', state.activeWorkspaceId);
    }

    const userData = selectedWorkspace?.id
      ? await fetchApi(`/api/workspaces/${selectedWorkspace.id}/users?limit=100`)
      : { users: [] };
    state.workspaceUsers = userData.users || [];
    renderWorkspaces();
  } catch (error) {
    state.workspaceUsers = [];
    state.workspaces = state.currentWorkspace ? [state.currentWorkspace] : [];
    renderWorkspaces(error.message);
  }
}

async function loadOperationsLedger() {
  const requests = {
    decisions: fetchApi('/api/decision-queue?status=open&limit=50'),
    recommendations: fetchApi('/api/recommendations?limit=50'),
    actions: fetchApi('/api/trello-actions?limit=50'),
    auditEvents: fetchApi('/api/audit?limit=50'),
    followUps: fetchApi('/api/follow-ups/due?limit=50'),
    findings: fetchApi('/api/findings?status=open&limit=50'),
    healthSnapshots: fetchApi('/api/findings/board-health?limit=20')
  };

  const entries = await Promise.all(Object.entries(requests).map(async ([key, promise]) => {
    try {
      return [key, await promise, null];
    } catch (error) {
      return [key, null, error.message];
    }
  }));

  state.ledger.errors = [];
  entries.forEach(([key, data, error]) => {
    if (error) {
      state.ledger[key] = [];
      state.ledger.errors.push(error);
      return;
    }

    if (key === 'decisions') state.ledger.decisions = data.items || [];
    if (key === 'recommendations') state.ledger.recommendations = data.recommendations || [];
    if (key === 'actions') state.ledger.actions = data.actions || [];
    if (key === 'auditEvents') state.ledger.auditEvents = data.auditEvents || [];
    if (key === 'followUps') state.ledger.followUps = data.followUps || [];
    if (key === 'findings') state.ledger.findings = data.findings || [];
    if (key === 'healthSnapshots') state.ledger.healthSnapshots = data.snapshots || [];
  });

  renderOperationsLedger();
}

function renderOverview() {
  const snapshot = state.snapshot;
  if (!snapshot) return;

  const generatedAt = new Date(snapshot.generatedAt);
  els.timestamp.textContent = `${snapshot.mode === 'demo' ? 'Demo mode' : 'Live mode'} updated ${generatedAt.toLocaleString()}`;
  els.riskCount.textContent = snapshot.signals.activeRisks;
  els.commandMode.textContent = snapshot.autonomy.level;

  const metrics = [
    ['Boards', snapshot.signals.boards],
    ['Active cards', snapshot.signals.activeCards],
    ['Overdue', snapshot.signals.overdueCards],
    ['High risk', snapshot.signals.highRiskCards],
    ['Unassigned', snapshot.signals.unassignedCards],
    ['Overloaded', snapshot.signals.overloadedMembers],
    ['Graph decisions', snapshot.signals.graphDecisions || 0]
  ];
  els.metrics.innerHTML = metrics.map(([label, value]) => `
    <div class="metric">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>
  `).join('');

  const confidence = snapshot.brief.confidence || 0;
  els.brief.innerHTML = `
    <h2>${escapeHtml(snapshot.brief.headline)}</h2>
    <p>${escapeHtml(snapshot.brief.narrative)}</p>
    <p><strong>Next decision:</strong> ${escapeHtml(snapshot.brief.decision)}</p>
    ${renderConfidence(confidence)}
  `;

  els.commandQueue.innerHTML = listOrEmpty(snapshot.commandQueue, renderCommand);
  bindAutopilotCommandActions();
  els.automationCount.textContent = `${snapshot.dailyPlan.automation.ready} ready`;
  els.dailyPlan.innerHTML = listOrEmpty(snapshot.dailyPlan.firstHour.map((item, index) => ({
    title: item,
    meta: `Step ${index + 1}`
  })), (item) => `
    <div class="item">
      <div class="item-title"><strong>${escapeHtml(item.title)}</strong><span class="pill review">${escapeHtml(item.meta)}</span></div>
    </div>
  `);

  els.focusCount.textContent = `${snapshot.focus.length} items`;
  els.focusQueue.innerHTML = listOrEmpty(snapshot.focus, renderFocus);
  els.teamCount.textContent = `${snapshot.teamLoad.length} people`;
  els.teamLoad.innerHTML = listOrEmpty(snapshot.teamLoad, renderTeamMember);
  els.boardCount.textContent = `${snapshot.boardSummaries.length} boards`;
  els.boards.innerHTML = listOrEmpty(snapshot.boardSummaries, renderBoard);
  bindLedgerDrilldownActions();
  renderOperationsBrief();
  renderJobDashboard();
}

function renderOperationsBrief() {
  const brief = state.operationsBrief;
  if (!brief) return;

  const counts = brief.counts || {};
  const robertDecisionCount = counts.robertDecisions || 0;
  const graphDecisionCount = counts.graphDecisions || 0;
  els.operationsBriefCount.textContent = graphDecisionCount > 0
    ? `${robertDecisionCount} Robert, ${graphDecisionCount} graph`
    : `${robertDecisionCount} decision${robertDecisionCount === 1 ? '' : 's'}`;

  const items = [
    ...(brief.robertDecisions || []),
    ...(brief.vaReady || []),
    ...(brief.teamQueue || []),
    ...(brief.failedActions || []),
    ...(brief.dueFollowUps || []),
    ...(brief.boardHealth || [])
  ].slice(0, 8);

  els.operationsBriefItems.innerHTML = `
    <div class="item">
      <div class="item-title">
        <strong>${escapeHtml(brief.headline)}</strong>
        <span class="pill ${brief.mode === 'demo' ? 'review' : 'healthy'}">${escapeHtml(brief.mode)}</span>
      </div>
      <div class="meta">${escapeHtml(brief.narrative)}</div>
      <div class="meta"><span>Next: ${escapeHtml(brief.nextDecision)}</span></div>
      ${renderConfidence(brief.confidence || 0)}
    </div>
    ${listOrEmpty(items, renderOperationsBriefItem)}
    <div class="item">
      <div class="item-title"><strong>Morning plan</strong><span class="pill review">read-only</span></div>
      <div class="meta">${(brief.morningPlan || []).map(step => `<span>${escapeHtml(step)}</span>`).join('')}</div>
    </div>
  `;
}

function renderJobDashboard() {
  const dashboard = state.jobDashboard;
  if (!dashboard) return;

  const summary = dashboard.summary || {};
  const health = dashboard.health || [];
  const problemJobs = health
    .filter(job => job.status !== 'healthy')
    .slice(0, 8);
  const displayJobs = problemJobs.length > 0 ? problemJobs : health.slice(0, 5);

  els.jobHealthCount.textContent = `${summary.trackedJobs || health.length || 0} tracked`;
  els.jobHealthList.innerHTML = `
    <div class="item">
      <div class="item-title">
        <strong>${summary.failedJobs || 0} failed, ${summary.staleJobs || 0} stale</strong>
        <span class="pill ${dashboard.mode === 'demo' ? 'review' : 'healthy'}">${escapeHtml(dashboard.mode)}</span>
      </div>
      <div class="meta">
        <span>${summary.healthyJobs || 0} healthy</span>
        <span>${summary.pausedJobs || 0} paused</span>
        <span>${summary.runningJobs || 0} running</span>
        <span>${summary.failedRuns || 0} failed runs</span>
      </div>
    </div>
    ${listOrEmpty(displayJobs, renderJobHealthItem)}
  `;

  document.querySelectorAll('[data-job-action]').forEach((button) => {
    button.addEventListener('click', () => runJobAction(button.dataset.jobName, button.dataset.jobAction));
  });
}

function renderOperationsLedger() {
  document.querySelectorAll('[data-queue-filter]').forEach((button) => {
    button.classList.toggle('active', button.dataset.queueFilter === state.queueFilter);
  });

  const decisions = state.ledger.decisions || [];
  const recommendations = state.ledger.recommendations || [];
  const actions = state.ledger.actions || [];
  const auditEvents = state.ledger.auditEvents || [];
  const followUps = state.ledger.followUps || [];
  const findings = state.ledger.findings || [];
  const healthSnapshots = state.ledger.healthSnapshots || [];

  const openRobert = decisions.filter(item => item.ownerType === 'robert').length;
  const vaTeam = decisions.filter(item => ['va', 'team'].includes(item.ownerType)).length;
  const pendingRecommendations = recommendations.filter(item => ['pending', 'approved', 'change_requested'].includes(item.status)).length;
  const failedActions = actions.filter(item => item.status === 'failed').length;
  const highRiskFindings = findings.filter(item => ['critical', 'high'].includes(item.severity)).length;

  els.approvalCount.textContent = openRobert + pendingRecommendations;
  els.ledgerMetrics.innerHTML = [
    ['Robert decisions', openRobert],
    ['VA/team queue', vaTeam],
    ['Awaiting review', pendingRecommendations],
    ['Failed actions', failedActions],
    ['Open findings', findings.length],
    ['High-risk findings', highRiskFindings],
    ['Audit events', auditEvents.length]
  ].map(([label, value]) => `
    <div class="metric">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>
  `).join('');

  const filteredDecisions = state.queueFilter === 'all'
    ? decisions
    : decisions.filter(item => item.ownerType === state.queueFilter);

  const errorNotice = state.ledger.errors.length > 0
    ? `<div class="notice">Operations ledger needs MongoDB/live data: ${escapeHtml(unique(state.ledger.errors).join(' | '))}</div>`
    : '';

  els.decisionQueue.innerHTML = errorNotice + listOrEmpty(filteredDecisions, renderDecisionItem);
  els.recommendationCount.textContent = `${pendingRecommendations} pending`;
  els.recommendationList.innerHTML = listOrEmpty(recommendations, renderRecommendation);
  els.findingsCount.textContent = `${findings.length} open`;
  els.findingsList.innerHTML = listOrEmpty(findings, renderFinding);
  els.boardHealthCount.textContent = `${healthSnapshots.length} snapshots`;
  els.boardHealthList.innerHTML = listOrEmpty(healthSnapshots, renderBoardHealth);
  els.trelloAttemptCount.textContent = `${actions.length} attempts`;
  els.trelloAttempts.innerHTML = listOrEmpty(actions, renderTrelloAttempt);
  els.followUpCount.textContent = `${followUps.length} due`;
  els.followUps.innerHTML = listOrEmpty(followUps, renderFollowUp);
  els.auditCount.textContent = `${auditEvents.length} events`;
  els.auditTrail.innerHTML = listOrEmpty(auditEvents, renderAuditEvent);

  document.querySelectorAll('[data-recommendation-action]').forEach((button) => {
    button.addEventListener('click', () => runRecommendationAction(
      button.dataset.recommendationId,
      button.dataset.recommendationAction
    ));
  });

  document.querySelectorAll('[data-decision-action]').forEach((button) => {
    button.addEventListener('click', () => runDecisionAction(button.dataset.decisionId, button.dataset.decisionAction));
  });
  document.querySelectorAll('[data-followup-action]').forEach((button) => {
    button.addEventListener('click', () => runFollowUpAction(button.dataset.followupId, button.dataset.followupAction));
  });
  document.querySelectorAll('[data-payload-edit]').forEach((button) => {
    button.addEventListener('click', () => editRecommendationPayload(button.dataset.payloadEdit));
  });
  document.querySelectorAll('[data-recommendation-evidence]').forEach((button) => {
    button.addEventListener('click', () => openRecommendationEvidence(button.dataset.recommendationEvidence));
  });
  bindLedgerDrilldownActions();
  bindGraphActions();
}

function renderOperationsBriefItem(item) {
  return `
    <div class="item">
      <div class="item-title">
        <strong>${escapeHtml(item.title)}</strong>
        <span class="pill ${severityClass(item.riskLevel)}">${escapeHtml(item.type || item.status || 'item')}</span>
      </div>
      <div class="meta">
        <span>${escapeHtml(item.reason || 'Review evidence')}</span>
        ${item.ownerType ? `<span>Owner: ${escapeHtml(item.ownerType)}</span>` : ''}
        ${item.boardName ? `<span>${escapeHtml(item.boardName)}</span>` : ''}
        ${item.cardName ? `<span>${escapeHtml(item.cardName)}</span>` : ''}
        ${item.sourceCount ? `<span>${item.sourceCount} sources</span>` : ''}
        ${item.sourceProvider ? `<span>${escapeHtml(item.sourceProvider)}</span>` : ''}
        ${item.draftOnly ? '<span>draft-only</span>' : ''}
      </div>
      ${item.providerUrl ? `<div class="meta"><a href="${escapeHtml(item.providerUrl)}" rel="noreferrer" target="_blank">Open source</a></div>` : ''}
    </div>
  `;
}

function renderJobHealthItem(job) {
  const statusClass = job.status === 'failed'
    ? 'critical'
    : job.status === 'stale'
      ? 'high'
      : job.status === 'paused'
        ? 'review'
        : 'healthy';
  const jobName = escapeHtml(job.jobName);
  const controlsDisabled = state.jobDashboard?.mode !== 'live';
  const canTrigger = job.manualTriggerAllowed && !job.paused && !controlsDisabled;
  const pauseResumeAction = job.paused ? 'resume' : 'pause';
  const pauseResumeLabel = job.paused ? 'Resume' : 'Pause';
  return `
    <div class="item">
      <div class="item-title">
        <strong>${escapeHtml(job.label || job.jobName)}</strong>
        <span class="pill ${statusClass}">${escapeHtml(job.status)}</span>
      </div>
      <div class="meta">
        <span>${escapeHtml(job.jobType || 'job')}</span>
        <span>Last run: ${formatDate(job.lastRunAt)}</span>
        <span>${Math.round((job.lastDurationMs || 0) / 1000)}s</span>
        <span>${job.processedCount || 0} processed</span>
      </div>
      ${job.pausedReason ? `<div class="meta">${escapeHtml(job.pausedReason)}</div>` : ''}
      ${job.lastError ? `<div class="meta">${escapeHtml(job.lastError)}</div>` : ''}
      <div class="item-actions">
        <button class="button" data-job-name="${jobName}" data-job-action="${pauseResumeAction}" type="button" ${controlsDisabled ? 'disabled' : ''}>${pauseResumeLabel}</button>
        <button class="button primary" data-job-name="${jobName}" data-job-action="trigger" type="button" ${canTrigger ? '' : 'disabled'}>Run now</button>
      </div>
    </div>
  `;
}

function renderDecisionItem(item) {
  const itemId = getId(item._id);
  const recommendationId = getId(item.recommendationId);
  return `
    <div class="item">
      <div class="item-title">
        <strong>${escapeHtml(item.question || item.title)}</strong>
        <span class="pill ${severityClass(item.riskLevel)}">${escapeHtml(item.ownerType)}</span>
      </div>
      <div class="meta">
        <span>${escapeHtml(item.reason || 'Approval required')}</span>
        <span>${escapeHtml(item.riskLevel || 'medium')} risk</span>
        <span>Answer: ${escapeHtml(item.recommendedAnswer || 'yes')}</span>
      </div>
      ${renderSourceEvidence(item.sourceEvidence)}
      ${recommendationId ? renderReviewActions(recommendationId) : ''}
      <div class="item-actions">
        <button class="button" data-decision-id="${itemId}" data-decision-action="snooze" type="button">Snooze 24h</button>
        <button class="button warn" data-decision-id="${itemId}" data-decision-action="delegate-team" type="button">Delegate team</button>
        <button class="button warn" data-decision-id="${itemId}" data-decision-action="delegate-va" type="button">Delegate VA</button>
      </div>
    </div>
  `;
}

function renderRecommendation(recommendation) {
  const id = getId(recommendation._id);
  const sourceEvidence = recommendation.sourceEvidence || [];
  return `
    <div class="item">
      <div class="item-title">
        <strong>${escapeHtml(recommendation.title || recommendation.recommendedAction)}</strong>
        <span class="pill ${severityClass(recommendation.riskLevel)}">${escapeHtml(recommendation.status)}</span>
      </div>
      <div class="meta">
        <span>${escapeHtml(recommendation.actionType)}</span>
        <span>${escapeHtml(recommendation.ownerType || 'robert')}</span>
        <span>${Math.round((recommendation.confidence || 0) * 100)}% confidence</span>
        <span>${sourceEvidence.length} evidence</span>
      </div>
      <div class="meta">${escapeHtml(recommendation.approvalReason || recommendation.description || 'Review the exact payload before action.')}</div>
      ${renderSourceEvidence(sourceEvidence)}
      <details class="payload">
        <summary>Exact action payload</summary>
        <pre>${escapeHtml(JSON.stringify(recommendation.actionPayload || {}, null, 2))}</pre>
      </details>
      <div class="item-actions">
        <button class="button" data-recommendation-evidence="${escapeHtml(id)}" type="button">Evidence bundle</button>
      </div>
      ${renderPayloadEditAction(id, recommendation)}
      ${renderReviewActions(id, recommendation.status, recommendation)}
    </div>
  `;
}

function renderReviewActions(recommendationId, status = 'pending', recommendation = {}) {
  const payload = recommendation.actionPayload || {};
  const executable = payload.executable !== false && payload.draftOnly !== true && recommendation.actionType !== 'manual_review';
  const executeButton = status === 'approved' && executable
    ? `<button class="button primary" data-recommendation-id="${recommendationId}" data-recommendation-action="execute-approved" type="button">Execute approved</button>`
    : '';
  return `
    <div class="item-actions">
      <button class="button primary" data-recommendation-id="${recommendationId}" data-recommendation-action="approve" type="button">Yes</button>
      <button class="button danger" data-recommendation-id="${recommendationId}" data-recommendation-action="reject" type="button">No</button>
      <button class="button warn" data-recommendation-id="${recommendationId}" data-recommendation-action="change" type="button">Change</button>
      ${executeButton}
    </div>
  `;
}
function renderPayloadEditAction(recommendationId, recommendation = {}) {
  const payload = recommendation.actionPayload || {};
  if (payload.executable !== false && payload.draftOnly !== true && recommendation.actionType !== 'manual_review') {
    return '';
  }

  return `<div class="item-actions"><button class="button warn" data-payload-edit="${recommendationId}" type="button">Edit payload JSON</button></div>`;
}
function renderFinding(finding) {
  const card = finding.cardId || {};
  const board = finding.boardId || {};
  const cardId = getId(card._id || card.id);
  return `
    <div class="item">
      <div class="item-title">
        <strong>${escapeHtml(finding.title)}</strong>
        <span class="pill ${severityClass(finding.severity)}">${escapeHtml(finding.severity)}</span>
      </div>
      <div class="meta">
        <span>${escapeHtml(finding.findingType)}</span>
        <span>Waiting on ${escapeHtml(finding.waitingOn || 'unknown')}</span>
        <span>${finding.signalScore || 0}/100 signal</span>
      </div>
      <div class="meta">
        <span>${escapeHtml(board.name || 'Board')}</span>
        <span>${escapeHtml(card.name || 'Card')}</span>
      </div>
      <div class="meta">${escapeHtml(finding.recommendedAction || finding.description || 'Review finding')}</div>
      ${renderSourceEvidence(finding.sourceEvidence)}
      ${cardId ? `<div class="item-actions"><button class="button" data-card-ledger="${escapeHtml(cardId)}" type="button">Card ledger</button></div>` : ''}
    </div>
  `;
}

function renderBoardHealth(snapshot) {
  const board = snapshot.boardId || {};
  const counts = snapshot.counts || {};
  return `
    <div class="item">
      <div class="item-title">
        <strong>${escapeHtml(board.name || 'Board health')}</strong>
        <span class="pill ${snapshot.healthStatus === 'critical' ? 'critical' : snapshot.healthStatus === 'at_risk' ? 'high' : 'healthy'}">${escapeHtml(snapshot.healthStatus)}</span>
      </div>
      <div class="meta">
        <span>${snapshot.healthScore}/100 health</span>
        <span>${counts.findings || 0} findings</span>
        <span>${counts.robertQueueCandidates || 0} Robert</span>
        <span>${counts.vaReadyCandidates || 0} VA-ready</span>
      </div>
      <div class="meta">${escapeHtml(snapshot.summary || 'No summary recorded')}</div>
    </div>
  `;
}

function renderTrelloAttempt(attempt) {
  return `
    <div class="item">
      <div class="item-title">
        <strong>${escapeHtml(attempt.actionType)}</strong>
        <span class="pill ${attempt.status === 'failed' ? 'critical' : attempt.status === 'succeeded' ? 'healthy' : 'review'}">${escapeHtml(attempt.status)}</span>
      </div>
      <div class="meta">
        <span>${formatDate(attempt.startedAt || attempt.createdAt)}</span>
        <span>${escapeHtml(attempt.errorMessage || 'No error recorded')}</span>
      </div>
      <details class="payload">
        <summary>Attempt payload</summary>
        <pre>${escapeHtml(JSON.stringify(attempt.payload || {}, null, 2))}</pre>
      </details>
    </div>
  `;
}

function renderFollowUp(followUp) {
  const followUpId = getId(followUp._id || followUp.id);
  return `
    <div class="item">
      <div class="item-title">
        <strong>${escapeHtml(followUp.reason || 'Follow-up needed')}</strong>
        <span class="pill review">${escapeHtml(followUp.status || 'due')}</span>
      </div>
      <div class="meta">
        <span>Due ${formatDate(followUp.dueAt)}</span>
        <span>${escapeHtml(followUp.nextAction || 'Review worker response')}</span>
      </div>
      <div class="item-actions">
        <button class="button primary" data-followup-id="${followUpId}" data-followup-action="resolved" type="button">Resolved</button>
        <button class="button" data-followup-id="${followUpId}" data-followup-action="escalated" type="button">Escalate</button>
      </div>
    </div>
  `;
}

function renderAuditEvent(event) {
  return `
    <div class="item">
      <div class="item-title">
        <strong>${escapeHtml(event.action)}</strong>
        <span class="pill ${severityClass(event.riskLevel)}">${escapeHtml(event.source)}</span>
      </div>
      <div class="meta">
        <span>${formatDate(event.createdAt)}</span>
        <span>${escapeHtml(event.actor || 'sneup')}</span>
        <span>${escapeHtml(event.entityType)}</span>
      </div>
    </div>
  `;
}

function renderSourceEvidence(sourceEvidence = []) {
  if (!sourceEvidence || sourceEvidence.length === 0) return '';
  return `<div class="meta">${sourceEvidence.slice(0, 3).map(item => escapeHtml(item.label || item.type || 'evidence')).join(' | ')}</div>`;
}

async function runRecommendationAction(recommendationId, action) {
  if (!recommendationId) return;

  const endpoint = `/api/recommendations/${recommendationId}/${action}`;
  const body = action === 'approve'
    ? { decidedBy: 'robert', decisionReason: 'Approved from Sneup command center' }
    : action === 'reject'
      ? { decidedBy: 'robert', decisionReason: 'Rejected from Sneup command center' }
      : action === 'change'
        ? { decidedBy: 'robert', decisionReason: 'Change requested from Sneup command center' }
        : { actor: 'robert' };

  try {
    const data = await fetchApi(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    openNotice('Recommendation updated', data.message || `Action completed: ${action}`);
    await loadOperationsLedger();
  } catch (error) {
    openNotice('Recommendation action failed', error.message);
  }
}
async function runDecisionAction(itemId, action) {
  if (!itemId) return;

  const endpoint = action === 'snooze'
    ? `/api/decision-queue/${itemId}/snooze`
    : `/api/decision-queue/${itemId}/delegate`;
  const body = action === 'snooze'
    ? {
      snoozedBy: 'robert',
      snoozedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      reason: 'Snoozed from Sneup command center'
    }
    : {
      delegatedBy: 'robert',
      ownerType: action === 'delegate-va' ? 'va' : 'team',
      delegatedTo: action === 'delegate-va' ? 'va' : 'team',
      reason: `Delegated from Sneup command center to ${action === 'delegate-va' ? 'VA' : 'team'}`
    };

  try {
    await fetchApi(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    openNotice('Decision updated', action === 'snooze' ? 'Decision snoozed for 24 hours.' : 'Decision delegated.');
    await loadOperationsLedger();
  } catch (error) {
    openNotice('Decision update failed', error.message);
  }
}

async function runFollowUpAction(followUpId, action) {
  if (!followUpId) return;

  const status = action === 'escalated' ? 'escalated' : 'resolved';
  const body = {
    status,
    resolvedBy: 'robert',
    outcome: status === 'escalated' ? 'needs_attention' : 'manual',
    resolutionNote: status === 'escalated'
      ? 'Escalated from Sneup command center'
      : 'Resolved from Sneup command center'
  };

  try {
    await fetchApi(`/api/follow-ups/${followUpId}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    openNotice('Follow-up updated', status === 'escalated' ? 'Follow-up escalated.' : 'Follow-up resolved.');
    await loadOperationsLedger();
  } catch (error) {
    openNotice('Follow-up update failed', error.message);
  }
}

async function runJobAction(jobName, action) {
  if (!jobName || !action) return;

  const actionLabels = {
    pause: 'paused',
    resume: 'resumed',
    trigger: 'triggered'
  };

  try {
    await fetchApi(`/api/jobs/${encodeURIComponent(jobName)}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reason: action === 'pause' ? 'Paused from Sneup command center' : undefined
      })
    });
    await loadJobDashboard();
    openNotice('Job control updated', `${jobName} ${actionLabels[action] || 'updated'}.`);
  } catch (error) {
    openNotice('Job control failed', error.message);
  }
}

async function editRecommendationPayload(recommendationId) {
  const recommendation = (state.ledger.recommendations || []).find(item => getId(item._id) === recommendationId);
  if (!recommendation) return;

  const currentPayload = JSON.stringify(recommendation.actionPayload || {}, null, 2);
  const nextPayload = window.prompt('Edit exact Trello action payload JSON before approval/execution:', currentPayload);
  if (!nextPayload) return;

  try {
    const parsedPayload = JSON.parse(nextPayload);
    await fetchApi(`/api/recommendations/${recommendationId}/payload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updatedBy: 'robert', replace: true, actionPayload: parsedPayload })
    });
    openNotice('Payload updated', 'Exact action payload updated. Review and approve when ready.');
    await loadOperationsLedger();
  } catch (error) {
    openNotice('Payload update failed', error.message);
  }
}

async function openRecommendationEvidence(recommendationId) {
  if (!recommendationId) return;

  try {
    const data = await fetchApi(`/api/recommendations/${recommendationId}/evidence`);
    renderEvidenceModal(data.evidence);
  } catch (error) {
    openNotice('Evidence unavailable', error.message);
  }
}

function renderEvidenceModal(bundle = {}) {
  const recommendation = bundle.recommendation || {};
  const summary = bundle.summary || {};
  els.modalTitle.textContent = 'Recommendation evidence';
  els.modalBody.innerHTML = `
    <div class="notice-stack">
      <div class="item">
        <div class="item-title">
          <strong>${escapeHtml(recommendation.title || recommendation.recommendedAction || 'Recommendation')}</strong>
          <span class="pill ${severityClass(recommendation.riskLevel)}">${escapeHtml(recommendation.status || 'pending')}</span>
        </div>
        <div class="meta">
          <span>${summary.sourceEvidenceCount || 0} source refs</span>
          <span>${summary.decisionCount || 0} decisions</span>
          <span>${summary.approvalCount || 0} approvals</span>
          <span>${summary.trelloActionCount || 0} Trello attempts</span>
          <span>${summary.auditEventCount || 0} audit events</span>
          <span>Newest ${formatDate(summary.newestEvidenceAt)}</span>
        </div>
      </div>
      ${renderEvidenceSection('Source Evidence', bundle.sourceEvidence || [], renderEvidenceRef)}
      ${renderEvidenceSection('Trello Action Evidence', bundle.trelloActions || [], renderEvidenceAction)}
      ${renderEvidenceSection('Audit Trail', bundle.auditEvents || [], renderEvidenceAudit)}
      <div class="toolbar modal-actions">
        <button class="button primary" type="button" id="evidenceClose">Done</button>
      </div>
    </div>
  `;
  els.modal.classList.add('open');
  document.getElementById('evidenceClose').addEventListener('click', closeModal);
}

function bindLedgerDrilldownActions() {
  document.querySelectorAll('[data-board-ledger]').forEach((button) => {
    button.addEventListener('click', () => openOperatingLedger('board', button.dataset.boardLedger));
  });
  document.querySelectorAll('[data-card-ledger]').forEach((button) => {
    button.addEventListener('click', () => openOperatingLedger('card', button.dataset.cardLedger));
  });
}

async function openOperatingLedger(type, entityId) {
  if (!entityId) return;

  const endpoint = type === 'board'
    ? `/api/boards/${entityId}/operating-ledger`
    : `/api/cards/${entityId}/operating-ledger`;

  try {
    const data = await fetchApi(endpoint);
    renderOperatingLedgerModal(type, data.ledger || {});
  } catch (error) {
    openNotice('Operating ledger unavailable', error.message);
  }
}

function renderOperatingLedgerModal(type, ledger = {}) {
  const graphContext = ledger.graphContext || {};
  const title = type === 'board' ? 'Board operating ledger' : 'Card operating ledger';
  els.modalTitle.textContent = title;
  els.modalBody.innerHTML = `
    <div class="notice-stack">
      <div class="item">
        <div class="item-title">
          <strong>${escapeHtml(graphContext.sourceName || title)}</strong>
          <span class="pill review">${escapeHtml(graphContext.contextType || type)}</span>
        </div>
        <div class="meta">
          <span>${(ledger.recommendations || []).length} recommendations</span>
          <span>${(ledger.decisions || []).length} decisions</span>
          <span>${(ledger.actions || []).length} Trello attempts</span>
          <span>${(ledger.auditEvents || []).length} audit events</span>
          <span>${(ledger.followUps || []).length} follow-ups</span>
        </div>
      </div>
      ${renderGraphLedgerContext(graphContext)}
      ${renderLedgerSection('Open Findings', ledger.findings || [], renderFinding)}
      ${renderLedgerSection('Recent Recommendations', ledger.recommendations || [], renderRecommendation)}
      ${renderLedgerSection('Trello Action Attempts', ledger.actions || [], renderTrelloAttempt)}
      ${renderLedgerSection('Audit Trail', ledger.auditEvents || [], renderAuditEvent)}
      <div class="toolbar modal-actions">
        <button class="button primary" type="button" id="ledgerClose">Done</button>
      </div>
    </div>
  `;
  els.modal.classList.add('open');
  document.getElementById('ledgerClose').addEventListener('click', closeModal);
  bindLedgerDrilldownActions();
  bindGraphActions();
  bindGraphLedgerFilters();
  document.querySelectorAll('[data-recommendation-action]').forEach((button) => {
    button.addEventListener('click', () => runRecommendationAction(
      button.dataset.recommendationId,
      button.dataset.recommendationAction
    ));
  });
  document.querySelectorAll('[data-recommendation-evidence]').forEach((button) => {
    button.addEventListener('click', () => openRecommendationEvidence(button.dataset.recommendationEvidence));
  });
  document.querySelectorAll('[data-payload-edit]').forEach((button) => {
    button.addEventListener('click', () => editRecommendationPayload(button.dataset.payloadEdit));
  });
}

function renderLedgerSection(title, items, renderer) {
  return `
    <section>
      <div class="panel-head evidence-head">
        <h2>${escapeHtml(title)}</h2>
        <span class="pill review">${items.length}</span>
      </div>
      <div class="list">${listOrEmpty(items.slice(0, 5), renderer)}</div>
    </section>
  `;
}

function renderGraphLedgerContext(graphContext = {}) {
  const counts = graphContext.counts || {};
  const hasGraph = (counts.items || 0) > 0 || (counts.dependencies || 0) > 0 || (counts.decisions || 0) > 0;
  const notice = hasGraph
    ? ''
    : '<div class="notice">No normalized graph item is linked to this Trello context yet. Sync connector work signals to enrich dependency context.</div>';

  return `
    <section>
      <div class="panel-head evidence-head">
        <h2>Graph Context</h2>
        <span class="pill ${hasGraph ? 'healthy' : 'review'}">${hasGraph ? 'linked' : 'empty'}</span>
      </div>
      <div class="item">
        <div class="meta">
          <span>${counts.items || 0} graph items</span>
          <span>${counts.dependencies || 0} dependencies</span>
          <span>${counts.decisions || 0} decisions</span>
          <span>${counts.recommendations || 0} graph recommendations</span>
        </div>
      </div>
      ${notice}
      ${renderGraphLedgerFilters(graphContext)}
      ${renderGraphDetailSection('Linked Source Items', graphContext.sourceLinks || [], renderGraphLinkedItem)}
      ${renderGraphDetailSection('Linked Graph Items', graphContext.items || [], renderGraphLinkedItem)}
      ${renderGraphDetailSection('Graph Decision Candidates', graphContext.candidates || [], renderGraphCandidateDetail)}
      ${renderGraphDetailSection('Graph Dependency Edges', graphContext.dependencies || [], renderGraphDependency)}
      ${renderGraphDetailSection('Graph Recommendation History', graphContext.recommendations || [], renderGraphRecommendationHistory)}
    </section>
  `;
}

function renderGraphLedgerFilters(graphContext = {}) {
  const filters = graphContext.filters || {};
  const providers = filters.providers || [];
  const dependencyTypes = filters.dependencyTypes || [];
  const directions = filters.directions || [];
  if (!providers.length && !dependencyTypes.length && !directions.length) return '';

  return `
    <div class="graph-filter-panel">
      ${renderGraphFilterGroup('Provider', 'provider', providers)}
      ${renderGraphFilterGroup('Type', 'type', dependencyTypes)}
      ${renderGraphFilterGroup('Direction', 'direction', directions)}
      <span class="meta graph-filter-count"><span data-graph-filter-count>0</span> visible graph rows</span>
    </div>
  `;
}

function renderGraphFilterGroup(label, group, values = []) {
  if (!values.length) return '';
  return `
    <div class="graph-filter-group">
      <span>${escapeHtml(label)}</span>
      <div class="segmented graph-filter-buttons" data-graph-filter-group="${escapeHtml(group)}">
        <button class="active" data-graph-filter="${escapeHtml(group)}" data-graph-filter-value="all" type="button">All</button>
        ${values.map(value => `
          <button data-graph-filter="${escapeHtml(group)}" data-graph-filter-value="${escapeHtml(value)}" type="button">${escapeHtml(value)}</button>
        `).join('')}
      </div>
    </div>
  `;
}

function bindGraphActions() {
  document.querySelectorAll('[data-graph-detail]').forEach((button) => {
    button.addEventListener('click', () => openGraphItemDetail(button.dataset.graphDetail));
  });
  document.querySelectorAll('[data-graph-queue]').forEach((button) => {
    button.addEventListener('click', () => queueGraphDecision(button.dataset.graphQueue));
  });
  document.querySelectorAll('[data-graph-dependency-review]').forEach((button) => {
    button.addEventListener('click', () => reviewGraphDependency(
      button.dataset.graphDependencyReview,
      button.dataset.graphDependencyAction
    ));
  });
}

function bindGraphLedgerFilters() {
  document.querySelectorAll('[data-graph-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      const group = button.dataset.graphFilter;
      document.querySelectorAll(`[data-graph-filter="${cssEscape(group)}"]`).forEach((peer) => {
        peer.classList.toggle('active', peer === button);
      });
      applyGraphLedgerFilters();
    });
  });
  applyGraphLedgerFilters();
}

function applyGraphLedgerFilters() {
  const provider = activeGraphFilter('provider');
  const type = activeGraphFilter('type');
  const direction = activeGraphFilter('direction');
  let visible = 0;

  document.querySelectorAll('[data-graph-ledger-row]').forEach((row) => {
    const providers = (row.dataset.graphProviders || '').split('|').filter(Boolean);
    const dependencyType = row.dataset.graphDependencyType || '';
    const rowDirection = row.dataset.graphDirection || '';
    const providerMatches = provider === 'all' || providers.includes(provider);
    const typeMatches = type === 'all' || dependencyType === type || !dependencyType;
    const directionMatches = direction === 'all' || rowDirection === direction || !rowDirection;
    const shouldShow = providerMatches && typeMatches && directionMatches;
    row.classList.toggle('graph-hidden', !shouldShow);
    if (shouldShow) visible += 1;
  });

  document.querySelectorAll('[data-graph-filter-count]').forEach((node) => {
    node.textContent = visible;
  });
}

function activeGraphFilter(group) {
  return document.querySelector(`[data-graph-filter="${cssEscape(group)}"].active`)?.dataset.graphFilterValue || 'all';
}

function renderEvidenceSection(title, items, renderer) {
  return `
    <section>
      <div class="panel-head evidence-head">
        <h2>${escapeHtml(title)}</h2>
        <span class="pill review">${items.length}</span>
      </div>
      <div class="list">${listOrEmpty(items.slice(0, 8), renderer)}</div>
    </section>
  `;
}

function renderEvidenceRef(item) {
  return `
    <div class="item">
      <div class="item-title">
        <strong>${escapeHtml(item.label || item.type || 'Evidence')}</strong>
        <span class="pill review">${escapeHtml(item.type || 'system')}</span>
      </div>
      <div class="meta">
        <span>${formatDate(item.observedAt)}</span>
        ${item.url ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">Open source</a>` : ''}
      </div>
      ${item.data ? `<details class="payload"><summary>Evidence data</summary><pre>${escapeHtml(JSON.stringify(item.data, null, 2))}</pre></details>` : ''}
    </div>
  `;
}

function renderEvidenceAction(action) {
  return `
    <div class="item">
      <div class="item-title">
        <strong>${escapeHtml(action.actionType || 'Trello action')}</strong>
        <span class="pill ${action.status === 'failed' ? 'critical' : action.status === 'succeeded' ? 'healthy' : 'review'}">${escapeHtml(action.status || 'pending')}</span>
      </div>
      <div class="meta">
        <span>${formatDate(action.finishedAt || action.startedAt || action.createdAt)}</span>
        <span>${escapeHtml(action.errorMessage || 'No error recorded')}</span>
      </div>
    </div>
  `;
}

function renderEvidenceAudit(event) {
  return `
    <div class="item">
      <div class="item-title">
        <strong>${escapeHtml(event.action || 'Audit event')}</strong>
        <span class="pill ${severityClass(event.riskLevel)}">${escapeHtml(event.source || 'system')}</span>
      </div>
      <div class="meta">
        <span>${formatDate(event.createdAt)}</span>
        <span>${escapeHtml(event.actor || 'sneup')}</span>
      </div>
    </div>
  `;
}
function renderCommand(command) {
  return `
    <div class="item">
      <div class="item-title">
        <strong>${escapeHtml(command.title)}</strong>
        <span class="pill ${severityClass(command.severity)}">${escapeHtml(command.severity)}</span>
      </div>
      <div class="meta">
        <span>${escapeHtml(command.target)}</span>
        <span>${escapeHtml(command.owner)}</span>
        <span>${command.automatable ? `${command.minutesSaved} min saved` : 'review'}</span>
      </div>
      <div class="meta">${escapeHtml(command.reason)}</div>
      ${renderSourceEvidence(command.sourceEvidence)}
      <div class="item-actions">
        <button class="button primary" data-command-id="${escapeHtml(command.id)}" type="button">Queue for approval</button>
      </div>
    </div>
  `;
}

function bindAutopilotCommandActions() {
  document.querySelectorAll('[data-command-id]').forEach((button) => {
    button.addEventListener('click', () => queueAutopilotCommand(button.dataset.commandId));
  });
}

async function queueAutopilotCommand(commandId) {
  const command = (state.snapshot?.commandQueue || []).find(item => item.id === commandId);
  if (!command) return;

  try {
    const data = await fetchApi('/api/autopilot/commands/queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actor: 'robert', command })
    });
    openNotice('Command queued', data.message || 'Autopilot command queued for approval');
    await loadOperationsLedger();
  } catch (error) {
    openNotice('Command queue failed', error.message);
  }
}

function renderFocus(item) {
  const cardId = getId(item.id);
  return `
    <div class="item">
      <div class="item-title">
        <strong>${escapeHtml(item.name)}</strong>
        <span class="pill ${severityClass(item.riskLevel)}">${item.priorityScore}</span>
      </div>
      <div class="meta">
        <span>${escapeHtml(item.boardName)}</span>
        <span>${escapeHtml(item.listName)}</span>
        <span>${escapeHtml(item.members.join(', ') || 'Unassigned')}</span>
      </div>
      <div class="meta">${item.reasons.map(escapeHtml).join('  |  ')}</div>
      ${renderSourceEvidence(item.sourceEvidence)}
      ${cardId ? `<div class="item-actions"><button class="button" data-card-ledger="${escapeHtml(cardId)}" type="button">Card ledger</button></div>` : ''}
    </div>
  `;
}

function renderTeamMember(member) {
  return `
    <div class="item">
      <div class="item-title">
        <strong>${escapeHtml(member.fullName || member.username)}</strong>
        <span class="pill ${member.capacityState === 'overloaded' ? 'critical' : member.capacityState === 'heavy' ? 'high' : 'healthy'}">${escapeHtml(member.capacityState)}</span>
      </div>
      <div class="meta">
        <span>${member.assignedCards} assigned</span>
        <span>${member.urgentCards} urgent</span>
        <span>${member.overdueCards} overdue</span>
      </div>
      <div class="meta">${(member.specialties || []).map(escapeHtml).join('  |  ') || 'No specialty signal yet'}</div>
    </div>
  `;
}

function renderBoard(board) {
  const maxCount = Math.max(...board.flow.map(step => step.count), 1);
  const boardId = getId(board.id);
  return `
    <div class="connector-card">
      <div class="connector-top">
        <div>
          <h3>${escapeHtml(board.name)}</h3>
          <p>${board.activeCards} active  |  ${board.overdueCards} overdue  |  ${board.unassignedCards} unassigned</p>
        </div>
        <span class="pill ${board.health === 'healthy' ? 'healthy' : board.health === 'critical' ? 'critical' : 'high'}">${escapeHtml(board.health)}</span>
      </div>
      <div class="flow">
        ${board.flow.map(step => `
          <div class="flow-row">
            <span>${escapeHtml(step.name)}</span>
            ${renderBar(Math.max(6, (step.count / maxCount) * 100), `${step.name} flow share`)}
            <span>${step.count}</span>
          </div>
        `).join('')}
      </div>
      <div class="meta">
        <span>${board.velocity.cardsPerWeek} cards/week</span>
        <span>${board.blockedCards} blocked</span>
      </div>
      ${boardId ? `<div class="connector-actions"><button class="button" data-board-ledger="${escapeHtml(boardId)}" type="button">Operating ledger</button></div>` : ''}
    </div>
  `;
}

function renderWorkspaces(errorMessage = '') {
  const workspaces = state.workspaces || [];
  const currentWorkspaceId = state.activeWorkspaceId || state.currentWorkspace?.id || '';
  const currentWorkspace = workspaces.find(workspace => workspace.id === currentWorkspaceId)
    || state.currentWorkspace
    || workspaces[0];

  els.workspaceCount.textContent = workspaces.length || 1;
  els.workspaceMode.textContent = state.securityContext?.workspaceOverrideAllowed ? 'switchable' : 'locked';

  const options = workspaces.length > 0
    ? workspaces.map(workspace => `
      <option value="${escapeHtml(workspace.id)}" ${workspace.id === currentWorkspaceId ? 'selected' : ''}>
        ${escapeHtml(workspace.name)}
      </option>
    `).join('')
    : `<option value="${escapeHtml(currentWorkspaceId)}">${escapeHtml(state.currentWorkspace?.name || 'Current workspace')}</option>`;

  els.workspaceSelect.innerHTML = options;
  els.workspaceSelect.disabled = !state.securityContext?.workspaceOverrideAllowed || workspaces.length <= 1;

  const users = state.workspaceUsers || [];
  els.workspaceMetrics.innerHTML = [
    ['Workspace', currentWorkspace?.name || 'Current'],
    ['Status', currentWorkspace?.status || 'active'],
    ['Plan', currentWorkspace?.plan || 'local'],
    ['Users', users.length],
    ['Override', state.securityContext?.workspaceOverrideAllowed ? 'Allowed' : 'Locked'],
    ['Actor', state.securityContext?.displayName || state.securityContext?.actorId || 'Sneup']
  ].map(([label, value]) => `
    <div class="metric">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `).join('');

  const notice = errorMessage
    ? `<div class="notice">${escapeHtml(errorMessage)}</div>`
    : '';
  els.workspaceList.innerHTML = notice + listOrEmpty(workspaces, renderWorkspace);
  els.workspaceUserCount.textContent = `${users.length} user${users.length === 1 ? '' : 's'}`;
  els.workspaceUsers.innerHTML = listOrEmpty(users, renderWorkspaceUser);
}

function renderWorkspace(workspace) {
  const selected = workspace.id === state.activeWorkspaceId;
  return `
    <div class="item">
      <div class="item-title">
        <strong>${escapeHtml(workspace.name)}</strong>
        <span class="pill ${workspace.status === 'active' ? 'healthy' : 'review'}">${escapeHtml(workspace.status)}</span>
      </div>
      <div class="meta">
        <span>${escapeHtml(workspace.slug)}</span>
        <span>${escapeHtml(workspace.plan)}</span>
        <span>${selected ? 'selected' : 'available'}</span>
      </div>
    </div>
  `;
}

function renderWorkspaceUser(user) {
  return `
    <div class="item">
      <div class="item-title">
        <strong>${escapeHtml(user.displayName)}</strong>
        <span class="pill ${user.status === 'active' ? 'healthy' : 'review'}">${escapeHtml(user.role)}</span>
      </div>
      <div class="meta">
        <span>${escapeHtml(user.status)}</span>
        <span>${escapeHtml(user.provider)}</span>
        <span>${escapeHtml(user.email || 'No email')}</span>
      </div>
    </div>
  `;
}

function renderEnhancements(errorMessage = '') {
  const enhancements = state.enhancements || [];
  const summary = state.enhancementSummary || {};
  const statuses = enhancements.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});

  if (state.enhancementSummary && state.enhancementSummary.byArea) {
    const currentArea = state.enhancementArea;
    const areaKeys = Object.keys(state.enhancementSummary.byArea).sort();
    const selectedArea = areaKeys.includes(currentArea) ? currentArea : 'all';
    state.enhancementArea = selectedArea;

    if (els.enhancementAreaFilter && (!els.enhancementAreaFilter.dataset.populated || currentArea === 'all')) {
      els.enhancementAreaFilter.dataset.populated = '1';
      const options = ['<option value="all">All areas</option>', ...areaKeys.map(area => {
        return `<option value="${escapeHtml(area)}">${escapeHtml(area)}</option>`;
      })];
      els.enhancementAreaFilter.innerHTML = options.join('');
    }
    els.enhancementAreaFilter.value = selectedArea;
  }

  const byPriority = summary.byPriority || {};
  const byArea = summary.byArea || {};
  const byStatus = summary.byStatus || {};
  els.enhancementCount.textContent = enhancements.length;
  els.enhancementStatusSummary.textContent = `${enhancements.length} total`;

  const notice = errorMessage
    ? `<div class="notice">${escapeHtml(errorMessage)}</div>`
    : '';
  els.enhancementMetrics.innerHTML = [
    ['Total', enhancements.length],
    ['P0', byPriority.P0 || 0],
    ['P1', byPriority.P1 || 0],
    ['P2', byPriority.P2 || 0],
    ['P3', byPriority.P3 || 0],
    ['Ready', byStatus.ready || statuses.ready || 0],
    ['In progress', byStatus['in-progress'] || statuses['in-progress'] || 0],
    ['Needs research', byStatus['needs-research'] || statuses['needs-research'] || 0],
    ['Done', byStatus.done || statuses.done || 0],
    ['Blocked', byStatus.blocked || 0]
  ].map(([label, value]) => `
    <div class="metric">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `).join('');

  const areas = Object.entries(byArea)
    .map(([name, count]) => `${name}: ${count}`)
    .sort((left, right) => left.localeCompare(right))
    .join(' | ');
  if (areas) {
    els.enhancementMetrics.innerHTML += `<div class="metric"><span>By area</span><strong>${escapeHtml(areas)}</strong></div>`;
  }

  els.enhancementsList.innerHTML = notice + listOrEmpty(enhancements, renderEnhancement);
}

function renderEnhancement(item) {
  return `
    <div class="item" data-enhancement="${escapeHtml(item.id)}" data-enhancement-status="${escapeHtml(item.status)}">
      <div class="item-title">
        <strong>${escapeHtml(item.title)}</strong>
        <span class="pill ${item.status === 'ready' ? 'healthy' : item.status === 'in-progress' ? 'review' : 'high'}">${escapeHtml(item.status)}</span>
      </div>
      <div class="item-title">
        <span>${escapeHtml(item.id)} - ${escapeHtml(item.area)} - ${escapeHtml(item.priority)}</span>
        <span class="pill ${priorityBadgeClass(item.priority)}">${escapeHtml(item.area)}</span>
      </div>
      <div class="meta">
        <span>Priority ${escapeHtml(item.priority)}</span>
        <span>Status ${escapeHtml(item.status)}</span>
        <span>Effort ${escapeHtml(item.effort)}</span>
      </div>
      <div class="meta">${escapeHtml(item.impact || 'No impact summary yet.')}</div>
      <details class="payload">
        <summary>Next step</summary>
        <pre>${escapeHtml(item.nextStep || 'No next step recorded.')}</pre>
      </details>
    </div>
  `;
}

function renderWorkSignals() {
  document.querySelectorAll('[data-signal-filter]').forEach((button) => {
    button.classList.toggle('active', button.dataset.signalFilter === state.signalFilter);
  });

  const signals = state.workSignals || [];
  const contracts = state.workSignalContracts || [];
  const graph = state.workGraph || { counts: {}, byStatus: {}, byProvider: {}, reviewMetrics: {}, providerReviewQuality: [], items: [] };
  const graphCandidates = state.workGraphCandidates || [];
  const providers = unique(signals.map(signal => signal.provider));
  const connectedProviderIds = new Set((state.accounts || []).map(account => account.connectorId));
  const connectedContracts = contracts.filter(contract => connectedProviderIds.has(contract.connectorId));
  const implementedContracts = contracts.filter(contract => contract.adapterStatus === 'implemented');
  const openSignals = signals.filter(signal => ['open', 'in_progress'].includes(signal.status));
  const blockedSignals = signals.filter(signal => signal.status === 'blocked');
  const criticalSignals = signals.filter(signal => signal.priority === 'critical');

  els.workSignalCount.textContent = signals.length;
  els.workSignalContractCount.textContent = `${contracts.length} providers`;
  els.workSignalMetrics.innerHTML = [
    ['Signals', signals.length],
    ['Open', openSignals.length],
    ['Blocked', blockedSignals.length],
    ['Critical', criticalSignals.length],
    ['Providers', providers.length],
    ['Graph items', graph.counts.items || 0],
    ['Graph actors', graph.counts.actors || 0],
    ['Graph deps', graph.counts.dependencies || 0],
    ['Stale graph edges', graph.reviewMetrics?.pendingReview || 0],
    ['Graph decisions', graphCandidates.length],
    ['Implemented adapters', implementedContracts.length],
    ['Connected adapters', connectedContracts.length]
  ].map(([label, value]) => `
    <div class="metric">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `).join('');

  const filteredSignals = state.signalFilter === 'all'
    ? signals
    : signals.filter(signal => signal.status === state.signalFilter);
  const notice = state.workSignalError
    ? `<div class="notice">Work signals need MongoDB/live data: ${escapeHtml(state.workSignalError)}</div>`
    : '';

  const graphNotice = graph.counts.items
    ? `<div class="notice">Normalized graph: ${escapeHtml(graph.counts.items)} items, ${escapeHtml(graph.counts.containers || 0)} containers, ${escapeHtml(graph.counts.dependencies || 0)} dependencies, ${escapeHtml(graph.counts.events || 0)} events.</div>`
    : '';
  const graphReviewNotice = renderGraphReviewQuality(graph);
  const graphDecisionNotice = graphCandidates.length
    ? `<div class="notice">Graph decisions: ${escapeHtml(countByOwner(graphCandidates, 'robert'))} Robert, ${escapeHtml(countByOwner(graphCandidates, 'va'))} VA, ${escapeHtml(countByOwner(graphCandidates, 'team'))} team.</div>`
    : '';
  const graphDecisionCards = graphCandidates.length
    ? `<div class="list graph-decision-list">${graphCandidates.map(renderGraphDecisionCandidate).join('')}</div>`
    : '';
  els.workSignalList.innerHTML = notice + graphNotice + graphReviewNotice + graphDecisionNotice + graphDecisionCards + listOrEmpty(filteredSignals, renderWorkSignal);
  els.workSignalContracts.innerHTML = listOrEmpty(
    connectedContracts.length > 0 ? connectedContracts : contracts.slice(0, 12),
    contract => renderWorkSignalContract(contract, connectedProviderIds.has(contract.connectorId))
  );

  document.querySelectorAll('[data-graph-detail]').forEach((button) => {
    button.addEventListener('click', () => openGraphItemDetail(button.dataset.graphDetail));
  });
  document.querySelectorAll('[data-graph-queue]').forEach((button) => {
    button.addEventListener('click', () => queueGraphDecision(button.dataset.graphQueue));
  });
  document.querySelectorAll('[data-graph-dependency-review]').forEach((button) => {
    button.addEventListener('click', () => reviewGraphDependency(
      button.dataset.graphDependencyReview,
      button.dataset.graphDependencyAction
    ));
  });
}

function countByOwner(items, ownerType) {
  return items.filter(item => item.ownerType === ownerType).length;
}

function renderGraphReviewQuality(graph = {}) {
  const metrics = graph.reviewMetrics || {};
  const providers = (graph.providerReviewQuality || [])
    .filter(provider => provider.pendingReview || provider.stale || provider.reviewed)
    .slice(0, 5);
  if (!metrics.pendingReview && !providers.length) return '';

  const providerSummary = providers.map(provider => {
    const label = `${provider.provider}: ${provider.stale || 0} stale, ${provider.pendingReview || 0} pending`;
    return escapeHtml(label);
  }).join(' | ');
  const outcomeSummary = [
    metrics.confirmed ? `${metrics.confirmed} confirmed` : '',
    metrics.refreshed ? `${metrics.refreshed} refreshed` : '',
    metrics.dismissed ? `${metrics.dismissed} dismissed` : ''
  ].filter(Boolean).join(', ');

  return `<div class="notice">Graph trust: ${escapeHtml(metrics.pendingReview || 0)} stale edges need review; ${escapeHtml(metrics.reviewCoverage || 0)}% of reviewable edges have an outcome.${outcomeSummary ? ` Outcomes: ${escapeHtml(outcomeSummary)}.` : ''}${providerSummary ? ` Connector detail: ${providerSummary}.` : ''}</div>`;
}

function renderWorkSignal(signal) {
  const evidence = signal.evidenceRefs || [];
  return `
    <div class="item">
      <div class="item-title">
        <strong>${escapeHtml(signal.title)}</strong>
        <span class="pill ${signalClass(signal)}">${escapeHtml(signal.priority || signal.status)}</span>
      </div>
      <div class="meta">
        <span>${escapeHtml(signal.provider)}</span>
        <span>${escapeHtml(signal.sourceType)}</span>
        <span>${escapeHtml(signal.status)}</span>
        <span>${escapeHtml((signal.owners || []).join(', ') || 'No owner')}</span>
        <span>Due ${formatDate(signal.dueAt)}</span>
      </div>
      <div class="meta">${escapeHtml(signal.description || 'No description captured yet.')}</div>
      ${evidence.length > 0 ? `<div class="meta">${evidence.slice(0, 3).map(item => escapeHtml(item.label || item.type || item.externalId || 'evidence')).join(' | ')}</div>` : ''}
      ${signal.url ? `<div class="meta"><a href="${escapeHtml(signal.url)}" rel="noreferrer" target="_blank">Open source</a></div>` : ''}
    </div>
  `;
}

function renderGraphDecisionCandidate(candidate) {
  const dependencySummary = candidate.dependencySummary || candidate.actionPayload?.dependencySummary || {};
  const itemId = candidate.workItemId || candidate.actionPayload?.workItemId;
  return `
    <div class="item">
      <div class="item-title">
        <strong>${escapeHtml(candidate.title || candidate.recommendedAction || 'Graph decision')}</strong>
        <span class="pill ${severityClass(candidate.riskLevel)}">${escapeHtml(candidate.ownerType || 'team')}</span>
      </div>
      <div class="meta">
        <span>${escapeHtml(candidate.sourceProvider || candidate.actionPayload?.sourceProvider || 'work graph')}</span>
        <span>${escapeHtml(candidate.findingType || 'decision')}</span>
        <span>${escapeHtml(candidate.riskLevel || 'medium')} risk</span>
        <span>${Math.round(candidate.graphScore || 0)} graph score</span>
      </div>
      <div class="meta">${escapeHtml(candidate.description || candidate.recommendedAction || 'Review graph evidence before queuing.')}</div>
      ${renderDependencySummary(dependencySummary)}
      <div class="item-actions">
        <button class="button" data-graph-detail="${escapeHtml(itemId)}" type="button" ${itemId ? '' : 'disabled'}>Inspect graph</button>
        <button class="button primary" data-graph-queue="${escapeHtml(itemId)}" type="button" ${itemId ? '' : 'disabled'}>Queue Yes/No</button>
      </div>
    </div>
  `;
}

function renderDependencySummary(summary = {}) {
  const total = Number(summary.dependencyCount) || 0;
  if (!total) return '';
  return `
    <div class="meta">
      <span>${total} dependencies</span>
      <span>${Number(summary.blockingCount) || 0} blocking downstream</span>
      <span>${Number(summary.blockedByCount) || 0} blockers</span>
      <span>${Number(summary.relatedCount) || 0} related</span>
    </div>
  `;
}

async function openGraphItemDetail(itemId) {
  if (!itemId) return;

  try {
    const data = await fetchApi(`/api/work-signals/graph/items/${itemId}`);
    renderGraphItemDetailModal(data.detail);
  } catch (error) {
    openNotice('Graph detail unavailable', error.message);
  }
}

async function queueGraphDecision(itemId) {
  if (!itemId) return;

  try {
    const data = await fetchApi(`/api/work-signals/graph/items/${itemId}/queue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actor: 'robert' })
    });
    openNotice('Graph decision queued', data.message || 'Graph decision queued for approval.');
    await Promise.all([loadWorkSignals(), loadOperationsLedger()]);
  } catch (error) {
    openNotice('Graph queue failed', error.message);
  }
}

async function reviewGraphDependency(dependencyId, action) {
  if (!dependencyId || !action) return;
  const labels = {
    confirm: 'Dependency confirmed',
    dismiss: 'Dependency dismissed',
    refresh: 'Dependency refreshed'
  };

  try {
    await fetchApi(`/api/work-signals/graph/dependencies/${dependencyId}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        actor: 'robert',
        reason: action === 'dismiss'
          ? 'Dismissed from graph review.'
          : 'Reviewed from graph detail.'
      })
    });
    openNotice(labels[action] || 'Dependency reviewed', 'The graph dependency review was recorded inside Sneup. No provider write was executed.');
    await Promise.all([loadWorkSignals(), loadOperationsLedger()]);
  } catch (error) {
    openNotice('Dependency review failed', error.message);
  }
}

function renderGraphItemDetailModal(detail = {}) {
  const item = detail.item || {};
  const candidate = detail.candidate || null;
  const recommendations = detail.recommendations || [];
  els.modalTitle.textContent = 'Work graph detail';
  els.modalBody.innerHTML = `
    <div class="notice-stack">
      <div class="item">
        <div class="item-title">
          <strong>${escapeHtml(item.title || 'Work item')}</strong>
          <span class="pill ${signalClass(item)}">${escapeHtml(item.priority || item.status || 'unknown')}</span>
        </div>
        <div class="meta">
          <span>${escapeHtml(item.sourceProvider || 'provider')}</span>
          <span>${escapeHtml(item.externalId || item.canonicalKey || 'no external id')}</span>
          <span>${escapeHtml(item.status || 'unknown')}</span>
          <span>Due ${formatDate(item.dueAt)}</span>
        </div>
        <div class="meta">${escapeHtml(item.description || 'No description captured yet.')}</div>
        ${item.url ? `<div class="meta"><a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">Open source item</a></div>` : ''}
        ${renderDependencySummary(detail.dependencySummary)}
      </div>
      ${renderGraphDetailSection('Decision Candidate', candidate ? [candidate] : [], renderGraphCandidateDetail)}
      ${renderGraphDetailSection('Dependency Edges', detail.dependencies || [], renderGraphDependency)}
      ${renderGraphDetailSection('Queued Recommendation History', recommendations, renderGraphRecommendationHistory)}
      ${renderGraphDetailSection('Recent Graph Events', detail.events || [], renderGraphEvent)}
      <div class="toolbar modal-actions">
        <button class="button" type="button" id="graphDetailQueue" ${item.id ? '' : 'disabled'}>Queue Yes/No</button>
        <button class="button primary" type="button" id="graphDetailClose">Done</button>
      </div>
    </div>
  `;
  els.modal.classList.add('open');
  document.getElementById('graphDetailClose').addEventListener('click', closeModal);
  document.getElementById('graphDetailQueue').addEventListener('click', () => queueGraphDecision(item.id));
  bindGraphActions();
}

function renderGraphDetailSection(title, items, renderer) {
  return `
    <section>
      <div class="panel-head evidence-head">
        <h2>${escapeHtml(title)}</h2>
        <span class="pill review">${items.length}</span>
      </div>
      <div class="list">${listOrEmpty(items.slice(0, 8), renderer)}</div>
    </section>
  `;
}

function graphRowAttrs({ providers = [], dependencyType = '', direction = '' } = {}) {
  return [
    'data-graph-ledger-row',
    `data-graph-providers="${escapeHtml(unique(providers).join('|'))}"`,
    `data-graph-dependency-type="${escapeHtml(dependencyType)}"`,
    `data-graph-direction="${escapeHtml(direction)}"`
  ].join(' ');
}

function renderGraphLinkedItem(item = {}) {
  return `
    <div class="item" ${graphRowAttrs({ providers: [item.sourceProvider] })}>
      <div class="item-title">
        <strong>${escapeHtml(item.title || item.externalId || 'Linked source')}</strong>
        <span class="pill review">${escapeHtml(item.sourceProvider || 'provider')}</span>
      </div>
      <div class="meta">
        <span>${escapeHtml(item.externalId || item.canonicalKey || 'no external id')}</span>
        <span>${escapeHtml(item.status || 'unknown')}</span>
      </div>
      <div class="item-actions">
        ${item.url ? `<a class="button" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">Open source</a>` : ''}
        ${item.id ? `<button class="button" data-graph-detail="${escapeHtml(item.id)}" type="button">Inspect graph</button>` : ''}
        ${item.id ? `<button class="button primary" data-graph-queue="${escapeHtml(item.id)}" type="button">Queue Yes/No</button>` : ''}
      </div>
    </div>
  `;
}

function renderGraphCandidateDetail(candidate) {
  const provider = candidate.sourceProvider || candidate.actionPayload?.sourceProvider || 'work_graph';
  const itemId = candidate.workItemId || candidate.actionPayload?.workItemId;
  const providerUrl = candidate.providerUrl || candidate.actionPayload?.providerUrl;
  return `
    <div class="item" ${graphRowAttrs({ providers: [provider] })}>
      <div class="item-title">
        <strong>${escapeHtml(candidate.title || candidate.recommendedAction || 'Decision candidate')}</strong>
        <span class="pill ${severityClass(candidate.riskLevel)}">${escapeHtml(candidate.ownerType || 'team')}</span>
      </div>
      <div class="meta">
        <span>${escapeHtml(provider)}</span>
        <span>${escapeHtml(candidate.findingType || 'graph_decision')}</span>
        <span>${escapeHtml(candidate.actionType || 'manual_review')}</span>
        <span>${Math.round(candidate.graphScore || 0)} score</span>
        <span>${Math.round((candidate.confidence || 0) * 100)}% confidence</span>
      </div>
      <div class="meta">${escapeHtml(candidate.approvalReason || candidate.description || candidate.recommendedAction || 'Review required.')}</div>
      ${renderDependencySummary(candidate.dependencySummary)}
      <div class="item-actions">
        ${providerUrl ? `<a class="button" href="${escapeHtml(providerUrl)}" target="_blank" rel="noreferrer">Open source</a>` : ''}
        ${itemId ? `<button class="button" data-graph-detail="${escapeHtml(itemId)}" type="button">Inspect graph</button>` : ''}
        ${itemId ? `<button class="button primary" data-graph-queue="${escapeHtml(itemId)}" type="button">Queue Yes/No</button>` : ''}
      </div>
    </div>
  `;
}

function renderGraphDependency(dependency) {
  const peer = dependency.peerItem || dependency.targetItem || dependency.unresolvedTarget || dependency.sourceItem || {};
  const freshness = dependency.freshnessStatus || 'fresh';
  const providers = [
    dependency.sourceProvider,
    dependency.targetProvider,
    dependency.sourceItem?.sourceProvider,
    dependency.targetItem?.sourceProvider,
    dependency.unresolvedTarget?.sourceProvider,
    peer.sourceProvider
  ];
  const edgeLabel = dependency.sourceItem && dependency.targetItem
    ? `${dependency.sourceItem.title || dependency.sourceItem.externalId || 'Source'} -> ${dependency.targetItem.title || dependency.targetItem.externalId || 'Target'}`
    : dependency.externalId;
  return `
    <div class="item" ${graphRowAttrs({
      providers,
      dependencyType: dependency.dependencyType,
      direction: dependency.direction
    })}>
      <div class="item-title">
        <strong>${escapeHtml(peer.title || edgeLabel || 'Linked work item')}</strong>
        <span class="pill review">${escapeHtml(dependency.dependencyType || 'unknown')}</span>
        ${freshness === 'stale' ? '<span class="pill critical">needs review</span>' : '<span class="pill healthy">fresh</span>'}
      </div>
      <div class="meta">
        <span>${escapeHtml(dependency.direction || 'related')}</span>
        <span>${escapeHtml(dependency.relationship || 'Dependency relationship')}</span>
        <span>${escapeHtml(dependency.resolutionStatus || 'resolved')}</span>
        <span>${escapeHtml(freshness)}</span>
        <span>${Math.round((dependency.confidence || 0) * 100)}% confidence</span>
      </div>
      <div class="meta">
        <span>${escapeHtml(peer.sourceProvider || dependency.targetProvider || dependency.sourceProvider || 'provider')}</span>
        <span>${escapeHtml(peer.externalId || dependency.targetExternalId || 'no external id')}</span>
        <span>${escapeHtml(peer.status || 'unknown')}</span>
        ${dependency.lastSeenAt ? `<span>seen ${formatDate(dependency.lastSeenAt)}</span>` : ''}
        <span>${escapeHtml(dependency.reviewStatus || 'unreviewed')}</span>
      </div>
      ${dependency.staleReason ? `<div class="meta">${escapeHtml(dependency.staleReason)}</div>` : ''}
      <div class="item-actions">
        ${dependency.sourceItem?.url ? `<a class="button" href="${escapeHtml(dependency.sourceItem.url)}" target="_blank" rel="noreferrer">Open source</a>` : ''}
        ${(dependency.targetItem?.url || dependency.unresolvedTarget?.url || dependency.targetUrl) ? `<a class="button" href="${escapeHtml(dependency.targetItem?.url || dependency.unresolvedTarget?.url || dependency.targetUrl)}" target="_blank" rel="noreferrer">Open target</a>` : ''}
        ${peer.id ? `<button class="button" data-graph-detail="${escapeHtml(peer.id)}" type="button">Inspect graph</button>` : ''}
        ${freshness === 'stale' && dependency.id ? `
          <button class="button" data-graph-dependency-review="${escapeHtml(dependency.id)}" data-graph-dependency-action="confirm" type="button">Confirm edge</button>
          <button class="button" data-graph-dependency-review="${escapeHtml(dependency.id)}" data-graph-dependency-action="refresh" type="button">Refresh trust</button>
          <button class="button danger" data-graph-dependency-review="${escapeHtml(dependency.id)}" data-graph-dependency-action="dismiss" type="button">Dismiss edge</button>
        ` : ''}
      </div>
    </div>
  `;
}

function renderGraphRecommendationHistory(recommendation) {
  const provider = recommendation.sourceProvider || 'work_graph';
  return `
    <div class="item" ${graphRowAttrs({ providers: [provider] })}>
      <div class="item-title">
        <strong>${escapeHtml(recommendation.title || recommendation.recommendedAction || 'Recommendation')}</strong>
        <span class="pill ${severityClass(recommendation.riskLevel)}">${escapeHtml(recommendation.status || 'pending')}</span>
      </div>
      <div class="meta">
        <span>${escapeHtml(provider)}</span>
        <span>${escapeHtml(recommendation.actionType || 'manual_review')}</span>
        <span>${escapeHtml(recommendation.ownerType || 'team')}</span>
        <span>${formatDate(recommendation.createdAt)}</span>
      </div>
      <div class="meta">${escapeHtml(recommendation.approvalReason || recommendation.recommendedAction || 'Review queued recommendation.')}</div>
      <div class="item-actions">
        ${recommendation.providerUrl ? `<a class="button" href="${escapeHtml(recommendation.providerUrl)}" target="_blank" rel="noreferrer">Open source</a>` : ''}
        ${recommendation.workItemId ? `<button class="button" data-graph-detail="${escapeHtml(recommendation.workItemId)}" type="button">Inspect graph</button>` : ''}
      </div>
    </div>
  `;
}

function renderGraphEvent(event) {
  return `
    <div class="item">
      <div class="item-title">
        <strong>${escapeHtml(event.summary || event.eventType || 'Graph event')}</strong>
        <span class="pill review">${escapeHtml(event.eventType || 'synced')}</span>
      </div>
      <div class="meta">
        <span>${formatDate(event.occurredAt)}</span>
        <span>${escapeHtml(event.sourceProvider || 'provider')}</span>
      </div>
    </div>
  `;
}

function renderWorkSignalContract(contract, connected) {
  const implemented = contract.adapterStatus === 'implemented';
  return `
    <div class="item">
      <div class="item-title">
        <strong>${escapeHtml(contract.connectorName)}</strong>
        <span class="pill ${connected ? 'connected' : implemented ? 'healthy' : 'review'}">${connected ? 'connected' : implemented ? 'adapter' : 'contract'}</span>
      </div>
      <div class="meta">
        <span>${escapeHtml(contract.category)}</span>
        <span>${escapeHtml(contract.authType)}</span>
        <span>${escapeHtml(contract.outputModel)}</span>
        <span>${escapeHtml(contract.adapterStatus || 'contract_only')}</span>
      </div>
      <div class="meta">${(contract.syncTargets || []).slice(0, 5).map(escapeHtml).join(' | ') || 'No sync targets declared'}</div>
      <div class="meta">${escapeHtml(contract.safeWritePolicy)}</div>
    </div>
  `;
}

function renderConnectors() {
  els.connectorCount.textContent = state.connectors.length;
  els.connectedCount.textContent = `${state.accounts.length} connected`;
  renderCategories();

  const selectedCategory = state.categories.find(category => category.id === state.category);
  els.connectorHeading.textContent = selectedCategory ? selectedCategory.name : 'All connectors';

  const connectedIds = new Set(state.accounts.map(account => account.connectorId));
  const filtered = state.connectors.filter((connector) => {
    const categoryMatch = state.category === 'all' || connector.category === state.category;
    const text = `${connector.name} ${connector.description} ${connector.categoryName}`.toLowerCase();
    return categoryMatch && (!state.search || text.includes(state.search));
  });

  els.connectorGrid.innerHTML = filtered.length === 0
    ? '<div class="empty">No connectors match this view.</div>'
    : filtered.map(connector => renderConnector(connector, connectedIds.has(connector.id))).join('');

  document.querySelectorAll('[data-connect]').forEach((button) => {
    button.addEventListener('click', () => startConnection(button.dataset.connect));
  });
}

function renderCategories() {
  const allCount = state.connectors.length;
  const rows = [{ id: 'all', name: 'All tools', count: allCount }, ...state.categories];
  els.categoryList.innerHTML = rows.map(category => `
    <button class="${state.category === category.id ? 'active' : ''}" data-category="${category.id}" type="button">
      <span>${escapeHtml(category.name)}</span>
      <span>${category.count}</span>
    </button>
  `).join('');
  document.querySelectorAll('[data-category]').forEach((button) => {
    button.addEventListener('click', () => {
      state.category = button.dataset.category;
      renderConnectors();
    });
  });
}

function renderConnector(connector, connected) {
  const initials = connector.name.split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase();
  const configured = connector.auth.configured;
  const authLabel = connector.auth.type === 'oauth2' ? 'OAuth' : connector.auth.type.replaceAll('_', ' ');
  return `
    <div class="connector-card">
      <div class="connector-top">
        <div class="connector-identity">
          <div class="connector-logo">${escapeHtml(initials)}</div>
          <div>
            <h3>${escapeHtml(connector.name)}</h3>
            <div class="meta"><span>${escapeHtml(connector.categoryName)}</span><span>${escapeHtml(authLabel)}</span></div>
          </div>
        </div>
        <span class="pill ${connected ? 'connected' : configured ? 'review' : 'high'}">${connected ? 'connected' : configured ? 'ready' : 'setup'}</span>
      </div>
      <p>${escapeHtml(connector.description)}</p>
      <div class="connector-actions">
        <span class="meta">${connector.sync.slice(0, 3).map(escapeHtml).join('  |  ')}</span>
        <button class="button ${configured || connector.auth.type !== 'oauth2' ? 'primary' : ''}" data-connect="${connector.id}" type="button">
          ${connected ? 'Manage' : 'Connect'}
        </button>
      </div>
    </div>
  `;
}

async function startConnection(connectorId) {
  const connector = state.connectors.find(item => item.id === connectorId);
  if (!connector) return;
  try {
    const response = await apiFetch(`/api/connectors/${connectorId}/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ returnTo: '/?connectors=1' })
    });
    const data = await response.json();
    if (!data.success) throw new Error(data.error || 'Could not start connection');

    if (data.authUrl) {
      window.location.href = data.authUrl;
      return;
    }

    openCredentialModal(connector, data);
  } catch (error) {
    openNotice(connector.name, error.message);
  }
}

function openCredentialModal(connector, data) {
  const fields = data.fields || connector.auth.fields || [];
  els.modalTitle.textContent = `Connect ${connector.name}`;
  els.modalBody.innerHTML = `
    <form id="credentialForm">
      ${fields.map(field => `
        <div class="field">
          <label for="field-${field.name}">${escapeHtml(field.label || field.name)}</label>
          <input id="field-${field.name}" name="${field.name}" type="${field.secret ? 'password' : 'text'}" ${field.required ? 'required' : ''}>
        </div>
      `).join('')}
      <div class="field">
        <label for="accountName">Account name</label>
        <input id="accountName" name="accountName" type="text" placeholder="${escapeHtml(connector.name)}">
      </div>
      <div class="notice">Credential storage is locked until MongoDB plus CONNECTOR_ENCRYPTION_KEY are configured.</div>
      <div class="toolbar modal-actions">
        <button class="button" type="button" id="cancelCredential">Cancel</button>
        <button class="button primary" type="submit">Save account</button>
      </div>
    </form>
  `;
  els.modal.classList.add('open');
  document.getElementById('cancelCredential').addEventListener('click', closeModal);
  document.getElementById('credentialForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.target).entries());
    try {
      const response = await apiFetch(`/api/connectors/${connector.id}/accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error || 'Could not save account');
      closeModal();
      await loadConnectors();
    } catch (error) {
      openNotice(connector.name, error.message);
    }
  });
}

function openNotice(title, message) {
  els.modalTitle.textContent = title;
  els.modalBody.innerHTML = `
    <div class="notice-stack">
      <div class="notice">${escapeHtml(message)}</div>
      <div class="toolbar modal-actions">
        <button class="button primary" type="button" id="noticeClose">Done</button>
      </div>
    </div>
  `;
  els.modal.classList.add('open');
  document.getElementById('noticeClose').addEventListener('click', closeModal);
}

function closeModal() {
  els.modal.classList.remove('open');
}

function listOrEmpty(items, renderer) {
  return items && items.length > 0
    ? items.map(renderer).join('')
    : '<div class="empty">Nothing needs attention.</div>';
}

function severityClass(value) {
  if (value === 'critical') return 'critical';
  if (value === 'high' || value === 'at_risk') return 'high';
  if (value === 'connected' || value === 'healthy') return 'healthy';
  return 'review';
}

function priorityBadgeClass(priority) {
  if (priority === 'P0') return 'critical';
  if (priority === 'P1') return 'high';
  if (priority === 'P2') return 'review';
  return 'healthy';
}

function signalClass(signal = {}) {
  if (signal.priority === 'critical' || signal.status === 'blocked') return 'critical';
  if (signal.priority === 'high' || signal.status === 'waiting') return 'high';
  if (signal.status === 'done' || signal.status === 'archived') return 'healthy';
  return 'review';
}

function getId(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value._id) return value._id;
  if (value.id) return value.id;
  return String(value);
}

function formatDate(value) {
  if (!value) return 'No date';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'No date' : date.toLocaleString();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function cssEscape(value) {
  if (window.CSS?.escape) return window.CSS.escape(String(value || ''));
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

function renderConfidence(value) {
  const safeValue = clampPercent(value);
  return `<progress class="confidence-meter" value="${safeValue}" max="100" aria-label="Confidence ${safeValue}%"></progress>`;
}

function renderBar(value, label) {
  const safeValue = clampPercent(value);
  return `<progress class="bar-meter" value="${safeValue}" max="100" aria-label="${escapeHtml(label)}"></progress>`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

loadAll();
