export const REPOSITORY_CLONE_TIMEOUT_MS = 300_000

export function runtimeRequestTimeout(path: string, input?: unknown) {
  if (path === '/api/remote-desktop') return 45000
  if (path === '/api/studio/session') return 30000
  if (path === '/api/studio/tools') {
    if (input && typeof input === 'object' && 'part' in input) {
      if (input.part === 'threads') return 900000
      if (input.part === 'browsers' || input.part === 'discover') return 120000
    }
    return 30000
  }
  // Restoring a task checkout can run five-minute setup before pushing.
  if (path === '/api/scm/push')
    return input && typeof input === 'object' && 'taskId' in input && input.taskId ? 900000 : 300000
  if (path === '/api/tasks/handoff') return 900000
  if (path === '/api/mcp-apps/rpc') {
    if (input && typeof input === 'object' && 'method' in input) {
      // Approval can wait ten minutes before the upstream tool's sixty-second deadline.
      if (input.method === 'tools/call') return 750000
      if (input.method === 'ui/cancel') return 30000
    }
    // Session connection, refreshed tools and resource reads are sequential.
    return 150000
  }
  // Rendering may wait for the shared artifact queue and a cold Chromium launch.
  if (path === '/api/artifacts/pdf') return 120000
  if (path === '/api/tasks/commit-message') return 120000
  if (path === '/api/tasks/commit') return 180000
  // Authentication, optional Git initialization, creation and final inspection are sequential.
  if (path === '/api/scm/repositories/github/create') return 300000
  if (
    path === '/api/scm/repositories/forge/read' ||
    path === '/api/scm/repositories/forge/inspect' ||
    path === '/api/scm/repositories/forge/bind'
  )
    // Credential lookup and repository pagination can require several upstream requests.
    return 180000
  // Discovery includes local tools and SSH host setup/discovery.
  if (path === '/api/previews/devices') return 300000
  // Remote opening includes discovery (120s), SSH setup (10s) and driver opening (300s).
  if (path === '/api/previews/simulator/open') return 450000
  if (
    (path === '/api/pull-request-watch' || path === '/api/pipeline-watch') &&
    input !== null &&
    typeof input === 'object' &&
    'action' in input &&
    input.action === 'watch'
  ) {
    // Pipeline registration awaits one fresh detail per unique run, in sequence.
    const runs =
      path === '/api/pipeline-watch' && 'runIds' in input && Array.isArray(input.runIds)
        ? new Set(input.runIds).size
        : 1
    return 180000 * Math.max(1, runs)
  }
  if (path === '/api/device-hosts/install') return 600000
  if (path === '/api/device-hosts/test') return 150000
  if (path === '/api/device-hosts/forward') return 90000
  if (path === '/api/tasks/side-chat/ask' || path === '/api/tasks/aside') return 120000
  if (path === '/api/commands/cua/action') return 90000
  if (path === '/api/agents/availability') return 90000
  if (path === '/api/agents/models') {
    if (
      input &&
      typeof input === 'object' &&
      'provider' in input &&
      (input.provider === 'acp' || input.provider === 'grok')
    ) {
      // Initialize, create and close a session, then each selected setting; Grok authenticates too.
      const config =
        input.provider === 'acp' &&
        'acpConfig' in input &&
        input.acpConfig &&
        typeof input.acpConfig === 'object' &&
        !Array.isArray(input.acpConfig)
          ? Object.keys(input.acpConfig).length
          : 0
      const mode = input.provider === 'acp' && 'acpMode' in input && input.acpMode ? 1 : 0
      const model = 'model' in input && input.model ? 1 : 0
      return 30000 * (3 + config + mode + model + (input.provider === 'grok' ? 1 : 0)) + 15000
    }
    return 65000
  }
  if (path === '/api/agents/acp/install') return 630000
  if (path === '/api/agents/acp/authenticate' || path === '/api/agents/acp/logout') return 330000
  if (path === '/api/agents/acp/inspect' || path.startsWith('/api/agents/acp/sessions'))
    return 65000
  return path.startsWith('/api/previews/')
    ? 120000
    : path === '/api/tasks/title'
      ? 120000
      : path === '/api/tasks/dictation/cleanup'
        ? 40000
        : path === '/api/scm/repositories/add'
          ? REPOSITORY_CLONE_TIMEOUT_MS + 30000
          : path.startsWith('/api/scm/pulls/') ||
              path.startsWith('/api/scm/work/') ||
              path === '/api/scm/jira/bind'
            ? 180000
            : 30000
}
