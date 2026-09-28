import { decode, decodeResult } from '@dovo/protocol'
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mcpServerSchema, mergeResources, resourceSettingsSchema } from '@dovo/protocol'
import { importSkill, testMcpServer } from './resources'
import { acpMcpServers, claudeMcpServers, codexMcpServers } from './mcp-settings'
const directories: string[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(
    directories.splice(0).map((path) =>
      rm(path, {
        recursive: true,
        force: true,
      }),
    ),
  )
})
async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'dovo-resource-test-'))
  directories.push(path)
  return path
}
it('merges named resources with disabled agent overrides and validates unique names', () => {
  const server = decode(mcpServerSchema, {
    name: 'docs',
    enabled: true,
    transport: 'stdio',
    command: 'node',
  })
  const skill = {
    name: 'review',
    enabled: true,
    description: 'Review changes',
    content: 'Check correctness',
  }
  const project = {
    mcpServers: [server],
    skills: [skill],
  }
  const agent = {
    mcpServers: [
      {
        ...server,
        enabled: false,
      },
    ],
    skills: [
      {
        ...skill,
        content: 'Agent rules',
      },
    ],
  }
  expect(mergeResources(project, agent)).toEqual(agent)
  expect(mergeResources(undefined, undefined)).toEqual({
    mcpServers: [],
    skills: [],
  })
  expect(
    decodeResult(resourceSettingsSchema, {
      ...project,
      skills: [skill, skill],
    }).success,
  ).toBe(false)
  expect(
    decodeResult(mcpServerSchema, {
      ...server,
      transport: 'http',
      url: 'https://user:secret@example.com',
    }).success,
  ).toBe(false)
})
it('imports a skill with YAML metadata and rejects malformed or oversized sources', async () => {
  const path = join(await directory(), 'SKILL.md')
  await writeFile(
    path,
    '---\nname: review\ndescription: >-\n  Review changes\n  before shipping\n---\nCheck correctness.\n',
  )
  expect(
    await importSkill({
      path,
    }),
  ).toMatchObject({
    name: 'review',
    description: 'Review changes before shipping',
    content: 'Check correctness.',
    sourcePath: await realpath(path),
    enabled: true,
  })
  await writeFile(path, 'No metadata')
  await expect(
    importSkill({
      path,
    }),
  ).rejects.toThrow('frontmatter')
  await writeFile(path, 'x'.repeat(64001))
  await expect(
    importSkill({
      path,
    }),
  ).rejects.toThrow('64 KB')
})
it('maps enabled MCP transports and resolves environment references for each harness', () => {
  vi.stubEnv('DOVO_MCP_TEST_TOKEN', 'test-value')
  const local = decode(mcpServerSchema, {
    name: 'local',
    enabled: true,
    transport: 'stdio',
    command: 'node',
    args: ['server.js'],
    env: {
      TOKEN: 'DOVO_MCP_TEST_TOKEN',
    },
  })
  const http = decode(mcpServerSchema, {
    name: 'remote',
    enabled: true,
    transport: 'http',
    url: 'https://example.com/mcp',
    bearerTokenEnv: 'DOVO_MCP_TEST_TOKEN',
  })
  const disabled = {
    ...local,
    name: 'disabled',
    enabled: false,
    env: {
      TOKEN: 'DOES_NOT_EXIST_DOVO',
    },
  }
  expect(codexMcpServers([local, http, disabled])).toMatchObject({
    local: {
      env: {
        TOKEN: 'test-value',
      },
    },
    remote: {
      http_headers: {
        Authorization: 'Bearer test-value',
      },
    },
    disabled: {
      enabled: false,
    },
  })
  expect(Object.keys(claudeMcpServers([local, http, disabled]))).toEqual(['local', 'remote'])
  expect(acpMcpServers([http])).toEqual([
    {
      name: 'remote',
      type: 'http',
      url: http.url,
      headers: [
        {
          name: 'Authorization',
          value: 'Bearer test-value',
        },
      ],
    },
  ])
  expect(() =>
    claudeMcpServers([
      {
        ...disabled,
        enabled: true,
      },
    ]),
  ).toThrow('DOES_NOT_EXIST_DOVO')
})
it('tests a real stdio handshake and lists tools without invoking them', async () => {
  const path = join(await directory(), 'server.cjs')
  await writeFile(
    path,
    `require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.id===undefined)return;let result;if(m.method==='initialize')result={protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}};else if(m.method==='tools/list')result={tools:[{name:'read_docs',description:'Docs',inputSchema:{type:'object'}}]};else process.exit(2);process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n')})`,
  )
  expect(
    await testMcpServer({
      name: 'fixture',
      enabled: true,
      transport: 'stdio',
      command: process.execPath,
      args: [path],
    }),
  ).toEqual({
    server: 'fixture',
    tools: ['read_docs'],
  })
})

it.each([307, 308])(
  'does not forward MCP credentials through an HTTP %s redirect',
  async (status) => {
    const { createServer } = await import('node:http')
    const { once } = await import('node:events')
    let forwarded = false
    const destination = createServer((request, response) => {
      forwarded = true
      request.resume()
      response.writeHead(400)
      response.end('Unexpected redirected request')
    })
    destination.listen(0, '127.0.0.1')
    await once(destination, 'listening')
    const target = destination.address()
    if (!target || typeof target === 'string') throw new Error('Missing port')
    const source = createServer((request, response) => {
      request.resume()
      response.writeHead(status, { Location: `http://127.0.0.1:${target.port}/mcp` })
      response.end()
    })
    source.listen(0, '127.0.0.1')
    await once(source, 'listening')
    const origin = source.address()
    if (!origin || typeof origin === 'string') throw new Error('Missing port')
    try {
      await expect(
        testMcpServer({
          name: 'audit',
          enabled: true,
          transport: 'http',
          url: `http://127.0.0.1:${origin.port}/mcp`,
          headerValues: { 'X-API-Key': 'synthetic-secret-audit-only' },
        }),
      ).rejects.toThrow(/fetch|redirect/i)
      expect(forwarded).toBe(false)
    } finally {
      source.closeAllConnections()
      destination.closeAllConnections()
      await Promise.all([
        new Promise<void>((resolve) => source.close(() => resolve())),
        new Promise<void>((resolve) => destination.close(() => resolve())),
      ])
    }
  },
)
