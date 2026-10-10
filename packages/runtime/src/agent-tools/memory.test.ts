import { afterEach, expect, it } from 'vite-plus/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import {
  decode,
  mutableArray,
  mutableStruct,
  memoryEntrySchema,
  type MemoryScope,
} from '@dovo/protocol'
import { Schema } from 'effect'
import { startRuntime } from '../index'
import { fixture } from '../testing/fixture'
import { taskToolsServer } from './config'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
function toolText(result: unknown) {
  return decode(
    mutableStruct({
      content: mutableArray(mutableStruct({ type: Schema.String, text: Schema.String })),
    }),
    result,
  ).content[0].text
}
async function connect(
  taskId: string,
  port: number,
  token: string,
  readOnly: boolean,
  scopes: MemoryScope[],
) {
  const config = taskToolsServer(
    taskId,
    port,
    token,
    '127.0.0.1',
    readOnly,
    false,
    undefined,
    false,
    false,
    scopes,
  )
  const client = new Client({ name: 'memory-test', version: '1' })
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    env: config.envValues,
    stderr: 'ignore',
  })
  await client.connect(transport)
  cleanups.push(() => client.close())
  return client
}

it.each([
  { readOnly: false, scopes: [] },
  { readOnly: false, scopes: ['system'] },
  { readOnly: true, scopes: ['system'] },
] satisfies Array<{ readOnly: boolean; scopes: MemoryScope[] }>)(
  'advertises memory only when opted in and hides writes for read-only agents: %j',
  async ({ readOnly, scopes }) => {
    const client = await connect('unused', 1, 'unused-token', readOnly, scopes)
    const names = (await client.listTools()).tools.map((tool) => tool.name)
    expect(names.includes('memory_read')).toBe(scopes.length > 0)
    expect(names.includes('memory_list')).toBe(scopes.length > 0)
    expect(names.includes('memory_write')).toBe(scopes.length > 0 && !readOnly)
    expect(names.includes('memory_delete')).toBe(scopes.length > 0 && !readOnly)
  },
)

it('binds memory calls to the task, exposes revisions, and stops access when the scope is disabled', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const token = 'memory-mcp-owner-token-at-least-32-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanups.push(() => runtime.close())
  const s = runtime.services
  s.store.update(() => f.workspace)
  const task = s.tasks.create({
    title: 'Memory',
    agentId: 'agent',
    repositoryId: 'repo',
    objective: 'Work',
  })
  s.memory.configure({ scope: 'project', repositoryId: 'repo', enabled: true })
  const client = await connect(task.id, runtime.port, token, false, ['project'])
  const created = await client.callTool({
    name: 'memory_write',
    arguments: { scope: 'project', key: 'testing', content: 'Use pnpm', taskId: 'forged-task' },
  })
  expect(created.isError).not.toBe(true)
  const first = decode(
    mutableStruct({ memory: memoryEntrySchema }),
    JSON.parse(toolText(created)),
  ).memory
  expect(first.repositoryId).toBe('repo')
  const listed = await client.callTool({
    name: 'memory_list',
    arguments: { scope: 'project', query: 'pnpm' },
  })
  expect(JSON.parse(toolText(listed))).toMatchObject({
    total: 1,
    entries: [{ key: 'testing', revision: first.revision }],
  })
  const read = await client.callTool({
    name: 'memory_read',
    arguments: { scope: 'project', key: 'testing' },
  })
  expect(JSON.parse(toolText(read))).toMatchObject({ memory: { content: 'Use pnpm' } })
  const stale = await client.callTool({
    name: 'memory_write',
    arguments: { scope: 'project', key: 'testing', content: 'Overwrite' },
  })
  expect(stale.isError).toBe(true)
  expect(toolText(stale)).toContain('A note with this key already exists')
  const updated = await client.callTool({
    name: 'memory_write',
    arguments: {
      scope: 'project',
      key: 'testing',
      content: 'Use pnpm test',
      expectedRevision: first.revision,
    },
  })
  expect(updated.isError).not.toBe(true)
  const current = decode(
    mutableStruct({ memory: memoryEntrySchema }),
    JSON.parse(toolText(updated)),
  ).memory
  s.memory.configure({ scope: 'project', repositoryId: 'repo', enabled: false })
  const blocked = await client.callTool({
    name: 'memory_read',
    arguments: { scope: 'project', key: 'testing' },
  })
  expect(blocked.isError).toBe(true)
  expect(toolText(blocked)).toContain('disabled or unavailable')
  s.memory.configure({ scope: 'project', repositoryId: 'repo', enabled: true })
  expect(
    (
      await client.callTool({
        name: 'memory_delete',
        arguments: { scope: 'project', key: 'testing', expectedRevision: current.revision },
      })
    ).isError,
  ).not.toBe(true)
  expect(s.memory.list({ scope: 'project', repositoryId: 'repo' }).total).toBe(0)
})
