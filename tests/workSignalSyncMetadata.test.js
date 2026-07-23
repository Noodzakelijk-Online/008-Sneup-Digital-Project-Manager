const { copyWorkSignalSyncCounts } = require('../src/utils/workSignalSyncMetadata');

describe('work-signal sync metadata', () => {
  test('preserves only bounded aggregate count fields for connector status', () => {
    expect(copyWorkSignalSyncCounts({
      projects: 2,
      reports: 4,
      tasks: '7',
      taskLists: 3.9,
      calendars: -1,
      files: Number.POSITIVE_INFINITY,
      description: 'Private provider content',
      customFields: { secret: 'do not expose' }
    })).toEqual({ projects: 2, reports: 4, tasks: 7, taskLists: 3, calendars: 0, files: 0 });
  });
});
