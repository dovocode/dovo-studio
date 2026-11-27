import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { setImmediate } from 'node:timers/promises'
import { expect, it, vi } from 'vite-plus/test'
import { deferred } from '../testing/integration.js'
import { executeCodeTool, codeToolDefinition } from './code-dispatch.js'

it('keeps image and audio blocks from selected tool results', async () => {
  const result = {
    content: [
      { type: 'image' as const, mimeType: 'image/png', data: 'aW1hZ2U=' },
      { type: 'audio' as const, mimeType: 'audio/wav', data: 'YXVkaW8=' },
    ],
  }
  const dovo = vi.fn<() => Promise<CallToolResult>>(async () => result)
  const output = await executeCodeTool({
    code: `const result=await tools.dovo.browser({});print(result);return 42`,
    signal: new AbortController().signal,
    tools: [codeToolDefinition, { name: 'browser', inputSchema: { type: 'object' } }],
    dovo,
    remote: async () => ({}),
  })
  expect(output.content).toEqual(expect.arrayContaining(result.content))
  expect(dovo).toHaveBeenCalledTimes(1)
})

it('reports nested MCP errors and rejects recursion before calling the tool', async () => {
  const remote = vi.fn<() => Promise<CallToolResult>>(async () => ({
    isError: true,
    content: [{ type: 'text' as const, text: 'Upstream failed' }],
  }))
  const options = {
    signal: new AbortController().signal,
    tools: [codeToolDefinition],
    dovo: vi.fn<() => Promise<CallToolResult>>(async () => ({ content: [] })),
    remote,
  }
  const nested = await executeCodeTool({ ...options, code: `await tools.mcp.example.call({})` })
  expect(nested).toMatchObject({ isError: true })
  expect(nested.content[0]).toMatchObject({ text: expect.stringContaining('Upstream failed') })
  const recursive = await executeCodeTool({
    ...options,
    code: `await tools.dovo.code({code:'return 1'})`,
  })
  expect(recursive).toMatchObject({ isError: true })
  expect(recursive.content[0]).toMatchObject({ text: expect.stringContaining('disabled') })
  expect(options.dovo).not.toHaveBeenCalled()
})

it('reports completed and unconfirmed calls when a script fails without printing', async () => {
  const remote = vi.fn<({ name }: { name: string }) => Promise<CallToolResult>>(
    async ({ name }) => {
      if (name === 'unknown') throw new Error('Connection lost before a response')
      return { content: [] }
    },
  )
  const result = await executeCodeTool({
    code: `
      await tools.mcp.example.record({})
      await tools.mcp.example.unknown({})
    `,
    signal: new AbortController().signal,
    tools: [codeToolDefinition],
    dovo: async () => ({ content: [] }),
    remote,
  })

  expect(remote.mock.calls.map(([call]) => call.name)).toEqual(['record', 'unknown'])
  expect(result.isError).toBe(true)
  expect(result.content[0]).toMatchObject({ text: expect.stringContaining('Connection lost') })
  const summary = result.content[1]
  expect(summary?.type === 'text' && JSON.parse(summary.text)).toEqual({
    output: [],
    calls: 2,
    callOutcomes: { completed: [1], unconfirmed: [2] },
  })
})

it.each(['reply received', 'reply lost'] as const)(
  'drains an in-flight MCP call after the script fails with %s',
  async (outcome) => {
    const entered = deferred<void>()
    const reply = deferred<void>()
    const remote = vi.fn<({ name }: { name: string }) => Promise<CallToolResult>>(
      async ({ name }) => {
        if (name === 'read') {
          entered.resolve()
          await reply.promise
          if (outcome === 'reply lost') throw new Error('Connection lost')
        }
        return { content: [] }
      },
    )
    const pending = executeCodeTool({
      code: `
        const followUp = () => tools.mcp.fixture.record({})
        tools.mcp.fixture.read({}).then(followUp, followUp).catch(() => {})
        throw new Error('Script stopped')
      `,
      signal: new AbortController().signal,
      tools: [codeToolDefinition],
      dovo: async () => ({ content: [] }),
      remote,
    })
    await entered.promise
    await setImmediate()
    reply.resolve()
    const result = await pending
    expect(remote.mock.calls.map(([call]) => call.name)).toEqual(['read'])
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining('Script stopped') })
    const summary = result.content[1]
    expect(summary?.type === 'text' && JSON.parse(summary.text)).toEqual({
      output: [],
      calls: 1,
      callOutcomes:
        outcome === 'reply received'
          ? { completed: [1], unconfirmed: [] }
          : { completed: [], unconfirmed: [1] },
    })
  },
)

it('does not dispatch a follow-up queued by the same guest batch that fails', async () => {
  const remote = vi.fn<({ name }: { name: string }) => Promise<CallToolResult>>(async () => ({
    content: [],
  }))
  const result = await executeCodeTool({
    code: `
      const read = tools.mcp.fixture.read({})
      read.then(() => tools.mcp.fixture.record({})).catch(() => {})
      await read
      throw new Error('Script stopped')
    `,
    signal: new AbortController().signal,
    tools: [codeToolDefinition],
    dovo: async () => ({ content: [] }),
    remote,
  })
  expect(remote.mock.calls.map(([call]) => call.name)).toEqual(['read'])
  expect(result.content[0]).toMatchObject({ text: expect.stringContaining('Script stopped') })
  const summary = result.content[1]
  expect(summary?.type === 'text' && JSON.parse(summary.text)).toMatchObject({
    callOutcomes: { completed: [1], unconfirmed: [] },
  })
})

it.each([
  ['first', 'second', 'third'],
  ['first', 'third', 'second'],
  ['second', 'first', 'third'],
  ['second', 'third', 'first'],
  ['third', 'first', 'second'],
  ['third', 'second', 'first'],
] as const)(
  'reports every dispatched call after a script fails with completion order %s, %s, %s',
  async (...order) => {
    const gates = { first: deferred<void>(), second: deferred<void>(), third: deferred<void>() }
    const entered = deferred<void>()
    let calls = 0
    const remote = vi.fn<({ name }: { name: string }) => Promise<CallToolResult>>(
      async ({ name }) => {
        const gate = gates[name as keyof typeof gates]
        if (!gate) throw new Error(`Unexpected tool ${name}`)
        if (++calls === 3) entered.resolve()
        await gate.promise
        if (name === 'second') throw new Error('MCP response lost')
        return { content: [] }
      },
    )
    let finished = false
    const pending = executeCodeTool({
      code: `
      tools.mcp.fixture.first({}).catch(() => {})
      tools.mcp.fixture.second({}).catch(() => {})
      tools.mcp.fixture.third({}).catch(() => {})
      throw new Error('Script stopped')
    `,
      signal: new AbortController().signal,
      tools: [codeToolDefinition],
      dovo: async () => ({ content: [] }),
      remote,
    }).then((result) => {
      finished = true
      return result
    })
    try {
      await Promise.race([
        entered.promise,
        pending.then(() => {
          throw new Error('Script returned before dispatching its tools')
        }),
      ])
      for (const name of order) {
        expect(finished).toBe(false)
        gates[name].resolve()
        await setImmediate()
      }
    } finally {
      for (const gate of Object.values(gates)) gate.resolve()
      await pending
    }
    const result = await pending
    expect(remote.mock.calls.map(([call]) => call.name)).toEqual(['first', 'second', 'third'])
    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining('Script stopped') })
    const summary = result.content[1]
    expect(summary?.type === 'text' && JSON.parse(summary.text)).toEqual({
      output: [],
      calls: 3,
      callOutcomes: { completed: [1, 3], unconfirmed: [2] },
    })
  },
)
