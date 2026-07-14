const REDACTED = '[REDACTED]';
const OMITTED = '[OMITTED]';
const TRUNCATED = '[TRUNCATED]';
const MAX_DEPTH = 6;
const MAX_ARRAY_ITEMS = 50;
const MAX_STRING_LENGTH = 1200;

const SENSITIVE_FIELD = /(access[_-]?token|api[_-]?key|authorization|credential|cookie|password|private[_-]?key|secret|session|signing[_-]?key|token)/i;
const PRIVATE_CONTENT_FIELD = /^(body|content|data|description|messageBody|payload|raw|responseText|text)$/i;

const sanitizeText = (value, maximum = MAX_STRING_LENGTH) => {
  let text = String(value ?? '');
  text = text
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, `$1${REDACTED}`)
    .replace(/([?&](?:access[_-]?token|api[_-]?key|authorization|password|secret|token)=[^&\s]+)/gi, (match) => {
      const separator = match.indexOf('=');
      return `${match.slice(0, separator + 1)}${REDACTED}`;
    })
    .replace(/(authorization\s*[:=]\s*)([^\s,;]+)/gi, `$1${REDACTED}`);
  return text.length > maximum ? `${text.slice(0, maximum)} ${TRUNCATED}` : text;
};

const errorSummary = (value) => {
  const status = Number(value?.statusCode ?? value?.status);
  const code = value?.code ? sanitizeText(value.code, 120) : undefined;
  const stackLines = typeof value?.stack === 'string'
    ? value.stack.split('\n').slice(1).join('\n').trim()
    : '';

  return Object.fromEntries(Object.entries({
    name: typeof value?.name === 'string' ? sanitizeText(value.name, 120) : 'Error',
    code,
    status: Number.isInteger(status) ? status : undefined,
    stack: stackLines ? sanitizeText(stackLines, 4000) : undefined
  }).filter(([, item]) => item !== undefined));
};

const isErrorLike = (value) => value instanceof Error
  || (value && typeof value === 'object' && typeof value.name === 'string' && typeof value.message === 'string' && value.stack);

const sanitizeValue = (value, key = '', depth = 0) => {
  if (SENSITIVE_FIELD.test(key)) return REDACTED;
  if (PRIVATE_CONTENT_FIELD.test(key)) return OMITTED;
  if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return sanitizeText(value);
  if (isErrorLike(value)) return errorSummary(value);
  if (depth >= MAX_DEPTH) return '[DEPTH_LIMIT]';

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeValue(item, key, depth + 1));
  }

  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [
      childKey,
      sanitizeValue(childValue, childKey, depth + 1)
    ]));
  }

  return sanitizeText(value);
};

const sanitizeLogInfo = (info = {}) => sanitizeValue(info);

module.exports = {
  OMITTED,
  REDACTED,
  sanitizeLogInfo,
  sanitizeText
};
