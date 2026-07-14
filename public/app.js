const FIRST_RUN_SETUP_KEY = 'sneup.firstRun.v1';
const SESSION_TOKEN_KEY = 'sneup.sessionToken.v1';
const CONNECTOR_PAGE_SIZE = 24;
let connectorSearchTimer;

const state = {
  snapshot: null,
  operationsBrief: null,
  jobDashboard: null,
  responseTiming: null,
  rateLimitMetrics: null,
  connectors: [],
  categories: [],
  accounts: [],
  connectorSafety: null,
  connectorTotal: 0,
  connectorCatalogTotal: 0,
  connectorSyncReadiness: null,
  workSignals: [],
  workGraph: null,
  workGraphCandidates: [],
  workSignalContracts: [],
  workSignalError: '',
  securityContext: null,
  currentWorkspace: null,
  workspaces: [],
  workspaceUsers: [],
  workspaceInvitations: [],
  policyRules: [],
  policyRuleError: '',
  policyHistory: [],
  policyHistoryError: '',
  activeWorkspaceId: localStorage.getItem('sneup.workspaceId') || '',
  sessionToken: sessionStorage.getItem(SESSION_TOKEN_KEY) || '',
  enhancements: [],
  enhancementSummary: {},
  recommendationEvaluation: null,
  enhancementPriority: 'all',
  enhancementArea: 'all',
  enhancementStatus: 'all',
  reports: [],
  forecast: null,
  loadedViews: new Set(),
  viewLoads: new Map(),
  connectorRequest: null,
  ledger: {
    decisions: [],
    recommendations: [],
    actions: [],
    auditEvents: [],
    followUps: [],
    accountability: null,
    outcomes: [],
    findings: [],
    healthSnapshots: [],
    reconciliationHealth: null,
    notificationPolicies: [],
    notificationDeliveries: [],
    errors: []
  },
  category: 'all',
  search: '',
  queueFilter: 'all',
  signalFilter: 'all',
  setupMode: localStorage.getItem(FIRST_RUN_SETUP_KEY) || ''
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
  notificationPolicies: document.getElementById('notificationPolicies'),
  notificationPolicyCount: document.getElementById('notificationPolicyCount'),
  notificationPolicyButton: document.getElementById('notificationPolicyButton'),
  notificationDeliveries: document.getElementById('notificationDeliveries'),
  notificationDeliveryCount: document.getElementById('notificationDeliveryCount'),
  findingsList: document.getElementById('findingsList'),
  findingsCount: document.getElementById('findingsCount'),
  boardHealthList: document.getElementById('boardHealthList'),
  boardHealthCount: document.getElementById('boardHealthCount'),
  followUps: document.getElementById('followUps'),
  followUpCount: document.getElementById('followUpCount'),
  accountabilityList: document.getElementById('accountabilityList'),
  accountabilityCount: document.getElementById('accountabilityCount'),
  outcomeList: document.getElementById('outcomeList'),
  outcomeCount: document.getElementById('outcomeCount'),
  auditTrail: document.getElementById('auditTrail'),
  auditCount: document.getElementById('auditCount'),
  connectorCount: document.getElementById('connectorCount'),
  connectorGrid: document.getElementById('connectorGrid'),
  connectorPagination: document.getElementById('connectorPagination'),
  categoryList: document.getElementById('categoryList'),
  connectorSearch: document.getElementById('connectorSearch'),
  connectorHeading: document.getElementById('connectorHeading'),
  connectedCount: document.getElementById('connectedCount'),
  connectorSafety: document.getElementById('connectorSafety'),
  enhancementCount: document.getElementById('enhancementCount'),
  enhancementMetrics: document.getElementById('enhancementMetrics'),
  enhancementStatusSummary: document.getElementById('enhancementStatusSummary'),
  enhancementsList: document.getElementById('enhancementsList'),
  enhancementAreaFilter: document.getElementById('enhancementAreaFilter'),
  reportCount: document.getElementById('reportCount'),
  reportMode: document.getElementById('reportMode'),
  reportList: document.getElementById('reportList'),
  forecastCount: document.getElementById('forecastCount'),
  forecastMetrics: document.getElementById('forecastMetrics'),
  forecastMode: document.getElementById('forecastMode'),
  forecastCapacityCount: document.getElementById('forecastCapacityCount'),
  forecastCapacity: document.getElementById('forecastCapacity'),
  portfolioForecast: document.getElementById('portfolioForecast'),
  forecastBoardCount: document.getElementById('forecastBoardCount'),
  forecastBoards: document.getElementById('forecastBoards'),
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
  workspaceInviteCount: document.getElementById('workspaceInviteCount'),
  workspaceInvitations: document.getElementById('workspaceInvitations'),
  workspaceInviteButton: document.getElementById('workspaceInviteButton'),
  policyRuleCount: document.getElementById('policyRuleCount'),
  policyRuleList: document.getElementById('policyRuleList'),
  policyHistoryCount: document.getElementById('policyHistoryCount'),
  policyHistoryList: document.getElementById('policyHistoryList'),
  setupButton: document.getElementById('setupButton'),
  modal: document.getElementById('connectorModal'),
  modalTitle: document.getElementById('modalTitle'),
  modalBody: document.getElementById('modalBody')
};

document.querySelectorAll('[data-view-button]').forEach((button) => {
  button.addEventListener('click', () => showView(button.dataset.viewButton));
});

document.getElementById('refreshButton').addEventListener('click', () => loadAll({ force: true }));
document.getElementById('approvalButton').addEventListener('click', () => showView('approvals'));
document.getElementById('connectorButton').addEventListener('click', () => showView('connectors'));
els.setupButton.addEventListener('click', () => openFirstRunSetup());
els.notificationPolicyButton.addEventListener('click', openNotificationPolicy);
els.workspaceInviteButton.addEventListener('click', openWorkspaceInvite);
els.workspaceSelect.addEventListener('change', async (event) => {
  state.activeWorkspaceId = event.target.value;
  if (state.activeWorkspaceId) {
    localStorage.setItem('sneup.workspaceId', state.activeWorkspaceId);
  } else {
    localStorage.removeItem('sneup.workspaceId');
  }
  await loadAll({ force: true });
});
document.getElementById('closeModal').addEventListener('click', closeModal);
els.modal.addEventListener('click', (event) => {
  if (event.target === els.modal) closeModal();
});
els.connectorSearch.addEventListener('input', (event) => {
  state.search = event.target.value.toLowerCase();
  clearTimeout(connectorSearchTimer);
  connectorSearchTimer = setTimeout(() => loadConnectors(), 180);
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

async function showView(viewName) {
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
    forecasts: 'Capacity and delivery forecasts',
    reports: 'Stakeholder reports',
    workspaces: 'Workspace administration'
  };
  document.getElementById('pageTitle').textContent = titles[viewName] || titles.overview;
  await loadView(viewName);
}

function openFirstRunSetup() {
  let selectedMode = state.setupMode || 'demo';
  const modeDetails = {
    demo: {
      title: 'Demo workspace',
      copy: 'Explore Sneup with local sample activity. No provider account is connected.'
    },
    live: {
      title: 'Connect workspace',
      copy: 'Sneup will restart and attempt your database-backed workspace. If the database is unavailable, it remains safely in catalog/demo mode.'
    }
  };

  const renderSelection = () => {
    const detail = modeDetails[selectedMode];
    document.querySelectorAll('[data-setup-mode]').forEach((button) => {
      const isSelected = button.dataset.setupMode === selectedMode;
      button.classList.toggle('active', isSelected);
      button.setAttribute('aria-pressed', String(isSelected));
    });
    const title = document.getElementById('setupModeTitle');
    const copy = document.getElementById('setupModeCopy');
    if (title) title.textContent = detail.title;
    if (copy) copy.textContent = detail.copy;
  };

  els.modalTitle.textContent = 'Set up Sneup';
  els.modalBody.innerHTML = `
    <div class="setup-flow">
      <p class="setup-intro">Choose how this device starts. You can return here whenever your workspace is ready.</p>
      <div class="segmented setup-mode" role="group" aria-label="Sneup startup mode">
        <button data-setup-mode="demo" type="button">Demo workspace</button>
        <button data-setup-mode="live" type="button">Connect workspace</button>
      </div>
      <div class="setup-selection" aria-live="polite">
        <strong id="setupModeTitle"></strong>
        <p id="setupModeCopy"></p>
      </div>
      <div class="notice">This device stores only the startup mode. Sneup does not collect credentials during setup.</div>
      <div class="toolbar modal-actions">
        <button class="button primary" type="button" id="completeSetup">${window.sneupDesktop?.saveStartupMode ? 'Save and restart' : 'Continue'}</button>
      </div>
    </div>
  `;
  els.modal.classList.add('open');
  renderSelection();

  document.querySelectorAll('[data-setup-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      selectedMode = button.dataset.setupMode;
      renderSelection();
    });
  });
  document.getElementById('completeSetup').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    state.setupMode = selectedMode;
    localStorage.setItem(FIRST_RUN_SETUP_KEY, selectedMode);

    if (window.sneupDesktop?.saveStartupMode && window.sneupDesktop?.restart) {
      button.disabled = true;
      button.textContent = 'Restarting...';
      try {
        await window.sneupDesktop.saveStartupMode(selectedMode);
        await window.sneupDesktop.restart();
        return;
      } catch (error) {
        button.disabled = false;
        button.textContent = 'Save and restart';
        openNotice('Startup preference failed', error.message || 'Sneup could not save this startup mode.');
        return;
      }
    }

    closeModal();
    if (selectedMode === 'live') showView('connectors');
  });
}

const viewLoaders = {
  overview: () => Promise.all([
    loadMissionControl(),
    loadOperationsBrief(),
    loadJobDashboard()
  ]),
  approvals: loadOperationsLedger,
  connectors: loadConnectors,
  enhancements: loadEnhancements,
  signals: loadWorkSignals,
  forecasts: loadForecast,
  reports: loadReports,
  workspaces: loadWorkspaceAdmin
};

const deferredViewCounts = {
  approvals: els.approvalCount,
  connectors: els.connectorCount,
  enhancements: els.enhancementCount,
  signals: els.workSignalCount,
  forecasts: els.forecastCount,
  reports: els.reportCount,
  workspaces: els.workspaceCount
};

function markDeferredViewCounts() {
  Object.entries(deferredViewCounts).forEach(([viewName, element]) => {
    if (!state.loadedViews.has(viewName)) element.textContent = '...';
  });
}

async function loadView(viewName, options = {}) {
  const loader = viewLoaders[viewName];
  if (!loader || (!options.force && state.loadedViews.has(viewName))) return;

  // Repeated navigation and refresh clicks should share an in-progress view load.
  const inFlight = state.viewLoads.get(viewName);
  if (inFlight) return inFlight;

  const load = Promise.resolve()
    .then(loader)
    .then(() => state.loadedViews.add(viewName))
    .finally(() => state.viewLoads.delete(viewName));
  state.viewLoads.set(viewName, load);
  return load;
}

async function loadAll(options = {}) {
  await loadSecurityContext();
  renderEnhancementFilters();
  if (options.force) state.loadedViews.clear();
  if (options.force || state.loadedViews.size === 0) markDeferredViewCounts();
  const activeView = document.querySelector('[data-view-button].active')?.dataset.viewButton || 'overview';
  await loadView(activeView, { force: options.force });
}

async function loadReports() {
  try {
    const data = await fetchApi('/api/reports');
    state.reports = data.reports || [];
    renderReports();
  } catch (error) {
    state.reports = [];
    renderReports(error.message);
  }
}

async function loadForecast() {
  try {
    const data = await fetchApi('/api/forecasts');
    state.forecast = data.forecast || null;
    renderForecast();
  } catch (error) {
    state.forecast = null;
    renderForecast(error.message);
  }
}

function renderForecast(errorMessage = '') {
  const forecast = state.forecast;
  if (!forecast) {
    els.forecastCount.textContent = '0';
    els.forecastMode.textContent = 'unavailable';
    els.forecastMode.className = 'pill critical';
    els.forecastMetrics.innerHTML = '';
    els.portfolioForecast.innerHTML = `<div class="empty">${escapeHtml(errorMessage || 'Forecast unavailable')}</div>`;
    els.forecastCapacity.innerHTML = '';
    els.forecastBoards.innerHTML = '';
    return;
  }

  const portfolio = forecast.portfolio || {};
  const members = forecast.memberCapacity || [];
  const boards = forecast.boards || [];
  const utilization = forecast.dataQuality?.utilization || {};
  const allocations = forecast.dataQuality?.allocations || {};
  const calendar = forecast.dataQuality?.calendar || {};
  els.forecastCount.textContent = String(boards.filter(board => board.health !== 'on_track').length);
  els.forecastMode.textContent = forecast.mode === 'demo' ? 'demo' : 'analysis only';
  els.forecastMode.className = `pill ${forecast.mode === 'demo' ? 'review' : 'healthy'}`;
  els.forecastCapacityCount.textContent = `${members.length} people`;
  els.forecastBoardCount.textContent = `${boards.length} boards`;
  els.forecastMetrics.innerHTML = [
    ['P50 delivery', formatForecastDate(portfolio.p50?.date)],
    ['P80 delivery', formatForecastDate(portfolio.p80?.date)],
    ['Forecast confidence', `${portfolio.confidence || 0}%`],
    ['Open cards', portfolio.openCards || 0],
    ['Weekly capacity', `${portfolio.weeklyAvailableHours || 0}h`],
    ['Estimated work', `${portfolio.workHours || 0}h`],
    ['Tracked utilization', utilization.entries ? `${utilization.weeklyHours || 0}h/week from ${formatProviderNames(utilization.activeProviders)}` : 'No tracked-time evidence'],
    ['Mapped allocations', allocations.matchedEntries ? `${allocations.matchedWeeklyHours || 0}h/week` : 'No resourcing evidence'],
    ['Board-mapped schedule', allocations.mappedProjectEntries ? `${allocations.mappedProjectWeeklyHours || 0}h/week` : 'No project mappings'],
    ['Mapped calendar', calendar.matchedEntries ? `${calendar.matchedWeeklyHours || 0}h/week` : 'No calendar evidence']
  ].map(([label, value]) => `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
  els.portfolioForecast.innerHTML = renderForecastSummary(portfolio);
  els.forecastCapacity.innerHTML = listOrEmpty(members, renderCapacityMember);
  els.forecastBoards.innerHTML = listOrEmpty(boards, renderBoardForecast);
  document.querySelectorAll('[data-capacity-member]').forEach((button) => {
    button.addEventListener('click', () => openCapacityEditor(button.dataset.capacityMember));
  });
  document.querySelectorAll('[data-board-project-mappings]').forEach((button) => {
    button.addEventListener('click', () => openBoardProjectMappingsEditor(button.dataset.boardProjectMappings));
  });
}

function formatForecastDate(value) {
  if (!value) return 'Needs capacity';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Needs capacity' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatProviderNames(providers = []) {
  const labels = providers.map(provider => ({ harvest: 'Harvest', everhour: 'Everhour', toggl_track: 'Toggl Track', clockify: 'Clockify' }[provider] || provider)).filter(Boolean);
  if (labels.length <= 1) return labels[0] || 'connected time tools';
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

function renderForecastSummary(forecast = {}) {
  return `
    <div class="item forecast-summary">
      <div class="item-title">
        <strong>${escapeHtml(forecast.boardName || 'Portfolio')}</strong>
        <span class="pill ${forecast.health === 'at_risk' ? 'high' : forecast.health === 'watch' ? 'review' : 'healthy'}">${escapeHtml(forecast.health || 'unknown')}</span>
      </div>
      <div class="meta"><span>P50 ${escapeHtml(formatForecastDate(forecast.p50?.date))}</span><span>P80 ${escapeHtml(formatForecastDate(forecast.p80?.date))}</span><span>${forecast.openCards || 0} open cards</span><span>${forecast.utilizationPercent ?? 'n/a'}% modeled load</span></div>
      <div class="meta">${escapeHtml(forecast.confidenceLabel || 'low evidence')} confidence: forecast uses explicit capacity and uncertainty assumptions.</div>
      ${(forecast.risks || []).length ? `<div class="forecast-risks">${forecast.risks.map(risk => `<span class="pill high">${escapeHtml(risk)}</span>`).join('')}</div>` : ''}
      <details class="payload"><summary>Assumptions</summary><div class="forecast-assumptions">${(forecast.assumptions || []).map(item => `<p>${escapeHtml(item)}</p>`).join('')}</div></details>
    </div>
  `;
}

function renderBoardForecast(forecast = {}) {
  const editable = Boolean(state.securityContext?.permissions?.includes('capacity:manage'));
  return `
    <article class="connector-card forecast-card">
      <div class="connector-top"><div><h3>${escapeHtml(forecast.boardName || 'Board')}</h3><p>${forecast.openCards || 0} open cards and ${forecast.workHours || 0} modeled work hours.</p></div><span class="pill ${forecast.health === 'at_risk' ? 'high' : forecast.health === 'watch' ? 'review' : 'healthy'}">${escapeHtml(forecast.health || 'unknown')}</span></div>
      <div class="forecast-dates"><span><strong>P50</strong>${escapeHtml(formatForecastDate(forecast.p50?.date))}</span><span><strong>P80</strong>${escapeHtml(formatForecastDate(forecast.p80?.date))}</span><span><strong>Confidence</strong>${forecast.confidence || 0}%</span></div>
      <div class="meta">${(forecast.risks || []).slice(0, 2).map(escapeHtml).join(' | ') || 'No material delivery risk detected.'}</div>
      <div class="meta">${forecast.mappedProjectScheduleEntriesNext28Days ? `Mapped project schedule: ${escapeHtml(forecast.mappedProjectScheduleWeeklyHours || 0)}h/week.` : 'No provider project schedule is mapped to this board.'}</div>
      ${editable && forecast.boardId ? `<div class="connector-actions"><button class="button" type="button" data-board-project-mappings="${escapeHtml(forecast.boardId)}">Map provider projects</button></div>` : ''}
    </article>
  `;
}

function openBoardProjectMappingsEditor(boardId) {
  const board = (state.forecast?.boards || []).find(item => String(item.boardId) === String(boardId));
  if (!board) return;
  const mappings = (board.externalProjectMappings || []).map(item => `${item.provider}: ${item.projectId}`).join('\n');
  els.modalTitle.textContent = `Project mappings: ${board.boardName || 'board'}`;
  els.modalBody.innerHTML = `
    <form id="boardProjectMappingsForm">
      <div class="notice">Only explicit Float or Resource Guru project IDs scope schedule evidence to this board. Mapped schedules remain analysis-only and do not change provider data or delivery capacity.</div>
      <div class="field"><label for="boardProjectMappings">Provider project IDs (one provider: ID per line)</label><textarea id="boardProjectMappings" name="externalProjectMappings" placeholder="float: 123&#10;resource_guru: 456">${escapeHtml(mappings)}</textarea></div>
      <div class="toolbar modal-actions"><button class="button" type="button" id="cancelBoardProjectMappings">Cancel</button><button class="button primary" type="submit">Save project mappings</button></div>
    </form>
  `;
  els.modal.classList.add('open');
  document.getElementById('cancelBoardProjectMappings').addEventListener('click', closeModal);
  document.getElementById('boardProjectMappingsForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      await fetchApi(`/api/forecasts/boards/${boardId}/project-mappings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          externalProjectMappings: form.elements.externalProjectMappings.value.split('\n').map((line) => {
            const separator = line.indexOf(':');
            return separator > 0 ? { provider: line.slice(0, separator).trim(), projectId: line.slice(separator + 1).trim() } : null;
          }).filter(Boolean)
        })
      });
      closeModal();
      await loadForecast();
      openNotice('Project mappings saved', 'Sneup refreshed board-scoped schedule evidence without changing provider data.');
    } catch (error) {
      submit.disabled = false;
      openNotice('Project mapping update failed', error.message);
    }
  });
}

