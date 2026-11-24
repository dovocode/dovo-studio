import sharp from 'sharp'
import { writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { readFile, symlink } from 'node:fs/promises'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { CallToolResultSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { PermissionPolicy } from '@dovo/protocol'
import { fixture } from '../testing/fixture.js'
import { runtimeIntegration } from '../testing/integration.js'
import { startRuntime } from '../index.js'
import { taskToolsServer } from './config.js'

vi.setConfig(runtimeIntegration)
const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
async function setup(
  permissions: PermissionPolicy = { provider: 'claude', permission: 'full-access' },
  sandbox?: 'workspace-write',
) {
  const f = await fixture()
  cleanups.push(f.cleanup)
  f.workspace.agents[0] = { ...f.workspace.agents[0], ...permissions }
  const runtime = await startRuntime({
    databasePath: ':memory:',
    port: 0,
    ownerToken: 'code-mode-owner-token-at-least-32-characters',
  })
  cleanups.push(() => runtime.close())
  const s = runtime.services
  s.store.update(() => f.workspace)
  const task = s.tasks.create({
    title: 'Code mode',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: '',
  })
  const runId = 'code-run'
  s.store.updateTask(task.id, (task) => ({ ...task, status: 'running', activeRunId: runId }))
  const controller = new AbortController()
  const issue = () => {
    const token = s.runCredentials.issue(
      {
        taskId: task.id,
        runId,
        permissions,
        readOnly: permissions.permission === 'read-only',
        sandboxMode: sandbox,
        artifacts: false,
        pipelineWatching: false,
        pullRequestWatching: false,
        deviceHub: false,
        memoryScopes: [],
      },
      controller.signal,
    )
    s.runCredentials.codeDirectories(token, { cwd: f.directory, linked: [], mcp: [] })
    return token
  }
  const token = issue()
  const credentialFile = s.runCredentials.file(token)
  const config = taskToolsServer(
    task.id,
    runtime.port,
    '',
    '127.0.0.1',
    permissions.permission === 'read-only',
    false,
    runId,
    false,
    false,
    [],
    false,
    sandbox,
    credentialFile,
  )
  const client = new Client({ name: 'code-mode-test', version: '1' })
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      '--conditions=development',
      '--import',
      createRequire(import.meta.url).resolve('tsx'),
      fileURLToPath(new URL('./server.ts', import.meta.url)),
    ],
    env: config.envValues,
    stderr: 'pipe',
  })
  // Source entry verifies this change without relying on a previous build.
  await client.connect(transport)
  cleanups.push(async () => {
    await client.close()
    await transport.close()
  })
  const code = async (code: string) =>
    CallToolResultSchema.parse(
      await client.callTool({ name: 'code', arguments: { code } }, undefined, { timeout: 20000 }),
    )
  const command = async (command: unknown, signal?: AbortSignal) => {
    const response = await fetch(`http://127.0.0.1:${runtime.port}/api/agent/code-tools`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: task.id, parentRunId: runId, command }),
      signal,
    })
    return { status: response.status, value: await response.json() }
  }
  return { f, s, runtime, task, token, controller, client, code, command, issue, credentialFile }
}
function execution(result: CallToolResult): { result: unknown; output: unknown[]; calls: number } {
  expect(result.isError).not.toBe(true)
  const text = result.content[0]
  if (text?.type !== 'text') throw new Error('Missing code output')
  return JSON.parse(text.text)
}

it('composes real Studio tools and contained file tools over stdio', async () => {
  const { code, f, s, task } = await setup()
  const result = execution(
    await code(`
const catalog=await tools.search({source:'harness',query:'file'});
const before=await tools.harness.read_file({path:'hello.txt'});
await tools.harness.write_file({path:'hello.txt',expectedContents:before.contents,contents:'changed\\n'});
await tools.harness.write_file({path:'new.txt',expectedContents:null,contents:'new file'});
await tools.dovo.todos({action:'set',items:[{id:'verify',text:'Check code',status:'completed'}]});
const [files,search]=await Promise.all([tools.harness.list_files({}),tools.harness.search({query:'changed'})]);
return {names:catalog.tools.map(tool=>tool.name),contents:(await tools.harness.read_file({path:'hello.txt'})).contents,files,search};`),
  )
  expect(result.result).toMatchObject({
    names: expect.arrayContaining(['read_file', 'write_file', 'list_files']),
    contents: 'changed\n',
  })
  expect(await readFile(join(f.directory, 'new.txt'), 'utf8')).toBe('new file')
  expect(s.store.task(task.id).nativeTodos).toMatchObject([{ id: 'verify', status: 'completed' }])
})

