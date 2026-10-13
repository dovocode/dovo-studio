import { mkdir, mkdtemp, writeFile, appendFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { defaultTaskHarness } from '@dovo/protocol'
import { expect, it } from 'vite-plus/test'
import { readClaudeThread } from './claude-thread'

it('reads a native conversation from a custom Claude configuration root without a model turn', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'dovo-native-claude-'))
  const root = join(cwd, 'config')
  const sessionId = randomUUID()
  const directory = join(
    root,
    'projects',
    cwd.replace(/[^a-zA-Z0-9]/g, '-'),
    sessionId,
    'subagents',
  )
  const input = randomUUID(),
    reply = randomUUID()
  try {
    await mkdir(directory, { recursive: true })
    const file = join(directory, 'agent-child.jsonl')
    await writeFile(
      file,
      [
        {
          type: 'user',
          uuid: input,
          parentUuid: null,
          message: { role: 'user', content: 'Native prompt' },
        },
        {
          type: 'assistant',
          uuid: reply,
          parentUuid: input,
          message: { role: 'assistant', content: [{ type: 'text', text: 'Native reply' }] },
        },
      ]
        .map((message) =>
          JSON.stringify({ ...message, sessionId, agentId: 'child', isSidechain: true }),
        )
        .join('\n'),
    )
    const agent = {
      ...defaultTaskHarness('claude'),
      id: 'fixture',
      name: 'Fixture',
      env: { CLAUDE_CONFIG_DIR: root },
    }
    expect(await readClaudeThread(agent, 'child', sessionId, cwd)).toEqual([
      { id: input, role: 'user', text: 'Native prompt' },
      { id: `${reply}:0`, role: 'assistant', text: 'Native reply' },
    ])
    await appendFile(file, '\n{"type":')
    expect(await readClaudeThread(agent, 'child', sessionId, cwd)).toHaveLength(2)
    expect(await readClaudeThread(agent, 'missing', sessionId, cwd)).toEqual([])
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})