function renderCapacityMember(member = {}) {
  const editable = Boolean(state.securityContext?.permissions?.includes('capacity:manage'));
  return `
    <div class="item">
      <div class="item-title"><strong>${escapeHtml(member.name || 'Team member')}</strong><span class="pill ${member.configured ? 'healthy' : 'review'}">${member.configured ? 'configured' : 'default'}</span></div>
      <div class="meta"><span>${member.weeklyAvailableHours || 0}h/week</span><span>${member.dailyAvailableHours || 0}h/day</span><span>${member.allocationPercent || 0}% allocation</span><span>${member.focusHoursPerWeek || 0}h focus</span>${member.timeOffHours ? `<span>${member.timeOffHours}h planned time off</span>` : ''}</div>
      <div class="meta">Historical card effort: ${member.historicalCardHours || 0}h. ${member.trackedTimeEntriesLast28Days ? `${escapeHtml(formatProviderNames(member.trackedTimeProvidersLast28Days))} tracked ${member.trackedTimeWeeklyHours || 0}h/week recently.` : 'No matched tracked-time evidence.'} ${member.scheduledAllocationEntriesNext28Days ? `Mapped allocations schedule ${member.scheduledAllocationWeeklyHours || 0}h/week.` : 'No mapped allocation evidence.'} ${member.calendarEventsNext28Days ? `Mapped calendar blocks ${member.calendarBusyWeeklyHours || 0}h/week.` : 'No mapped calendar evidence.'} ${(member.skills || []).map(escapeHtml).join(' | ') || 'No skills recorded.'}</div>
      ${editable ? `<div class="item-actions"><button class="button" type="button" data-capacity-member="${escapeHtml(member.memberId)}">Edit capacity</button></div>` : ''}
    </div>
  `;
}

function openCapacityEditor(memberId) {
  const member = (state.forecast?.memberCapacity || []).find(item => String(item.memberId) === String(memberId));
  if (!member) return;
  const externalIdentities = (member.externalIdentities || []).map(item => `${item.provider}: ${item.externalId}`).join('\n');
  els.modalTitle.textContent = `Capacity: ${member.name || 'team member'}`;
  els.modalBody.innerHTML = `
    <form id="capacityProfileForm">
      <div class="notice">Capacity updates are analysis inputs only. They do not change any provider account or work item.</div>
      <div class="field"><label for="capacityWeeklyHours">Weekly hours</label><input id="capacityWeeklyHours" name="weeklyHours" type="number" min="1" max="80" value="${escapeHtml(member.weeklyHours || 32)}" required></div>
      <div class="field"><label for="capacityAllocation">Allocation percentage</label><input id="capacityAllocation" name="allocationPercent" type="number" min="0" max="100" value="${escapeHtml(member.allocationPercent ?? 100)}" required></div>
      <div class="field"><label for="capacityFocus">Focus hours per week</label><input id="capacityFocus" name="focusHoursPerWeek" type="number" min="0" max="80" value="${escapeHtml(member.focusHoursPerWeek || 0)}" required></div>
      <div class="field"><label for="capacitySkills">Skills (comma-separated)</label><input id="capacitySkills" name="skills" type="text" value="${escapeHtml((member.skills || []).join(', '))}"></div>
      <div class="field"><label for="capacityExternalIdentities">Capacity evidence IDs (one provider: ID per line)</label><textarea id="capacityExternalIdentities" name="externalIdentities" placeholder="float: 123&#10;google_workspace: person@example.com">${escapeHtml(externalIdentities)}</textarea></div>
      <div class="field"><label for="capacityTimeOff">Planned time off (one YYYY-MM-DD to YYYY-MM-DD range per line)</label><textarea id="capacityTimeOff" name="timeOff">${escapeHtml((member.timeOff || []).map(item => `${String(item.startDate || '').slice(0, 10)} to ${String(item.endDate || '').slice(0, 10)}${item.label ? ` | ${item.label}` : ''}`).join('\n'))}</textarea></div>
      <div class="toolbar modal-actions"><button class="button" type="button" id="cancelCapacityEdit">Cancel</button><button class="button primary" type="submit">Save capacity</button></div>
    </form>
  `;
  els.modal.classList.add('open');
  document.getElementById('cancelCapacityEdit').addEventListener('click', closeModal);
  document.getElementById('capacityProfileForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      await fetchApi(`/api/forecasts/capacity/${memberId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          weeklyHours: form.elements.weeklyHours.value,
          allocationPercent: form.elements.allocationPercent.value,
          focusHoursPerWeek: form.elements.focusHoursPerWeek.value,
          skills: form.elements.skills.value.split(',').map(skill => skill.trim()).filter(Boolean),
          externalIdentities: form.elements.externalIdentities.value.split('\n').map((line) => {
            const separator = line.indexOf(':');
            return separator > 0 ? { provider: line.slice(0, separator).trim(), externalId: line.slice(separator + 1).trim() } : null;
          }).filter(Boolean),
          timeOff: form.elements.timeOff.value.split('\n').map((line) => {
            const [range, label] = line.split('|');
            const [startDate, endDate] = range.split(/\s+to\s+/i).map(value => value.trim());
            return startDate && endDate ? { startDate, endDate, label: label?.trim() || '' } : null;
          }).filter(Boolean)
        })
      });
      closeModal();
      await loadForecast();
      openNotice('Capacity saved', 'Sneup refreshed the analysis-only delivery forecast.');
    } catch (error) {
      submit.disabled = false;
      openNotice('Capacity update failed', error.message);
    }
  });
}

function renderReports(errorMessage = '') {
  els.reportCount.textContent = state.reports.length || 0;
  els.reportMode.textContent = errorMessage ? 'unavailable' : 'read-only';
  els.reportMode.className = `pill ${errorMessage ? 'critical' : 'healthy'}`;
  els.reportList.innerHTML = errorMessage
    ? `<div class="empty">${escapeHtml(errorMessage)}</div>`
    : listOrEmpty(state.reports, (report) => `
      <div class="item report-item">
        <div class="item-title">
          <strong>${escapeHtml(report.label)}</strong>
          <span class="pill review">read-only</span>
        </div>
        <div class="meta">Uses current command, risk, decision, owner, date, and source-evidence context.</div>
        <div class="item-actions">
          <button class="button" data-report-download="${escapeHtml(report.id)}" data-report-format="markdown" type="button">Markdown</button>
          <button class="button primary" data-report-download="${escapeHtml(report.id)}" data-report-format="pdf" type="button">PDF</button>
        </div>
      </div>
    `);

  document.querySelectorAll('[data-report-download]').forEach((button) => {
    button.addEventListener('click', () => downloadReport(button.dataset.reportDownload, button.dataset.reportFormat));
  });
}

function downloadReport(reportType, format) {
  const report = state.reports.find(item => item.id === reportType);
  if (!report || !['markdown', 'pdf'].includes(format)) return;
  const url = `/api/reports/${encodeURIComponent(reportType)}?format=${encodeURIComponent(format)}`;
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${report.filename || reportType}.${format === 'markdown' ? 'md' : 'pdf'}`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
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
    const [response, evaluationResponse] = await Promise.all([
      fetchApi(`/api/enhancements${params.toString() ? `?${params}` : ''}`),
      fetchApi('/api/enhancements/evaluations/recommendations')
    ]);
    state.enhancements = response.enhancements || [];
    state.enhancementSummary = response.summary || {};
    state.recommendationEvaluation = evaluationResponse.report || null;
    renderEnhancements();
  } catch (error) {
    state.enhancements = [];
    state.enhancementSummary = {};
    state.recommendationEvaluation = null;
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

  if (state.sessionToken && !headers.Authorization) {
    headers.Authorization = `Bearer ${state.sessionToken}`;
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
    const [response, timing] = await Promise.all([
      apiFetch('/api/jobs'),
      fetchApi('/api/security/response-timing').catch(() => ({ timing: null }))
    ]);
    const data = await response.json();
    if (!data.success) throw new Error(data.error || 'Job health unavailable');
    state.jobDashboard = data.dashboard;
    state.responseTiming = timing.timing || null;
    state.rateLimitMetrics = timing.rateLimit || null;
    renderJobDashboard();
  } catch (error) {
    state.jobDashboard = null;
    state.responseTiming = null;
    state.rateLimitMetrics = null;
    els.jobHealthCount.textContent = '0 tracked';
    els.jobHealthList.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
  }
}

async function loadConnectors({ append = false } = {}) {
  if (state.connectorRequest) state.connectorRequest.abort();
  const request = new AbortController();
  state.connectorRequest = request;

  try {
    const offset = append ? state.connectors.length : 0;
    const query = new URLSearchParams({
      limit: String(CONNECTOR_PAGE_SIZE),
      offset: String(offset)
    });
    if (state.category !== 'all') query.set('category', state.category);
    if (state.search) query.set('search', state.search);

    const data = await fetchApi(`/api/connectors?${query}`, { signal: request.signal });
    if (state.connectorRequest !== request) return;
    const connectors = data.connectors || [];
    state.connectors = append ? [...state.connectors, ...connectors] : connectors;
    state.categories = data.categories || [];
    state.accounts = data.accounts || [];
    state.connectorSafety = data.safety || null;
    state.connectorTotal = data.total || 0;
    state.connectorCatalogTotal = data.catalogTotal || state.connectorTotal;
    state.connectorSyncReadiness = data.syncReadiness || null;
    renderConnectors();
  } catch (error) {
    if (error.name === 'AbortError' || state.connectorRequest !== request) return;
    els.connectorGrid.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
  } finally {
    if (state.connectorRequest === request) state.connectorRequest = null;
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
    if (current.auth?.demoMode) {
      state.activeWorkspaceId = current.workspace.id;
      state.workspaces = [current.workspace];
      state.workspaceUsers = [];
      state.workspaceInvitations = [];
      state.policyRules = [];
      state.policyRuleError = '';
      state.policyHistory = [];
      state.policyHistoryError = '';
      renderWorkspaces();
      return;
    }
    try {
      const [policyData, historyData] = await Promise.all([
        fetchApi('/api/policy-rules'),
        fetchApi('/api/policy-rules/history?limit=25')
      ]);
      state.policyRules = policyData.policies || [];
      state.policyRuleError = '';
      state.policyHistory = historyData.history || [];
      state.policyHistoryError = '';
    } catch (error) {
      state.policyRules = [];
      state.policyRuleError = error.message;
      state.policyHistory = [];
      state.policyHistoryError = error.message;
    }

    if (!current.auth?.workspaceOverrideAllowed) {
      state.workspaces = [current.workspace];
      state.workspaceUsers = [];
      state.workspaceInvitations = [];
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

    const [userData, invitationData] = selectedWorkspace?.id
      ? await Promise.all([
        fetchApi(`/api/workspaces/${selectedWorkspace.id}/users?limit=100`),
        fetchApi(`/api/workspaces/${selectedWorkspace.id}/invitations?limit=100`)
      ])
      : [{ users: [] }, { invitations: [] }];
    state.workspaceUsers = userData.users || [];
    state.workspaceInvitations = invitationData.invitations || [];
    renderWorkspaces();
  } catch (error) {
    state.workspaceUsers = [];
    state.workspaceInvitations = [];
    state.policyRules = [];
    state.policyRuleError = error.message;
    state.policyHistory = [];
    state.policyHistoryError = error.message;
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
    accountability: fetchApi('/api/team/accountability?days=30&limit=50'),
    outcomes: fetchApi('/api/outcomes?limit=50'),
    findings: fetchApi('/api/findings?status=open&limit=50'),
    healthSnapshots: fetchApi('/api/findings/board-health?limit=20'),
    reconciliationHealth: fetchApi('/api/trello-actions/reconciliation/health?limit=100'),
    notificationPolicies: fetchApi('/api/notifications/policies?limit=100'),
    notificationDeliveries: fetchApi('/api/notifications/deliveries?limit=100')
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
      state.ledger[key] = key === 'reconciliationHealth' ? null : [];
      state.ledger.errors.push(error);
      return;
    }

    if (key === 'decisions') state.ledger.decisions = data.items || [];
    if (key === 'recommendations') state.ledger.recommendations = data.recommendations || [];
    if (key === 'actions') state.ledger.actions = data.actions || [];
    if (key === 'auditEvents') state.ledger.auditEvents = data.auditEvents || [];
    if (key === 'followUps') state.ledger.followUps = data.followUps || [];
    if (key === 'accountability') state.ledger.accountability = data.accountability || null;
    if (key === 'outcomes') state.ledger.outcomes = data.outcomes || [];
    if (key === 'findings') state.ledger.findings = data.findings || [];
    if (key === 'healthSnapshots') state.ledger.healthSnapshots = data.snapshots || [];
    if (key === 'reconciliationHealth') state.ledger.reconciliationHealth = data.health || null;
    if (key === 'notificationPolicies') state.ledger.notificationPolicies = data.policies || [];
    if (key === 'notificationDeliveries') state.ledger.notificationDeliveries = data.deliveries || [];
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
    ${renderResponseTiming()}
    ${listOrEmpty(displayJobs, renderJobHealthItem)}
  `;

  document.querySelectorAll('[data-job-action]').forEach((button) => {
    button.addEventListener('click', () => runJobAction(button.dataset.jobName, button.dataset.jobAction));
  });
}

