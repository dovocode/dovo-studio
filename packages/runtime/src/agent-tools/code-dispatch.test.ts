import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, it, vi } from 'vite-plus/test'
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