it('discovers and composes the default read, edit and bash tools', async () => {
  const { code, f, s, task } = await setup()
  const result = execution(
    await code(`
const {tools: catalog} = await tools.search({source:'harness'});
const before = await tools.read({path:'hello.txt'});
const edit = await tools.edit({path:'hello.txt', oldText:'original', newText:'updated'});
const [matches, files] = await Promise.all([tools.grep({query:'updated'}), tools.ls({})]);
const shell = data(await tools.bash({command:'node --version', waitMs:5000}));
return {names:catalog.map(tool=>tool.name), before, edit, matches, files, shell};
`),
  )
  expect(result.result).toMatchObject({
    names: expect.arrayContaining(['read', 'edit', 'bash', 'grep', 'ls']),
    before: { contents: 'original\n' },
    edit: { path: 'hello.txt' },
    matches: {
      matches: expect.arrayContaining([expect.objectContaining({ path: 'hello.txt', line: 1 })]),
    },
    files: { entries: expect.arrayContaining([expect.objectContaining({ path: 'hello.txt' })]) },
    shell: { running: false, exitCode: 0, outputTail: expect.stringMatching(/v\d+\./) },
  })
  expect(await readFile(join(f.directory, 'hello.txt'), 'utf8')).toBe('updated\n')
  expect(s.terminals.list().filter((terminal) => terminal.taskId === task.id)).toHaveLength(1)
})

it('rejects absent, ambiguous and concurrent exact-text edits without losing unrelated content', async () => {
  const { code, f } = await setup()
  const file = join(f.directory, 'hello.txt')
  await writeFile(file, 'original\nbanana\n')
  for (const oldText of ['missing', 'ana']) {
    const result = await code(
      `await tools.edit({path:'hello.txt', oldText:${JSON.stringify(oldText)}, newText:'other'})`,
    )
    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({ text: expect.stringMatching(/exactly once/) })
  }
  expect(await readFile(file, 'utf8')).toBe('original\nbanana\n')
  const result = execution(
    await code(`
  const edits = await Promise.allSettled(
    ['first', 'second'].map(newText => tools.edit({path:'hello.txt', oldText:'original', newText}))
  );
  return edits.map(edit => edit.status).sort();
  `),
  )
  expect(result.result).toEqual(['fulfilled', 'rejected'])
  expect(await readFile(file, 'utf8')).toMatch(/^(first|second)\nbanana\n$/)
})

it('returns already printed results with the error when a later step fails', async () => {
  const { code, s, task } = await setup()
  const result = await code(`
    const terminal = data(await tools.harness.terminal_run({command:'node --version', check:true}));
    print({terminalId:terminal.id});
    throw new Error('later step failed');
  `)
  const [terminal] = s.terminals.list().filter((terminal) => terminal.taskId === task.id)
  expect(s.terminals.list()).toHaveLength(1)
  expect(result.isError).toBe(true)
  expect(result.content[0]).toMatchObject({ text: expect.stringContaining('later step failed') })
  const partial = result.content[1]
  expect(partial?.type === 'text' && JSON.parse(partial.text)).toEqual({
    calls: 1,
    callOutcomes: { completed: [1], unconfirmed: [] },
    output: [[{ terminalId: terminal?.id }]],
  })

  const large = await code(`print('x'.repeat(70000)); throw new Error('large output failure');`)
  expect(large.isError).toBe(true)
  expect(large.content[0]).toMatchObject({ text: expect.stringContaining('large output failure') })
  const retained = large.content[1]
  if (retained?.type !== 'text') throw new Error('Missing printed output reference')
  const reference = JSON.parse(retained.text)
  expect(reference).toMatchObject({ toolCompleted: false, retained: true })
  const page = execution(
    await code(
      `return await tools.harness.read_tool_result({resultId:${JSON.stringify(reference.resultId)}})`,
    ),
  )
  expect(page.result).toMatchObject({ text: expect.stringContaining('x'.repeat(100)) })
})