function renderResponseTiming() {
  const timing = state.responseTiming;
  const rateLimit = state.rateLimitMetrics;
  const views = (timing?.views || []).filter(view => view.samples > 0).slice(0, 8);
  if ((!timing || views.length === 0) && !rateLimit) return '';
  return `
    <div class="item">
      <div class="item-title"><strong>Command-center response timing</strong><span class="pill healthy">bounded</span></div>
      <div class="meta">Recent in-memory samples only. No request bodies, identifiers, query strings, or credentials are retained.</div>
      ${views.length > 0 ? `<div class="meta">${views.map(view => `<span>${escapeHtml(view.view)}: p50 ${view.p50Ms}ms, p95 ${view.p95Ms}ms (${view.samples})</span>`).join('')}</div>` : ''}
      ${rateLimit ? `<div class="meta"><span>Rate-limit buckets: ${rateLimit.bucketCount}/${rateLimit.maxBuckets} (${rateLimit.utilizationPercent}%)</span><span>${rateLimit.leastRecentlyUsedBucketsPruned} pressure pruned</span><span>${rateLimit.rejectedRequests} rejected</span></div>` : ''}
    </div>
  `;
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
  const accountability = state.ledger.accountability;
  const outcomes = state.ledger.outcomes || [];
  const findings = state.ledger.findings || [];
  const healthSnapshots = state.ledger.healthSnapshots || [];
  const reconciliationHealth = state.ledger.reconciliationHealth;
  const notificationPolicies = state.ledger.notificationPolicies || [];
  const notificationDeliveries = state.ledger.notificationDeliveries || [];
  const reconciliationSummary = reconciliationHealth?.summary || {};

  const openRobert = decisions.filter(item => item.ownerType === 'robert').length;
  const vaTeam = decisions.filter(item => ['va', 'team'].includes(item.ownerType)).length;
  const pendingRecommendations = recommendations.filter(item => ['pending', 'approved', 'change_requested'].includes(item.status)).length;
  const failedActions = actions.filter(item => item.status === 'failed').length;
  const highRiskFindings = findings.filter(item => ['critical', 'high'].includes(item.severity)).length;
  const outcomesNeedingAttention = outcomes.filter(item => item.status === 'needs_attention' || item.status === 'not_verified').length;

  els.approvalCount.textContent = openRobert + pendingRecommendations;
  els.ledgerMetrics.innerHTML = [
    ['Robert decisions', openRobert],
    ['VA/team queue', vaTeam],
    ['Awaiting review', pendingRecommendations],
    ['Failed actions', failedActions],
    ['Reconciliation alerts', reconciliationSummary.requiresOperator || 0],
    ['Critical evidence gaps', reconciliationSummary.critical || 0],
    ['Open findings', findings.length],
    ['High-risk findings', highRiskFindings],
    ['Overdue follow-ups', accountability?.summary?.overdueFollowUps || 0],
    ['Workers needing attention', accountability?.summary?.membersNeedingAttention || 0],
    ['Outcome reviews', outcomesNeedingAttention],
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
  els.trelloAttemptCount.textContent = reconciliationSummary.requiresOperator
    ? `${reconciliationSummary.requiresOperator} need evidence`
    : `${actions.length} attempts`;
  els.trelloAttempts.innerHTML = `${renderTrelloReconciliationHealth(reconciliationHealth)}${listOrEmpty(actions, renderTrelloAttempt)}`;
  els.notificationPolicyCount.textContent = `${notificationPolicies.length} polic${notificationPolicies.length === 1 ? 'y' : 'ies'}`;
  els.notificationPolicies.innerHTML = listOrEmpty(notificationPolicies, renderNotificationPolicy);
  els.notificationDeliveryCount.textContent = `${notificationDeliveries.length} event${notificationDeliveries.length === 1 ? '' : 's'}`;
  els.notificationDeliveries.innerHTML = listOrEmpty(notificationDeliveries, renderNotificationDelivery);
  els.followUpCount.textContent = `${followUps.length} due`;
  els.followUps.innerHTML = listOrEmpty(followUps, renderFollowUp);
  els.accountabilityCount.textContent = `${accountability?.summary?.members || 0} people`;
  els.accountabilityList.innerHTML = accountability
    ? listOrEmpty(accountability.members || [], renderWorkerAccountability)
    : '<div class="notice">Worker accountability needs ledger access.</div>';
  els.outcomeCount.textContent = `${outcomesNeedingAttention} review`;
  els.outcomeList.innerHTML = listOrEmpty(outcomes, renderInterventionOutcome);
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
  document.querySelectorAll('[data-trello-action-reconcile]').forEach((button) => {
    button.addEventListener('click', () => openTrelloActionReconciliation(button.dataset.trelloActionReconcile));
  });
  document.querySelectorAll('[data-outcome-evaluate]').forEach((button) => {
    button.addEventListener('click', () => runOutcomeEvaluation(button.dataset.outcomeEvaluate));
  });
  document.querySelectorAll('[data-notification-policy-activate]').forEach((button) => {
    button.addEventListener('click', () => openNotificationActivation(button.dataset.notificationPolicyActivate));
  });
  document.querySelectorAll('[data-notification-policy-pause]').forEach((button) => {
    button.addEventListener('click', () => updateNotificationPolicy(button.dataset.notificationPolicyPause, { status: 'paused' }));
  });
  document.querySelectorAll('[data-notification-policy-test]').forEach((button) => {
    button.addEventListener('click', () => openNotificationTest(button.dataset.notificationPolicyTest));
  });
  document.querySelectorAll('[data-notification-delivery-evidence]').forEach((button) => {
    button.addEventListener('click', () => openNotificationDeliveryEvidence(button.dataset.notificationDeliveryEvidence));
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
  const connectorRetries = Number(job.metadata?.retryCount) || 0;
  const connectorPacingMs = Number(job.metadata?.rateLimitWaitMs) || 0;
  const dependencyFreshness = job.metadata?.dependencyFreshness;
  const freshnessProviders = Number(dependencyFreshness?.providerCount) || 0;
  const staleDependencies = Number(dependencyFreshness?.markedStale) || 0;
  const freshnessFailures = Number(dependencyFreshness?.failureCount) || 0;
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
      ${connectorRetries || connectorPacingMs ? `<div class="meta"><span>${connectorRetries} provider retries</span><span>${Math.round(connectorPacingMs / 1000)}s provider pacing</span></div>` : ''}
      ${freshnessProviders || staleDependencies || freshnessFailures ? `<div class="meta"><span>Graph freshness: ${freshnessProviders} providers checked</span><span>${staleDependencies} stale edges marked</span>${freshnessFailures ? `<span>${freshnessFailures} freshness checks failed</span>` : ''}</div>` : ''}
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
  const fields = getPayloadReviewFields(recommendation);
  if (fields.length === 0) return '';
  return `<div class="item-actions"><button class="button warn" data-payload-edit="${recommendationId}" type="button">Review payload</button></div>`;
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
  const attemptId = getId(attempt._id || attempt.id);
  const needsReconciliation = attempt.status === 'in_progress'
    || (attempt.status === 'succeeded' && attempt.recommendationId?.status === 'executing');
  const reconciliation = attempt.reconciliation || {};
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
      ${reconciliation.status && reconciliation.status !== 'not_needed' ? `
        <div class="meta">
          <span>${escapeHtml(reconciliation.status.replaceAll('_', ' '))}</span>
          <span>${escapeHtml(reconciliation.reconciledBy || 'operator')}</span>
          <span>${formatDate(reconciliation.reconciledAt)}</span>
        </div>
      ` : ''}
      ${needsReconciliation && attemptId ? `
        <div class="item-actions">
          <button class="button warn" data-trello-action-reconcile="${escapeHtml(attemptId)}" type="button">Reconcile result</button>
        </div>
      ` : ''}
    </div>
  `;
}

function renderTrelloReconciliationHealth(health) {
  if (!health) return '';
  const summary = health.summary || {};
  const alerts = (health.items || []).filter(item => item.severity === 'critical' || item.severity === 'warning');
  if (alerts.length === 0) {
    return `
      <div class="item">
        <div class="item-title"><strong>Reconciliation coverage</strong><span class="pill healthy">current</span></div>
        <div class="meta"><span>${summary.unresolved || 0} unresolved claim${summary.unresolved === 1 ? '' : 's'}</span><span>Evidence warning at ${health.thresholds?.warningHours || 4}h</span></div>
      </div>
    `;
  }

  return `
    <div class="item">
      <div class="item-title">
        <strong>Reconciliation attention</strong>
        <span class="pill ${summary.critical ? 'critical' : 'high'}">${summary.critical || 0} critical, ${summary.warning || 0} warning</span>
      </div>
      <div class="meta"><span>Confirm the observed provider result in the matching action below.</span><span>Thresholds: ${health.thresholds?.warningHours || 4}h / ${health.thresholds?.criticalHours || 24}h</span></div>
      <div class="meta">${alerts.slice(0, 3).map(item => `<span>${escapeHtml(item.actionType || 'Trello action')}: ${escapeHtml(item.message)}</span>`).join('')}</div>
    </div>
  `;
}

function renderNotificationPolicy(policy) {
  const policyId = getId(policy.id || policy._id);
  const statusClass = policy.status === 'active' ? 'healthy' : 'review';
  const channel = String(policy.channel || '').replaceAll('_', ' ');
  return `
    <div class="item">
      <div class="item-title">
        <strong>${escapeHtml(policy.name)}</strong>
        <span class="pill ${statusClass}">${escapeHtml(policy.status)}</span>
      </div>
      <div class="meta">
        <span>${escapeHtml(channel)}</span>
        <span>${escapeHtml(policy.destinationLabel || 'Unlabelled destination')}</span>
        <span>${escapeHtml(policy.minimumSeverity)} and above</span>
      </div>
      <div class="meta"><span>${policy.destinationConfigured ? 'Encrypted destination configured' : 'Destination needs configuration'}</span><span>${policy.quietHours?.enabled ? `Warning alerts defer ${escapeHtml(policy.quietHours.startHourUtc)}:00-${escapeHtml(policy.quietHours.endHourUtc)}:00 UTC` : 'No quiet hours'}</span></div>
      <div class="meta"><span>${policy.digest?.enabled ? `Warning digest at ${escapeHtml(policy.digest.hourUtc)}:00 UTC, up to ${escapeHtml(policy.digest.maximumItems)} items` : 'Warning alerts deliver individually'}</span></div>
      <div class="item-actions">
        ${policy.status === 'active'
    ? `<button class="button" data-notification-policy-pause="${escapeHtml(policyId)}" type="button">Pause</button>`
    : `<button class="button primary" data-notification-policy-activate="${escapeHtml(policyId)}" type="button">Activate</button>`}
        <button class="button" data-notification-policy-test="${escapeHtml(policyId)}" type="button">Send test</button>
      </div>
    </div>
  `;
}

function renderNotificationDelivery(delivery) {
  const policies = state.ledger.notificationPolicies || [];
  const policy = policies.find(item => getId(item.id || item._id) === getId(delivery.policyId));
  const statusClass = ['delivered', 'digested'].includes(delivery.status) ? 'healthy'
    : delivery.status === 'failed' ? 'critical' : 'review';
  const deliveryId = getId(delivery.id || delivery._id);
  const sourceEvidence = notificationDeliverySourceEvidence(delivery);
  return `
    <div class="item">
      <div class="item-title">
        <strong>${escapeHtml(delivery.title || 'Notification delivery')}</strong>
        <span class="pill ${statusClass}">${escapeHtml(delivery.status)}</span>
      </div>
      <div class="meta">
        <span>${escapeHtml(policy?.name || 'Notification policy')}</span>
        <span>${escapeHtml(delivery.severity || 'info')}</span>
        <span>${formatDate(delivery.deliveredAt || delivery.failedAt || delivery.createdAt)}</span>
      </div>
      <div class="meta"><span>${escapeHtml(delivery.errorMessage || delivery.message || 'Delivery recorded')}</span></div>
      ${renderSourceEvidence(sourceEvidence)}
      ${sourceEvidence.length && deliveryId ? `<div class="item-actions"><button class="button" data-notification-delivery-evidence="${escapeHtml(deliveryId)}" type="button">Source details</button></div>` : ''}
    </div>
  `;
}

function notificationDeliverySourceEvidence(delivery = {}) {
  const candidates = [
    ...(Array.isArray(delivery.sourceEvidence) ? delivery.sourceEvidence : []).map(item => ({
      ...item,
      type: item.sourceType || item.type || 'source'
    })),
    ...(delivery.sourceUrl ? [{
      type: delivery.sourceType || 'source',
      label: 'Open source evidence',
      url: delivery.sourceUrl
    }] : [])
  ];
  const seenUrls = new Set();
  return candidates.filter((item) => {
    const sourceUrl = safeExternalUrl(item.url);
    if (!sourceUrl || seenUrls.has(sourceUrl)) return false;
    seenUrls.add(sourceUrl);
    return true;
  });
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

function renderWorkerAccountability(member) {
  const attentionClass = member.attention === 'needs_attention'
    ? 'critical'
    : member.attention === 'watch'
      ? 'review'
      : 'healthy';
  const attentionLabel = member.attention === 'needs_attention'
    ? 'needs attention'
    : member.attention === 'watch'
      ? 'watch'
      : 'clear';
  const coverage = member.responseCoverage === null || member.responseCoverage === undefined
    ? 'No follow-ups in window'
    : `${member.responseCoverage}% response coverage`;
  return `
    <div class="item">
      <div class="item-title">
        <strong>${escapeHtml(member.name || 'Unknown member')}</strong>
        <span class="pill ${attentionClass}">${escapeHtml(attentionLabel)}</span>
      </div>
      <div class="meta">
        <span>${escapeHtml(member.workloadLevel || 'unknown')} workload</span>
        <span>${member.followUpsCreated || 0} follow-ups</span>
        <span>${member.responseCount || 0} responses</span>
        <span>${escapeHtml(coverage)}</span>
      </div>
      <div class="meta">
        <span>${member.overdueFollowUps || 0} overdue</span>
        <span>${member.escalatedFollowUps || 0} escalated</span>
        <span>${member.blockedResponses || 0} blocked</span>
        <span>${member.ignoredResponses || 0} explicitly ignored</span>
      </div>
    </div>
  `;
}

function renderInterventionOutcome(outcome) {
  const statusClass = outcome.status === 'confirmed_improved'
    ? 'healthy'
    : outcome.status === 'awaiting_evidence'
      ? 'review'
      : 'critical';
  const recommendation = outcome.recommendationId || {};
  const recommendationId = getId(recommendation._id || outcome.recommendationId);
  const canEvaluate = Boolean(recommendationId)
    && ['awaiting_evidence', 'needs_attention', 'not_verified'].includes(outcome.status);
  return `
    <div class="item">
      <div class="item-title">
        <strong>${escapeHtml(recommendation.title || `${outcome.actionType || 'Intervention'} outcome`)}</strong>
        <span class="pill ${statusClass}">${escapeHtml((outcome.status || 'awaiting_evidence').replaceAll('_', ' '))}</span>
      </div>
      <div class="meta">
        <span>${escapeHtml(outcome.actionType || 'action')}</span>
        <span>Checked ${formatDate(outcome.evaluatedAt)}</span>
      </div>
      <div class="meta"><span>${escapeHtml(outcome.summary || 'Outcome evidence is pending.')}</span></div>
      ${canEvaluate ? `<div class="item-actions"><button class="button" data-outcome-evaluate="${escapeHtml(recommendationId)}" type="button">Refresh evidence</button></div>` : ''}
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
  const visibleRefs = sourceEvidence.slice(0, 3);
  const remainingCount = Math.max(0, sourceEvidence.length - visibleRefs.length);
  return `
    <div class="source-evidence" aria-label="Source evidence">
      ${visibleRefs.map(renderSourceEvidenceRef).join('')}
      ${remainingCount ? `<span class="evidence-ref">+${remainingCount} more</span>` : ''}
    </div>
  `;
}

function renderSourceEvidenceRef(item = {}) {
  const label = escapeHtml(item.label || item.type || 'Evidence');
  const sourceUrl = safeExternalUrl(item.url);
  const title = escapeHtml(`${item.type || 'source'} evidence`);
  return sourceUrl
    ? `<a class="evidence-ref evidence-link" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noreferrer" title="${title}">${label}</a>`
    : `<span class="evidence-ref" title="${title}">${label}</span>`;
}

function safeExternalUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(String(value));
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    return url.toString();
  } catch (error) {
    return '';
  }
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
    openNotice('Decision updated', action === 'snooze' ? 'Decision snoozed using this workspace default.' : 'Decision delegated.');
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

async function runOutcomeEvaluation(recommendationId) {
  if (!recommendationId) return;

  try {
    const result = await fetchApi(`/api/outcomes/recommendations/${recommendationId}/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    openNotice('Outcome evidence refreshed', result.outcome?.summary || 'Sneup refreshed the available outcome evidence.');
    await loadOperationsLedger();
  } catch (error) {
    openNotice('Outcome evaluation failed', error.message);
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
  const fields = getPayloadReviewFields(recommendation);
  if (fields.length === 0) return;

  const payload = recommendation.actionPayload || {};
  let context = {};
  try {
    context = await loadPayloadReviewContext(recommendation, fields);
  } catch (error) {
    openNotice('Payload review unavailable', error.message);
    return;
  }
  const reviewReady = isPayloadReviewReady(fields, context);
  els.modalTitle.textContent = `Review ${String(recommendation.actionType || 'action').replaceAll('_', ' ')} payload`;
  els.modalBody.innerHTML = `
    <form id="payloadReviewForm">
      <div class="notice">The Trello target and action type are locked. Saving changes returns this recommendation to pending so the exact revised payload must be approved again.</div>
      <div class="payload-target">${renderProtectedPayloadSummary(payload)}</div>
      ${reviewReady ? '' : '<div class="notice">Sneup needs the current board members or lists before this payload can be prepared.</div>'}
      ${fields.map((field) => renderPayloadReviewField(field, payload, context)).join('')}
      <div class="toolbar modal-actions">
        <button class="button" type="button" id="cancelPayloadReview">Cancel</button>
        <button class="button primary" type="submit" ${reviewReady ? '' : 'disabled'}>Save for approval</button>
      </div>
    </form>
  `;
  els.modal.classList.add('open');
  document.getElementById('cancelPayloadReview').addEventListener('click', closeModal);
  document.getElementById('payloadReviewForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const submitButton = form.querySelector('button[type="submit"]');
    const actionPayload = {};
    for (const field of fields) {
      const input = form.elements[field.key];
      const value = input?.value || '';
      if (field.kind === 'checklist') {
        actionPayload[field.key] = value.split('\n').map(item => item.trim()).filter(Boolean);
      } else if (field.kind === 'member') {
        const selected = input?.options?.[input.selectedIndex];
        actionPayload.toMemberId = value;
        actionPayload.toMemberTrelloId = selected?.dataset.trelloId || '';
      } else {
        actionPayload[field.key] = value;
      }
    }
    submitButton.disabled = true;
    try {
      await fetchApi(`/api/recommendations/${recommendationId}/payload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updatedBy: 'robert', actionPayload })
      });
      closeModal();
      openNotice('Payload saved', 'The revised action is pending a fresh Yes/No approval.');
      await loadOperationsLedger();
    } catch (error) {
      submitButton.disabled = false;
      openNotice('Payload update failed', error.message);
    }
  });
}

