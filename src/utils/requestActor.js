const IDENTITY_FIELDS = [
  'actor',
  'actorId',
  'decidedBy',
  'updatedBy',
  'resolvedBy',
  'snoozedBy',
  'delegatedBy',
  'reconciledBy',
  'evaluatedBy'
];

const getAuthenticatedActor = (req, fallback = 'api') => req.auth?.actorId || fallback;

const bodyWithAuthenticatedActor = (req, actorField, fallback) => {
  const body = req.body && typeof req.body === 'object' ? { ...req.body } : {};
  IDENTITY_FIELDS.forEach(field => delete body[field]);

  return {
    ...body,
    [actorField]: getAuthenticatedActor(req, fallback)
  };
};

module.exports = {
  getAuthenticatedActor,
  bodyWithAuthenticatedActor
};
