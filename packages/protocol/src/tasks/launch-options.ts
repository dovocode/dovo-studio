/** Environment values are configuration, not encrypted credentials. Split on the first equals. */
export function parseAgentEnvironment(text: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    const index = line.indexOf('=')
    const name = line.slice(0, index).trim()
    if (index < 1 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
      throw new Error('Environment variables must use NAME=value, one per line')
    if (name === 'DOVO_OWNER_TOKEN' || name === 'ELECTRON_RUN_AS_NODE')
      throw new Error(`${name} cannot be passed to an agent`)
    env[name] = line.slice(index + 1)
  }
  return env
}
export function formatAgentEnvironment(env: Readonly<Record<string, string>> = {}): string {
  return Object.entries(env)
    .map(([name, value]) => `${name}=${value}`)
    .join('\n')
}
