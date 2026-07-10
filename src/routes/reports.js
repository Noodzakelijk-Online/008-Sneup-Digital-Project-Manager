const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const reportingService = require('../services/reportingService');
const { getRequestWorkspaceObjectId } = require('../services/workspaceScopeService');
const { requirePermission } = require('../utils/requestSecurity');

router.get('/', requirePermission('api:read'), (req, res) => {
  res.json({ success: true, reports: reportingService.getTypes() });
});

router.get('/:reportType', requirePermission('api:read'), async (req, res) => {
  try {
    const format = req.query.format || 'markdown';
    if (!['markdown', 'pdf'].includes(format)) {
      return res.status(400).json({ success: false, error: 'format must be markdown or pdf' });
    }

    const report = await reportingService.generateReport(req.params.reportType, {
      workspaceId: getRequestWorkspaceObjectId(req)
    });

    if (format === 'pdf') {
      const pdf = await reportingService.renderPdf(report);
      res.type('application/pdf');
      res.attachment(`${report.filename}.pdf`);
      return res.send(pdf);
    }

    res.type('text/markdown; charset=utf-8');
    res.attachment(`${report.filename}.md`);
    return res.send(report.markdown);
  } catch (error) {
    logger.error('Failed to generate report:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      error: error.statusCode ? error.message : 'Failed to generate report'
    });
  }
});

module.exports = router;