it('rejects stale writes, escaping paths, external symlinks and newly linked scopes', async () => {
  const { code, f } = await setup()
  for (const source of [
    `await tools.harness.write_file({path:'hello.txt',expectedContents:'stale',contents:'bad'})`,
    `await tools.harness.write_file({path:'hello.txt',expectedContents:null,contents:'bad'})`,
    `await tools.harness.read_file({path:'../outside'})`,
    `await tools.harness.read_file({path:'.git/config'})`,
    `await tools.harness.read_file({path:'hello.txt',checkoutId:'new-link'})`,
  ])
    expect((await code(source)).isError).toBe(true)
  const outside = await fixture()
  cleanups.push(outside.cleanup)
  await symlink(outside.directory, join(f.directory, 'outside'), 'junction')
  expect((await code(`await tools.harness.read_file({path:'outside/hello.txt'})`)).isError).toBe(
    true,
  )
  expect(
    (
      await code(
        `await tools.harness.write_file({path:'outside/hello.txt',expectedContents:'original\\n',contents:'bad'})`,
      )
    ).isError,
  ).toBe(true)
  expect(await readFile(join(f.directory, 'hello.txt'), 'utf8')).toBe('original\n')
  expect(await readFile(join(outside.directory, 'hello.txt'), 'utf8')).toBe('original\n')
})

it('keeps read-only and sandbox restrictions inside code and validates nested tool arguments', async () => {
  const { code } = await setup({ provider: 'codex', permission: 'read-only' })
  const result = execution(
    await code(`return (await tools.search({source:'harness'})).tools.map(tool=>tool.name)`),
  )
  expect(result.result).toContain('read_file')
  expect(result.result).toEqual(expect.arrayContaining(['read', 'grep', 'ls']))
  expect(result.result).not.toContain('write_file')
  expect(result.result).not.toContain('edit')
  expect(result.result).not.toContain('bash')
  expect(result.result).not.toContain('terminal_run')
  for (const source of [
    `await tools.harness.write_file({path:'hello.txt',expectedContents:'original\\n',contents:'bad'})`,
    `await tools.edit({path:'hello.txt',oldText:'original',newText:'bad'})`,
    `await tools.bash({command:'echo bad'})`,
    `await tools.harness.terminal_run({command:'echo bad'})`,
    `await tools.dovo.code({code:'return 1'})`,
    `await tools.dovo.studio_threads({action:'list'})`,
    `await tools.dovo.todos({action:'unknown'})`,
  ])
    expect((await code(source)).isError).toBe(true)
})

it('requests approval for edits and rechecks live access before a delayed operation', async () => {
  const { code, s, f } = await setup({ provider: 'claude', permission: 'ask' })
  const pending = code(
    `await tools.harness.write_file({path:'hello.txt',expectedContents:'original\\n',contents:'bad'})`,
  )
  await vi.waitFor(() => expect(s.approvals.list()).toHaveLength(1))
  s.approvals.respond(s.approvals.list()[0].id, false)
  expect((await pending).isError).toBe(true)
  const pending2 = code(
    `await tools.edit({path:'hello.txt',oldText:'original',newText:'approved'})`,
  )
  await vi.waitFor(() => expect(s.approvals.list()).toHaveLength(1))
  s.approvals.respond(s.approvals.list()[0].id, true)
  execution(await pending2)
  expect(await readFile(join(f.directory, 'hello.txt'), 'utf8')).toBe('approved\n')
  s.store.update((workspace) => ({
    ...workspace,
    agents: workspace.agents.map((agent) => ({ ...agent, permission: 'read-only' })),
  }))
  expect((await code(`await tools.harness.read_file({path:'hello.txt'})`)).isError).toBe(true)
  expect((await code(`await tools.dovo.todos({action:'set',items:[]})`)).isError).toBe(true)
})

