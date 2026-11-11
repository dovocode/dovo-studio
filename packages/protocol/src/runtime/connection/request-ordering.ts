/** These POST endpoints read saved state and need only their own project/thread prerequisites.
 * Keep unknown endpoints behind the full write barrier until their contract is checked. */
const independentReads = new Set([
  '/api/scm/source/identity',
  '/api/scm/pulls/overview',
  '/api/scm/pulls/detail',
  '/api/scm/pulls/options/read',
  '/api/scm/work/options',
  '/api/scm/work/issues/list',
  '/api/scm/work/issues/detail',
  '/api/scm/work/pipelines/list',
  '/api/scm/work/pipelines/detail',
  '/api/scm/work/pipelines/definitions',
  '/api/scm/jira/projects/read',
  '/api/tasks/history',
  '/api/tasks/waiting',
  '/api/attachments/read',
])

export function requestNeedsWorkspaceSync(path: string, method = 'POST') {
  return (
    method !== 'GET' &&
    !(method === 'POST' && (path === '/api/tasks/cancel' || independentReads.has(path)))
  )
}

/** A pure read still depends on a project or thread this editor has just changed. */
export function requestReadWorkspaceDependency(path: string, input: unknown, method = 'POST') {
  if (method !== 'POST' || !independentReads.has(path) || !input || typeof input !== 'object')
    return undefined
  return {
    repositoryId:
      'repositoryId' in input && typeof input.repositoryId === 'string'
        ? input.repositoryId
        : undefined,
    taskId:
      path.startsWith('/api/tasks/') && 'id' in input && typeof input.id === 'string'
        ? input.id
        : 'taskId' in input && typeof input.taskId === 'string'
          ? input.taskId
          : undefined,
  }
}

const taskCommands = new Set([
  '/api/tasks/message',
  '/api/tasks/steer',
  '/api/tasks/queue',
  '/api/tasks/lifecycle',
  '/api/tasks/viewed',
  '/api/tasks/compact',
  '/api/tasks/new-session',
  '/api/tasks/continue-harness',
])
export function requestWorkspaceTask(path: string, input: unknown) {
  return taskCommands.has(path) &&
    input !== null &&
    typeof input === 'object' &&
    'id' in input &&
    typeof input.id === 'string'
    ? input.id
    : undefined
}
