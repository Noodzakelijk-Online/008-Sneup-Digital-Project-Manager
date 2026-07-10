const EXECUTABLE_ACTION_TYPES = new Set([
  'comment',
  'follow_up',
  'performance_notification',
  'move_card',
  'reassign',
  'escalate',
  'add_label',
  'set_due_date',
  'add_checklist'
]);

const ACTION_FIELDS = Object.freeze({
  comment: { required: ['cardTrelloId', 'commentText'], editable: ['commentText'] },
  follow_up: { required: ['cardTrelloId', 'commentText'], editable: ['commentText'] },
  performance_notification: { required: ['cardTrelloId', 'commentText'], editable: ['commentText'] },
  move_card: { required: ['cardTrelloId', 'targetListId'], editable: ['targetListId'] },
  reassign: {
    required: ['cardTrelloId', 'fromMemberTrelloId', 'toMemberTrelloId'],
    editable: ['toMemberId', 'toMemberTrelloId', 'commentText']
  },
  escalate: { required: ['cardTrelloId', 'commentText'], editable: ['commentText'] },
  add_label: { required: ['cardTrelloId', 'labelName'], editable: ['labelName', 'labelColor'] },
  set_due_date: { required: ['cardTrelloId', 'due'], editable: ['due'] },
  add_checklist: { required: ['cardTrelloId', 'checklistName', 'checkItems'], editable: ['checklistName', 'checkItems'] }
});

const MAX_TEXT_LENGTH = 4000;
const MAX_SHORT_TEXT_LENGTH = 256;
const LABEL_COLORS = new Set(['yellow', 'purple', 'blue', 'red', 'green', 'orange', 'black', 'sky', 'pink', 'lime']);

const payloadError = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
};

const cleanText = (value, field, maximum = MAX_TEXT_LENGTH, { required = false } = {}) => {
  if (value === undefined || value === null) {
    if (required) throw payloadError(`${field} is required`);
    return undefined;
  }
  if (typeof value !== 'string') throw payloadError(`${field} must be text`);
  const text = value.trim();
  if (required && !text) throw payloadError(`${field} is required`);
  if (text.length > maximum) throw payloadError(`${field} must be ${maximum} characters or fewer`);
  return text;
};

const cleanChecklistItems = (value) => {
  if (!Array.isArray(value)) throw payloadError('checkItems must be an array of checklist item text');
  const items = value
    .map((item) => cleanText(item, 'checkItems item', MAX_SHORT_TEXT_LENGTH, { required: true }))
    .filter(Boolean);
  if (items.length === 0) throw payloadError('checkItems must include at least one item');
  if (items.length > 100) throw payloadError('checkItems must include 100 items or fewer');
  return items;
};

const cleanDueDate = (value) => {
  const due = cleanText(value, 'due', 128, { required: true });
  if (Number.isNaN(new Date(due).getTime())) throw payloadError('due must be a valid ISO date');
  return due;
};

const isExternalProviderWriteBlocked = (payload = {}) =>
  payload.externalProviderWriteBlocked === true || payload.source === 'work_graph';

const isReadyForExecution = (actionType, payload = {}) => {
  const definition = ACTION_FIELDS[actionType];
  if (!definition || isExternalProviderWriteBlocked(payload)) return false;
  return definition.required.every((field) => {
    const value = payload[field];
    return Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && value !== '';
  });
};

const normalizePatch = (actionType, patch, currentPayload = {}) => {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw payloadError('actionPayload object is required');
  }

  const definition = ACTION_FIELDS[actionType];
  if (!definition) throw payloadError(`Payload editing is not supported for ${actionType}`);
  if (isExternalProviderWriteBlocked(currentPayload)) {
    throw payloadError('Provider-specific payloads must remain draft-only until Sneup can prepare a safe action for that provider');
  }

  const unknownFields = Object.keys(patch).filter((field) => !definition.editable.includes(field));
  if (unknownFields.length > 0) {
    throw payloadError(`These action payload fields are protected: ${unknownFields.join(', ')}`);
  }

  const normalized = {};
  for (const field of definition.editable) {
    if (!Object.prototype.hasOwnProperty.call(patch, field)) continue;
    if (field === 'checkItems') normalized[field] = cleanChecklistItems(patch[field]);
    else if (field === 'due') normalized[field] = cleanDueDate(patch[field]);
    else if (field === 'labelColor') {
      const color = cleanText(patch[field], field, 32, { required: true }).toLowerCase();
      if (!LABEL_COLORS.has(color)) throw payloadError('labelColor must be a supported Trello label color');
      normalized[field] = color;
    } else if (field === 'toMemberId' || field === 'toMemberTrelloId' || field === 'targetListId') {
      normalized[field] = cleanText(patch[field], field, MAX_SHORT_TEXT_LENGTH, { required: true });
    } else if (field === 'labelName' || field === 'checklistName') {
      normalized[field] = cleanText(patch[field], field, MAX_SHORT_TEXT_LENGTH, { required: true });
    } else {
      normalized[field] = cleanText(patch[field], field, MAX_TEXT_LENGTH, { required: field !== 'commentText' || actionType !== 'reassign' });
    }
  }

  return normalized;
};

const applyPatch = (actionType, currentPayload, patch) => {
  const merged = { ...(currentPayload || {}), ...normalizePatch(actionType, patch, currentPayload) };
  const ready = isReadyForExecution(actionType, merged);
  return {
    ...merged,
    executable: ready,
    draftOnly: !ready
  };
};

module.exports = {
  ACTION_FIELDS,
  EXECUTABLE_ACTION_TYPES,
  applyPatch,
  isExternalProviderWriteBlocked,
  isReadyForExecution,
  normalizePatch
};
