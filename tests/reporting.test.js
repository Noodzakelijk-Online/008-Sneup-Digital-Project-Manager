const reportingService = require('../src/services/reportingService');

describe('stakeholder reporting', () => {
  const originalDemoMode = process.env.SNEUP_DEMO_MODE;

  beforeEach(() => {
    process.env.SNEUP_DEMO_MODE = 'true';
  });

  afterAll(() => {
    process.env.SNEUP_DEMO_MODE = originalDemoMode;
  });

  test('generates every report type from demo operating data', async () => {
    const types = reportingService.getTypes();
    expect(types.map(item => item.id)).toEqual([
      'weekly_status',
      'standup',
      'risk_register',
      'client_update'
    ]);

    for (const reportType of types.map(item => item.id)) {
      const report = await reportingService.generateReport(reportType);
      expect(report.markdown).toContain('# ');
      expect(report.markdown).toContain('Generated:');
      expect(report.markdown).toContain('Owner:');
      expect(report.markdown).toContain('Source:');
      expect(report.sections.length).toBeGreaterThan(0);
      expect(report.filename).toMatch(/^[a-z-]+-\d{4}-\d{2}-\d{2}$/);
    }
  });

  test('produces a PDF with project status content', async () => {
    const report = await reportingService.generateReport('weekly_status');
    const pdf = await reportingService.renderPdf(report);

    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.length).toBeGreaterThan(500);
  });

  test('rejects an unsupported report type', async () => {
    await expect(reportingService.generateReport('unknown')).rejects.toMatchObject({
      statusCode: 404,
      message: 'Unsupported report type'
    });
  });
});