const PAYLOAD_REVIEW_FIELDS = Object.freeze({
  comment: [{ key: 'commentText', label: 'Comment text', kind: 'textarea', required: true }],
  follow_up: [{ key: 'commentText', label: 'Follow-up text', kind: 'textarea', required: true }],
  performance_notification: [{ key: 'commentText', label: 'Notification text', kind: 'textarea', required: true }],
  move_card: [{ key: 'targetListId', label: 'Target Trello list', kind: 'list', required: true }],
  reassign: [
    { key: 'targetMember', label: 'New accountable owner', kind: 'member', required: true },
    { key: 'commentText', label: 'Optional reassignment note', kind: 'textarea', required: false }
  ],
  escalate: [{ key: 'commentText', label: 'Escalation text', kind: 'textarea', required: true }],
  add_label: [
    { key: 'labelName', label: 'Label name', kind: 'text', required: true },
    { key: 'labelColor', label: 'Label color', kind: 'labelColor', required: true }
  ],
  set_due_date: [{ key: 'due', label: 'Due date (ISO 8601)', kind: 'text', required: true }],
  add_checklist: [
    { key: 'checklistName', label: 'Checklist name', kind: 'text', required: true },
    { key: 'checkItems', label: 'Checklist items (one per line)', kind: 'checklist', required: true }
  ]
});

function getPayloadReviewFields(recommendation = {}) {
  const payload = recommendation.actionPayload || {};
  if (payload.externalProviderWriteBlocked === true || payload.source === 'work_graph') return [];
  return PAYLOAD_REVIEW_FIELDS[recommendation.actionType] || [];
}

async function loadPayloadReviewContext(recommendation, fields) {
  if (!fields.some((field) => field.kind === 'member' || field.kind === 'list')) return {};
  const boardId = getId(recommendation.boardId);
  if (!boardId) throw new Error('This recommendation does not have a board target to verify.');
  const data = await fetchApi(`/api/boards/${boardId}`);
  return {
    members: data.board?.members || [],
    lists: data.lists || []
  };
}

function isPayloadReviewReady(fields, context = {}) {
  return fields.every((field) => {
    if (field.kind === 'member') return (context.members || []).length > 0;
    if (field.kind === 'list') return (context.lists || []).length > 0;
    return true;
  });
}

function renderPayloadReviewField(field, payload = {}, context = {}) {
  const required = field.required ? 'required' : '';
  const value = field.key === 'targetMember' ? payload.toMemberId : payload[field.key];
  if (field.kind === 'textarea' || field.kind === 'checklist') {
    const text = field.kind === 'checklist' && Array.isArray(value) ? value.join('\n') : value || '';
    return `<div class="field"><label for="payloadField${escapeHtml(field.key)}">${escapeHtml(field.label)}</label><textarea id="payloadField${escapeHtml(field.key)}" name="${escapeHtml(field.key)}" ${required}>${escapeHtml(text)}</textarea></div>`;
  }
  if (field.kind === 'member') {
    const members = context.members || [];
    return `<div class="field"><label for="payloadField${escapeHtml(field.key)}">${escapeHtml(field.label)}</label><select id="payloadField${escapeHtml(field.key)}" name="${escapeHtml(field.key)}" ${required}>${members.map((member) => {
      const memberId = getId(member._id || member.id);
      const label = member.fullName || member.username || memberId;
      return `<option value="${escapeHtml(memberId)}" data-trello-id="${escapeHtml(member.trelloId || '')}" ${String(memberId) === String(value || '') ? 'selected' : ''}>${escapeHtml(label)}</option>`;
    }).join('')}</select></div>`;
  }
  if (field.kind === 'list') {
    const lists = context.lists || [];
    return `<div class="field"><label for="payloadField${escapeHtml(field.key)}">${escapeHtml(field.label)}</label><select id="payloadField${escapeHtml(field.key)}" name="${escapeHtml(field.key)}" ${required}>${lists.map((list) => {
      const listId = list.trelloId || getId(list._id || list.id);
      return `<option value="${escapeHtml(listId)}" ${String(listId) === String(value || '') ? 'selected' : ''}>${escapeHtml(list.name || listId)}</option>`;
    }).join('')}</select></div>`;
  }
  if (field.kind === 'labelColor') {
    const selected = String(value || 'red').toLowerCase();
    const options = ['yellow', 'purple', 'blue', 'red', 'green', 'orange', 'black', 'sky', 'pink', 'lime'];
    return `<div class="field"><label for="payloadField${escapeHtml(field.key)}">${escapeHtml(field.label)}</label><select id="payloadField${escapeHtml(field.key)}" name="${escapeHtml(field.key)}" ${required}>${options.map(color => `<option value="${color}" ${color === selected ? 'selected' : ''}>${color}</option>`).join('')}</select></div>`;
  }
  return `<div class="field"><label for="payloadField${escapeHtml(field.key)}">${escapeHtml(field.label)}</label><input id="payloadField${escapeHtml(field.key)}" name="${escapeHtml(field.key)}" type="text" value="${escapeHtml(value || '')}" ${required}></div>`;
}

