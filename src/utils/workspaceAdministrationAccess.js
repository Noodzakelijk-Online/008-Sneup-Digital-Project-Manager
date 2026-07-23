const workspaceIdOf = (workspace) => {
  if (!workspace) return '';
  return String(workspace._id || workspace.id || workspace);
};

const canManageAcrossWorkspaces = (auth = {}) => Boolean(
  auth.localRequest || auth.workspaceOverrideAllowed
);

const assertWorkspaceAdministrationAccess = (req, workspace) => {
  const targetWorkspaceId = workspaceIdOf(workspace);
  const authenticatedWorkspaceId = workspaceIdOf(req?.auth?.workspaceId);
  if (canManageAcrossWorkspaces(req?.auth) || (targetWorkspaceId && targetWorkspaceId === authenticatedWorkspaceId)) {
    return workspace;
  }

  const error = new Error('Workspace administration is limited to the authenticated workspace');
  error.statusCode = 403;
  throw error;
};

module.exports = {
  assertWorkspaceAdministrationAccess,
  canManageAcrossWorkspaces,
  workspaceIdOf
};
