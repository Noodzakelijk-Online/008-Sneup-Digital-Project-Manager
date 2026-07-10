const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const API_VERSION = '7.1';
const WORK_ITEM_FIELDS = [
  'System.Id',
  'System.Title',
  'System.WorkItemType',
  'System.State',
  'System.Reason',
  'System.AssignedTo',
  'System.Tags',
  'System.CreatedDate',
  'System.ChangedDate',
  'System.ClosedDate',
  'Microsoft.VSTS.Scheduling.DueDate',
  'Microsoft.VSTS.Common.Priority',
  'System.TeamProject',
  'System.AreaPath',
  'System.IterationPath'
];

const clampInteger = (value, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
};

const parseDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const relationTargetId = (relation) => {
  const match = String(relation?.url || '').match(/\/workitems\/(\d+)(?:$|\?)/i);
  return match ? match[1] : null;
};

const relationIds = (relations, pattern) => (relations || [])
  .filter(relation => pattern.test(String(relation?.rel || '')))
  .map(relationTargetId)
  .filter(Boolean);

class AzureDevOpsWorkSignalClient {
  constructor(options = {}) {
    this.http = options.http || axios;
    this.accountConnectorService = options.accountConnectorService || accountConnectorService;
  }

  getConfig() {
    return {
      timeout: clampInteger(process.env.SNEUP_AZURE_DEVOPS_TIMEOUT_MS, 15000, 1000, 60000),
      maxProjects: clampInteger(process.env.SNEUP_AZURE_DEVOPS_MAX_PROJECTS, 25, 1, 100),
      maxItemsPerProject: clampInteger(process.env.SNEUP_AZURE_DEVOPS_MAX_ITEMS_PER_PROJECT, 250, 1, 2000),
      maxTotalItems: clampInteger(process.env.SNEUP_AZURE_DEVOPS_MAX_TOTAL_ITEMS, 2500, 1, 10000),
      cursorLookbackMs: clampInteger(process.env.SNEUP_AZURE_DEVOPS_CURSOR_LOOKBACK_MS, 60000, 0, 3600000)
    };
  }

  getAccessToken(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const token = credentials.token || credentials.accessToken || credentials.apiKey;
    if (!token) {
      const error = new Error('Azure DevOps personal access token is missing. Reconnect this account to continue syncing.');
      error.statusCode = 503;
      throw error;
    }
    return token;
  }

