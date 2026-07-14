const DEFAULT_MAX_SAMPLES = 60;

const VIEW_ROUTES = Object.freeze({
  overview: new Set([
    '/api/autopilot/mission-control',
    '/api/autopilot/operations-brief',
    '/api/jobs'
  ]),
  approvals: new Set([
    '/api/decision-queue',
    '/api/recommendations',
    '/api/trello-actions',
    '/api/audit',
    '/api/follow-ups/due',
    '/api/team/accountability',
    '/api/outcomes',
    '/api/findings',
    '/api/findings/board-health',
    '/api/trello-actions/reconciliation/health',
    '/api/notifications/policies',
    '/api/notifications/deliveries'
  ]),
  connectors: new Set(['/api/connectors']),
  enhancements: new Set(['/api/enhancements', '/api/enhancements/evaluations/recommendations']),
  signals: new Set(['/api/work-signals', '/api/work-signals/contracts', '/api/work-signals/graph', '/api/work-signals/graph/decisions']),
  forecasts: new Set(['/api/forecasts']),
  reports: new Set(['/api/reports']),
  workspaces: new Set(['/api/workspaces/current', '/api/workspaces', '/api/policy-rules', '/api/policy-rules/history'])
});

const clampInteger = (value, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
};

const percentile = (values, percentileValue) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * percentileValue) - 1))];
};

class ResponseTimingService {
  constructor(options = {}) {
    this.now = options.now || (() => Number(process.hrtime.bigint()) / 1e6);
    this.maxSamples = options.maxSamples || clampInteger(process.env.SNEUP_RESPONSE_TIMING_MAX_SAMPLES, DEFAULT_MAX_SAMPLES, 10, 250);
    this.views = new Map(Object.keys(VIEW_ROUTES).map(view => [view, { samples: [], lastSampleAt: null }]));
  }

  getView(req) {
    if (req.method !== 'GET') return null;
    return Object.entries(VIEW_ROUTES).find(([, paths]) => paths.has(req.path))?.[0] || null;
  }

  record(view, durationMs, statusCode, sampledAt = new Date()) {
    const metric = this.views.get(view);
    if (!metric || !Number.isFinite(durationMs) || durationMs < 0) return;
    metric.samples.push({ durationMs: Math.round(durationMs), failed: statusCode >= 400 });
    if (metric.samples.length > this.maxSamples) metric.samples.shift();
    metric.lastSampleAt = sampledAt.toISOString();
  }

  middleware() {
    return (req, res, next) => {
      const view = this.getView(req);
      if (!view) return next();
      const startedAt = this.now();
      res.once('finish', () => {
        this.record(view, this.now() - startedAt, res.statusCode);
      });
      return next();
    };
  }

  getSummary() {
    const views = [...this.views.entries()].map(([view, metric]) => {
      const samples = metric.samples.map(sample => sample.durationMs);
      const totalMs = samples.reduce((total, value) => total + value, 0);
      return {
        view,
        samples: samples.length,
        averageMs: samples.length ? Math.round(totalMs / samples.length) : 0,
        p50Ms: percentile(samples, 0.5),
        p95Ms: percentile(samples, 0.95),
        maxMs: samples.length ? Math.max(...samples) : 0,
        failures: metric.samples.filter(sample => sample.failed).length,
        lastSampleAt: metric.lastSampleAt
      };
    });
    const sampledViews = views.filter(view => view.samples > 0);
    return {
      retention: 'in_memory_bounded_recent_samples',
      maxSamplesPerView: this.maxSamples,
      sampledViews: sampledViews.length,
      views
    };
  }
}

const responseTimingService = new ResponseTimingService();

module.exports = responseTimingService;
module.exports.ResponseTimingService = ResponseTimingService;
module.exports.VIEW_ROUTES = VIEW_ROUTES;