it('keeps run scopes and current credentials when the MCP process stays warm', async () => {
  const { code, s, issue, credentialFile, token, task } = await setup()
  execution(await code(`return await tools.harness.read_file({path:'hello.txt'})`))
  const next = issue()
  expect(next).not.toBe(token)
  expect(() => s.runCredentials.authenticate(token)).toThrow(/expired|revoked/)
  expect(s.runCredentials.file(next)).toBe(credentialFile)
  execution(await code(`return await tools.harness.read_file({path:'hello.txt'})`))
  s.store.updateTask(task.id, (task) => ({
    ...task,
    linkedCheckouts: [{ id: 'late', repositoryId: 'repo', execution: 'main', access: 'edit' }],
  }))
  expect(
    (await code(`await tools.harness.read_file({path:'hello.txt',checkoutId:'late'})`)).isError,
  ).toBe(true)
})

it('cancels runtime approval when the code request is disconnected', async () => {
  const { command, s, f } = await setup({ provider: 'claude', permission: 'ask' })
  const controller = new AbortController()
  const pending = command(
    {
      source: 'harness',
      name: 'write_file',
      arguments: { path: 'hello.txt', expectedContents: 'original\n', contents: 'bad' },
    },
    controller.signal,
  )
  const rejected = pending.catch((error: unknown) => error)
  await vi.waitFor(() => expect(s.approvals.list()).toHaveLength(1))
  controller.abort()
  expect(await rejected).toMatchObject({ name: 'AbortError' })
  await vi.waitFor(() => expect(s.approvals.list()).toHaveLength(0))
  expect(await readFile(join(f.directory, 'hello.txt'), 'utf8')).toBe('original\n')
})

it('uses the existing terminal session with command approval and sandbox limits', async () => {
  const { code, s, task } = await setup({ provider: 'claude', permission: 'ask' })
  const pending = code(
    `const terminal=data(await tools.harness.terminal_run({command:'printf code-mode-output'}));return terminal;`,
  )
  await vi.waitFor(() => expect(s.approvals.list()).toHaveLength(1))
  s.approvals.respond(s.approvals.list()[0].id, true)
  const result = execution(await pending)
  expect(result.result).toMatchObject({ id: expect.any(String) })
  const terminal = s.terminals.list().find((terminal) => terminal.taskId === task.id)
  if (!terminal) throw new Error('Missing terminal')
  await vi.waitFor(() => expect(s.terminals.get(terminal.id).buffer).toContain('code-mode-output'))
  execution(
    await code(`return await tools.harness.terminal_close({id:${JSON.stringify(terminal.id)}})`),
  )
  expect(s.terminals.list()).toHaveLength(0)
  const restricted = await setup(
    { provider: 'codex', permission: 'workspace-write', sandboxMode: 'workspace-write' },
    'workspace-write',
  )
  expect((await restricted.code(`await tools.bash({command:'echo bad'})`)).isError).toBe(true)
})

it('runs a check once and returns its exit code, failure names and a bounded tail', async () => {
  const { code, client, s } = await setup()
  const script =
    "console.log('not ok 1 - checkout round trip'); console.log('x'.repeat(7000)); setTimeout(() => { console.log('check finished'); process.exit(7) }, 100)"
  const command = `node -e ${JSON.stringify(script)}`
  const result = execution(
    await code(`
    const result = data(await tools.harness.terminal_run({command:${JSON.stringify(command)},check:true,waitMs:0}));
    const summary = data(await tools.harness.terminal_read({id:result.id,summary:true,waitMs:5000}));
    return {result,summary};
  `),
  )
  expect(result.result).toMatchObject({
    result: { id: expect.any(String) },
    summary: {
      running: false,
      exitCode: 7,
      outputTruncated: true,
      failedTests: ['checkout round trip'],
      outputTail: expect.stringMatching(/check finished\s*$/),
    },
  })
  const terminal = s.terminals.list()[0]!
  expect(s.terminals.list()).toHaveLength(1)
  const raw = await client.callTool({ name: 'terminal_read', arguments: { id: terminal.id } })
  expect(JSON.stringify(raw)).toContain('checkout round trip')
  await vi.waitFor(() => {
    expect(
      s.activity
        .list('', 'tool', 0, terminal.taskId)
        .events.map((event) => JSON.parse(event.payload)),
    ).toEqual(expect.arrayContaining([expect.objectContaining({ exitCode: 7, status: 'failed' })]))
  })
})

