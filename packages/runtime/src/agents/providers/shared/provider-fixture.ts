import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultTaskHarness } from '@dovo/protocol'
import type { Agent } from '@dovo/protocol'
import type { AgentRun } from '../../execution/types.js'
export async function providerFixture(provider: Agent['provider'], code: string) {
  const cwd = await mkdtemp(join(tmpdir(), `dovo-${provider}-test-`))
  const script = join(cwd, 'host.cjs'),
    record = join(cwd, 'wire.json')
  await writeFile(record, '[]')
  await writeFile(script, code)
  const output: string[] = [],
    sessions: string[] = [],
    events: Array<{ name: string; value: unknown }> = []
  const run: AgentRun = {
    agent: {
      ...defaultTaskHarness(provider),
      id: 'a',
      name: 'Test',
      permission: 'ask',
      endpoint: process.execPath,
      args: [script],
      env: { TEST_RECORD: record },
    },
    cwd,
    prompt: 'hello',
    signal: new AbortController().signal,
    onText: (text) => output.push(text),
    onSession: (id) => sessions.push(id),
    onActivity: () => {},
    onEvent: (name, value) => events.push({ name, value }),
    approve: async () => true,
    ask: async () => ({ answer: ['yes'] }),
  }
  const messages = async (): Promise<
    Array<{
      method: string
      id?: string
      params?: Record<string, unknown>
      result?: Record<string, unknown>
    }>
  > => JSON.parse(await readFile(record, 'utf8'))
  return { cwd, script, record, output, sessions, events, run, messages }
}
