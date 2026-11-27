import { afterAll, expect, it, vi } from 'vite-plus/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { dashboardSaveResultSchema, decode } from '@dovo/protocol'
import { defineExtension, view } from '@dovo/protocol/studio-extension-sdk'
import { Ajv2020 } from 'ajv/dist/2020.js'
import { startRuntime } from '../index.js'
import { fixture } from '../testing/fixture.js'
import { taskToolsServer } from './config.js'

// Runs the task tool server in this process, so the test does not need a built dist folder.
// The stdio transport is the only replaced part; calls still reach the real runtime over HTTP.
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: class {
    constructor() {
      return serverTransport
    }
  },
}))
vi.setConfig({ testTimeout: 60_000 })
const cleanups: Array<() => Promise<unknown>> = []
afterAll(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  vi.unstubAllEnvs()
})

function resultText(result: Awaited<ReturnType<Client['callTool']>>) {
  const parsed = CallToolResultSchema.parse(result)
  const block = parsed.content.find((part) => part.type === 'text')
  if (!block || block.type !== 'text') throw new Error('Expected text')
  return { isError: parsed.isError === true, text: block.text }
}

it('authors dashboards and extension drafts through dovo_task without running anything', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: 'dashboard-tool-owner-token-at-least-32-chars',
    port: 0,
  })
  cleanups.push(() => runtime.close())
  const s = runtime.services
  s.store.update(() => f.workspace)
  const task = s.tasks.create({
    title: 'Author',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: '',
  })
  const runId = 'dashboard-tool-run'
  s.store.updateTask(task.id, (entry) => ({ ...entry, status: 'running', activeRunId: runId }))
  const controller = new AbortController()
  cleanups.push(async () => controller.abort())
  const token = s.runCredentials.issue(
    {
      taskId: task.id,
      runId,
      permissions: { provider: 'codex', permission: 'ask' },
      readOnly: false,
      artifacts: false,
      pipelineWatching: false,
      pullRequestWatching: false,
      deviceHub: false,
      memoryScopes: [],
    },
    controller.signal,
  )
  const config = taskToolsServer(task.id, runtime.port, token, '127.0.0.1', false, false, runId)
  for (const [key, value] of Object.entries(config.envValues ?? {})) vi.stubEnv(key, value)
  await import('./server.js')
  const client = new Client({ name: 'dashboards-tool', version: '1' })
  await client.connect(clientTransport)
  cleanups.push(() => client.close())

  const command = {
    action: 'create',
    requestId: '20000000-0000-4000-8000-000000000001',
    dashboard: {
      title: 'Ops',
      tiles: [
        {
          title: 'Tests',
          kind: 'command',
          span: 2,
          height: 1,
          repositoryId: 'repo',
          command: 'touch ran',
        },
        {
          title: 'Local metrics',
          kind: 'cli',
          span: 2,
          height: 1,
          repositoryId: 'repo',
          command: 'metrics --json',
          chart: 'number',
          pointer: '/total',
          refreshSeconds: 60,
          panels: [{ title: 'Recent results', pointer: '/history', chart: 'line' }],
        },
      ],
    },
  }
  const create = async () =>
    resultText(await client.callTool({ name: 'dashboards', arguments: command }))
  const created = await create()
  expect(await create()).toEqual(created)
  expect(s.dashboards.list()).toHaveLength(1)
  expect(created.isError).toBe(false)
  const { dashboard } = decode(dashboardSaveResultSchema, JSON.parse(created.text))
  expect(dashboard.tiles[1]).toMatchObject({
    kind: 'cli',
    refreshSeconds: 60,
    panels: [{ title: 'Recent results', pointer: '/history', chart: 'line' }],
  })
  expect(s.dashboards.get(dashboard.id)).toEqual(dashboard)
  expect(s.terminals.list()).toEqual([])

  // The advertised schema rejects actions and fields outside dashboard authoring.
  for (const args of [
    { action: 'run', id: dashboard.id },
    { action: 'list', headers: { Authorization: 'x' } },
  ])
    expect(resultText(await client.callTool({ name: 'dashboards', arguments: args })).isError).toBe(
      true,
    )
  const stale = resultText(
    await client.callTool({
      name: 'dashboards',
      arguments: { action: 'delete', id: dashboard.id, expectedRevision: 2 },
    }),
  )
  expect(stale).toMatchObject({ isError: true, text: expect.stringContaining('changed') })
  expect(
    resultText(
      await client.callTool({
        name: 'dashboards',
        arguments: { action: 'delete', id: dashboard.id, expectedRevision: 1 },
      }),
    ).isError,
  ).toBe(false)
  expect(s.dashboards.list()).toEqual([])
  const extensionManifest = defineExtension({
    id: 'test.delivery',
    name: 'Delivery',
    contributions: [
      { id: 'terminal', title: 'Terminal', kind: 'studio', destination: 'terminal' },
      view({
        id: 'overview',
        title: 'Delivery overview',
        placement: 'tool',
        root: {
          id: 'card',
          kind: 'card',
          children: [{ id: 'summary', kind: 'text', value: 'Delivery overview' }],
        },
      }),
    ],
  })
  const extensions = async (args: Record<string, unknown>) =>
    resultText(await client.callTool({ name: 'studio_extensions', arguments: args }))
  const viewCatalog = await extensions({ action: 'catalog' })
  expect(viewCatalog.isError).toBe(false)
  expect(JSON.parse(viewCatalog.text)).toMatchObject({
    sdk: {
      module: '@dovo/protocol/studio-extension-sdk',
      helpers: expect.arrayContaining([
        'defineExtension',
        'view',
        'setting',
        'result',
        'page',
        'apiSource',
        'cliSource',
        'sourceControls',
        'dataGrid',
      ]),
    },
    views: {
      components: expect.arrayContaining(['card', 'custom', 'chart', 'data-source', 'data-grid']),
      placements: expect.arrayContaining(['settings', 'tool', 'page']),
    },
  })
  const contract = await extensions({ action: 'catalog', component: 'manifest' })
  expect(contract.isError).toBe(false)
  const { schema: manifestContract } = JSON.parse(contract.text)
  const validateContract = new Ajv2020().compile(manifestContract)
  expect(validateContract(extensionManifest)).toBe(true)
  expect(validateContract({ ...extensionManifest, id: 'Bad ID' })).toBe(false)
  expect(validateContract({ ...extensionManifest, settings: null })).toBe(false)
  expect(validateContract({ ...extensionManifest, extra: true })).toBe(false)
  expect(JSON.parse(contract.text)).toMatchObject({
    schema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      additionalProperties: false,
      properties: {
        id: { allOf: [{ pattern: expect.any(String) }] },
        contributions: { maxItems: 16, items: { anyOf: expect.any(Array) } },
      },
    },
  })
  const component = await extensions({ action: 'catalog', component: 'custom' })
  expect(component.isError).toBe(false)
  expect(JSON.parse(component.text)).toMatchObject({
    component: 'custom',
    schema: { schema: { properties: { component: { properties: { type: expect.any(Object) } } } } },
  })
  expect((await extensions({ action: 'validate', manifest: extensionManifest })).isError).toBe(
    false,
  )
  const draft = await extensions({
    action: 'stage',
    manifest: extensionManifest,
    expectedRevision: 0,
  })
  expect(draft.isError).toBe(false)
  expect(JSON.parse(draft.text)).toEqual({ id: 'test.delivery', revision: 1, staged: true })
  const read = await extensions({ action: 'read', id: extensionManifest.id })
  expect(read.isError).toBe(false)
  expect(JSON.parse(read.text)).toEqual({
    id: extensionManifest.id,
    revision: 1,
    enabled: false,
    draft: extensionManifest,
  })
  expect(
    (await extensions({ action: 'install', id: 'test.delivery', expectedRevision: 1 })).isError,
  ).toBe(true)
  const catalog = await extensions({ action: 'list' })
  expect(JSON.parse(catalog.text)).toMatchObject({
    extensions: [{ id: 'test.delivery', enabled: false, draft: true }],
  })
  s.studioExtensions.command({ action: 'agent-install-policy', enabled: true }, () => undefined)
  const installed = await extensions({
    action: 'install',
    id: 'test.delivery',
    expectedRevision: 1,
  })
  expect(installed.isError).toBe(false)
  expect(JSON.parse(installed.text)).toEqual({ id: 'test.delivery', revision: 2, installed: true })
  const marketplaceContract = await extensions({ action: 'catalog', component: 'marketplace' })
  expect(marketplaceContract.isError).toBe(false)
  expect(JSON.parse(marketplaceContract.text)).toMatchObject({
    action: 'marketplace',
    inputKey: 'marketplace',
    schema: { schema: { anyOf: expect.any(Array) } },
  })
  const discover = await extensions({
    action: 'marketplace',
    marketplace: { action: 'list', query: 'shortcuts' },
  })
  expect(discover.isError).toBe(false)
  const [release] = JSON.parse(discover.text).packages
  expect(release.id).toBe('dovo.workspace-shortcuts')
  const exact = { id: release.id, digest: release.digest }
  const preview = await extensions({
    action: 'marketplace',
    marketplace: { action: 'read', ...exact },
  })
  expect(preview.isError).toBe(false)
  const staged = await extensions({
    action: 'marketplace',
    marketplace: { action: 'stage', ...exact, expectedRevision: 0, bindings: [] },
  })
  expect(staged.isError).toBe(false)
  const marketplaceInstall = await extensions({
    action: 'install',
    id: release.id,
    expectedRevision: JSON.parse(staged.text).revision,
  })
  expect(marketplaceInstall.isError).toBe(false)
  expect(s.terminals.list()).toEqual([])
})
