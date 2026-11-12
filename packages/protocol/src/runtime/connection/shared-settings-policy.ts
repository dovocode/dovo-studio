import type { ScopedSettingsValue, TaskHarness } from '../../workspace.js'

/** Shared defaults are portable choices. Credentials and local installations keep their owner. */
export function sharedHarnessIssue(harness: TaskHarness): string | undefined {
  if (
    Object.keys(harness.env ?? {}).length ||
    Object.values(harness.envSecrets ?? {}).some(
      (reference) => reference.provider !== 'environment',
    )
  )
    return 'Agent environment values and secret references belong to one computer. Use a computer-specific setting.'
  if (harness.acpInstallationId || harness.executablePath || harness.configDirectory)
    return 'Agent installations and local paths belong to one computer. Use a computer-specific setting.'
  const endpoint = harness.endpoint.trim()
  if (/^https?:\/\//i.test(endpoint)) {
    let url: URL
    try {
      url = new URL(endpoint)
    } catch {
      return 'Enter a valid HTTP(S) agent connection URL.'
    }
    if (url.username || url.password)
      return 'Agent connection credentials belong to one computer. Use a computer-specific setting.'
  } else if (/[/\\]|^~|^[A-Za-z]:/.test(endpoint))
    return 'Agent executable paths belong to one computer. Use a computer-specific setting.'
}

export function sharedSettingsIssue(value: ScopedSettingsValue): string | undefined {
  const harnesses = [
    ...(value.agents ?? []),
    ...(value.taskDefaults?.harness ? [value.taskDefaults.harness] : []),
  ]
  for (const harness of harnesses) {
    const issue = sharedHarnessIssue(harness)
    if (issue) return issue
  }
  const resources = [value.resources, ...(value.agents ?? []).map((agent) => agent.resources)]
  for (const resource of resources) {
    if (
      resource?.mcpServers.some(
        (server) =>
          Object.keys(server.envValues ?? {}).length ||
          Object.keys(server.headerValues ?? {}).length,
      )
    )
      return 'Shared MCP settings must reference environment variables. Keep literal credentials in computer-specific settings.'
    if (resource?.skills.some((skill) => skill.sourcePath))
      return 'Local skill files belong to one computer. Use a computer-specific setting.'
  }
}
