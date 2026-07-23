const WORK_SIGNAL_COUNT_FIELDS = [
  'repositories', 'boards', 'sites', 'workspaces', 'projects', 'tasks', 'taskLists', 'todoLists', 'todoTasks',
  'channels', 'calendars', 'events', 'files', 'issues', 'workflows', 'executions', 'timeEntries', 'mergeRequests',
  'items', 'pages', 'dataSources', 'forms', 'salesInvoices', 'spaces', 'sections', 'milestones', 'userStories'
];

const normalizeCount = value => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(1000000, Math.floor(parsed)));
};

const copyWorkSignalSyncCounts = (source = {}) => Object.fromEntries(
  WORK_SIGNAL_COUNT_FIELDS
    .filter(field => source[field] !== undefined && source[field] !== null)
    .map(field => [field, normalizeCount(source[field])])
);

module.exports = {
  WORK_SIGNAL_COUNT_FIELDS,
  copyWorkSignalSyncCounts
};
