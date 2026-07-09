const DEFAULT_MIN_INTERVAL_MS = 500;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_MS = 500;
const DEFAULT_RETRY_MAX_MS = 15000;
const DEFAULT_MAX_PROVIDER_STATES = 250;

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const clampInteger = (value, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
};

const providerEnvKey = (provider) => String(provider || 'unknown')
  .toUpperCase()
  .replace(/[^A-Z0-9]/g, '_');

class ProviderSyncPolicyService {
  constructor(options = {}) {
    this.nextAllowedAt = new Map();
    this.now = options.now || Date.now;
    this.sleep = options.sleep || delay;
  }

  reset() {
    this.nextAllowedAt.clear();
  }

  getPolicy(provider, overrides = {}) {
    const envKey = providerEnvKey(provider);
    return {
      minIntervalMs: clampInteger(
        overrides.minIntervalMs ?? process.env[`SNEUP_CONNECTOR_${envKey}_MIN_INTERVAL_MS`] ?? process.env.SNEUP_CONNECTOR_MIN_INTERVAL_MS,
        DEFAULT_MIN_INTERVAL_MS,
        0,
        60000
      ),
      maxRetries: clampInteger(
        overrides.maxRetries ?? process.env.SNEUP_CONNECTOR_SYNC_MAX_RETRIES,
        DEFAULT_MAX_RETRIES,
        0,
        6
      ),
      retryBaseMs: clampInteger(
        overrides.retryBaseMs ?? process.env.SNEUP_CONNECTOR_SYNC_RETRY_BASE_MS,
        DEFAULT_RETRY_BASE_MS,
        50,
        60000
      ),
      retryMaxMs: clampInteger(
        overrides.retryMaxMs ?? process.env.SNEUP_CONNECTOR_SYNC_RETRY_MAX_MS,
        DEFAULT_RETRY_MAX_MS,
        100,
        300000
      ),
      maxProviderStates: clampInteger(
        overrides.maxProviderStates ?? process.env.SNEUP_CONNECTOR_RATE_LIMIT_MAX_PROVIDERS,
        DEFAULT_MAX_PROVIDER_STATES,
        8,
        5000
      )
    };
  }

  async run(provider, callback, overrides = {}) {
    const policy = this.getPolicy(provider, overrides);
    let retryCount = 0;
    let rateLimitWaitMs = 0;

    while (true) {
      const waitedMs = await this.acquire(provider, policy);
      rateLimitWaitMs += waitedMs;

      try {
        const result = await callback({
          provider,
          attemptCount: retryCount + 1,
          retryCount,
          policy
        });
        return {
          result,
          retryCount,
          attemptCount: retryCount + 1,
          rateLimitWaitMs,
          policy
        };
      } catch (error) {
        if (!this.isRetryable(error) || retryCount >= policy.maxRetries) {
          this.attachFailureMetadata(error, {
            retryCount,
            attemptCount: retryCount + 1,
            rateLimitWaitMs,
            policy
          });
          throw error;
        }

        retryCount += 1;
        const retryDelayMs = this.retryDelayMs(error, retryCount, policy);
        await this.sleep(retryDelayMs);
      }
    }
  }

  async acquire(provider, policy) {
    const key = String(provider || 'unknown');
    const now = this.now();
    const nextAllowedAt = this.nextAllowedAt.get(key) || 0;
    const waitMs = Math.max(0, nextAllowedAt - now);
    if (waitMs > 0) {
      await this.sleep(waitMs);
    }

    this.nextAllowedAt.set(key, this.now() + policy.minIntervalMs);
    this.pruneProviderState(policy.maxProviderStates);
    return waitMs;
  }

  retryDelayMs(error, retryCount, policy) {
    const retryAfterMs = this.retryAfterMs(error);
    if (retryAfterMs !== null) {
      return Math.min(policy.retryMaxMs, Math.max(policy.retryBaseMs, retryAfterMs));
    }
    const exponential = policy.retryBaseMs * (2 ** Math.max(0, retryCount - 1));
    return Math.min(policy.retryMaxMs, exponential);
  }

  retryAfterMs(error) {
    if (Number.isFinite(error?.retryAfterMs)) return Math.max(0, Number(error.retryAfterMs));
    const raw = error?.response?.headers?.['retry-after'] || error?.response?.headers?.['Retry-After'];
    if (raw === undefined || raw === null || raw === '') return null;
    const seconds = Number(raw);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const parsedDate = Date.parse(raw);
    return Number.isFinite(parsedDate) ? Math.max(0, parsedDate - this.now()) : null;
  }

  isRetryable(error) {
    const status = Number(error?.statusCode || error?.response?.status || error?.status);
    if ([408, 425, 429].includes(status) || status >= 500) return true;
    return ['ECONNABORTED', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN'].includes(error?.code);
  }

  attachFailureMetadata(error, metadata) {
    if (!error || typeof error !== 'object') return;
    error.connectorSyncPolicy = metadata;
  }

  pruneProviderState(maxProviderStates) {
    if (this.nextAllowedAt.size <= maxProviderStates) return;
    const overflow = this.nextAllowedAt.size - maxProviderStates;
    [...this.nextAllowedAt.entries()]
      .sort((left, right) => left[1] - right[1])
      .slice(0, overflow)
      .forEach(([provider]) => this.nextAllowedAt.delete(provider));
  }
}

const providerSyncPolicyService = new ProviderSyncPolicyService();

module.exports = providerSyncPolicyService;
module.exports.ProviderSyncPolicyService = ProviderSyncPolicyService;
