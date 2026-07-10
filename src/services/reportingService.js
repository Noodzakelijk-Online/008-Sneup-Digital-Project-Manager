const PDFDocument = require('pdfkit');
const autopilotService = require('./autopilotService');
const operationsBriefService = require('./operationsBriefService');
const { safeExternalSourceUrl } = require('../utils/externalSourceUrl');

const REPORT_TYPES = Object.freeze({
  weekly_status: { label: 'Weekly status', filename: 'weekly-status' },
  standup: { label: 'Standup', filename: 'standup' },
  risk_register: { label: 'Risk register', filename: 'risk-register' },
  client_update: { label: 'Client update', filename: 'client-update' }
});

const REPORT_ITEM_LIMIT = 8;

const cleanText = (value, fallback = '') => String(value ?? fallback)
  .replace(/[\r\n]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const markdownText = (value, fallback = '') => cleanText(value, fallback)
  .replace(/([\\`*_[\]<>])/g, '\\$1');

const dateLabel = (value) => {
  const date = new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? 'Unknown date' : date.toISOString().slice(0, 10);
};

const listItem = (title, detail = '', sourceEvidence = []) => ({
  title: cleanText(title, 'Operating item'),
  detail: cleanText(detail),
  sources: (sourceEvidence || []).slice(0, 3).map((source = {}) => ({
    label: cleanText(source.label || source.type, 'Source'),
    url: safeExternalSourceUrl(source.url)
  }))
});

class ReportingService {
  getTypes() {
    return Object.entries(REPORT_TYPES).map(([id, type]) => ({ id, ...type }));
  }

  async generateReport(type, options = {}) {
    const definition = REPORT_TYPES[type];
    if (!definition) {
      const error = new Error('Unsupported report type');
      error.statusCode = 404;
      throw error;
    }

    const [brief, missionControl] = await Promise.all([
      operationsBriefService.getDailyBrief({ workspaceId: options.workspaceId }),
      autopilotService.getMissionControl({ workspaceId: options.workspaceId })
    ]);

    const generatedAt = missionControl.generatedAt || brief.generatedAt || new Date();
    const report = {
      type,
      label: definition.label,
      filename: `${definition.filename}-${dateLabel(generatedAt)}`,
      mode: missionControl.mode || brief.mode || 'live',
      generatedAt,
      headline: cleanText(brief.headline || missionControl.brief?.headline, 'Project update'),
      narrative: cleanText(brief.narrative || missionControl.brief?.narrative),
      sections: this.buildSections(type, brief, missionControl)
    };

    return {
      ...report,
      markdown: this.renderMarkdown(report)
    };
  }

  buildSections(type, brief = {}, missionControl = {}) {
    const decisions = (brief.robertDecisions || []).slice(0, REPORT_ITEM_LIMIT).map(item =>
      listItem(item.title, `${item.reason || 'Decision needed'} | Owner: ${item.ownerType || 'Robert'}${item.dueAt ? ` | Due: ${dateLabel(item.dueAt)}` : ''}`)
    );
    const focus = (missionControl.focus || []).slice(0, REPORT_ITEM_LIMIT).map(item =>
      listItem(item.name, `${item.boardName || 'Board'} | Owner: ${(item.members || []).join(', ') || 'Unassigned'}${item.due ? ` | Due: ${dateLabel(item.due)}` : ''} | ${(item.reasons || []).join(', ')}`, item.sourceEvidence)
    );
    const risks = (missionControl.risks || []).slice(0, REPORT_ITEM_LIMIT).map(item =>
      listItem(item.title, `${item.severity || 'medium'} risk | ${item.boardName || 'Portfolio'} | ${item.detail || ''}`, item.sourceEvidence)
    );
    const vaReady = (brief.vaReady || []).slice(0, REPORT_ITEM_LIMIT).map(item =>
      listItem(item.title, item.reason || 'Ready for VA ownership')
    );
    const followUps = (brief.dueFollowUps || []).slice(0, REPORT_ITEM_LIMIT).map(item =>
      listItem(item.title, item.reason || 'Follow-up due')
    );
    const boardHealth = (brief.boardHealth || []).slice(0, REPORT_ITEM_LIMIT).map(item =>
      listItem(item.title, item.reason || item.status || 'Board health needs review')
    );

    if (type === 'standup') {
      return [
        { heading: 'Today', items: (missionControl.dailyPlan?.firstHour || []).slice(0, 5).map(item => listItem(item)) },
        { heading: 'Top focus', items: focus },
        { heading: 'Robert decisions', items: decisions },
        { heading: 'Risks to manage', items: risks },
        { heading: 'VA-ready work', items: vaReady }
      ];
    }

    if (type === 'risk_register') {
      return [
        { heading: 'Active risks', items: risks },
        { heading: 'Delivery focus', items: focus },
        { heading: 'Boards requiring recovery', items: boardHealth },
        { heading: 'Follow-ups due', items: followUps },
        { heading: 'Decisions needed', items: decisions }
      ];
    }

    if (type === 'client_update') {
      return [
        { heading: 'Delivery focus', items: focus },
        { heading: 'Delivery risks', items: risks.map(item => listItem(item.title, item.detail, item.sources)) },
        { heading: 'Next decisions', items: decisions.map(item => listItem(item.title, item.detail, item.sources)) }
      ];
    }

    return [
      { heading: 'Delivery focus', items: focus },
      { heading: 'Risks to manage', items: risks },
      { heading: 'Decisions needed', items: decisions },
      { heading: 'VA-ready work', items: vaReady },
      { heading: 'Follow-ups due', items: followUps }
    ];
  }

  renderMarkdown(report) {
    const lines = [
      `# ${markdownText(report.label)}`,
      '',
      `Generated: ${dateLabel(report.generatedAt)} (${markdownText(report.mode)} mode)`,
      '',
      `## ${markdownText(report.headline)}`,
      report.narrative ? markdownText(report.narrative) : ''
    ].filter((line, index) => line || index < 5);

    for (const section of report.sections) {
      lines.push('', `## ${markdownText(section.heading)}`);
      if (!section.items.length) {
        lines.push('', 'No items need attention.');
        continue;
      }
      section.items.forEach(item => {
        const detail = item.detail ? ` - ${markdownText(item.detail)}` : '';
        lines.push(`- **${markdownText(item.title)}**${detail}`);
        item.sources.forEach(source => {
          const sourceLabel = markdownText(source.label);
          lines.push(source.url ? `  - Source: [${sourceLabel}](${source.url})` : `  - Source: ${sourceLabel}`);
        });
      });
    }

    return `${lines.join('\n').trim()}\n`;
  }

  renderPdf(report) {
    return new Promise((resolve, reject) => {
      const document = new PDFDocument({ margin: 48, size: 'A4', info: { Title: `Sneup ${report.label}` } });
      const chunks = [];
      document.on('data', chunk => chunks.push(chunk));
      document.on('error', reject);
      document.on('end', () => resolve(Buffer.concat(chunks)));

      document.fontSize(20).text(`Sneup ${report.label}`);
      document.moveDown(0.35);
      document.fontSize(9).fillColor('#5f6d67').text(`Generated ${dateLabel(report.generatedAt)} | ${report.mode} mode`);
      document.moveDown();
      document.fillColor('#1c2321').fontSize(14).text(report.headline);
      if (report.narrative) {
        document.moveDown(0.3);
        document.fontSize(10).text(report.narrative);
      }

      for (const section of report.sections) {
        document.moveDown();
        document.fillColor('#0e473e').fontSize(12).text(section.heading);
        document.moveDown(0.25);
        document.fillColor('#1c2321').fontSize(10);
        if (!section.items.length) {
          document.text('No items need attention.');
          continue;
        }
        section.items.forEach(item => {
          document.font('Helvetica-Bold').text(item.title, { continued: Boolean(item.detail) });
          if (item.detail) document.font('Helvetica').text(` - ${item.detail}`);
          item.sources.forEach(source => document.fontSize(8).fillColor('#5f6d67').text(`Source: ${source.label}${source.url ? ` (${source.url})` : ''}`, { indent: 12 }));
          document.fillColor('#1c2321').fontSize(10);
        });
      }

      document.end();
    });
  }
}

module.exports = new ReportingService();
module.exports.REPORT_TYPES = REPORT_TYPES;