function renderProtectedPayloadSummary(payload = {}) {
  const fields = [
    ['Card', payload.cardTrelloId],
    ['Board', payload.boardId],
    ['Current owner', payload.fromMemberTrelloId],
    ['Source', payload.source]
  ].filter(([, value]) => value);
  if (fields.length === 0) return '';
  return `<div class="meta">${fields.map(([label, value]) => `<span>${escapeHtml(label)}: ${escapeHtml(value)}</span>`).join('')}</div>`;
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

function openNotificationDeliveryEvidence(deliveryId) {
  const delivery = (state.ledger.notificationDeliveries || [])
    .find(item => getId(item.id || item._id) === deliveryId);
  if (!delivery) return;

  const sourceEvidence = notificationDeliverySourceEvidence(delivery);
  if (sourceEvidence.length === 0) {
    openNotice('Notification sources', 'This delivery has no validated source links.');
    return;
  }

  els.modalTitle.textContent = 'Notification sources';
  els.modalBody.innerHTML = `
    <div class="notice-stack">
      <div class="item">
        <div class="item-title">
          <strong>${escapeHtml(delivery.title || 'Notification delivery')}</strong>
          <span class="pill ${['delivered', 'digested'].includes(delivery.status) ? 'healthy' : delivery.status === 'failed' ? 'critical' : 'review'}">${escapeHtml(delivery.status || 'recorded')}</span>
        </div>
        <div class="meta">
          <span>${sourceEvidence.length} source ref${sourceEvidence.length === 1 ? '' : 's'}</span>
          <span>${formatDate(delivery.deliveredAt || delivery.failedAt || delivery.createdAt)}</span>
        </div>
      </div>
      <section>
        <div class="panel-head evidence-head">
          <h2>Source evidence</h2>
          <span class="pill review">${sourceEvidence.length}</span>
        </div>
        <div class="list">${sourceEvidence.map(renderEvidenceRef).join('')}</div>
      </section>
      <div class="toolbar modal-actions">
        <button class="button primary" type="button" id="notificationEvidenceClose">Done</button>
      </div>
    </div>
  `;
  els.modal.classList.add('open');
  document.getElementById('notificationEvidenceClose').addEventListener('click', closeModal);
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
  const sourceUrl = safeExternalUrl(item.url);
  return `
    <div class="item">
      <div class="item-title">
        <strong>${escapeHtml(item.label || item.type || 'Evidence')}</strong>
        <span class="pill review">${escapeHtml(item.type || 'system')}</span>
      </div>
      <div class="meta">
        <span>${formatDate(item.observedAt)}</span>
        ${sourceUrl ? `<a class="evidence-link" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noreferrer">Open source</a>` : ''}
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
  const readOnlyDemo = state.snapshot?.mode === 'demo' || state.securityContext?.demoMode;
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
        ${readOnlyDemo
          ? '<span class="meta">Read-only demo preview</span>'
          : `<button class="button primary" data-command-id="${escapeHtml(command.id)}" type="button">Queue for approval</button>`}
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
  if (state.snapshot?.mode === 'demo' || state.securityContext?.demoMode) {
    openNotice('Read-only demo', 'Connect a database-backed workspace before queuing approval requests.');
    return;
  }

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
  const invitations = state.workspaceInvitations || [];
  const policyRules = state.policyRules || [];
  const policyHistory = state.policyHistory || [];
  const pendingInvitations = invitations.filter(invite => invite.status === 'pending');
  els.workspaceMetrics.innerHTML = [
    ['Workspace', currentWorkspace?.name || 'Current'],
    ['Status', currentWorkspace?.status || 'active'],
    ['Plan', currentWorkspace?.plan || 'local'],
    ['Users', users.length],
    ['Pending invites', pendingInvitations.length],
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
  const demoNotice = state.securityContext?.demoMode || currentWorkspace?.demoMode
    ? '<div class="notice">Demo workspace is read-only. Connect a database and sign in to manage people, invitations, and action safety.</div>'
    : '';
  els.workspaceList.innerHTML = demoNotice + notice + listOrEmpty(workspaces, renderWorkspace);
  els.workspaceUserCount.textContent = `${users.length} user${users.length === 1 ? '' : 's'}`;
  els.workspaceUsers.innerHTML = listOrEmpty(users, renderWorkspaceUser);
  els.workspaceInviteCount.textContent = `${pendingInvitations.length} pending`;
  els.workspaceInvitations.innerHTML = listOrEmpty(invitations, renderWorkspaceInvitation);
  els.workspaceInviteButton.disabled = !currentWorkspace?.id || !state.securityContext?.permissions?.includes('identity:manage');
  els.policyRuleCount.textContent = `${policyRules.length} action${policyRules.length === 1 ? '' : 's'}`;
  els.policyRuleList.innerHTML = state.policyRuleError
    ? `<div class="notice">${escapeHtml(state.policyRuleError)}</div>`
    : listOrEmpty(policyRules, renderPolicyRule);
  els.policyHistoryCount.textContent = `${policyHistory.length} change${policyHistory.length === 1 ? '' : 's'}`;
  els.policyHistoryList.innerHTML = state.policyHistoryError
    ? `<div class="notice">${escapeHtml(state.policyHistoryError)}</div>`
    : listOrEmpty(policyHistory, renderPolicyHistory);
  bindWorkspaceIdentityActions();
  bindPolicyRuleActions();
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
      <div class="item-actions">
        <button class="button" data-workspace-user-sessions="${escapeHtml(user.id)}" type="button">Review sessions</button>
      </div>
    </div>
  `;
}

function renderWorkspaceInvitation(invitation) {
  const canRevoke = invitation.status === 'pending';
  const canRetryDelivery = canRevoke
    && invitation.delivery?.mode === 'email'
    && ['failed', 'not_sent'].includes(invitation.delivery?.status);
  const delivery = invitation.delivery?.status === 'sent' ? 'email sent' : invitation.delivery?.status === 'failed' ? 'email failed' : 'manual link';
  const retentionNotice = invitation.redactedAt ? '<span>personal data removed</span>' : '';
  return `
    <div class="item">
      <div class="item-title">
        <strong>${escapeHtml(invitation.displayName || 'Invitation record')}</strong>
        <span class="pill ${invitation.status === 'accepted' ? 'healthy' : invitation.status === 'pending' ? 'review' : 'critical'}">${escapeHtml(invitation.status)}</span>
      </div>
      <div class="meta">
        <span>${escapeHtml(invitation.email || 'Personal data removed')}</span>
        <span>${escapeHtml(invitation.role)}</span>
        <span>${escapeHtml(delivery)}</span>
        <span>Expires ${escapeHtml(formatDate(invitation.expiresAt))}</span>
        ${retentionNotice}
      </div>
      ${canRevoke ? `
        <div class="item-actions">
          ${canRetryDelivery ? `<button class="button" data-retry-workspace-invite-delivery="${escapeHtml(invitation.id)}" type="button">Retry email</button>` : ''}
          <button class="button danger" data-revoke-workspace-invite="${escapeHtml(invitation.id)}" type="button">Revoke invitation</button>
        </div>
      ` : ''}
    </div>
  `;
}

function renderPolicyRule(policy) {
  const canManage = state.securityContext?.permissions?.includes('policy-rules:manage');
  const isWorkflowPolicy = policy.policyKind === 'workflow';
  const isRoutingPolicy = policy.workflowType === 'decision_queue_routing';
  const isCooldownPolicy = policy.workflowType === 'scheduled_intervention_cooldown';
  const isTimingPolicy = policy.workflowType === 'scheduled_intervention_timing';
  const stateLabel = policy.enabled ? 'active' : 'paused';
  const stateClass = policy.enabled ? 'healthy' : 'critical';
  const riskClass = policy.riskLevel === 'critical' ? 'critical' : policy.riskLevel === 'high' ? 'high' : 'review';
  const pauseReview = !policy.enabled && policy.pauseReviewOverdue
    ? '<span>pause review overdue</span>'
    : !policy.enabled && policy.pauseExpiresAt
      ? `<span>review by ${escapeHtml(formatDate(policy.pauseExpiresAt))}</span>`
      : '';
  const routing = policy.routingByRisk || {};
  const routingSummary = ['low', 'medium', 'high', 'critical']
    .map((risk) => {
      const entry = routing[risk];
      return entry ? `${risk}: ${entry.ownerType} / ${entry.escalationHours}h` : null;
    })
    .filter(Boolean)
    .join(' | ');
  const cooldowns = Object.values(policy.cooldownHoursByTrigger || {}).map(Number).filter(Number.isFinite);
  const cooldownSummary = cooldowns.length > 0
    ? `${cooldowns.length} signals, ${Math.min(...cooldowns)}-${Math.max(...cooldowns)}h suppression`
    : 'scheduled duplicate suppression';
  const timingSummary = `${Number(policy.followUpAfterHours || 24)}h follow-up / ${Number(policy.escalationAfterHours || 48)}h escalation`;
  return `
    <div class="item">
      <div class="item-title">
        <strong>${escapeHtml(policy.label || String(policy.actionType || '').replaceAll('_', ' '))}</strong>
        <span class="pill ${stateClass}">${escapeHtml(stateLabel)}</span>
      </div>
      <div class="meta">
        ${isTimingPolicy
          ? `<span>${escapeHtml(timingSummary)}</span><span>scheduled candidates only</span>`
          : isCooldownPolicy
          ? `<span>${escapeHtml(cooldownSummary)}</span><span>scheduled signals only</span>`
          : isRoutingPolicy
          ? `<span>${escapeHtml(routingSummary || 'internal queue routing')}</span><span>overdue VA/team work goes to Robert</span>`
          : isWorkflowPolicy
          ? `<span>${escapeHtml(String(policy.defaultSnoozeHours || 24))}-hour default</span><span>internal queue only</span>`
          : `<span class="pill ${riskClass}">${escapeHtml(policy.riskLevel)} risk</span><span>${escapeHtml(policy.ownerType)} decides</span><span>approval required</span>`}
        <span>${policy.configured ? 'workspace rule set' : 'baseline rule'}</span>
        ${pauseReview}
      </div>
      ${canManage ? `<div class="item-actions"><button class="button" data-policy-rule="${escapeHtml(policy.actionType)}" type="button">Configure</button></div>` : ''}
    </div>
  `;
}

function renderPolicyHistory(event) {
  const after = event.afterState || {};
  const before = event.beforeState || {};
  const action = after.label || before.label || 'Trello action';
  const state = after.enabled === false ? 'paused' : after.enabled === true ? 'active' : 'updated';
  const stateClass = state === 'paused' ? 'critical' : state === 'active' ? 'healthy' : 'review';
  return `
    <div class="item">
      <div class="item-title">
        <strong>${escapeHtml(action)}</strong>
        <span class="pill ${stateClass}">${escapeHtml(state)}</span>
      </div>
      <div class="meta">
        <span>${formatDate(event.createdAt)}</span>
        <span>${escapeHtml(event.actor || 'sneup')}</span>
        <span>${escapeHtml(after.riskLevel || before.riskLevel || 'risk unchanged')}</span>
        ${after.relaxationConfirmed ? '<span>relaxation confirmed</span>' : ''}
      </div>
    </div>
  `;
}

function bindWorkspaceIdentityActions() {
  document.querySelectorAll('[data-workspace-user-sessions]').forEach((button) => {
    button.addEventListener('click', () => openWorkspaceUserSessions(button.dataset.workspaceUserSessions));
  });
  document.querySelectorAll('[data-revoke-workspace-invite]').forEach((button) => {
    const invitation = state.workspaceInvitations.find(item => item.id === button.dataset.revokeWorkspaceInvite);
    button.addEventListener('click', () => openInviteRevocationConfirmation(invitation));
  });
  document.querySelectorAll('[data-retry-workspace-invite-delivery]').forEach((button) => {
    const invitation = state.workspaceInvitations.find(item => item.id === button.dataset.retryWorkspaceInviteDelivery);
    button.addEventListener('click', () => openInviteDeliveryRetryConfirmation(invitation));
  });
}

function bindPolicyRuleActions() {
  document.querySelectorAll('[data-policy-rule]').forEach((button) => {
    button.addEventListener('click', () => openPolicyRuleEditor(button.dataset.policyRule));
  });
}

function openPolicyRuleEditor(actionType) {
  const policy = (state.policyRules || []).find(item => item.actionType === actionType);
  if (!policy) return;

  if (policy.workflowType === 'scheduled_intervention_timing') {
    els.modalTitle.textContent = policy.label;
    els.modalBody.innerHTML = `
      <form id="policyRuleForm" class="notice-stack">
        <div class="notice">This policy only controls when Sneup creates internal follow-up or escalation candidates. It can retain or lengthen the 24-hour follow-up and 48-hour escalation baselines up to 7 days. Escalation cannot precede follow-up, and this policy never prepares or performs a provider write.</div>
        <div class="workflow-routing-grid">
          <fieldset class="workflow-routing-row">
            <legend>Follow-up candidate</legend>
            <label>Create after no response (hours)
              <input name="followUpAfterHours" type="number" min="24" max="168" step="1" value="${escapeHtml(String(policy.followUpAfterHours || 24))}" required>
            </label>
          </fieldset>
          <fieldset class="workflow-routing-row">
            <legend>Escalation candidate</legend>
            <label>Create after no response (hours)
              <input name="escalationAfterHours" type="number" min="48" max="168" step="1" value="${escapeHtml(String(policy.escalationAfterHours || 48))}" required>
            </label>
          </fieldset>
        </div>
        <label>Reason<textarea name="reason" rows="3" maxlength="500" placeholder="Why this workspace needs longer follow-up timing">${escapeHtml(policy.reason || '')}</textarea></label>
        <div class="toolbar modal-actions">
          <button class="button" type="button" id="cancelPolicyRule">Cancel</button>
          <button class="button primary" type="submit">Save timing defaults</button>
        </div>
      </form>
    `;
    els.modal.classList.add('open');
    document.getElementById('cancelPolicyRule').addEventListener('click', closeModal);
    document.getElementById('policyRuleForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const submitButton = form.querySelector('button[type="submit"]');
      const values = new FormData(form);
      submitButton.disabled = true;
      submitButton.textContent = 'Saving...';
      try {
        await fetchApi(`/api/policy-rules/${encodeURIComponent(actionType)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            followUpAfterHours: Number(values.get('followUpAfterHours')),
            escalationAfterHours: Number(values.get('escalationAfterHours')),
            reason: values.get('reason')
          })
        });
        closeModal();
        await loadWorkspaceAdmin();
      } catch (error) {
        submitButton.disabled = false;
        submitButton.textContent = 'Save timing defaults';
        openNotice('Timing defaults blocked', error.message);
      }
    });
    return;
  }

  if (policy.workflowType === 'scheduled_intervention_cooldown') {
    const cooldowns = policy.cooldownHoursByTrigger || {};
    const labels = {
      card_stuck: 'Stuck card',
      no_activity: 'No activity',
      overdue: 'Overdue card',
      member_overloaded: 'Member overloaded',
      blocking_others: 'Blocking other work',
      no_response_to_followup: 'No response to follow-up',
      performance_milestone: 'Performance milestone'
    };
    const triggers = Object.keys(labels);
    const rows = triggers.map((trigger) => `
      <fieldset class="workflow-routing-row">
        <legend>${escapeHtml(labels[trigger])}</legend>
        <label>Suppress equivalent scheduled recommendations for (hours)
          <input name="${trigger}CooldownHours" type="number" min="24" max="168" step="1" value="${escapeHtml(String(cooldowns[trigger] || 24))}" required>
        </label>
      </fieldset>
    `).join('');
    els.modalTitle.textContent = policy.label;
    els.modalBody.innerHTML = `
      <form id="policyRuleForm" class="notice-stack">
        <div class="notice">This policy only suppresses duplicate scheduled intervention candidates. It can lengthen the 24-hour baseline up to 7 days, never shortens it, and never prepares or performs a provider write. Manual requests are not suppressed.</div>
        <div class="workflow-routing-grid">${rows}</div>
        <label>Reason<textarea name="reason" rows="3" maxlength="500" placeholder="Why this workspace needs longer signal cooldowns">${escapeHtml(policy.reason || '')}</textarea></label>
        <div class="toolbar modal-actions">
          <button class="button" type="button" id="cancelPolicyRule">Cancel</button>
          <button class="button primary" type="submit">Save cooldown defaults</button>
        </div>
      </form>
    `;
    els.modal.classList.add('open');
    document.getElementById('cancelPolicyRule').addEventListener('click', closeModal);
    document.getElementById('policyRuleForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const submitButton = form.querySelector('button[type="submit"]');
      const values = new FormData(form);
      submitButton.disabled = true;
      submitButton.textContent = 'Saving...';
      try {
        await fetchApi(`/api/policy-rules/${encodeURIComponent(actionType)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cooldownHoursByTrigger: Object.fromEntries(triggers.map(trigger => [
              trigger,
              Number(values.get(`${trigger}CooldownHours`))
            ])),
            reason: values.get('reason')
          })
        });
        closeModal();
        await loadWorkspaceAdmin();
      } catch (error) {
        submitButton.disabled = false;
        submitButton.textContent = 'Save cooldown defaults';
        openNotice('Cooldown defaults blocked', error.message);
      }
    });
    return;
  }

  if (policy.workflowType === 'decision_queue_routing') {
    const routing = policy.routingByRisk || {};
    const risks = ['low', 'medium', 'high', 'critical'];
    const riskLabels = { low: 'Low-risk queue', medium: 'Medium-risk queue', high: 'High-risk queue', critical: 'Critical queue' };
    const rows = risks.map((risk) => {
      const entry = routing[risk] || {};
      const ownerControl = ['high', 'critical'].includes(risk)
        ? '<span class="workflow-fixed-owner">Robert only</span>'
        : `<select name="${risk}OwnerType">
            ${['va', 'team', 'robert'].map(owner => `<option value="${owner}" ${owner === entry.ownerType ? 'selected' : ''}>${owner}</option>`).join('')}
          </select>`;
      return `
        <fieldset class="workflow-routing-row">
          <legend>${escapeHtml(riskLabels[risk])}</legend>
          <label>Decision owner${ownerControl}</label>
          <label>Escalate to Robert after (hours)
            <input name="${risk}EscalationHours" type="number" min="1" max="168" step="1" value="${escapeHtml(String(entry.escalationHours || 24))}" required>
          </label>
        </fieldset>
      `;
    }).join('');
    els.modalTitle.textContent = policy.label;
    els.modalBody.innerHTML = `
      <form id="policyRuleForm" class="notice-stack">
        <div class="notice">This policy only routes internal decision queue items. When a VA or team item reaches its review deadline, Sneup records the escalation and moves it to Robert. It never prepares or performs a provider write.</div>
        <div class="workflow-routing-grid">${rows}</div>
        <label>Reason<textarea name="reason" rows="3" maxlength="500" placeholder="Why this workspace needs these queue defaults">${escapeHtml(policy.reason || '')}</textarea></label>
        <div class="toolbar modal-actions">
          <button class="button" type="button" id="cancelPolicyRule">Cancel</button>
          <button class="button primary" type="submit">Save queue defaults</button>
        </div>
      </form>
    `;
    els.modal.classList.add('open');
    document.getElementById('cancelPolicyRule').addEventListener('click', closeModal);
    document.getElementById('policyRuleForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const submitButton = form.querySelector('button[type="submit"]');
      const values = new FormData(form);
      submitButton.disabled = true;
      submitButton.textContent = 'Saving...';
      try {
        await fetchApi(`/api/policy-rules/${encodeURIComponent(actionType)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            routingByRisk: Object.fromEntries(risks.map((risk) => [risk, {
              ownerType: ['high', 'critical'].includes(risk) ? 'robert' : values.get(`${risk}OwnerType`),
              escalationHours: Number(values.get(`${risk}EscalationHours`))
            }])),
            reason: values.get('reason')
          })
        });
        closeModal();
        await loadWorkspaceAdmin();
      } catch (error) {
        submitButton.disabled = false;
        submitButton.textContent = 'Save queue defaults';
        openNotice('Queue defaults blocked', error.message);
      }
    });
    return;
  }

  if (policy.policyKind === 'workflow') {
    els.modalTitle.textContent = policy.label;
    els.modalBody.innerHTML = `
      <form id="policyRuleForm" class="notice-stack">
        <div class="notice">This default only reschedules internal decision queue items. It never prepares or performs a provider write.</div>
        <label>Default snooze duration (hours)
          <input name="defaultSnoozeHours" type="number" min="1" max="168" step="1" value="${escapeHtml(String(policy.defaultSnoozeHours || 24))}" required>
          <small>Choose between 1 hour and 7 days. People can still choose an explicit future deadline where the API permits it.</small>
        </label>
        <label>Reason<textarea name="reason" rows="3" maxlength="500" placeholder="Why this workspace needs this default">${escapeHtml(policy.reason || '')}</textarea></label>
        <div class="toolbar modal-actions">
          <button class="button" type="button" id="cancelPolicyRule">Cancel</button>
          <button class="button primary" type="submit">Save workflow default</button>
        </div>
      </form>
    `;
    els.modal.classList.add('open');
    document.getElementById('cancelPolicyRule').addEventListener('click', closeModal);
    document.getElementById('policyRuleForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const submitButton = form.querySelector('button[type="submit"]');
      const values = new FormData(form);
      submitButton.disabled = true;
      submitButton.textContent = 'Saving...';
      try {
        await fetchApi(`/api/policy-rules/${encodeURIComponent(actionType)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            defaultSnoozeHours: Number(values.get('defaultSnoozeHours')),
            reason: values.get('reason')
          })
        });
        closeModal();
        await loadWorkspaceAdmin();
      } catch (error) {
        submitButton.disabled = false;
        submitButton.textContent = 'Save workflow default';
        openNotice('Workflow default blocked', error.message);
      }
    });
    return;
  }

  const riskLevels = ['low', 'medium', 'high', 'critical'];
  const ownerStrictness = { system: 0, va: 1, team: 1, robert: 2 };
  const availableRisks = riskLevels.filter(level => riskLevels.indexOf(level) >= riskLevels.indexOf(policy.baselineRiskLevel));
  const availableOwners = ['system', 'va', 'team', 'robert'].filter(owner => ownerStrictness[owner] >= ownerStrictness[policy.baselineOwnerType]);

  els.modalTitle.textContent = `Action safety: ${policy.label}`;
  els.modalBody.innerHTML = `
    <form id="policyRuleForm" class="notice-stack">
      <div class="notice">Every Trello write remains approval-gated. This workspace rule can pause this action type or make its risk and decision owner stricter.</div>
      <label><input name="enabled" type="checkbox" ${policy.enabled ? 'checked' : ''}> Allow approved ${escapeHtml(policy.label)} actions to execute</label>
      <label>Pause review time
        <input name="pauseExpiresAt" type="datetime-local" value="${escapeHtml(toDateTimeLocalValue(policy.pauseExpiresAt))}">
        <small>An expired pause stays paused until a manager reviews it; Sneup never re-enables it automatically.</small>
      </label>
      <label>Risk level
        <select name="riskLevel">
          ${availableRisks.map(level => `<option value="${escapeHtml(level)}" ${level === policy.riskLevel ? 'selected' : ''}>${escapeHtml(level)}</option>`).join('')}
        </select>
      </label>
      <label>Decision owner
        <select name="ownerType">
          ${availableOwners.map(owner => `<option value="${escapeHtml(owner)}" ${owner === policy.ownerType ? 'selected' : ''}>${escapeHtml(owner)}</option>`).join('')}
        </select>
      </label>
      <label>Reason<textarea name="reason" rows="3" maxlength="500" placeholder="Why this action needs this safety posture">${escapeHtml(policy.reason || '')}</textarea></label>
      <label><input name="confirmRelaxation" type="checkbox"> I confirm that this may relax an existing workspace safety rule.</label>
      <div class="toolbar modal-actions">
        <button class="button" type="button" id="cancelPolicyRule">Cancel</button>
        <button class="button primary" type="submit">Save safety rule</button>
      </div>
    </form>
  `;
  els.modal.classList.add('open');
  document.getElementById('cancelPolicyRule').addEventListener('click', closeModal);
  document.getElementById('policyRuleForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const submitButton = form.querySelector('button[type="submit"]');
    const values = new FormData(form);
    submitButton.disabled = true;
    submitButton.textContent = 'Saving...';
    try {
      await fetchApi(`/api/policy-rules/${encodeURIComponent(actionType)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: values.get('enabled') === 'on',
          riskLevel: values.get('riskLevel'),
          ownerType: values.get('ownerType'),
          reason: values.get('reason'),
          pauseExpiresAt: values.get('pauseExpiresAt') || null,
          confirmRelaxation: values.get('confirmRelaxation') === 'on'
        })
      });
      closeModal();
      await loadWorkspaceAdmin();
    } catch (error) {
      submitButton.disabled = false;
      submitButton.textContent = 'Save safety rule';
      openNotice('Safety rule blocked', error.message);
    }
  });
}

function openWorkspaceInvite() {
  const workspaceId = state.activeWorkspaceId || state.currentWorkspace?.id;
  if (!workspaceId) {
    openNotice('Invitation unavailable', 'Choose a workspace before inviting a user.');
    return;
  }

  els.modalTitle.textContent = 'Invite user';
  els.modalBody.innerHTML = `
    <form id="workspaceInviteForm" class="notice-stack">
      <label>Email<input name="email" type="email" autocomplete="email" required></label>
      <label>Name<input name="displayName" type="text" autocomplete="name" required></label>
      <label>Role
        <select name="role">
          <option value="viewer">Viewer</option>
          <option value="operator">Operator</option>
          <option value="manager">Manager</option>
          <option value="admin">Admin</option>
        </select>
      </label>
      <label>Expires in days<input name="expiresInDays" type="number" min="1" max="30" value="7" required></label>
      <label>Delivery
        <select name="deliveryMode">
          <option value="manual">Secure link</option>
          <option value="email">Send email</option>
        </select>
      </label>
      <div class="toolbar modal-actions">
        <button class="button" type="button" id="cancelWorkspaceInvite">Cancel</button>
        <button class="button primary" type="submit">Create invitation</button>
      </div>
    </form>
  `;
  els.modal.classList.add('open');
  document.getElementById('cancelWorkspaceInvite').addEventListener('click', closeModal);
  document.getElementById('workspaceInviteForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitButton = event.currentTarget.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = 'Creating...';
    const values = new FormData(event.currentTarget);
    try {
      const data = await fetchApi(`/api/workspaces/${encodeURIComponent(workspaceId)}/invitations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: values.get('email'),
          displayName: values.get('displayName'),
          role: values.get('role'),
          expiresInDays: Number(values.get('expiresInDays')),
          deliveryMode: values.get('deliveryMode')
        })
      });
      await loadWorkspaceAdmin();
      renderCreatedInvitation(data);
    } catch (error) {
      openNotice('Invitation failed', error.message);
    }
  });
}

function renderCreatedInvitation(data) {
  const delivery = data.delivery?.status === 'sent'
    ? 'Email sent.'
    : data.delivery?.status === 'failed'
      ? `Email was not sent: ${data.delivery.message || 'provider delivery failed'}.`
      : 'Secure link created.';
  els.modalTitle.textContent = 'Invitation ready';
  els.modalBody.innerHTML = `
    <div class="notice-stack">
      <div class="notice">${escapeHtml(delivery)}</div>
      <label for="workspaceInviteUrl">Secure invitation link</label>
      <textarea id="workspaceInviteUrl" rows="4" readonly>${escapeHtml(data.inviteUrl)}</textarea>
      <div class="toolbar modal-actions">
        <button class="button" type="button" id="copyWorkspaceInvite">Copy link</button>
        <button class="button primary" type="button" id="closeWorkspaceInvite">Done</button>
      </div>
    </div>
  `;
  document.getElementById('copyWorkspaceInvite').addEventListener('click', async (event) => {
    try {
      await navigator.clipboard.writeText(data.inviteUrl);
      event.currentTarget.textContent = 'Copied';
    } catch (error) {
      const input = document.getElementById('workspaceInviteUrl');
      input.focus();
      input.select();
    }
  });
  document.getElementById('closeWorkspaceInvite').addEventListener('click', closeModal);
}

function openInviteRevocationConfirmation(invitation) {
  if (!invitation || invitation.status !== 'pending') return;
  els.modalTitle.textContent = 'Revoke invitation?';
  els.modalBody.innerHTML = `
    <div class="notice-stack">
      <div class="notice">This will invalidate the invitation for ${escapeHtml(invitation.email)} immediately.</div>
      <div class="toolbar modal-actions">
        <button class="button" type="button" id="cancelInviteRevoke">Cancel</button>
        <button class="button danger" type="button" id="confirmInviteRevoke">Revoke invitation</button>
      </div>
    </div>
  `;
  document.getElementById('cancelInviteRevoke').addEventListener('click', closeModal);
  document.getElementById('confirmInviteRevoke').addEventListener('click', async (event) => {
    const workspaceId = state.activeWorkspaceId || state.currentWorkspace?.id;
    if (!workspaceId) return;
    event.currentTarget.disabled = true;
    event.currentTarget.textContent = 'Revoking...';
    try {
      await fetchApi(`/api/workspaces/${encodeURIComponent(workspaceId)}/invitations/${encodeURIComponent(invitation.id)}/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      closeModal();
      await loadWorkspaceAdmin();
    } catch (error) {
      openNotice('Invitation revocation failed', error.message);
    }
  });
}

