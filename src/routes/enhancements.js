const express = require('express');
const router = express.Router();
const enhancementBacklog = require('../services/enhancementBacklog');

router.get('/', (req, res) => {
  const filters = {
    priority: req.query.priority,
    area: req.query.area,
    status: req.query.status
  };
  const enhancements = enhancementBacklog.listEnhancements(filters);

  res.json({
    success: true,
    count: enhancements.length,
    summary: enhancementBacklog.getSummary(enhancements),
    enhancements
  });
});

router.get('/:enhancementId', (req, res) => {
  const enhancement = enhancementBacklog.getEnhancement(req.params.enhancementId);

  if (!enhancement) {
    return res.status(404).json({
      success: false,
      error: 'Enhancement not found'
    });
  }

  return res.json({
    success: true,
    enhancement
  });
});

module.exports = router;
