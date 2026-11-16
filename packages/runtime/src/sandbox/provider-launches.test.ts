/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vite-plus/test'
import { harnessProfiles } from './harnesses.js'

const agents = fileURLToPath(new URL('../agents/', import.meta.url))
/** Process starts that never run a harness turn or its tools, so they stay on the host. A new
 * entry needs a reason; any other spawn in these folders must use the sandbox launcher. */
const hostOnly: Record<string, string> = {
  'providers/codex/session-activity.ts':
    'Checks with lsof whether a host terminal owns a session file.',
  'providers/pi/pi-version.ts': 'Checks the host Pi version; skipped for sandboxed runs.',
  'providers/muse/muse.ts': 'Only `muse --version` runs on the host; turns use sandboxLaunch.',
  'providers/cursor/cursor.ts':
    'The Cursor SDK worker is Dovo code on the host; sandboxed Cursor runs are refused.',
  'execution/agent-hooks.ts':
    'Lifecycle hooks of host threads. Sandboxed threads run their hooks through spawnHarness.',
  'execution/stop-owned-child.ts': 'Windows taskkill for an owned process tree.',
  'execution/process-memory.ts': 'Reads process memory for automatic memory protection.',
  'execution/diagnostics.ts': 'Reports host harness versions in diagnostics.',
  'execution/codex-network-diagnostics.ts': 'Runs the host Codex network diagnostics.',
}
const processStart = /(?<![\w.])(?:spawn|execFile|fork|exec|execEffect)\(/
/** SDKs that start the CLI themselves receive a `sandboxLaunch` command line instead. */
const sdkStart = /(?<![\w.])spawnMspConnection\(|RuntimeConnection\.forStdio\(/

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(join(directory, entry.name))
      : entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')
        ? [join(directory, entry.name)]
        : [],
  )
}

describe('provider launches', () => {
  it('start every harness process through the sandbox launcher', () => {
    const direct = files(join(agents, 'providers'))
      .concat(files(join(agents, 'execution')))
      .filter((file) => !file.endsWith('shared/provider-fixture.ts'))
      .filter((file) => {
        const source = readFileSync(file, 'utf8')
        const lines = source.split('\n').filter((line) => !line.trim().startsWith('//'))
        return (
          lines.some((line) => processStart.test(line)) ||
          (lines.some((line) => sdkStart.test(line)) && !source.includes('sandboxLaunch('))
        )
      })
      .map((file) => relative(agents, file))
    expect(direct.filter((file) => !hostOnly[file])).toEqual([])
    // Keep the exception list honest: remove entries whose file no longer starts a process.
    expect(Object.keys(hostOnly).filter((file) => !direct.includes(file))).toEqual([])
  })

  it('cover every provider with a sandbox profile', () => {
    for (const provider of [
      'codex',
      'claude',
      'opencode',
      'pi',
      'copilot',
      'vibe',
      'hermes',
      'grok',
      'muse',
      'cursor',
      'acp',
    ] as const)
      expect(harnessProfiles[provider]).toBeDefined()
    expect(harnessProfiles.cursor.unsupported).toMatch(/host/)
  })
})