it('reads a large Code mode result by reference without redoing its work', async () => {
  const { code, s, token } = await setup()
  const output = await code(`return {text:'dovo'.repeat(20_000)}`)
  const first = output.content[0]
  if (first?.type !== 'text') throw new Error('Missing compact result')
  expect(first.text.length).toBeLessThan(5000)
  const result = JSON.parse(first.text)
  expect(result).toMatchObject({
    resultId: expect.any(String),
    retained: true,
    toolCompleted: true,
  })
  const read = `return await tools.harness.read_tool_result({resultId:${JSON.stringify(result.resultId)},limit:64})`
  expect(execution(await code(read)).result).toMatchObject({ offset: 0, nextOffset: 64 })
  s.runCredentials.revoke(token)
  expect((await code(read)).isError).toBe(true)
})

it('returns default and large result pages directly from both result stores', async () => {
  const { code, command, s } = await setup()
  const large = '\u2028'.repeat(5 * 1024 * 1024)
  vi.spyOn(s.mcpApps, 'codeTools').mockResolvedValue({ content: [{ type: 'text', text: large }] })
  const runtimeResult = await command({ source: 'mcp', server: 'fixture', name: 'large' })
  expect(runtimeResult.status).toBe(200)
  const output = await code(`return '🙂' + '\\u2028'.repeat(30000)`)
  const first = output.content[0]
  if (first?.type !== 'text') throw new Error('Missing compact result')
  const localResultId = JSON.parse(first.text).resultId
  for (const resultId of [runtimeResult.value.resultId, localResultId]) {
    expect(resultId).toEqual(expect.any(String))
    const page = execution(
      await code(
        `return await tools.harness.read_tool_result({resultId:${JSON.stringify(resultId)}})`,
      ),
    )
    expect(page.result).toMatchObject({
      resultId,
      offset: 0,
      text: expect.any(String),
      nextOffset: 8192,
    })
    const largePage = execution(
      await code(
        `return await tools.harness.read_tool_result({resultId:${JSON.stringify(resultId)},offset:8192,limit:262144})`,
      ),
    )
    expect(largePage.result).toMatchObject({
      resultId,
      offset: 8192,
      text: expect.any(String),
      nextOffset: expect.any(Number),
    })
  }
  const offset = '{"result":"'.length
  const read = (offset: number) =>
    code(
      `return await tools.harness.read_tool_result({resultId:${JSON.stringify(localResultId)},offset:${offset},limit:1})`,
    )
  expect(execution(await read(offset)).result).toMatchObject({ text: '\ud83d' })
  expect(execution(await read(offset + 1)).result).toMatchObject({ text: '\ude42' })
})

it('runs bundled Mirage in all five modes through real code-mode MCP', async () => {
  const { code, f } = await setup()
  const image = await sharp(
    Buffer.from(
      '<svg width="640" height="400"><rect width="640" height="400" fill="white"/><text x="40" y="100" font-size="56" fill="black">SAVE CHANGES</text><rect x="40" y="160" width="220" height="80" fill="blue"/></svg>',
    ),
  )
    .png()
    .toBuffer()
  await writeFile(join(f.directory, 'screen.png'), image)
  for (const action of ['describe', 'ocr', 'detect', 'segment', 'decide']) {
    const args = {
      action,
      image: { path: 'screen.png' },
      maxTokens: 256,
      ...(action === 'decide' ? { form: { state: { enum: ['loading', 'error', 'ready'] } } } : {}),
    }
    const result = execution(
      await code(`return data(await tools.dovo.vision(${JSON.stringify(args)}))`),
    )
    expect(result.result).toMatchObject({
      model: 'Cactus Mirage',
      runtime: '4.0.0',
      local: true,
      action,
      image: { width: 640, height: 400 },
      coordinateScale: 1000,
    })
    const evidence =
      action === 'ocr'
        ? 'SAVE CHANGES'
        : action === 'segment'
          ? '"mask":'
          : action === 'decide'
            ? '"state":'
            : '"objects":'
    expect(JSON.stringify(result.result)).toContain(evidence)
  }
  expect(
    (await code(`await tools.dovo.vision({action:'ocr',image:{path:'../outside.png'}})`)).isError,
  ).toBe(true)
  expect(
    (await code(`await tools.dovo.vision({action:'decide',image:{path:'screen.png'}})`)).isError,
  ).toBe(true)
})