function openInviteDeliveryRetryConfirmation(invitation) {
  if (!invitation || invitation.status !== 'pending' || invitation.delivery?.mode !== 'email') return;
  const workspaceId = state.activeWorkspaceId || state.currentWorkspace?.id;
  if (!workspaceId) return;

  els.modalTitle.textContent = 'Retry invitation email?';
  els.modalBody.innerHTML = `
    <div class="notice-stack">
      <div class="notice">Sneup will invalidate the prior secure link, create a fresh one-time link, and send it to ${escapeHtml(invitation.email)}. The replacement is recorded in the workspace audit ledger.</div>
      <div class="toolbar modal-actions">
        <button class="button" type="button" id="cancelInviteDeliveryRetry">Cancel</button>
        <button class="button primary" type="button" id="confirmInviteDeliveryRetry">Retry email</button>
      </div>
    </div>
  `;
  document.getElementById('cancelInviteDeliveryRetry').addEventListener('click', closeModal);
  document.getElementById('confirmInviteDeliveryRetry').addEventListener('click', async (event) => {
    event.currentTarget.disabled = true;
    event.currentTarget.textContent = 'Retrying...';
    try {
      const data = await fetchApi(`/api/workspaces/${encodeURIComponent(workspaceId)}/invitations/${encodeURIComponent(invitation.id)}/retry-delivery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      await loadWorkspaceAdmin();
      renderCreatedInvitation(data);
    } catch (error) {
      event.currentTarget.disabled = false;
      event.currentTarget.textContent = 'Retry email';
      openNotice('Invitation retry failed', error.message);
    }
  });
}

async function openWorkspaceUserSessions(userId) {
  const workspaceId = state.activeWorkspaceId || state.currentWorkspace?.id;
  const user = state.workspaceUsers.find(item => item.id === userId);
  if (!workspaceId || !user) {
    openNotice('Session access unavailable', 'Choose a workspace user before reviewing sessions.');
    return;
  }

  els.modalTitle.textContent = 'Session access';
  els.modalBody.innerHTML = '<div class="notice">Loading active and historical sessions...</div>';
  els.modal.classList.add('open');

  try {
    const data = await fetchApi(`/api/workspaces/${encodeURIComponent(workspaceId)}/users/${encodeURIComponent(user.id)}/sessions?limit=100`);
    renderWorkspaceUserSessions(data.user || user, data.sessions || []);
  } catch (error) {
    openNotice('Session access unavailable', error.message);
  }
}

function renderWorkspaceUserSessions(user, sessions) {
  const activeSessions = sessions.filter(session => session.status === 'active');
  els.modalTitle.textContent = `${user.displayName} sessions`;
  els.modalBody.innerHTML = `
    <div class="notice-stack">
      <div class="notice">Review issued access for this user. Revoking a session ends its API access immediately and records a high-risk audit event.</div>
      <div class="item">
        <div class="item-title">
          <strong>${escapeHtml(user.displayName)}</strong>
          <span class="pill ${activeSessions.length ? 'review' : 'healthy'}">${activeSessions.length} active</span>
        </div>
        <div class="meta">
          <span>${escapeHtml(user.role || 'user')}</span>
          <span>${escapeHtml(user.email || 'No email')}</span>
        </div>
      </div>
      <div class="list">
        ${listOrEmpty(sessions, (session) => `
          <div class="item">
            <div class="item-title">
              <strong>${escapeHtml(session.name || 'User session')}</strong>
              <span class="pill ${session.status === 'active' ? 'review' : 'healthy'}">${escapeHtml(session.status)}</span>
            </div>
            <div class="meta">
              <span>Used ${escapeHtml(formatDate(session.lastUsedAt || session.createdAt))}</span>
              <span>Expires ${escapeHtml(formatDate(session.expiresAt))}</span>
              <span>${escapeHtml(session.tokenPrefix || 'Token protected')}</span>
            </div>
            ${session.status === 'active' ? `
              <div class="item-actions">
                <button class="button danger" data-revoke-workspace-session="${escapeHtml(session.id)}" type="button">Revoke session</button>
              </div>
            ` : ''}
          </div>
        `)}
      </div>
      <div class="toolbar modal-actions">
        <button class="button" type="button" id="closeSessionAccess">Done</button>
      </div>
    </div>
  `;
  document.getElementById('closeSessionAccess').addEventListener('click', closeModal);
  document.querySelectorAll('[data-revoke-workspace-session]').forEach((button) => {
    const session = sessions.find(item => item.id === button.dataset.revokeWorkspaceSession);
    button.addEventListener('click', () => openSessionRevocationConfirmation(user, session));
  });
}

function openSessionRevocationConfirmation(user, session) {
  if (!session || session.status !== 'active') return;
  els.modalTitle.textContent = 'Revoke session?';
  els.modalBody.innerHTML = `
    <div class="notice-stack">
      <div class="notice">This immediately ends API access for <strong>${escapeHtml(session.name || 'this session')}</strong> belonging to ${escapeHtml(user.displayName)}. This cannot be undone; issue a new session if access is needed again.</div>
      <div class="toolbar modal-actions">
        <button class="button" type="button" id="cancelSessionRevoke">Cancel</button>
        <button class="button danger" type="button" id="confirmSessionRevoke">Revoke session</button>
      </div>
    </div>
  `;
  document.getElementById('cancelSessionRevoke').addEventListener('click', () => openWorkspaceUserSessions(user.id));
  document.getElementById('confirmSessionRevoke').addEventListener('click', async () => {
    const workspaceId = state.activeWorkspaceId || state.currentWorkspace?.id;
    if (!workspaceId) return;
    const button = document.getElementById('confirmSessionRevoke');
    button.disabled = true;
    button.textContent = 'Revoking...';
    try {
      await fetchApi(`/api/workspaces/${encodeURIComponent(workspaceId)}/users/${encodeURIComponent(user.id)}/sessions/${encodeURIComponent(session.id)}/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      await openWorkspaceUserSessions(user.id);
    } catch (error) {
      openNotice('Session revocation failed', error.message);
    }
  });
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
  const evaluation = state.recommendationEvaluation;
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
    ['Blocked', byStatus.blocked || 0],
    ['AI evaluation', evaluation ? `${evaluation.score}%` : 'not run']
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
  if (evaluation) {
    els.enhancementMetrics.innerHTML += `<div class="metric"><span>Evaluation scenarios</span><strong>${escapeHtml(`${evaluation.passed}/${evaluation.total} passed`)}</strong></div>`;
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
  els.connectorCount.textContent = state.connectorCatalogTotal || state.connectorTotal || state.connectors.length;
  els.connectedCount.textContent = `${state.accounts.length} connected`;
  renderCategories();

  const selectedCategory = state.categories.find(category => category.id === state.category);
  els.connectorHeading.textContent = selectedCategory ? selectedCategory.name : 'All connectors';
  renderConnectorSafety();

  const accountsByConnectorId = new Map(state.accounts.map(account => [account.connectorId, account]));
  els.connectorGrid.innerHTML = state.connectorTotal === 0
    ? '<div class="empty">No connectors match this view.</div>'
    : state.connectors.map(connector => renderConnector(connector, accountsByConnectorId.get(connector.id))).join('');
  els.connectorPagination.innerHTML = state.connectorTotal > 0
    ? `<span class="meta">Showing ${state.connectors.length} of ${state.connectorTotal} tools</span>${state.connectors.length < state.connectorTotal ? '<button class="button" data-load-more-connectors type="button">Show more</button>' : ''}`
    : '';

  document.querySelectorAll('[data-connect]').forEach((button) => {
    button.addEventListener('click', () => startConnection(button.dataset.connect));
  });
  document.querySelectorAll('[data-rotate-credential]').forEach((button) => {
    button.addEventListener('click', () => {
      const account = state.accounts.find(item => item.id === button.dataset.rotateCredential);
      if (account) startConnection(account.connectorId, { account });
    });
  });
  document.querySelectorAll('[data-connector-sync]').forEach((button) => {
    button.addEventListener('click', () => syncConnectorAccount(button.dataset.connectorSync));
  });
  document.querySelectorAll('[data-jira-site]').forEach((button) => {
    button.addEventListener('click', () => openJiraSiteModal(button.dataset.jiraSite));
  });
  document.querySelectorAll('[data-confluence-site]').forEach((button) => {
    button.addEventListener('click', () => openConfluenceSiteModal(button.dataset.confluenceSite));
  });
  document.querySelectorAll('[data-asana-workspace]').forEach((button) => {
    button.addEventListener('click', () => openAsanaWorkspaceModal(button.dataset.asanaWorkspace));
  });
  document.querySelectorAll('[data-basecamp-account]').forEach((button) => {
    button.addEventListener('click', () => openBasecampAccountModal(button.dataset.basecampAccount));
  });
  document.querySelectorAll('[data-resource-guru-account]').forEach((button) => {
    button.addEventListener('click', () => openResourceGuruAccountModal(button.dataset.resourceGuruAccount));
  });
  document.querySelectorAll('[data-figma-team]').forEach((button) => {
    button.addEventListener('click', () => openFigmaTeamModal(button.dataset.figmaTeam));
  });
  document.querySelectorAll('[data-sharepoint-site]').forEach((button) => {
    button.addEventListener('click', () => openSharePointSiteModal(button.dataset.sharepointSite));
  });
  document.querySelectorAll('[data-xero-tenant]').forEach((button) => {
    button.addEventListener('click', () => openXeroTenantModal(button.dataset.xeroTenant));
  });
  document.querySelectorAll('[data-load-more-connectors]').forEach((button) => {
    button.addEventListener('click', () => {
      loadConnectors({ append: true });
    });
  });
}

function renderConnectorSafety() {
  const safety = state.connectorSafety;
  if (!safety) {
    els.connectorSafety.innerHTML = '';
    return;
  }
  const liveAdapters = state.connectorSyncReadiness?.ready || 0;
  els.connectorSafety.innerHTML = `
    <div>
      <strong>${safety.providerWritesBlocked} tools are write-blocked</strong>
      <span>${liveAdapters} provider sync adapters are live. Signals are read-only. ${safety.scopeReviews} account links require a scope review.</span>
    </div>
    <span>${safety.providerScopeReviews} broad provider grants flagged</span>
  `;
}

function renderCategories() {
  const allCount = state.connectorCatalogTotal || state.connectorTotal || state.connectors.length;
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
      loadConnectors();
    });
  });
}

function renderConnector(connector, account) {
  const connected = Boolean(account);
  const initials = connector.name.split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase();
  const configured = connector.auth.configured;
  const authLabel = connector.auth.displayType || (connector.auth.type === 'oauth2' ? 'OAuth' : connector.auth.type.replaceAll('_', ' '));
  const safety = connector.safety || {};
  const syncReady = connector.syncReadiness?.accountConnectionAvailable === true;
  const adapterImplemented = syncReady;
  const connectionLabel = connected ? (adapterImplemented ? 'connected' : 'linked') : syncReady ? (configured ? 'ready' : 'setup') : 'catalog';
  const connectionStatusClass = connected && adapterImplemented ? 'connected' : connected || (syncReady && configured) ? 'review' : 'high';
  const adapterSummary = syncReady
    ? 'Read-only sync adapter available.'
    : 'Account connection is not available yet.';
  const isJira = connector.id === 'jira_software' || connector.id === 'jira_service_management';
  const isConfluence = connector.id === 'confluence';
  const isAsana = connector.id === 'asana';
  const selectedJiraCloudId = account?.metadata?.fields?.cloudId;
  const selectedConfluenceCloudId = account?.metadata?.fields?.confluenceCloudId;
  const selectedAsanaWorkspaceGid = account?.metadata?.fields?.asanaWorkspaceGid;
  const selectedBasecampAccountId = account?.metadata?.fields?.basecampAccountId;
  const isBasecamp = connector.id === 'basecamp';
  const selectedResourceGuruAccountId = account?.metadata?.fields?.resourceGuruAccountId;
  const isResourceGuru = connector.id === 'resource_guru';
  const selectedFigmaTeamId = account?.metadata?.fields?.figmaTeamId;
  const isFigma = connector.id === 'figma';
  const selectedSharePointSiteId = account?.metadata?.fields?.sharePointSiteId;
  const isSharePoint = connector.id === 'sharepoint';
  const selectedXeroTenantId = account?.metadata?.fields?.xeroTenantId;
  const isXero = connector.id === 'xero';
  const canSync = Boolean(account && adapterImplemented && (!isFigma || selectedFigmaTeamId) && (!isConfluence || selectedConfluenceCloudId) && (!isSharePoint || selectedSharePointSiteId) && (!isXero || selectedXeroTenantId));
  const lastSync = account?.metadata?.lastWorkSignalSync || {};
  const sourceLabel = lastSync.source === 'github_api' ? 'GitHub API'
    : lastSync.source === 'trello_api' ? 'Trello API'
      : lastSync.source === 'jira_api' ? 'Jira API'
        : lastSync.source === 'asana_api' ? 'Asana API'
          : lastSync.source === 'slack_api' ? 'Slack API'
            : lastSync.source === 'google_workspace_api' ? 'Google Workspace API'
              : lastSync.source === 'microsoft_graph' ? 'Microsoft Graph'
                : lastSync.source === 'linear_graphql' ? 'Linear GraphQL'
                  : lastSync.source === 'notion_api' ? 'Notion API'
                    : lastSync.source === 'monday_api' ? 'monday.com API'
                      : lastSync.source === 'clickup_api' ? 'ClickUp API'
                        : lastSync.source === 'azure_devops_api' ? 'Azure DevOps API'
                          : lastSync.source === 'wrike_api' ? 'Wrike API'
                            : lastSync.source === 'smartsheet_api' ? 'Smartsheet API'
                              : lastSync.source === 'airtable_api' ? 'Airtable API'
                                : lastSync.source === 'todoist_api' ? 'Todoist API'
                                  : lastSync.source === 'shortcut_api' ? 'Shortcut API'
                                    : lastSync.source === 'bitbucket_api' ? 'Bitbucket API'
                                        : lastSync.source === 'basecamp_api' ? 'Basecamp API'
                                        : lastSync.source === 'xero_sales_invoice_metadata' ? 'Xero invoices'
                                        : lastSync.source === 'google_forms_metadata' ? 'Google Forms metadata'
                                          : lastSync.source === 'confluence_page_space_metadata' ? 'Confluence metadata'
                                          : 'Sync';
  const syncSummary = canSync && lastSync.finishedAt
    ? `<div class="meta"><span>${sourceLabel} ${formatDate(lastSync.finishedAt)}</span><span>${lastSync.signalCount || 0} signals</span>${lastSync.repositories ? `<span>${lastSync.repositories} repos</span>` : ''}${lastSync.boards ? `<span>${lastSync.boards} boards</span>` : ''}${lastSync.sites ? `<span>${lastSync.sites} Jira site${lastSync.sites === 1 ? '' : 's'}</span>` : ''}${lastSync.workspaces ? `<span>${lastSync.workspaces} Asana workspace${lastSync.workspaces === 1 ? '' : 's'}</span>` : ''}${lastSync.projects ? `<span>${lastSync.projects} projects</span>` : ''}${lastSync.todoLists ? `<span>${lastSync.todoLists} to-do lists</span>` : ''}${lastSync.channels ? `<span>${lastSync.channels} channels</span>` : ''}${lastSync.calendars ? `<span>${lastSync.calendars} calendars</span>` : ''}${lastSync.events ? `<span>${lastSync.events} events</span>` : ''}${lastSync.taskLists ? `<span>${lastSync.taskLists} task lists</span>` : ''}${lastSync.todoTasks ? `<span>${lastSync.todoTasks} To Do tasks</span>` : ''}${lastSync.files ? `<span>${lastSync.files} files</span>` : ''}${lastSync.issues ? `<span>${lastSync.issues} issues</span>` : ''}${lastSync.items ? `<span>${lastSync.items} items</span>` : ''}${lastSync.forms ? `<span>${lastSync.forms} forms</span>` : ''}${lastSync.salesInvoices ? `<span>${lastSync.salesInvoices} sales invoices</span>` : ''}${lastSync.spaces ? `<span>${lastSync.spaces} spaces</span>` : ''}${lastSync.pages ? `<span>${lastSync.pages} pages</span>` : ''}${lastSync.dataSources ? `<span>${lastSync.dataSources} data sources</span>` : ''}</div>`
    : '';
  const consentSummary = account?.consent?.acknowledgedAt
    ? `<div class="meta"><span>scope review ${escapeHtml(formatDate(account.consent.acknowledgedAt))}</span><span>${escapeHtml(account.consent.acknowledgedBy || 'local user')}</span></div>`
    : '';
  return `
    <div class="connector-card">
      <div class="connector-top">
        <div class="connector-identity">
          <div class="connector-logo">${escapeHtml(initials)}</div>
          <div>
            <h3>${escapeHtml(connector.name)}</h3>
            <div class="meta"><span>${escapeHtml(connector.categoryName)}</span><span>${escapeHtml(authLabel)}</span><span>${safety.scopeRisk === 'review' ? 'scope review' : 'read-only'}</span></div>
          </div>
        </div>
        <span class="pill ${connectionStatusClass}">${connectionLabel}</span>
      </div>
      <p>${escapeHtml(connector.description)}</p>
      <div class="connector-policy ${safety.scopeRisk === 'review' ? 'review' : ''}">${escapeHtml(safety.summary || 'Read-only ingestion only.')}</div>
      <div class="meta"><span>${escapeHtml(adapterSummary)}</span></div>
      ${consentSummary}
      ${syncSummary}
      <div class="connector-actions">
        <span class="meta">${connector.sync.slice(0, 3).map(escapeHtml).join('  |  ')}</span>
        ${isJira && account ? `<button class="button" data-jira-site="${escapeHtml(account.id)}" type="button">${selectedJiraCloudId ? 'Jira site selected' : 'Select Jira site'}</button>` : ''}
        ${isConfluence && account ? `<button class="button" data-confluence-site="${escapeHtml(account.id)}" type="button">${selectedConfluenceCloudId ? 'Confluence site selected' : 'Select Confluence site'}</button>` : ''}
        ${isAsana && account ? `<button class="button" data-asana-workspace="${escapeHtml(account.id)}" type="button">${selectedAsanaWorkspaceGid ? 'Asana workspace selected' : 'Select Asana workspace'}</button>` : ''}
        ${isBasecamp && account ? `<button class="button" data-basecamp-account="${escapeHtml(account.id)}" type="button">${selectedBasecampAccountId ? 'Basecamp account selected' : 'Select Basecamp account'}</button>` : ''}
        ${isResourceGuru && account ? `<button class="button" data-resource-guru-account="${escapeHtml(account.id)}" type="button">${selectedResourceGuruAccountId ? 'Resource Guru account selected' : 'Select Resource Guru account'}</button>` : ''}
        ${isFigma && account ? `<button class="button" data-figma-team="${escapeHtml(account.id)}" type="button">${selectedFigmaTeamId ? 'Figma team selected' : 'Configure Figma team'}</button>` : ''}
        ${isSharePoint && account ? `<button class="button" data-sharepoint-site="${escapeHtml(account.id)}" type="button">${selectedSharePointSiteId ? 'SharePoint site selected' : 'Select SharePoint site'}</button>` : ''}
        ${isXero && account ? `<button class="button" data-xero-tenant="${escapeHtml(account.id)}" type="button">${selectedXeroTenantId ? 'Xero organisation selected' : 'Select Xero organisation'}</button>` : ''}
        ${canSync ? `<button class="button" data-connector-sync="${escapeHtml(account.id)}" type="button">Sync now</button>` : ''}
        ${syncReady ? (connected && connector.auth.type !== 'oauth2'
          ? `<button class="button primary" data-rotate-credential="${escapeHtml(account.id)}" type="button">Rotate credential</button>`
          : `<button class="button ${configured ? 'primary' : ''}" data-connect="${connector.id}" type="button">${connected ? 'Reconnect' : 'Connect'}</button>`) : ''}
      </div>
    </div>
  `;
}

