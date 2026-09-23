import { chmodSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Deliberately exclude shell hooks, NODE_OPTIONS and unrelated application secrets.
export const runtimeEnvironmentKeys = [
  'DOVO_OWNER_TOKEN',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_ORG_ID',
  'OPENAI_PROJECT_ID',
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'GH_ENTERPRISE_TOKEN',
  'GITHUB_ENTERPRISE_TOKEN',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'AWS_PROFILE',
  'AWS_REGION',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'ANTHROPIC_VERTEX_PROJECT_ID',
  'CLOUD_ML_REGION',
] as const
const allowed = new Set<string>(runtimeEnvironmentKeys)
export function readRuntimeEnvironment(path: string): Record<string, string> {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (cause) {
    if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return {}
    throw cause
  }
  const value: unknown = JSON.parse(raw)
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Runtime environment must be a JSON object')
  const result: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (!allowed.has(key) || typeof entry !== 'string' || entry.includes('\0'))
      throw new Error(`Unsupported runtime environment setting: ${key}`)
    result[key] = entry
  }
  chmodSync(path, 0o600)
  return result
}
export function persistRuntimeEnvironment(directory: string, environment: NodeJS.ProcessEnv) {
  const path = join(directory, 'runtime-environment.json')
  const values = readRuntimeEnvironment(path)
  for (const key of runtimeEnvironmentKeys) {
    const value = environment[key]
    if (value !== undefined) values[key] = value
  }
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, JSON.stringify(values), { mode: 0o600 })
  chmodSync(temporary, 0o600)
  renameSync(temporary, path)
  return path
}