it('recovers completed large MCP output through the authorized result reader', async () => {
  const { command, code, s, controller } = await setup()
  const execute = vi
    .spyOn(s.mcpApps, 'codeTools')
    .mockResolvedValue({ content: [{ type: 'text', text: 'x'.repeat(5 * 1024 * 1024) }] })
  const result = await command({
    source: 'mcp',
    server: 'fixture',
    name: 'write_once',
    arguments: {},
  })
  expect(result.status).toBe(200)
  const retained = result.value
  expect(retained).toMatchObject({ toolCompleted: true, retained: true })
  const page = execution(
    await code(
      `return await tools.harness.read_tool_result({resultId:${JSON.stringify(retained.resultId)},limit:64})`,
    ),
  )
  expect(page.result).toMatchObject({ untrusted: true, offset: 0, nextOffset: 64 })
  expect(execute).toHaveBeenCalledTimes(1)
  controller.abort()
  expect(
    (
      await command({
        source: 'harness',
        name: 'read_tool_result',
        arguments: { resultId: retained.resultId },
      })
    ).status,
  ).toBe(401)
  expect(execute).toHaveBeenCalledTimes(1)
})

it('keeps recovery details when an MCP discovery catalog exceeds the code value limit', async () => {
  const { code, s } = await setup()
  const execute = vi.spyOn(s.mcpApps, 'codeTools').mockResolvedValue({
    tools: [{ name: 'large_schema', description: 'x'.repeat(5 * 1024 * 1024) }],
  })
  const found = execution(await code(`return await tools.search({source:'mcp',server:'fixture'})`))
  expect(found.result).toMatchObject({ toolCompleted: true, retained: true, tools: [] })
  if (!found.result || typeof found.result !== 'object' || !('resultId' in found.result))
    throw new Error('Missing catalog recovery ID')
  const resultId = found.result.resultId
  const page = execution(
    await code(
      `return await tools.harness.read_tool_result({resultId:${JSON.stringify(resultId)},limit:64})`,
    ),
  )
  expect(page.result).toMatchObject({ untrusted: true, offset: 0, nextOffset: 64 })
  expect(execute).toHaveBeenCalledTimes(1)
})

it('filters a large MCP catalog before retaining the matching schemas', async () => {
  const { code, s } = await setup()
  vi.spyOn(s.mcpApps, 'codeTools').mockResolvedValue({
    tools: [
      { name: 'large_schema', description: 'x'.repeat(5 * 1024 * 1024) },
      { name: 'small_schema', description: 'Unique match', inputSchema: { type: 'object' } },
    ],
  })
  const found = execution(
    await code(`return await tools.search({source:'mcp',server:'fixture',query:'UNIQUE MATCH'})`),
  )
  expect(found.result).toEqual({
    tools: [{ name: 'small_schema', description: 'Unique match', inputSchema: { type: 'object' } }],
  })
})

it('rejects a large MCP tool error before it can look like a successful retained result', async () => {
  const { code, s } = await setup()
  const execute = vi.spyOn(s.mcpApps, 'codeTools').mockResolvedValue({
    isError: true,
    content: [{ type: 'text', text: `Upstream failed: ${'x'.repeat(5 * 1024 * 1024)}` }],
  })
  const answer = execution(
    await code(`
    try { await tools.mcp.fixture.write_once({}); return 'continued' }
    catch (error) { return error.message }
  `),
  )
  expect(answer.result).toEqual(expect.stringContaining('Upstream failed'))
  expect(answer.result).toHaveLength(4097)
  expect(execute).toHaveBeenCalledTimes(1)
})