  getOrganizationUrl(account) {
    const raw = String(account?.metadata?.fields?.organizationUrl || '').trim();
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      const error = new Error('A valid Azure DevOps organization URL is required. Use https://dev.azure.com/your-organization.');
      error.statusCode = 400;
      throw error;
    }
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'dev.azure.com' || segments.length !== 1 || parsed.search || parsed.hash) {
      const error = new Error('Azure DevOps organization URLs must use https://dev.azure.com/your-organization.');
      error.statusCode = 400;
      throw error;
    }
    return `https://dev.azure.com/${encodeURIComponent(segments[0])}`;
  }

  headers(token) {
    return {
      Accept: 'application/json',
      Authorization: `Basic ${Buffer.from(`:${token}`).toString('base64')}`,
      'Content-Type': 'application/json'
    };
  }

  requestGet(baseUrl, path, token, config, params = {}) {
    return this.http.get(`${baseUrl}${path}`, {
      params: { 'api-version': API_VERSION, ...params },
      headers: this.headers(token),
      timeout: config.timeout
    });
  }

  requestPost(baseUrl, path, token, config, body, params = {}) {
    return this.http.post(`${baseUrl}${path}`, body, {
      params: { 'api-version': API_VERSION, ...params },
      headers: this.headers(token),
      timeout: config.timeout
    });
  }

  async listProjects(baseUrl, token, config) {
    const response = await this.requestGet(baseUrl, '/_apis/projects', token, config, {
      '$top': config.maxProjects,
      stateFilter: 'wellFormed'
    });
    const projects = Array.isArray(response.data?.value) ? response.data.value.filter(project => project?.id || project?.name) : [];
    if (projects.length >= config.maxProjects) {
      const error = new Error('Azure DevOps sync reached its configured project limit. Increase SNEUP_AZURE_DEVOPS_MAX_PROJECTS before continuing.');
      error.statusCode = 413;
      throw error;
    }
    return projects;
  }

  async queryWorkItemIds(baseUrl, project, token, cursorDate, config, maxItems) {
    const changedSince = cursorDate ? new Date(cursorDate.getTime() - config.cursorLookbackMs).toISOString() : null;
    const query = [
      'SELECT [System.Id] FROM WorkItems',
      changedSince ? `WHERE [System.ChangedDate] >= '${changedSince}'` : '',
      'ORDER BY [System.ChangedDate] DESC'
    ].filter(Boolean).join(' ');
    const response = await this.requestPost(baseUrl, `/${encodeURIComponent(project.name || project.id)}/_apis/wit/wiql`, token, config, { query }, {
      '$top': maxItems,
      timePrecision: true
    });
    const ids = (Array.isArray(response.data?.workItems) ? response.data.workItems : [])
      .map(item => Number(item?.id))
      .filter(Number.isFinite);
    if (ids.length >= maxItems) {
      const error = new Error(`Azure DevOps project ${project.name || project.id} reached its configured work-item limit. Increase SNEUP_AZURE_DEVOPS_MAX_ITEMS_PER_PROJECT before continuing.`);
      error.statusCode = 413;
      throw error;
    }
    return ids;
  }

  sanitizeWorkItem(workItem, project, baseUrl) {
    const fields = workItem.fields || {};
    const relations = Array.isArray(workItem.relations) ? workItem.relations : [];
    const id = String(workItem.id);
    return {
      id,
      title: fields['System.Title'],
      workItemType: fields['System.WorkItemType'],
      status: fields['System.State'],
      reason: fields['System.Reason'],
      assignee: fields['System.AssignedTo'],
      tags: String(fields['System.Tags'] || '').split(';').map(tag => tag.trim()).filter(Boolean),
      dueDate: fields['Microsoft.VSTS.Scheduling.DueDate'],
      createdDate: fields['System.CreatedDate'],
      changedDate: fields['System.ChangedDate'],
      closedDate: fields['System.ClosedDate'],
      priority: fields['Microsoft.VSTS.Common.Priority'],
      project: { id: project.id, name: project.name || fields['System.TeamProject'] },
      areaPath: fields['System.AreaPath'],
      iterationPath: fields['System.IterationPath'],
      dependencies: relationIds(relations, /Dependency-Reverse/i),
      blocks: relationIds(relations, /Dependency-Forward/i),
      related: relationIds(relations, /Related/i),
      url: `${baseUrl}/${encodeURIComponent(project.name || project.id)}/_workitems/edit/${encodeURIComponent(id)}`
    };
  }

  async readWorkItems(baseUrl, project, ids, token, config) {
    const records = [];
    for (let index = 0; index < ids.length; index += 200) {
      const batchIds = ids.slice(index, index + 200);
      const response = await this.requestPost(baseUrl, `/${encodeURIComponent(project.name || project.id)}/_apis/wit/workitemsbatch`, token, config, {
        ids: batchIds,
        fields: WORK_ITEM_FIELDS,
        '$expand': 'Relations',
        errorPolicy: 'Omit'
      });
      const workItems = Array.isArray(response.data?.value) ? response.data.value : [];
      records.push(...workItems.map(item => this.sanitizeWorkItem(item, project, baseUrl)));
    }
    return records;
  }

  async fetchDelta(account, cursor) {
    const config = this.getConfig();
    const token = this.getAccessToken(account);
    const baseUrl = this.getOrganizationUrl(account);
    const cursorDate = parseDate(cursor);
    const projects = await this.listProjects(baseUrl, token, config);
    const records = [];
    let newest = cursorDate;

    for (const project of projects) {
      const remaining = config.maxTotalItems - records.length;
      if (remaining <= 0) {
        const error = new Error('Azure DevOps sync reached its configured total work-item limit. Increase SNEUP_AZURE_DEVOPS_MAX_TOTAL_ITEMS before continuing.');
        error.statusCode = 413;
        throw error;
      }
      const maxItems = Math.min(config.maxItemsPerProject, remaining);
      const ids = await this.queryWorkItemIds(baseUrl, project, token, cursorDate, config, maxItems);
      const projectItems = await this.readWorkItems(baseUrl, project, ids, token, config);
      for (const item of projectItems) {
        const changedAt = parseDate(item.changedDate || item.closedDate || item.createdDate);
        if (changedAt && (!newest || changedAt > newest)) newest = changedAt;
        records.push(item);
      }
    }
    return {
      records,
      nextCursor: newest ? newest.toISOString() : cursor || null,
      hasMore: false,
      metadata: { source: 'azure_devops_api', projects: projects.length, items: records.length }
    };
  }
}

const azureDevOpsWorkSignalClient = new AzureDevOpsWorkSignalClient();

module.exports = azureDevOpsWorkSignalClient;
module.exports.AzureDevOpsWorkSignalClient = AzureDevOpsWorkSignalClient;
