/// <reference types="node" />
import { createServer } from 'node:http'
import { expect, it } from 'vite-plus/test'
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv-provider.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { fromJSONSchema } from 'zod'
import { defaultTaskHarness, noStudioTools } from '@dovo/protocol'
import { taskToolsServer } from './config.js'
import { museToolSchema } from './muse-schema.js'

function depth(value: unknown): number {
  return value && typeof value === 'object'
    ? 1 + Math.max(0, ...Object.values(value).map(depth))
    : 0
}

it('preserves shallow constraints and describes deeper schemas without mutating the source', () => {
  const shallow = {
    type: 'object' as const,
    properties: { name: { type: 'string' as const, minLength: 1, maxLength: 20 } },
    required: ['name'],
  }
  expect(museToolSchema(shallow)).toEqual(shallow)
  const schema = { type: 'object' as const, properties: { nested: shallow } }
  const deep = {
    type: 'object' as const,
    properties: { nested: { type: 'object' as const, properties: { nested: schema } } },
  }
  const original = JSON.stringify(deep)
  const projected = museToolSchema(deep)
  expect(depth(projected)).toBeLessThanOrEqual(8)
  expect(JSON.stringify(projected)).toContain('Studio validates the complete value')
  expect(
    fromJSONSchema(projected).safeParse({ nested: { nested: { nested: { name: 'valid' } } } })
      .success,
  ).toBe(true)
  expect(JSON.stringify(deep)).toBe(original)
})

it.each([
  { profile: '', minDepth: 10, maxDepth: Infinity },
  { profile: 'muse', minDepth: 0, maxDepth: 8 },
])(
  'advertises commands and validates original nested inputs for profile "$profile"',
  async ({ profile, minDepth, maxDepth }) => {
    const calls: unknown[] = []
    const backend = createServer(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      calls.push(JSON.parse(Buffer.concat(chunks).toString()))
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ ok: true }))
    })
    await new Promise<void>((resolve) => backend.listen(0, '127.0.0.1', resolve))
    const address = backend.address()
    if (!address || typeof address === 'string') throw new Error('Expected a TCP server')
    try {
      const config = taskToolsServer(
        'schema-test',
        address.port,
        'fixture-only',
        '127.0.0.1',
        false,
        true,
        'run',
        true,
        true,
        [],
        true,
        undefined,
        undefined,
        {
          ...noStudioTools(),
          threads: true,
          automations: true,
          browsers: true,
          ui: true,
          diagnostics: true,
        },
      )
      const client = new Client({ name: 'muse-schema-test', version: '1' })
      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: { ...config.envValues, DOVO_TASK_SCHEMA_PROFILE: profile },
        stderr: 'pipe',
      })
      try {
        await client.connect(transport)
        const { tools } = await client.listTools()
        const todos = tools.find((tool) => tool.name === 'todos')
        if (!todos) throw new Error('Expected the checklist tool')
        const validator = new AjvJsonSchemaValidator()
        expect(todos.inputSchema.anyOf).toBeDefined()
        expect(
          validator.getValidator(todos.inputSchema)({
            action: 'set',
            items: [{ text: 'Check schema', status: 'pending' }],
          }).valid,
        ).toBe(true)
        for (const tool of tools) {
          expect(depth(tool.inputSchema)).toBeLessThanOrEqual(maxDepth)
          expect(() => validator.getValidator(tool.inputSchema)).not.toThrow()
        }
        expect(
          depth(tools.find((tool) => tool.name === 'studio_automations')?.inputSchema),
        ).toBeGreaterThan(minDepth)
        const before = calls.length
        const invalid = await client.callTool({
          name: 'ask_question',
          arguments: {
            key: 'bad',
            title: 'Pick',
            questions: [
              { id: 'one', header: '', question: 'Pick?', options: [{ value: 'one', label: 42 }] },
            ],
          },
        })
        expect(invalid.isError).toBe(true)
        expect(calls).toHaveLength(before)
        const missing = await client.callTool({ name: 'todos', arguments: { action: 'set' } })
        expect(missing.isError).toBe(true)
        expect(calls).toHaveLength(before)
        const valid = await client.callTool({
          name: 'todos',
          arguments: { action: 'set', items: [{ text: 'Check schema', status: 'pending' }] },
        })
        expect(valid.isError).not.toBe(true)
        expect(calls.at(-1)).toMatchObject({
          command: { action: 'set', items: [{ text: 'Check schema', status: 'pending' }] },
        })
        const automation = {
          id: 'test',
          name: 'Test',
          edges: [],
          nodes: [
            {
              id: 'task',
              type: 'automation',
              position: { x: 0, y: 0 },
              data: {
                kind: 'task',
                label: 'Task',
                trigger: 'manual',
                schedule: '',
                timezone: 'UTC',
                objective: 'Check schema',
                agentId: 'agent',
                repositoryId: 'repo',
                harness: defaultTaskHarness('muse'),
              },
            },
          ],
        }
        const invalidAutomation = {
          ...automation,
          nodes: automation.nodes.map((node) => ({
            ...node,
            data: { ...node.data, harness: { ...node.data.harness, provider: 42 } },
          })),
        }
        const nested = await client.callTool({
          name: 'studio_automations',
          arguments: { command: { action: 'validate', automation: invalidAutomation } },
        })
        expect(nested.isError).toBe(true)
        expect(calls).toHaveLength(before + 1)
        const validAutomation = await client.callTool({
          name: 'studio_automations',
          arguments: { command: { action: 'validate', automation } },
        })
        expect(validAutomation.isError).not.toBe(true)
        expect(calls).toHaveLength(before + 2)
      } finally {
        await client.close()
        await transport.close()
      }
    } finally {
      await new Promise<void>((resolve, reject) =>
        backend.close((error) => (error ? reject(error) : resolve())),
      )
    }
  },
)
