import { mkdir, mkdtemp, writeFile, appendFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultTaskHarness } from '@dovo/protocol'
import { expect, it } from 'vite-plus/test'
import { readClaudeThread } from './claude-thread'

it('reads workflow thinking, tools and answers from the configured home, including late complete lines', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'dovo-workflow-thread-'))
  const config = join(cwd, 'config'),
    directory = join(config, 'projects', 'project', 'workflow', 'run')
  const file = join(directory, 'agent-reader.jsonl')
  const agent = {
    ...defaultTaskHarness('claude'),
    id: 'claude',
    name: 'Claude',
    env: { CLAUDE_CONFIG_DIR: 'config' },
  }
  try {
    await mkdir(directory, { recursive: true })
    await writeFile(
      file,
      [
        {
          type: 'assistant',
          uuid: 'thinking',
          message: { content: [{ type: 'thinking', thinking: 'Inspecting API' }] },
        },
        {
          type: 'assistant',
          uuid: 'read',
          message: {
            content: [
              { type: 'tool_use', id: 'read', name: 'Read', input: { file_path: 'api.ts' } },
            ],
          },
        },
        {
          type: 'user',
          uuid: 'output',
          message: {
            content: [{ type: 'tool_result', tool_use_id: 'read', content: 'API source' }],
          },
        },
      ]
        .map((line) => JSON.stringify(line))
        .join('\n') + '\n{"type":"assistant",',
    )
    expect(await readClaudeThread(agent, file, 'session', cwd)).toMatchObject([
      { role: 'reasoning', text: 'Inspecting API' },
      { role: 'tool', label: 'Read' },
      { role: 'tool', text: 'API source' },
    ])
    await appendFile(
      file,
      '"uuid":"reply","message":{"content":[{"type":"text","text":"API reviewed"}]}}\n',
    )
    expect((await readClaudeThread(agent, file, 'session', cwd)).at(-1)).toMatchObject({
      role: 'assistant',
      text: 'API reviewed',
    })
    await writeFile(
      file,
      JSON.stringify({
        type: 'assistant',
        uuid: 'large',
        isMeta: true,
        message: { content: 'x'.repeat(2 * 1024 * 1024) },
      }) +
        '\n' +
        JSON.stringify({
          type: 'assistant',
          uuid: 'final',
          message: { content: [{ type: 'text', text: 'Final answer past the cap' }] },
        }) +
        '\n',
    )
    expect(await readClaudeThread(agent, file, 'session', cwd)).toMatchObject([
      { label: 'Earlier history omitted' },
      { role: 'assistant', text: 'Final answer past the cap' },
    ])
    const outside = join(cwd, 'agent-outside.jsonl')
    await writeFile(
      outside,
      '{"type":"assistant","uuid":"secret","message":{"content":"Outside data"}}\n',
    )
    await symlink(outside, join(directory, 'agent-link.jsonl'))
    await expect(readClaudeThread(agent, outside, 'session', cwd)).rejects.toThrow('outside')
    await expect(
      readClaudeThread(agent, join(directory, 'agent-link.jsonl'), 'session', cwd),
    ).rejects.toThrow('outside')
    expect(
      await readClaudeThread(agent, join(directory, 'agent-missing.jsonl'), 'session', cwd),
    ).toEqual([])
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})
