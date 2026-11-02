import { diagnosticMessage } from '@dovo/protocol'
import type { AgentDiscovery, CommandSettings, CodexNetworkDiagnostic } from '@dovo/protocol'
import { stripVTControlCharacters } from 'node:util'
import { exec, processEnvironment } from '../../process.js'

/** Explicit diagnostics only: never invoked by model discovery or startup. */
export async function codexNetworkDiagnostics(
  settings: CommandSettings,
  agent?: AgentDiscovery,
  signal?: AbortSignal,
): Promise<CodexNetworkDiagnostic> {
  const started = Date.now()
  const env = processEnvironment(agent?.env)
  const secrets = Object.entries(env).flatMap(([name, value]) =>
    /token|secret|password|api[_-]?key|authorization/i.test(name) && value && value.length >= 4
      ? [value]
      : [],
  )
  const output = (value: string) =>
    diagnosticMessage(
      secrets.reduce(
        (text, secret) => text.replaceAll(secret, '[redacted]'),
        stripVTControlCharacters(value),
      ),
    )
  try {
    const result = await exec(agent?.endpoint || settings.codex, ['doctor', '--network-only'], {
      env,
      timeout: 30_000,
      maxBuffer: 128 * 1024,
      signal,
    })
    return {
      ok: true,
      durationMs: Date.now() - started,
      output: output(result.stdout + '\n' + result.stderr),
    }
  } catch (error) {
    if (signal?.aborted) throw signal.reason
    const streams =
      error && typeof error === 'object'
        ? [
            ...('stdout' in error && typeof error.stdout === 'string' ? [error.stdout] : []),
            ...('stderr' in error && typeof error.stderr === 'string' ? [error.stderr] : []),
          ].join('\n')
        : ''
    return { ok: false, durationMs: Date.now() - started, output: output(streams || String(error)) }
  }
}
