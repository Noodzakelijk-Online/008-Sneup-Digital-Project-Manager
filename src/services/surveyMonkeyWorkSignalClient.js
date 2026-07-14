const axios = require('axios');
const accountConnectorService = require('./accountConnectorService');

const clamp = (value, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
};
const boundedText = (value, maximum = 160) => {
  const text = String(value || '')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]')
    .replace(/\bhttps?:\/\/\S+/gi, '[redacted url]')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.slice(0, maximum) : undefined;
};
const surveyId = value => /^[A-Za-z0-9_-]{1,128}$/.test(String(value || '')) ? String(value) : undefined;

const surveyRecord = item => {
  const id = surveyId(item?.id);
  const name = boundedText(item?.title);
  if (!id || !name) return null;
  return { id: `survey:${id}`, sourceType: 'survey', surveyId: id, name, status: 'open' };
};

class SurveyMonkeyWorkSignalClient {
  constructor(options = {}) {
    this.http = options.http || axios;
    this.accountConnectorService = options.accountConnectorService || accountConnectorService;
  }

  getConfig() {
    return {
      timeout: clamp(process.env.SNEUP_SURVEYMONKEY_TIMEOUT_MS, 15000, 1000, 60000),
      maxSurveys: clamp(process.env.SNEUP_SURVEYMONKEY_MAX_SURVEYS, 50, 1, 100),
      maxResponseBytes: clamp(process.env.SNEUP_SURVEYMONKEY_MAX_RESPONSE_BYTES, 2000000, 1024, 10000000)
    };
  }

  getAccessToken(account) {
    const credentials = this.accountConnectorService.getAccountCredentials(account);
    const token = credentials.accessToken || credentials.token || credentials.apiKey;
    if (!token) {
      const error = new Error('SurveyMonkey access token is missing. Reconnect this account to continue syncing.');
      error.statusCode = 503;
      throw error;
    }
    return token;
  }

  boundedSurveys(payload, maximum) {
    const surveys = Array.isArray(payload?.data) ? payload.data : [];
    if (surveys.length >= maximum && (payload?.links?.next || Number(payload?.total) > surveys.length)) {
      const error = new Error('SurveyMonkey sync reached its configured survey limit. Increase SNEUP_SURVEYMONKEY_MAX_SURVEYS before continuing.');
      error.statusCode = 413;
      throw error;
    }
    return surveys;
  }

  async fetchDelta(account, cursor) {
    const config = this.getConfig();
    const token = this.getAccessToken(account);
    const response = await this.http.get('https://api.surveymonkey.com/v3/surveys', {
      params: { page: 1, per_page: config.maxSurveys },
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      timeout: config.timeout,
      maxContentLength: config.maxResponseBytes,
      maxBodyLength: config.maxResponseBytes,
      maxRedirects: 0,
      proxy: false
    });
    const records = this.boundedSurveys(response.data, config.maxSurveys).map(surveyRecord).filter(Boolean);
    return {
      records,
      nextCursor: cursor || null,
      hasMore: false,
      metadata: {
        source: 'surveymonkey_api',
        surveys: records.length,
        contentPolicy: 'bounded_survey_metadata_only_no_questions_responses_collectors_contacts_links_or_provider_writes'
      }
    };
  }
}

const surveyMonkeyWorkSignalClient = new SurveyMonkeyWorkSignalClient();
module.exports = surveyMonkeyWorkSignalClient;
module.exports.SurveyMonkeyWorkSignalClient = SurveyMonkeyWorkSignalClient;
