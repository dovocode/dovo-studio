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

it('throws nested MCP errors and rejects recursion before dispatch', async () => {
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
  await expect(
    executeCodeTool({ ...options, code: `await tools.mcp.example.call({})` }),
  ).rejects.toThrow('Upstream failed')
  await expect(
    executeCodeTool({ ...options, code: `await tools.dovo.code({code:'return 1'})` }),
  ).rejects.toThrow('disabled')
  expect(options.dovo).not.toHaveBeenCalled()
})
