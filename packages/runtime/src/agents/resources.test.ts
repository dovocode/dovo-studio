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
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})
async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'dovo-resource-test-'))
  directories.push(path)
  return path
}
it('merges named resources with disabled agent overrides and validates unique names', () => {
  const server = mcpServerSchema.parse({
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
  const project = { mcpServers: [server], skills: [skill] }
  const agent = {
    mcpServers: [{ ...server, enabled: false }],
    skills: [{ ...skill, content: 'Agent rules' }],
  }
  expect(mergeResources(project, agent)).toEqual(agent)
  expect(mergeResources(undefined, undefined)).toEqual({ mcpServers: [], skills: [] })
  expect(resourceSettingsSchema.safeParse({ ...project, skills: [skill, skill] }).success).toBe(
    false,
  )
  expect(
    mcpServerSchema.safeParse({
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
  expect(await importSkill({ path })).toMatchObject({
    name: 'review',
    description: 'Review changes before shipping',
    content: 'Check correctness.',
    sourcePath: await realpath(path),
    enabled: true,
  })
  await writeFile(path, 'No metadata')
  await expect(importSkill({ path })).rejects.toThrow('frontmatter')
  await writeFile(path, 'x'.repeat(64001))
  await expect(importSkill({ path })).rejects.toThrow('64 KB')
})
it('maps enabled MCP transports and resolves environment references for each harness', () => {
  vi.stubEnv('DOVO_MCP_TEST_TOKEN', 'test-value')
  const local = mcpServerSchema.parse({
    name: 'local',
    enabled: true,
    transport: 'stdio',
    command: 'node',
    args: ['server.js'],
    env: { TOKEN: 'DOVO_MCP_TEST_TOKEN' },
  })
  const http = mcpServerSchema.parse({
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
    env: { TOKEN: 'DOES_NOT_EXIST_DOVO' },
  }
  expect(codexMcpServers([local, http, disabled])).toMatchObject({
    local: { env: { TOKEN: 'test-value' } },
    remote: { http_headers: { Authorization: 'Bearer test-value' } },
    disabled: { enabled: false },
  })
  expect(Object.keys(claudeMcpServers([local, http, disabled]))).toEqual(['local', 'remote'])
  expect(acpMcpServers([http])).toEqual([
    {
      name: 'remote',
      type: 'http',
      url: http.url,
      headers: [{ name: 'Authorization', value: 'Bearer test-value' }],
    },
  ])
  expect(() => claudeMcpServers([{ ...disabled, enabled: true }])).toThrow('DOES_NOT_EXIST_DOVO')
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
  ).toEqual({ server: 'fixture', tools: ['read_docs'] })
})