async function openFigmaTeamModal(accountId) {
  const account = state.accounts.find(item => item.id === accountId);
  if (!account) return;
  const selectedTeamId = account.metadata?.fields?.figmaTeamId || '';
  els.modalTitle.textContent = 'Configure Figma team';
  els.modalBody.innerHTML = `
    <form id="figmaTeamForm">
      <div class="field">
        <label for="figmaTeamId">Figma team ID</label>
        <input id="figmaTeamId" name="figmaTeamId" inputmode="numeric" pattern="[0-9]{1,24}" maxlength="24" required value="${escapeHtml(selectedTeamId)}" placeholder="Numeric ID from the Figma team URL">
      </div>
      <div class="notice">Sneup uses the selected team's project and file metadata only. It does not read design content, nodes, comments, users, thumbnails, URLs, or versions.</div>
      <div class="toolbar modal-actions">
        <button class="button" type="button" id="cancelFigmaTeam">Cancel</button>
        <button class="button primary" type="submit">Use this team</button>
      </div>
    </form>
  `;
  els.modal.classList.add('open');
  document.getElementById('cancelFigmaTeam').addEventListener('click', closeModal);
  document.getElementById('figmaTeamForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.target).entries());
    try {
      await fetchApi(`/api/connectors/accounts/${accountId}/figma-team`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      closeModal();
      openNotice('Figma team configured', 'Sneup will use this team for the next read-only metadata sync.');
      await loadConnectors();
    } catch (error) {
      openNotice('Figma team configuration', error.message);
    }
  });
}

async function openSharePointSiteModal(accountId) {
  const account = state.accounts.find(item => item.id === accountId);
  if (!account) return;

  try {
    const data = await fetchApi(`/api/connectors/accounts/${accountId}/sharepoint-sites`);
    const sites = data.sites || [];
    if (sites.length === 0) {
      openNotice('SharePoint site selection', 'No followed SharePoint sites are available for this account. Follow a site in SharePoint, then reconnect it with the approved read-only scope.');
      return;
    }

    const selectedSiteId = account.metadata?.fields?.sharePointSiteId || (sites.length === 1 ? sites[0].sharePointSiteId : '');
    els.modalTitle.textContent = 'Select SharePoint site';
    els.modalBody.innerHTML = `
      <form id="sharePointSiteForm">
        <div class="field">
          <label for="sharePointSiteId">Followed SharePoint site</label>
          <select id="sharePointSiteId" name="sharePointSiteId" required>
            <option value="" ${selectedSiteId ? '' : 'selected'} disabled>Select a site</option>
            ${sites.map(site => `<option value="${escapeHtml(site.sharePointSiteId)}" ${site.sharePointSiteId === selectedSiteId ? 'selected' : ''}>${escapeHtml(site.name)}</option>`).join('')}
          </select>
        </div>
        <div class="notice">Sneup reads only root file and folder metadata from this selected followed site. It does not read contents, links, permissions, pages, lists, versions, or sharing details.</div>
        <div class="toolbar modal-actions">
          <button class="button" type="button" id="cancelSharePointSite">Cancel</button>
          <button class="button primary" type="submit">Use this site</button>
        </div>
      </form>
    `;
    els.modal.classList.add('open');
    document.getElementById('cancelSharePointSite').addEventListener('click', closeModal);
    document.getElementById('sharePointSiteForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const body = Object.fromEntries(new FormData(event.target).entries());
      try {
        await fetchApi(`/api/connectors/accounts/${accountId}/sharepoint-site`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        });
        closeModal();
        openNotice('SharePoint site selected', 'Sneup will use this site for the next read-only metadata sync.');
        await loadConnectors();
      } catch (error) {
        openNotice('SharePoint site selection', error.message);
      }
    });
  } catch (error) {
    openNotice('SharePoint site selection', error.message);
  }
}

async function openXeroTenantModal(accountId) {
  const account = state.accounts.find(item => item.id === accountId);
  if (!account) return;

  try {
    const data = await fetchApi(`/api/connectors/accounts/${accountId}/xero-tenants`);
    const tenants = data.tenants || [];
    if (tenants.length === 0) {
      openNotice('Xero organisation selection', 'No Xero organisations are available for this account. Reconnect it with the approved invoice read scope.');
      return;
    }

    const selectedTenantId = account.metadata?.fields?.xeroTenantId || (tenants.length === 1 ? tenants[0].xeroTenantId : '');
    els.modalTitle.textContent = 'Select Xero organisation';
    els.modalBody.innerHTML = `
      <form id="xeroTenantForm">
        <div class="field">
          <label for="xeroTenantId">Authorized Xero organisation</label>
          <select id="xeroTenantId" name="xeroTenantId" required>
            <option value="" ${selectedTenantId ? '' : 'selected'} disabled>Select an organisation</option>
            ${tenants.map(tenant => `<option value="${escapeHtml(tenant.xeroTenantId)}" ${tenant.xeroTenantId === selectedTenantId ? 'selected' : ''}>${escapeHtml(tenant.name)}</option>`).join('')}
          </select>
        </div>
        <div class="notice">Sneup reads only capped sales-invoice status and date metadata from this organisation. It does not retain contacts, invoice numbers, amounts, payment details, line items, or links.</div>
        <div class="toolbar modal-actions">
          <button class="button" type="button" id="cancelXeroTenant">Cancel</button>
          <button class="button primary" type="submit">Use this organisation</button>
        </div>
      </form>
    `;
    els.modal.classList.add('open');
    document.getElementById('cancelXeroTenant').addEventListener('click', closeModal);
    document.getElementById('xeroTenantForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const body = Object.fromEntries(new FormData(event.target).entries());
      try {
        await fetchApi(`/api/connectors/accounts/${accountId}/xero-tenant`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        });
        closeModal();
        openNotice('Xero organisation selected', 'Sneup will use this organisation for the next read-only invoice metadata sync.');
        await loadConnectors();
      } catch (error) {
        openNotice('Xero organisation selection', error.message);
      }
    });
  } catch (error) {
    openNotice('Xero organisation selection', error.message);
  }
}

async function openResourceGuruAccountModal(accountId) {
  const account = state.accounts.find(item => item.id === accountId);
  if (!account) return;

  try {
    const data = await fetchApi(`/api/connectors/accounts/${accountId}/resource-guru-accounts`);
    const accounts = data.accounts || [];
    if (accounts.length === 0) {
      openNotice('Resource Guru account selection', 'No Resource Guru accounts are currently authorized for this connection. Reconnect it with Resource Guru access.');
      return;
    }

    const selectedAccountId = account.metadata?.fields?.resourceGuruAccountId || (accounts.length === 1 ? accounts[0].resourceGuruAccountId : '');
    els.modalTitle.textContent = 'Select Resource Guru account';
    els.modalBody.innerHTML = `
      <form id="resourceGuruAccountForm">
        <div class="field">
          <label for="resourceGuruAccountId">Authorized Resource Guru account</label>
          <select id="resourceGuruAccountId" name="resourceGuruAccountId" required>
            <option value="" ${selectedAccountId ? '' : 'selected'} disabled>Select an account</option>
            ${accounts.map(resourceGuruAccount => `<option value="${escapeHtml(resourceGuruAccount.resourceGuruAccountId)}" ${resourceGuruAccount.resourceGuruAccountId === selectedAccountId ? 'selected' : ''}>${escapeHtml(resourceGuruAccount.name)}</option>`).join('')}
          </select>
        </div>
        <div class="notice">Sneup will only ingest read-only project and booking schedule metadata from this account.</div>
        <div class="toolbar modal-actions">
          <button class="button" type="button" id="cancelResourceGuruAccount">Cancel</button>
          <button class="button primary" type="submit">Use this account</button>
        </div>
      </form>
    `;
    els.modal.classList.add('open');
    document.getElementById('cancelResourceGuruAccount').addEventListener('click', closeModal);
    document.getElementById('resourceGuruAccountForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const body = Object.fromEntries(new FormData(event.target).entries());
      try {
        await fetchApi(`/api/connectors/accounts/${accountId}/resource-guru-account`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        });
        closeModal();
        openNotice('Resource Guru account selected', 'Sneup will use this account for the next read-only sync.');
        await loadConnectors();
      } catch (error) {
        openNotice('Resource Guru account selection', error.message);
      }
    });
  } catch (error) {
    openNotice('Resource Guru account selection', error.message);
  }
}

async function openBasecampAccountModal(accountId) {
  const account = state.accounts.find(item => item.id === accountId);
  if (!account) return;

  try {
    const data = await fetchApi(`/api/connectors/accounts/${accountId}/basecamp-accounts`);
    const accounts = data.accounts || [];
    if (accounts.length === 0) {
      openNotice('Basecamp account selection', 'No Basecamp 3 accounts are currently authorized for this connection. Reconnect it with Basecamp access.');
      return;
    }

    const selectedAccountId = account.metadata?.fields?.basecampAccountId || (accounts.length === 1 ? accounts[0].basecampAccountId : '');
    els.modalTitle.textContent = 'Select Basecamp account';
    els.modalBody.innerHTML = `
      <form id="basecampAccountForm">
        <div class="field">
          <label for="basecampAccountId">Authorized Basecamp account</label>
          <select id="basecampAccountId" name="basecampAccountId" required>
            <option value="" ${selectedAccountId ? '' : 'selected'} disabled>Select an account</option>
            ${accounts.map(basecampAccount => `<option value="${escapeHtml(basecampAccount.basecampAccountId)}" ${basecampAccount.basecampAccountId === selectedAccountId ? 'selected' : ''}>${escapeHtml(basecampAccount.name)}</option>`).join('')}
          </select>
        </div>
        <div class="notice">Sneup will only ingest read-only project and to-do metadata from this account.</div>
        <div class="toolbar modal-actions">
          <button class="button" type="button" id="cancelBasecampAccount">Cancel</button>
          <button class="button primary" type="submit">Use this account</button>
        </div>
      </form>
    `;
    els.modal.classList.add('open');
    document.getElementById('cancelBasecampAccount').addEventListener('click', closeModal);
    document.getElementById('basecampAccountForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const body = Object.fromEntries(new FormData(event.target).entries());
      try {
        await fetchApi(`/api/connectors/accounts/${accountId}/basecamp-account`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        });
        closeModal();
        openNotice('Basecamp account selected', 'Sneup will use this account for the next read-only sync.');
        await loadConnectors();
      } catch (error) {
        openNotice('Basecamp account selection', error.message);
      }
    });
  } catch (error) {
    openNotice('Basecamp account selection', error.message);
  }
}

async function openAsanaWorkspaceModal(accountId) {
  const account = state.accounts.find(item => item.id === accountId);
  if (!account) return;

  try {
    const data = await fetchApi(`/api/connectors/accounts/${accountId}/asana-workspaces`);
    const workspaces = data.workspaces || [];
    if (workspaces.length === 0) {
      openNotice('Asana workspace selection', 'No Asana workspaces are currently authorized for this account. Reconnect it with workspace read access.');
      return;
    }

    const selectedWorkspaceGid = account.metadata?.fields?.asanaWorkspaceGid || (workspaces.length === 1 ? workspaces[0].workspaceGid : '');
    els.modalTitle.textContent = 'Select Asana workspace';
    els.modalBody.innerHTML = `
      <form id="asanaWorkspaceForm">
        <div class="field">
          <label for="asanaWorkspaceGid">Authorized workspace</label>
          <select id="asanaWorkspaceGid" name="workspaceGid" required>
            <option value="" ${selectedWorkspaceGid ? '' : 'selected'} disabled>Select a workspace</option>
            ${workspaces.map(workspace => `<option value="${escapeHtml(workspace.workspaceGid)}" ${workspace.workspaceGid === selectedWorkspaceGid ? 'selected' : ''}>${escapeHtml(workspace.name)}${workspace.organization ? ' (organization)' : ''}</option>`).join('')}
          </select>
        </div>
        <div class="notice">Sneup will only ingest read-only project tasks from the selected workspace.</div>
        <div class="toolbar modal-actions">
          <button class="button" type="button" id="cancelAsanaWorkspace">Cancel</button>
          <button class="button primary" type="submit">Use this workspace</button>
        </div>
      </form>
    `;
    els.modal.classList.add('open');
    document.getElementById('cancelAsanaWorkspace').addEventListener('click', closeModal);
    document.getElementById('asanaWorkspaceForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const body = Object.fromEntries(new FormData(event.target).entries());
      try {
        await fetchApi(`/api/connectors/accounts/${accountId}/asana-workspace`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        closeModal();
        openNotice('Asana workspace selected', 'Sneup will use this workspace for the next read-only sync.');
        await loadConnectors();
      } catch (error) {
        openNotice('Asana workspace selection', error.message);
      }
    });
  } catch (error) {
    openNotice('Asana workspace selection', error.message);
  }
}

async function openConfluenceSiteModal(accountId) {
  const account = state.accounts.find(item => item.id === accountId);
  if (!account) return;

  try {
    const data = await fetchApi(`/api/connectors/accounts/${accountId}/confluence-sites`);
    const sites = data.sites || [];
    if (sites.length === 0) {
      openNotice('Confluence site selection', 'No Confluence sites are currently authorized for this account. Reconnect it with page and space read access.');
      return;
    }

    const selectedCloudId = account.metadata?.fields?.confluenceCloudId || (sites.length === 1 ? sites[0].cloudId : '');
    els.modalTitle.textContent = 'Select Confluence site';
    els.modalBody.innerHTML = `
      <form id="confluenceSiteForm">
        <div class="field">
          <label for="confluenceCloudId">Authorized Confluence site</label>
          <select id="confluenceCloudId" name="cloudId" required>
            <option value="" ${selectedCloudId ? '' : 'selected'} disabled>Select a site</option>
            ${sites.map(site => `<option value="${escapeHtml(site.cloudId)}" ${site.cloudId === selectedCloudId ? 'selected' : ''}>${escapeHtml(site.name)}${site.url ? ` (${escapeHtml(site.url)})` : ''}</option>`).join('')}
          </select>
        </div>
        <div class="notice">Sneup will ingest space and page metadata only. It does not read page bodies, comments, attachments, users, descriptions, URLs, or version messages.</div>
        <div class="toolbar modal-actions">
          <button class="button" type="button" id="cancelConfluenceSite">Cancel</button>
          <button class="button primary" type="submit">Use this site</button>
        </div>
      </form>
    `;
    els.modal.classList.add('open');
    document.getElementById('cancelConfluenceSite').addEventListener('click', closeModal);
    document.getElementById('confluenceSiteForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const body = Object.fromEntries(new FormData(event.target).entries());
      try {
        await fetchApi(`/api/connectors/accounts/${accountId}/confluence-site`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        closeModal();
        openNotice('Confluence site selected', 'Sneup will use this site for the next read-only metadata sync.');
        await loadConnectors();
      } catch (error) {
        openNotice('Confluence site selection', error.message);
      }
    });
  } catch (error) {
    openNotice('Confluence site selection', error.message);
  }
}

