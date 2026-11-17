import { expect, it } from 'vite-plus/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { DiagnosticStdioTransport } from './stdio-transport.js'

it('retains and redacts startup stderr across chunks without blocking a noisy child', async () => {
  const secret = 'private-split-credential-0123456789'
  const transport = new DiagnosticStdioTransport({
    command: process.execPath,
    args: [
      '-e',
      String.raw`process.stderr.write('x'.repeat(100000)+'\n');process.stderr.write('Failed token='+process.env.MCP_TEST_SECRET.slice(0,12));setTimeout(()=>{process.stderr.write(process.env.MCP_TEST_SECRET.slice(12)+'\nConfiguration missing\n');process.exit(1)},20)`,
    ],
    env: { MCP_TEST_SECRET: secret },
  })
  const client = new Client({ name: 'diagnostic-test', version: '1' })
  try {
    await expect(client.connect(transport)).rejects.toThrow('Connection closed')
    const error = await transport.explain(new Error('Connection closed'))
    expect(error).toBeInstanceOf(Error)
    const text = String(error)
    expect(text).toContain('Configuration missing')
    expect(text).toContain('[redacted]')
    expect(text).not.toContain(secret)
    expect(text.length).toBeLessThan(2200)
  } finally {
    await client.close()
  }
})

it('keeps the original failure when a child has no stderr', async () => {
  const transport = new DiagnosticStdioTransport({
    command: process.execPath,
    args: ['-e', 'process.exit(1)'],
  })
  const client = new Client({ name: 'diagnostic-test', version: '1' })
  try {
    await expect(client.connect(transport)).rejects.toThrow('Connection closed')
    const original = new Error('Connection closed')
    expect(await transport.explain(original)).toBe(original)
  } finally {
    await client.close()
  }
})