async function openJiraSiteModal(accountId) {
  const account = state.accounts.find(item => item.id === accountId);
  if (!account) return;

  try {
    const data = await fetchApi(`/api/connectors/accounts/${accountId}/jira-sites`);
    const sites = data.sites || [];
    if (sites.length === 0) {
      openNotice('Jira site selection', 'No Jira sites are currently authorized for this account. Reconnect it with Jira read access.');
      return;
    }

    const selectedCloudId = account.metadata?.fields?.cloudId || (sites.length === 1 ? sites[0].cloudId : '');
    els.modalTitle.textContent = 'Select Jira site';
    els.modalBody.innerHTML = `
      <form id="jiraSiteForm">
        <div class="field">
          <label for="jiraCloudId">Authorized Jira site</label>
          <select id="jiraCloudId" name="cloudId" required>
            <option value="" ${selectedCloudId ? '' : 'selected'} disabled>Select a site</option>
            ${sites.map(site => `<option value="${escapeHtml(site.cloudId)}" ${site.cloudId === selectedCloudId ? 'selected' : ''}>${escapeHtml(site.name)}${site.url ? ` (${escapeHtml(site.url)})` : ''}</option>`).join('')}
          </select>
        </div>
        <div class="notice">Sneup will only ingest read-only work signals from the selected site.</div>
        <div class="toolbar modal-actions">
          <button class="button" type="button" id="cancelJiraSite">Cancel</button>
          <button class="button primary" type="submit">Use this site</button>
        </div>
      </form>
    `;
    els.modal.classList.add('open');
    document.getElementById('cancelJiraSite').addEventListener('click', closeModal);
    document.getElementById('jiraSiteForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const body = Object.fromEntries(new FormData(event.target).entries());
      try {
        await fetchApi(`/api/connectors/accounts/${accountId}/jira-site`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        closeModal();
        openNotice('Jira site selected', 'Sneup will use this site for the next read-only sync.');
        await loadConnectors();
      } catch (error) {
        openNotice('Jira site selection', error.message);
      }
    });
  } catch (error) {
    openNotice('Jira site selection', error.message);
  }
}

async function syncConnectorAccount(accountId) {
  if (!accountId) return;
  try {
    const data = await fetchApi(`/api/work-signals/accounts/${accountId}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const result = data.result || {};
    openNotice('Connector synced', `${result.signalCount || 0} work signals updated${result.retryCount ? ` after ${result.retryCount} ${result.retryCount === 1 ? 'retry' : 'retries'}` : ''}.`);
    await Promise.all([loadConnectors(), loadWorkSignals(), loadJobDashboard()]);
  } catch (error) {
    openNotice('Connector sync unavailable', error.message);
  }
}

async function startConnection(connectorId, options = {}) {
  const connector = state.connectors.find(item => item.id === connectorId);
  if (!connector) return;
  try {
    const response = await apiFetch(`/api/connectors/${connectorId}/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ returnTo: '/?connectors=1', scopeAcknowledged: options.scopeAcknowledged === true })
    });
    const data = await response.json();
    if (!data.success) throw new Error(data.error || 'Could not start connection');

    if (data.scopeReviewRequired) {
      openConnectorSafetyReview(connector, data, options.account);
      return;
    }

    if (data.authUrl) {
      window.location.href = data.authUrl;
      return;
    }

    openCredentialModal(connector, data, options.account);
  } catch (error) {
    openNotice(connector.name, error.message);
  }
}

function openConnectorSafetyReview(connector, data, account) {
  const safety = data.safety || connector.safety || {};
  els.modalTitle.textContent = `Review ${connector.name} access`;
  els.modalBody.innerHTML = `
    <div class="notice-stack">
      <div class="notice"><strong>Read-only signal ingestion.</strong> Sneup blocks provider writes and turns proposed provider changes into exact-payload approval decisions.</div>
      <div class="scope-review-list">
        <span>Requested provider scopes</span>
        <code>${escapeHtml((safety.requestedScopes || []).join(', ') || 'Provider-managed token permissions')}</code>
      </div>
      ${(safety.reviewReasons || []).map(reason => `<div class="notice">${escapeHtml(reason)}</div>`).join('')}
      <div class="toolbar modal-actions">
        <button class="button" type="button" id="cancelScopeReview">Cancel</button>
        <button class="button primary" type="button" id="continueScopeReview">Continue to ${escapeHtml(connector.name)}</button>
      </div>
    </div>
  `;
  els.modal.classList.add('open');
  document.getElementById('cancelScopeReview').addEventListener('click', closeModal);
  document.getElementById('continueScopeReview').addEventListener('click', () => {
    closeModal();
    startConnection(connector.id, { scopeAcknowledged: true, account });
  });
}

function openCredentialModal(connector, data, account) {
  const fields = data.fields || connector.auth.fields || [];
  const rotating = Boolean(account);
  els.modalTitle.textContent = `${rotating ? 'Rotate' : 'Connect'} ${connector.name}`;
  els.modalBody.innerHTML = `
    <form id="credentialForm">
      ${fields.map(field => `
        <div class="field">
          <label for="field-${field.name}">${escapeHtml(field.label || field.name)}</label>
          <input id="field-${field.name}" name="${field.name}" type="${field.secret ? 'password' : 'text'}" autocomplete="${field.secret ? 'current-password' : 'off'}" ${field.required ? 'required' : ''}>
        </div>
      `).join('')}
      <div class="field">
        <label for="accountName">Account name</label>
        <input id="accountName" name="accountName" type="text" placeholder="${escapeHtml(connector.name)}">
      </div>
      <div class="notice">Credential storage is locked until MongoDB plus CONNECTOR_ENCRYPTION_KEY are configured. ${rotating ? 'Replacing this credential retains the linked account, renews its scope evidence, and records a secret-free audit event.' : 'Saving records the scope review without storing your credential in the audit ledger.'}</div>
      <div class="toolbar modal-actions">
        <button class="button" type="button" id="cancelCredential">Cancel</button>
        <button class="button primary" type="submit">${rotating ? 'Replace credential' : 'Save account'}</button>
      </div>
    </form>
  `;
  els.modal.classList.add('open');
  document.getElementById('cancelCredential').addEventListener('click', closeModal);
  document.getElementById('credentialForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = {
      ...Object.fromEntries(new FormData(event.target).entries()),
      scopeAcknowledged: data.scopeAcknowledged === true
    };
    try {
      const response = await apiFetch(rotating ? `/api/connectors/accounts/${account.id}/rotate-credentials` : `/api/connectors/${connector.id}/accounts`, {
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

function openTrelloActionReconciliation(actionId) {
  const attempt = (state.ledger.actions || []).find(item => getId(item._id || item.id) === actionId);
  if (!attempt) return;

  els.modalTitle.textContent = `Reconcile ${String(attempt.actionType || 'Trello action').replaceAll('_', ' ')}`;
  els.modalBody.innerHTML = `
    <form id="trelloActionReconciliationForm" class="notice-stack">
      <div class="notice">Confirm the observed provider result. This finalizes Sneup's ledger and does not send another Trello request.</div>
      <label>Observed result
        <select name="outcome" required>
          <option value="" selected disabled>Select result</option>
          <option value="succeeded">Succeeded in Trello</option>
          <option value="failed">Did not succeed in Trello</option>
        </select>
      </label>
      <label>Evidence checked
        <textarea name="evidence" rows="4" maxlength="2000" required placeholder="Trello activity, card state, or provider error reviewed"></textarea>
      </label>
      <label>Resolution note
        <textarea name="reason" rows="2" maxlength="1000" placeholder="Optional decision note"></textarea>
      </label>
      <div class="toolbar modal-actions">
        <button class="button" type="button" id="cancelTrelloReconciliation">Cancel</button>
        <button class="button primary" type="submit">Finalize ledger</button>
      </div>
    </form>
  `;
  els.modal.classList.add('open');

  document.getElementById('cancelTrelloReconciliation').addEventListener('click', closeModal);
  document.getElementById('trelloActionReconciliationForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitButton = event.currentTarget.querySelector('button[type="submit"]');
    const formData = new FormData(event.currentTarget);
    submitButton.disabled = true;
    submitButton.textContent = 'Finalizing...';

    try {
      const data = await fetchApi(`/api/trello-actions/${encodeURIComponent(actionId)}/reconcile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outcome: formData.get('outcome'),
          evidence: formData.get('evidence'),
          reason: formData.get('reason'),
          reconciledBy: state.securityContext?.actorId || 'local-user'
        })
      });
      closeModal();
      await loadOperationsLedger();
      openNotice('Ledger reconciled', data.auditRecorded === false
        ? 'The provider result is finalized. Audit recording needs operator review.'
        : 'The provider result and approval ledger are finalized.');
    } catch (error) {
      submitButton.disabled = false;
      submitButton.textContent = 'Finalize ledger';
      openNotice('Reconciliation blocked', error.message);
    }
  });
}

function openNotificationPolicy() {
  els.modalTitle.textContent = 'Add alert policy';
  els.modalBody.innerHTML = `
    <form id="notificationPolicyForm" class="notice-stack">
      <label>Name<input name="name" type="text" maxlength="120" required placeholder="Operations alerts"></label>
      <label>Channel
        <select name="channel" required>
          <option value="slack_webhook">Slack webhook</option>
          <option value="teams_webhook">Teams webhook</option>
          <option value="generic_webhook">Generic webhook</option>
          <option value="email">Email (Resend)</option>
        </select>
      </label>
      <label>Destination label<input name="destinationLabel" type="text" maxlength="160" required placeholder="Project operations channel"></label>
      <label id="notificationWebhookDestination">HTTPS webhook URL<input name="destinationUrl" type="url" inputmode="url" autocomplete="off" required placeholder="https://..."></label>
      <label id="notificationEmailDestination" hidden>Email recipient<input name="destinationEmail" type="email" inputmode="email" autocomplete="email" placeholder="operations@example.com"></label>
      <label>Minimum severity
        <select name="minimumSeverity">
          <option value="warning">Warning and critical</option>
          <option value="critical">Critical only</option>
        </select>
      </label>
      <label><input name="quietHoursEnabled" type="checkbox"> Defer warning alerts during quiet hours (critical alerts stay immediate)</label>
      <div class="form-grid">
        <label>Quiet start UTC<input name="quietStartHourUtc" type="number" min="0" max="23" value="18"></label>
        <label>Quiet end UTC<input name="quietEndHourUtc" type="number" min="0" max="23" value="8"></label>
      </div>
      <label><input name="digestEnabled" type="checkbox"> Send warning evidence as one daily digest (critical alerts stay immediate)</label>
      <div class="form-grid">
        <label>Digest hour UTC<input name="digestHourUtc" type="number" min="0" max="23" value="9"></label>
        <label>Maximum digest items<input name="digestMaximumItems" type="number" min="1" max="25" value="10"></label>
      </div>
      <div class="notice">The policy starts paused. Activate it separately when this workspace is ready to deliver matching reconciliation alerts.</div>
      <div class="toolbar modal-actions">
        <button class="button" type="button" id="cancelNotificationPolicy">Cancel</button>
        <button class="button primary" type="submit">Save paused policy</button>
      </div>
    </form>
  `;
  els.modal.classList.add('open');
  document.getElementById('cancelNotificationPolicy').addEventListener('click', closeModal);
  const policyForm = document.getElementById('notificationPolicyForm');
  const channelInput = policyForm.elements.channel;
  const webhookDestination = document.getElementById('notificationWebhookDestination');
  const emailDestination = document.getElementById('notificationEmailDestination');
  const syncDestinationInput = () => {
    const emailSelected = channelInput.value === 'email';
    webhookDestination.hidden = emailSelected;
    emailDestination.hidden = !emailSelected;
    policyForm.elements.destinationUrl.required = !emailSelected;
    policyForm.elements.destinationEmail.required = emailSelected;
  };
  channelInput.addEventListener('change', syncDestinationInput);
  syncDestinationInput();
  policyForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitButton = event.currentTarget.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = 'Saving...';
    try {
      await fetchApi('/api/notifications/policies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...Object.fromEntries(new FormData(event.currentTarget).entries()),
          quietHours: {
            enabled: event.currentTarget.elements.quietHoursEnabled.checked,
            startHourUtc: Number(event.currentTarget.elements.quietStartHourUtc.value),
            endHourUtc: Number(event.currentTarget.elements.quietEndHourUtc.value)
          },
          digest: {
            enabled: event.currentTarget.elements.digestEnabled.checked,
            hourUtc: Number(event.currentTarget.elements.digestHourUtc.value),
            maximumItems: Number(event.currentTarget.elements.digestMaximumItems.value)
          }
        })
      });
      closeModal();
      await loadOperationsLedger();
    } catch (error) {
      submitButton.disabled = false;
      submitButton.textContent = 'Save paused policy';
      openNotice('Policy not saved', error.message);
    }
  });
}

async function updateNotificationPolicy(policyId, body) {
  try {
    await fetchApi(`/api/notifications/policies/${encodeURIComponent(policyId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    await loadOperationsLedger();
    return true;
  } catch (error) {
    openNotice('Policy update blocked', error.message);
    return false;
  }
}

function openNotificationActivation(policyId) {
  const policy = (state.ledger.notificationPolicies || []).find(item => getId(item.id || item._id) === policyId);
  if (!policy) return;
  els.modalTitle.textContent = 'Activate alert policy';
  els.modalBody.innerHTML = `
    <form id="activateNotificationPolicyForm" class="notice-stack">
      <div class="notice">Activating <strong>${escapeHtml(policy.name)}</strong> sends matching ${escapeHtml(policy.minimumSeverity)} reconciliation evidence alerts to <strong>${escapeHtml(policy.destinationLabel || 'the configured destination')}</strong>.</div>
      <label><input type="checkbox" name="confirmActivation" required> I confirm this workspace may deliver these alerts.</label>
      <div class="toolbar modal-actions">
        <button class="button" type="button" id="cancelNotificationActivation">Cancel</button>
        <button class="button primary" type="submit">Activate policy</button>
      </div>
    </form>
  `;
  els.modal.classList.add('open');
  document.getElementById('cancelNotificationActivation').addEventListener('click', closeModal);
  document.getElementById('activateNotificationPolicyForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitButton = event.currentTarget.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = 'Activating...';
    try {
      if (await updateNotificationPolicy(policyId, { status: 'active' })) closeModal();
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = 'Activate policy';
    }
  });
}

function openNotificationTest(policyId) {
  const policy = (state.ledger.notificationPolicies || []).find(item => getId(item.id || item._id) === policyId);
  if (!policy) return;
  els.modalTitle.textContent = 'Send test alert';
  els.modalBody.innerHTML = `
    <form id="notificationTestForm" class="notice-stack">
      <div class="notice">This sends a real test delivery to <strong>${escapeHtml(policy.destinationLabel || 'the configured destination')}</strong>. It does not activate the policy.</div>
      <label><input type="checkbox" name="confirmDelivery" required> I understand this sends an external test notification.</label>
      <div class="toolbar modal-actions">
        <button class="button" type="button" id="cancelNotificationTest">Cancel</button>
        <button class="button primary" type="submit">Send test</button>
      </div>
    </form>
  `;
  els.modal.classList.add('open');
  document.getElementById('cancelNotificationTest').addEventListener('click', closeModal);
  document.getElementById('notificationTestForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitButton = event.currentTarget.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = 'Sending...';
    try {
      await fetchApi(`/api/notifications/policies/${encodeURIComponent(policyId)}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmDelivery: true })
      });
      closeModal();
      await loadOperationsLedger();
      openNotice('Test delivered', 'The external destination accepted the test alert.');
    } catch (error) {
      submitButton.disabled = false;
      submitButton.textContent = 'Send test';
      openNotice('Test delivery failed', error.message);
    }
  });
}

function closeModal() {
  els.modal.classList.remove('open');
}

function inviteTokenFromUrl() {
  const url = new URL(window.location.href);
  const token = url.searchParams.get('invite');
  if (!token) return '';
  url.searchParams.delete('invite');
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
  return token;
}

function openInviteAcceptance(rawToken) {
  els.modalTitle.textContent = 'Join workspace';
  els.modalBody.innerHTML = `
    <form id="acceptWorkspaceInviteForm" class="notice-stack">
      <label>Name<input name="displayName" type="text" autocomplete="name" required></label>
      <div class="toolbar modal-actions">
        <button class="button primary" type="submit">Join workspace</button>
      </div>
    </form>
  `;
  els.modal.classList.add('open');
  document.getElementById('acceptWorkspaceInviteForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitButton = event.currentTarget.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = 'Joining...';
    try {
      const values = new FormData(event.currentTarget);
      const data = await fetchApi('/api/workspaces/invitations/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: rawToken, displayName: values.get('displayName') })
      });
      state.sessionToken = data.sessionToken;
      sessionStorage.setItem(SESSION_TOKEN_KEY, data.sessionToken);
      state.activeWorkspaceId = data.workspace.id;
      localStorage.setItem('sneup.workspaceId', state.activeWorkspaceId);
      closeModal();
      await loadAll({ force: true });
      showView('overview');
    } catch (error) {
      openNotice('Unable to join workspace', error.message);
    }
  });
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

function toDateTimeLocalValue(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
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

const invitationToken = inviteTokenFromUrl();
if (invitationToken) {
  openInviteAcceptance(invitationToken);
} else {
  loadAll();
  if (!state.setupMode) openFirstRunSetup();
}
