import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const assets = root + 'apps/web/dist/client/assets/'
const css = readdirSync(assets)
  .filter((file) => file.endsWith('.css'))
  .map((file) => readFileSync(assets + file, 'utf8'))
  .join('\n')
const fromView = root + 'packages/extension-tasks/src/dashboards/view.tsx'
const marketplace = JSON.parse(
  readFileSync(root + 'packages/runtime/src/studio-extensions/marketplace-catalog.json', 'utf8'),
).map((release) => ({
  package: release,
  digest: createHash('sha256').update(JSON.stringify(release)).digest('hex'),
}))

const bundle = await bundleBrowser(
  {
    stdin: {
      contents: `
        import React from 'react'
        import { createRoot } from 'react-dom/client'
        import Dashboards from './packages/extension-tasks/src/dashboards/view'
        import Extensions from './packages/extension-tasks/src/studio-extensions/view'
        function Views() {
          const [extensions, setExtensions] = React.useState(false)
          const { snapshot, activeRuntimeId } = useWorkspace()
          const [page, setPage] = React.useState()
          React.useEffect(() => {
            window.showExtensions = (show) => { setExtensions(show); setPage(undefined) }
            window.openExtensionPage = setPage
          }, [])
          const pins = snapshot.studioExtensionPinnedPages.map((pin) => ({
            ...studioExtensionPageTarget(activeRuntimeId, pin.extensionId, pin.pageId),
            title: pin.title,
          }))
          return <TooltipProvider>
            {pins.length > 0 && <ActivityBar views={[]} activeId="" onSelect={() => {}}
              extensionPages={pins} activeExtensionPage={page} onOpenExtensionPage={(item) => setPage(item.entityId)} />}
            {page ? <ExtensionPage entityId={page} /> : extensions ? <Extensions /> : <Dashboards />}
          </TooltipProvider>
        }
        import { Fixture, studioExtensionPageTarget, useWorkspace } from '@dovo/studio-core'
        import ExtensionPage from './packages/extension-tasks/src/studio-extensions/page'
        import { ActivityBar } from './packages/studio-shell/src/activity-bar'
        import { TooltipProvider } from '@dovo/studio-ui'
        createRoot(document.getElementById('app')).render(<Fixture><Views /></Fixture>)
      `,
      loader: 'tsx',
      resolveDir: root,
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    nodePaths: [root + 'packages/extension-tasks/node_modules', root + 'node_modules'],
  },
  [
    {
      path: '@dovo/studio-core',
      contents: `
        import React, { createContext, useContext, useEffect, useState } from 'react'
        export * from '${root}packages/studio-core/src/index'
        export const encodeWorkTarget = JSON.stringify
        export const clientScopeKey = () => 1
        export const useStudioHost = () => ({ navigate(target) {
          if (target.viewId === 'studio-extension-page') window.openExtensionPage(target.entityId)
        }, openThread() {} })
        const Workspace = createContext(null)
        const profile = { id: 'owner', name: 'Test runtime', connection: { address: 'http://test:51464' } }
        const workspace = { repositories: [{ id: 'repo', name: 'Example project' }], tasks: [{ id: 'thread', title: 'Delivery thread' }], automations: [] }
        const snapshot = { dashboardsSupported: true, studioDataSourcesSupported: true, studioExtensionsSupported: true, studioExtensionComponentVersion: 1, studioExtensionCustomPropsSupported: true, studioExtensionMarketplaceSupported: true, workspace, terminals: [] }
        const dashboards = []
        let extension
        let marketplaceEntry
        let installedMarketplace
        let stagedMarketplace
        const marketplace = ${JSON.stringify(marketplace)}
        let allowAgentInstall = false
        const runs = new Map()
        const sessions = new Map()
        let stored
        const readCache = {
          read: async () => stored ? { value: stored } : null,
          write: async (_key, value) => { stored = value },
        }
        window.calls = []
        let loseRunResponse = true
        async function request(path, input) {
          window.calls.push({ path, input })
          if (path === '/api/studio-extensions') {
            if (input.action === 'marketplace') {
              const command = input.marketplace
              if (command.action === 'list') return { packages: marketplace.map(({ package: pkg, digest }) => ({
                id: pkg.manifest.id, name: pkg.manifest.name, publisher: pkg.publisher,
                description: pkg.description, version: pkg.version, digest,
                ...(installedMarketplace?.digest === digest && { installed: installedMarketplace }),
                ...(stagedMarketplace?.digest === digest && { draft: stagedMarketplace }),
              })) }
              if (command.action === 'sources') return { servers: ['health'], apps: [] }
              const entry = marketplace.find(({ package: pkg, digest }) => pkg.manifest.id === command.id && digest === command.digest)
              if (!entry) throw Error('Package unavailable')
              if (command.action === 'read') return entry
              const manifest = entry.package.manifest
              const contributions = manifest.contributions.map((item) => {
                if (item.kind !== 'tool' && item.kind !== 'app') return item
                const binding = command.bindings.find(({ contributionId }) => item.id === contributionId)
                if (!binding) throw Error('Binding required')
                return { ...item, taskId: binding.taskId, server: binding.source }
              })
              marketplaceEntry = {
                id: manifest.id, revision: 50, enabled: false, settings: {}, canRollback: false,
                draft: { ...manifest, contributions },
              }
              stagedMarketplace = { digest: entry.digest, version: entry.package.version }
              return { extension: structuredClone(marketplaceEntry) }
            }
            if (input.action === 'list') return { extensions: [extension, marketplaceEntry].filter(Boolean).map((entry) => structuredClone(entry)), allowAgentInstall }
            if (input.id === marketplaceEntry?.id && input.action === 'install') {
              if (input.expectedRevision !== marketplaceEntry.revision) throw Error('Draft changed')
              marketplaceEntry = { ...marketplaceEntry, revision: 51, enabled: true, installed: marketplaceEntry.draft,
                settings: Object.fromEntries(marketplaceEntry.draft.settings.map(({ id, default: value }) => [id, value])), draft: undefined }
              installedMarketplace = stagedMarketplace
              stagedMarketplace = undefined
              return { extension: structuredClone(marketplaceEntry) }
            }
            if (input.action === 'agent-install-policy') {
              allowAgentInstall = input.enabled
              return { ok: true }
            }
            if (input.action === 'stage') {
              extension = { id: input.manifest.id, revision: 1, enabled: false, canRollback: false, settings: {}, draft: input.manifest }
            } else {
              if (!extension || input.expectedRevision !== extension.revision) throw Error('Extension changed')
              if (input.action === 'open') {
                return { contribution: extension.installed.contributions.find((item) => item.id === input.contributionId) }
              }
              if (input.action === 'read-data') return { data: { count: window.buildCount ?? 73, durations: [1, 4, 3] }, updatedAt: Date.now() }
              if (input.action === 'pin-page') {
                const item = extension.installed.contributions.find(({ id }) => id === input.contributionId)
                window.setExtensionPins(input.pinned
                  ? [{extensionId: extension.id, pageId: item.id, title: item.title}]
                  : [])
                return { ok: true }
              }
              if (input.action === 'call') {
                if (!extension.enabled) throw Error('Extension unavailable')
                return { data: { branch: extension.settings.branch, series: [1, 3, 2] } }
              }
              if (input.action === 'install') {
                extension = { ...extension, enabled: true, installed: extension.draft, draft: undefined, settings: { branch: 'main' } }
              } else if (input.action === 'settings') extension = { ...extension, settings: { ...extension.settings, ...input.settings } }
              else if (input.action === 'disable') extension = { ...extension, enabled: false }
              extension.revision++
            }
            return { extension: structuredClone(extension) }
          }
          if (path.endsWith('/list')) return { dashboards: dashboards.filter((item) =>
            input.dataSources || !item.tiles.some((tile) => tile.kind === 'cli' || tile.refreshSeconds || tile.panels),
          ) }
          if (path.endsWith('/save')) {
            const index = dashboards.findIndex((item) => item.id === input.dashboard.id)
            if ((dashboards[index]?.revision ?? 0) !== input.expectedRevision) throw Error('Dashboard changed')
            const dashboard = { ...input.dashboard, revision: input.expectedRevision + 1 }
            dashboards.splice(index < 0 ? dashboards.length : index, index < 0 ? 0 : 1, dashboard)
            return { dashboard }
          }
          if (path.endsWith('/session')) return { terminalId: sessions.get(input.tileId) ?? null }
          if (path.endsWith('/run')) {
            const terminalId = runs.get(input.requestId) ?? 'tty-' + (runs.size + 1)
            runs.set(input.requestId, terminalId)
            sessions.set(input.tileId, terminalId)
            if (loseRunResponse) {
              loseRunResponse = false
              throw Error('Response lost')
            }
            return { terminalId }
          }
          if (path === '/api/terminals/close') {
            for (const [tileId, terminalId] of sessions) if (terminalId === input.id) sessions.delete(tileId)
            return { ok: true }
          }
          if (path.endsWith('/command-data')) return { data: { count: 42, durations: [2, 4, 3] }, updatedAt: Date.now() }
          if (path.endsWith('/read')) return { data: window.dashboardReading ?? [3, 5, 2], updatedAt: Date.now() }
          throw Error('Unexpected request ' + path)
        }
        export function Fixture({ children }) {
          const [connected, setConnected] = useState(true)
          const [connection, setConnection] = useState(profile.connection)
          const [revision, remount] = useState(0)
          const [extensionRevision, setExtensionRevision] = useState(0)
          const [pins, setPins] = useState([])
          const liveSnapshot = React.useMemo(() => ({
            ...snapshot, studioExtensionsRevision: extensionRevision, studioExtensionPinnedPages: pins,
          }), [extensionRevision, pins])
          useEffect(() => {
            window.stageElsewhere = (name) => {
              const manifest = extension.draft ?? extension.installed
              extension = { ...extension, revision: extension.revision + 1, draft: { ...manifest, name: name ?? manifest.name } }
              setExtensionRevision(extension.revision)
            }
            window.saveElsewhere = (branch, notify) => {
              extension = { ...extension, revision: extension.revision + 1, settings: { ...extension.settings, branch } }
              if (notify) setExtensionRevision(extension.revision)
            }
            window.addTimedTileToMarketplaceDashboard = () => {
              const index = dashboards.findIndex((item) => item.title === 'Service overview')
              const dashboard = dashboards[index]
              const tile = { id: 'timed', title: 'Timed API', kind: 'api', span: 2,
                height: 1, url: 'http://metrics.test', pointer: '', chart: 'number', refreshSeconds: 30 }
              dashboards[index] = { ...dashboard, revision: dashboard.revision + 1,
                tiles: [...dashboard.tiles, tile] }
            }
            window.setExtensionPins = setPins
            window.setConnected = setConnected
            window.replacePairing = () => setConnection({ ...profile.connection })
            window.reopen = () => remount((previous) => previous + 1)
          }, [])
          return <Workspace.Provider value={{
            activeRuntimeId: profile.id, runtimes: [{ profile: { ...profile, connection }, snapshot: liveSnapshot, connected }],
            connection, request, snapshot: liveSnapshot, workspace, connected, readCache,
          }}><React.Fragment key={revision}>{children}</React.Fragment></Workspace.Provider>
        }
        export const useWorkspace = () => useContext(Workspace)
        export const WorkspaceScope = ({ children }) => children
      `,
    },
    {
      path: '../terminal/terminal-session',
      importer: fromView,
      contents:
        'export const TerminalSession = ({id, readOnly}) => <p data-read-only={readOnly}>Terminal {id}</p>',
    },
    {
      path: '../browser/browser-pane',
      importer: fromView,
      contents: 'export const BrowserPane = () => null',
    },
    {
      path: '../chat/mcp-app',
      importer: root + 'packages/extension-tasks/src/',
      contents: 'export const McpAppView = () => null',
    },
    {
      path: '@dovo/extension-runtime/remote-desktop-viewer',
      importer: fromView,
      contents: 'export const RemoteDesktopViewer = () => null',
    },
  ],
)

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
  const errors = []
  const confirmations = []
  let embedRequests = 0
  await page.route('https://dashboard-embed.invalid/', (route) => {
    embedRequests++
    return route.fulfill({ contentType: 'text/html', body: '<p>Embedded status</p>' })
  })
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('dialog', (dialog) => {
    confirmations.push(dialog.message())
    return dialog.accept()
  })
  await page.setContent('<div id="app" style="height:100dvh"></div>')
  await page.addStyleTag({ content: css })
  await page.addScriptTag({ content: bundle.outputFiles[0].text })

  const addTile = async (name) => {
    await page.getByRole('button', { name: 'Add tile', exact: true }).click()
    await page.getByRole('menuitem', { name, exact: true }).click()
  }
  const dashboardAction = async (name) => {
    await page.getByRole('button', { name: 'Dashboard actions' }).click()
    await page.getByRole('menuitem', { name, exact: true }).click()
  }

  await page.getByRole('button', { name: 'New dashboard' }).click()
  await page.getByLabel('Dashboard title').fill('Delivery')
  await addTile('HTTP data')
  await page.getByLabel('URL', { exact: true }).fill('http://builds.lan/metrics')
  await page.getByLabel('Display').selectOption('line')
  await page.getByLabel('Width').selectOption('4')
  await addTile('Command')
  assert.equal(await page.getByLabel('URL', { exact: true }).count(), 0)
  await page.getByRole('button', { name: 'HTTP data', exact: true }).click()
  assert.equal(
    await page.getByLabel('URL', { exact: true }).inputValue(),
    'http://builds.lan/metrics',
  )
  await page.getByRole('button', { name: 'Command', exact: true }).click()
  await page.getByLabel('Project').selectOption('repo')
  await page.getByLabel('Command', { exact: true }).fill('pnpm build')
  await page.getByRole('button', { name: 'Move earlier' }).last().click()
  await addTile('Iframe')
  await page.getByLabel('URL', { exact: true }).last().fill('https://dashboard-embed.invalid/')

  await page.evaluate(() => window.setConnected(false))
  await page.getByRole('status').getByText('Computer offline.', { exact: false }).waitFor()
  assert.equal(await page.getByLabel('Dashboard title').inputValue(), 'Delivery')
  await page.evaluate(() => window.setConnected(true))
  await page.getByRole('button', { name: 'Save dashboard' }).click()
  await page.getByRole('heading', { name: 'HTTP data' }).waitFor()
  assert.deepEqual(await page.locator('section h2').allTextContents(), [
    'Command',
    'HTTP data',
    'Iframe',
  ])
  const tileWidths = () =>
    page
      .locator('section')
      .evaluateAll((tiles) => tiles.map((tile) => tile.getBoundingClientRect().width))
  let [commandWidth, chartWidth] = await tileWidths()
  assert.ok(chartWidth > commandWidth * 1.9, 'The full-width tile spans twice the grid')
  await page.getByRole('button', { name: 'Expand Command' }).click()
  assert.equal((await tileWidths())[0], chartWidth)
  await page.getByRole('button', { name: 'Collapse Command' }).click()
  assert.equal((await tileWidths())[0], commandWidth)
  await page.setViewportSize({ width: 500, height: 850 })
  ;[commandWidth, chartWidth] = await tileWidths()
  assert.equal(commandWidth, chartWidth, 'Narrow screens stack full-width tiles')
  assert.equal(
    await page.evaluate(() => window.calls.filter(({ path }) => /\/(read|run)$/.test(path)).length),
    0,
  )

  assert.equal(embedRequests, 0)
  await page.getByRole('button', { name: 'Load iframe' }).click()
  await page.frameLocator('iframe[title="Iframe"]').getByText('Embedded status').waitFor()
  assert.equal(embedRequests, 1)
  assert.equal(await page.locator('iframe').getAttribute('sandbox'), 'allow-scripts allow-forms')
  await page.getByRole('button', { name: 'Close iframe' }).click()
  assert.equal(await page.locator('iframe').count(), 0)

  await page.getByRole('button', { name: 'Refresh data' }).click()
  await page.getByRole('img', { name: 'Line graph, range 2 to 5' }).waitFor()
  await page.evaluate(() => {
    window.setConnected(false)
    window.dashboardReading = [4, 6, 3]
  })
  await page.getByText(/Last result .* stale/).waitFor()
  await page.getByRole('img', { name: 'Line graph, range 2 to 5' }).waitFor()
  assert.equal(
    await page.evaluate(() => window.calls.filter(({ path }) => path.endsWith('/read')).length),
    1,
  )
  await page.evaluate(() => window.setConnected(true))
  await page.getByRole('img', { name: 'Line graph, range 3 to 6' }).waitFor()
  assert.equal(
    await page.evaluate(() => window.calls.filter(({ path }) => path.endsWith('/read')).length),
    2,
  )
  await page.evaluate(() => {
    document.hasFocus = () => false
    window.dispatchEvent(new Event('blur'))
    window.dashboardReading = [6, 8, 4]
  })
  await page.getByText(/Last result .* stale/).waitFor()
  assert.equal(
    await page.evaluate(() => window.calls.filter(({ path }) => path.endsWith('/read')).length),
    2,
  )
  await page.evaluate(() => {
    delete document.hasFocus
    window.dispatchEvent(new Event('focus'))
  })
  await page.getByRole('img', { name: 'Line graph, range 4 to 8' }).waitFor()
  assert.equal(
    await page.evaluate(() => window.calls.filter(({ path }) => path.endsWith('/read')).length),
    3,
  )
  await page.getByRole('button', { name: 'Run command' }).click()
  await page.getByRole('alert').getByText('Response lost').waitFor()
  await page.getByRole('button', { name: 'Recover run' }).click()
  await page.getByText('Terminal tty-1').waitFor()
  const calls = await page.evaluate(() => window.calls)
  const retries = calls.filter(({ path }) => path.endsWith('/run'))
  assert.equal(retries.length, 2)
  assert.equal(retries[0].input.requestId, retries[1].input.requestId)
  assert.equal(retries[0].input.expectedRevision, 1)
  await page.evaluate(() => {
    window.setConnected(false)
    window.reopen()
  })
  await page.getByRole('status').getByText('Computer offline.', { exact: false }).waitFor()
  await page.getByRole('heading', { name: 'HTTP data' }).waitFor()
  await page.getByRole('img', { name: 'Line graph, range 4 to 8' }).waitFor()
  await page.getByText(/Last result .* stale/).waitFor()
  assert.equal((await page.evaluate(() => window.calls)).length, calls.length)
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dashboardAction('Export dashboard'),
  ])
  assert.equal(download.suggestedFilename(), 'delivery.dovo-dashboard.json')
  const path = await download.path()
  const exported = JSON.parse(readFileSync(path, 'utf8'))
  assert.equal(exported.title, 'Delivery')
  assert.equal(exported.revision, 0)
  assert.equal(exported.tiles[0].repositoryId, '')
  assert.equal(exported.tiles[1].chart, 'line')

  const [picker] = await Promise.all([
    page.waitForEvent('filechooser'),
    dashboardAction('Import dashboard'),
  ])
  await picker.setFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{'),
  })
  await page
    .getByRole('alert')
    .getByText('This file does not contain valid dashboard JSON.')
    .waitFor()
  const [retryPicker] = await Promise.all([
    page.waitForEvent('filechooser'),
    dashboardAction('Import dashboard'),
  ])
  await retryPicker.setFiles(path)
  assert.equal(await page.getByLabel('Dashboard title').inputValue(), 'Delivery')
  assert.equal(await page.getByLabel('Project').inputValue(), '')
  assert.equal(await page.getByLabel('Command').inputValue(), 'pnpm build')
  assert.equal((await page.evaluate(() => window.calls)).length, calls.length)

  await page.evaluate(() => window.setConnected(true))
  await page.getByLabel('Project').selectOption('repo')
  await page.getByRole('button', { name: 'Save dashboard' }).click()
  await page.getByRole('heading', { name: 'HTTP data' }).waitFor()
  const finalCalls = await page.evaluate(() => window.calls)
  const importedSave = finalCalls.filter(({ path }) => path.endsWith('/save')).at(-1).input
  assert.equal(importedSave.expectedRevision, 0)
  assert.notEqual(importedSave.dashboard.id, exported.id)
  assert.notEqual(importedSave.dashboard.tiles[0].id, exported.tiles[0].id)
  assert.equal(importedSave.dashboard.tiles[0].repositoryId, 'repo')
  assert.equal(
    finalCalls.filter(({ path }) => /\/(read|run)$/.test(path)).length,
    calls.filter(({ path }) => /\/(read|run)$/.test(path)).length,
  )
  await page.evaluate(() => window.showExtensions(true))
  const agentInstall = page.getByRole('checkbox', {
    name: 'Allow agents to install their own extensions on this computer',
  })
  await agentInstall.waitFor()
  assert.equal(await agentInstall.isChecked(), false)
  await agentInstall.check()
  await page.waitForFunction(() =>
    window.calls.some(({ input }) => input.action === 'agent-install-policy' && input.enabled),
  )
  await agentInstall.uncheck()
  await page.waitForFunction(() =>
    window.calls.some(({ input }) => input.action === 'agent-install-policy' && !input.enabled),
  )
  await page.getByText('Add extension manifest', { exact: true }).click()
  await page.getByLabel('Extension manifest JSON').fill(
    JSON.stringify({
      id: 'example.ci',
      version: 1,
      name: 'Continuous integration',
      settings: [{ id: 'branch', title: 'Branch', default: 'main' }],
      contributions: [
        {
          id: 'status',
          kind: 'tool',
          title: 'Check service status',
          taskId: 'thread',
          server: 'ci',
          tool: 'status',
          inputs: { branch: 'branch' },
        },
        {
          id: 'metrics',
          kind: 'api',
          title: 'Build metrics',
          url: 'http://builds.lan/metrics',
          pointer: '',
          chart: 'table',
          refreshSeconds: 30,
        },
        {
          id: 'report',
          kind: 'app',
          title: 'Open delivery app',
          taskId: 'thread',
          appId: 'report',
        },
        {
          id: 'report-page',
          kind: 'view',
          placement: 'page',
          title: 'Build report',
          view: {
            version: 1,
            root: 'main',
            nodes: [
              { id: 'main', kind: 'card', children: ['metrics-refresh', 'total'] },
              { id: 'metrics-refresh', kind: 'data-source', source: 'metrics' },
              {
                id: 'total',
                kind: 'data-grid',
                value: { result: 'metrics' },
                panels: [
                  { title: 'Build count', pointer: '/count', chart: 'number' },
                  { title: 'Build time', pointer: '/durations', chart: 'line' },
                ],
              },
            ],
          },
        },
        {
          id: 'delivery-view',
          kind: 'view',
          placement: 'settings',
          title: 'Delivery overview',
          view: {
            version: 1,
            root: 'layout',
            nodes: [
              {
                id: 'layout',
                kind: 'card',
                children: [
                  'branch',
                  'run',
                  'result',
                  'trend',
                  'count',
                  'custom',
                  'unsupported',
                  'tabs',
                  'dialog',
                ],
              },
              { id: 'branch', kind: 'input', label: 'Delivery branch', setting: 'branch' },
              { id: 'run', kind: 'button', label: 'Read delivery', action: 'status' },
              { id: 'result', kind: 'status', value: { result: 'status', path: ['branch'] } },
              {
                id: 'trend',
                kind: 'chart',
                label: 'Delivery trend',
                value: { result: 'status', path: ['series'] },
              },
              {
                id: 'count',
                kind: 'metric',
                label: 'Build count',
                value: { result: 'metrics', path: ['count'] },
              },
              {
                id: 'custom',
                kind: 'custom',
                label: 'Delivery diagram',
                fallback: 'standard',
                component: {
                  type: 'diagram',
                  shapes: [{ kind: 'circle', x: 500, y: 500, radius: 200, tone: 'accent' }],
                  actions: [{ label: 'Read diagram status', action: 'status' }],
                },
              },
              { id: 'standard', kind: 'text', value: 'Standard diagram view' },
              {
                id: 'unsupported',
                kind: 'custom',
                label: 'Unknown component',
                fallback: 'backup',
                component: { type: 'future-renderer', props: { points: [1, 2, 3] } },
              },
              { id: 'backup', kind: 'text', value: 'Unknown component fallback' },
              {
                id: 'tabs',
                kind: 'tabs',
                label: 'Overview tabs',
                items: [
                  { label: 'Summary', child: 'summary' },
                  { label: 'Details', child: 'details' },
                ],
              },
              { id: 'summary', kind: 'text', value: 'Delivery summary' },
              { id: 'details', kind: 'text', value: 'Delivery details' },
              { id: 'dialog', kind: 'dialog', label: 'Help', child: 'help' },
              { id: 'help', kind: 'text', value: 'Delivery help' },
            ],
          },
        },
      ],
    }),
  )
  await page.getByRole('button', { name: 'Stage manifest' }).click()
  await page.getByRole('button', { name: 'Review draft' }).click()
  const review = page.getByRole('dialog', { name: 'Review proposed manifest' })
  await review.getByText('Continuous integration', { exact: true }).waitFor()
  await page.evaluate(() => window.stageElsewhere('Revised integration'))
  await review.getByRole('alert').filter({ hasText: 'This draft changed.' }).waitFor()
  assert.equal(await review.getByRole('button', { name: 'Install draft' }).isDisabled(), true)
  assert.equal(
    await page.evaluate(() => window.calls.some(({ input }) => input.action === 'install')),
    false,
  )
  await review.getByRole('button', { name: 'Cancel' }).click()
  await page.getByRole('button', { name: 'Review draft' }).click()
  await review.getByText('Revised integration', { exact: true }).waitFor()
  await review.getByRole('button', { name: 'Install draft' }).click()
  await page.getByText('Unknown component fallback', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Build report', exact: true }).click()
  const report = page.getByRole('heading', { name: 'Build report', exact: true })
  await report.waitFor()
  await page.getByRole('button', { name: 'Refresh data' }).click()
  await page.getByRole('region', { name: 'Build count' }).getByText('73', { exact: true }).waitFor()
  await page
    .getByRole('region', { name: 'Build time' })
    .getByRole('img', { name: 'Line graph, range 1 to 4' })
    .waitFor()
  await page.getByRole('button', { name: 'Pin to sidebar' }).click()
  const sidebar = page.getByRole('navigation', { name: 'Main navigation' })
  await sidebar.getByRole('button', { name: 'Build report' }).waitFor()
  await page.evaluate(() => {
    window.showExtensions(false)
    window.buildCount = 74
  })
  await sidebar.getByRole('button', { name: 'Build report' }).click()
  await report.waitFor()
  await page.getByRole('region', { name: 'Build count' }).getByText('74', { exact: true }).waitFor()
  await page.evaluate(() => {
    delete window.buildCount
  })
  assert.equal(
    await sidebar.getByRole('button', { name: 'Build report' }).getAttribute('aria-current'),
    'page',
  )
  await page.getByRole('button', { name: 'Unpin from sidebar' }).click()
  await sidebar.waitFor({ state: 'hidden' })
  await page.evaluate(() => window.showExtensions(true))
  await page.getByText('Unknown component fallback', { exact: true }).waitFor()
  await page.getByRole('tab', { name: 'Details' }).click()
  await page.getByRole('tabpanel').getByText('Delivery details', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Help', exact: true }).click()
  await page.getByRole('dialog', { name: 'Help' }).getByText('Delivery help').waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('dialog', { name: 'Help' }).waitFor({ state: 'hidden' })
  await page.getByRole('img', { name: 'Delivery diagram' }).waitFor()
  await page.getByRole('button', { name: 'Show Studio components' }).click()
  await page.getByText('Standard diagram view', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Show custom component' }).click()
  await page.getByRole('img', { name: 'Delivery diagram' }).waitFor()

  await page.getByLabel('Delivery branch', { exact: true }).fill('discard-me')
  await page.getByRole('button', { name: 'Discard edits' }).click()
  assert.equal(await page.getByLabel('Delivery branch').inputValue(), 'main')
  await page.getByLabel('Delivery branch', { exact: true }).fill('release')
  assert.equal(await page.getByRole('button', { name: 'Read delivery' }).isDisabled(), true)
  await page.evaluate(() => window.setConnected(false))
  await page.getByText('Computer offline.', { exact: true }).waitFor()
  assert.equal(await page.getByLabel('Delivery branch').inputValue(), 'release')
  await page.evaluate(() => window.setConnected(true))
  await page.getByRole('button', { name: 'Save extension settings' }).click()
  await page.getByRole('button', { name: 'Read diagram status' }).click()
  await page.getByText('release', { exact: true }).waitFor()
  await page.getByRole('img', { name: 'Line graph, range 1 to 3' }).waitFor()
  await page.getByRole('button', { name: 'Check service status' }).click()
  await page.getByText(/"branch": "release"/).waitFor()
  await page.getByRole('button', { name: 'Open delivery app' }).click()
  await page.getByRole('button', { name: 'Close app' }).waitFor()
  await page.getByText('Revised integration settings', { exact: true }).click()
  await page.getByLabel('Branch', { exact: true }).fill('stable')
  await page.getByLabel('Delivery branch', { exact: true }).fill('temporary')
  await page.evaluate(() => window.stageElsewhere())
  await page.getByRole('button', { name: 'Review draft' }).waitFor()
  await page.getByText(/"branch": "release"/).waitFor()
  await page.getByRole('button', { name: 'Close app' }).waitFor()
  assert.equal(await page.getByLabel('Delivery branch').inputValue(), 'temporary')
  assert.equal(await page.getByLabel('Branch', { exact: true }).inputValue(), 'stable')
  await page.getByRole('img', { name: 'Line graph, range 1 to 3' }).waitFor()
  await page.getByRole('button', { name: 'Discard edits' }).click()
  await page.getByRole('button', { name: 'Save extension settings' }).click()
  assert.equal(await page.getByLabel('Branch', { exact: true }).inputValue(), 'stable')
  await page.evaluate(() => window.showExtensions(false))
  await page.getByRole('button', { name: 'Edit dashboard' }).click()
  await addTile('Studio extension')
  await page.getByLabel('Extension contribution').selectOption('example.ci/delivery-view')
  await page.getByRole('button', { name: 'Save dashboard' }).click()
  await page.getByText('73', { exact: true }).waitFor()
  const readCountBeforeTool = await page.evaluate(
    () => window.calls.filter(({ input }) => input.action === 'read-data').length,
  )
  await page.getByRole('button', { name: 'Read delivery' }).click()
  await page.getByText('stable', { exact: true }).waitFor()
  await page.getByRole('img', { name: 'Line graph, range 1 to 3' }).waitFor()
  assert.equal(
    await page.evaluate(
      () => window.calls.filter(({ input }) => input.action === 'read-data').length,
    ),
    readCountBeforeTool,
  )
  await page.getByRole('button', { name: 'Start auto refresh (30s)' }).click()
  await page.getByText('73', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Stop auto refresh' }).click()
  const saveSettings = page.getByRole('button', { name: 'Save extension settings' })
  await page.getByLabel('Delivery branch').fill('local')
  await page.evaluate(() => window.saveElsewhere('shared', true))
  await page.getByText('Branch. Saved value: shared', { exact: true }).waitFor()
  assert.equal(await saveSettings.isDisabled(), true)
  assert.equal(await page.getByLabel('Delivery branch').inputValue(), 'local')
  await page.getByRole('button', { name: 'Use saved values' }).click()
  assert.equal(await page.getByLabel('Delivery branch').inputValue(), 'shared')
  await page.getByLabel('Delivery branch').fill('retry')
  await page.evaluate(() => window.saveElsewhere('remote', false))
  await saveSettings.click()
  await page.getByRole('alert').filter({ hasText: 'Extension changed' }).waitFor()
  await page.getByText('Branch. Saved value: remote', { exact: true }).waitFor()
  assert.equal(await page.getByLabel('Delivery branch').inputValue(), 'retry')
  assert.equal(await saveSettings.isDisabled(), true)
  await page.getByRole('button', { name: 'Keep my edits' }).click()
  await saveSettings.click()
  await page.getByRole('button', { name: 'Read delivery' }).click()
  await page.getByText('retry', { exact: true }).waitFor()
  assert.equal(
    await page.evaluate(
      () => window.calls.find(({ input }) => input.action === 'install').input.componentVersion,
    ),
    3,
  )
  await page.evaluate(() => window.showExtensions(true))
  const delivery = page
    .locator('details')
    .filter({ has: page.locator('summary').getByText('Delivery overview', { exact: true }) })
  const sourceReads = () =>
    page.evaluate(() => window.calls.filter(({ input }) => input.action === 'read-data').length)
  await page.clock.install()
  const readsBeforeStart = await sourceReads()
  await delivery.getByRole('button', { name: 'Start auto refresh (30s)' }).click()
  await delivery.getByText('73', { exact: true }).waitFor()
  assert.equal(await sourceReads(), readsBeforeStart + 1)
  await delivery.getByLabel('Delivery branch').fill('timed')
  await delivery.getByRole('button', { name: 'Save extension settings' }).click()
  await delivery.getByRole('button', { name: 'Stop auto refresh' }).waitFor()
  await delivery.getByText('73', { exact: true }).waitFor()
  const summary = delivery.locator('summary').filter({ hasText: 'Delivery overview' })
  await summary.click()
  await delivery.getByRole('button', { name: 'Stop auto refresh' }).waitFor({ state: 'hidden' })
  await page.clock.fastForward(31_000)
  assert.equal(await sourceReads(), readsBeforeStart + 1, 'Closed views pause refresh')
  await summary.click()
  await page.waitForFunction(
    (count) => window.calls.filter(({ input }) => input.action === 'read-data').length === count,
    readsBeforeStart + 2,
  )
  await delivery.getByRole('button', { name: 'Stop auto refresh' }).click()
  await page.getByRole('button', { name: 'Disable extension' }).click()
  await page.getByRole('button', { name: 'Enable extension' }).waitFor()
  await page.evaluate(() => window.showExtensions(false))
  await page.getByText('This extension contribution is unavailable.', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Read delivery' }).count(), 0)
  await page.evaluate(() => window.showExtensions(true))
  await page.getByRole('button', { name: 'Browse extension marketplace' }).click()
  await page.getByLabel('Search extensions').fill('service')
  await page.getByRole('button', { name: 'Preview Service status 1.0.0' }).click()
  const stagePackage = page.getByRole('button', { name: 'Stage package' })
  await stagePackage.waitFor()
  assert.equal(await stagePackage.isDisabled(), true)
  await page.getByLabel('Source thread for Read service status').selectOption('thread')
  await page.getByLabel('MCP server with read-only tool service_status').selectOption('health')
  await stagePackage.click()
  await page.getByRole('button', { name: 'Review staged draft' }).click()
  await page
    .getByRole('dialog', { name: 'Review proposed manifest' })
    .getByRole('button', { name: 'Install draft' })
    .click()
  await page.getByRole('button', { name: 'Add dashboard' }).click()
  await page.getByRole('button', { name: 'Open dashboards' }).waitFor()
  const installedDashboard = await page.evaluate(() =>
    window.calls.filter(
      ({ path, input }) => path.endsWith('/save') && input.dashboard.title === 'Service overview',
    ),
  )
  assert.equal(installedDashboard.length, 1)
  assert.equal(
    await page.evaluate(
      () => window.calls.findLast(({ path }) => path === '/api/dashboards/list').input.dataSources,
    ),
    true,
  )
  assert.deepEqual(
    installedDashboard[0].input.dashboard.tiles.map(({ kind, extensionId, contributionId }) => ({
      kind,
      extensionId,
      contributionId,
    })),
    [{ kind: 'extension', extensionId: 'dovo.service-status', contributionId: 'overview' }],
  )
  await page.evaluate(() => window.addTimedTileToMarketplaceDashboard())
  await page.getByRole('button', { name: 'Close marketplace' }).click()
  await page.getByRole('button', { name: 'Browse extension marketplace' }).click()
  await page.getByRole('button', { name: 'Preview Service status 1.0.0' }).click()
  await page.getByRole('button', { name: 'Add dashboard' }).click()
  await page.getByRole('button', { name: 'Open dashboards' }).waitFor()
  assert.equal(
    await page.evaluate(
      () =>
        window.calls.filter(
          ({ path, input }) =>
            path.endsWith('/save') && input.dashboard.title === 'Service overview',
        ).length,
    ),
    1,
    'The marketplace finds an installed dashboard with a timed tile',
  )
  await page.evaluate(() => window.showExtensions(false))
  await page.getByLabel('Dashboard', { exact: true }).selectOption({ label: 'Service overview' })
  await page.getByRole('button', { name: 'Read status', exact: true }).waitFor()
  await page.getByRole('button', { name: 'New dashboard' }).click()
  await page.getByLabel('Dashboard title').fill('Local metrics')
  await addTile('CLI data')
  await page.getByLabel('Project').selectOption('repo')
  await page.getByLabel('Command', { exact: true }).fill('your-cli --json')
  await page.getByLabel('Display').selectOption('number')
  await page.getByLabel('Refresh interval in seconds').fill('30')
  await page.getByRole('button', { name: 'Add display' }).click()
  await page.getByLabel('Display title').fill('Total builds')
  await page.getByLabel('JSON pointer', { exact: true }).last().fill('/count')
  await page.getByRole('button', { name: 'Add display' }).click()
  await page.getByLabel('Display title').last().fill('Build duration')
  await page.getByLabel('JSON pointer', { exact: true }).last().fill('/durations')
  await page
    .getByRole('combobox', { name: /^Display/ })
    .last()
    .selectOption('line')
  await page.getByLabel('Width').selectOption('4')
  await page.getByRole('button', { name: 'Save dashboard' }).click()
  await page.getByRole('heading', { name: 'CLI data' }).waitFor()
  const readCount = () =>
    page.evaluate(() => window.calls.filter(({ path }) => path.endsWith('/command-data')).length)
  await page.clock.fastForward(31_000)
  assert.equal(await readCount(), 0, 'Opening the dashboard never runs the command')
  const cliTile = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'CLI data' }) })
  await cliTile.getByRole('button', { name: 'Start auto refresh (30s)' }).click()
  await page
    .getByRole('region', { name: 'Total builds' })
    .getByText('42', { exact: true })
    .waitFor()
  await page
    .getByRole('region', { name: 'Build duration' })
    .getByRole('img', { name: 'Line graph, range 2 to 4' })
    .waitFor()
  assert.equal(await readCount(), 1)
  await page.setViewportSize({ width: 1200, height: 900 })
  const chartCardFits = await page
    .getByRole('region', { name: 'Build duration' })
    .evaluate((card) => {
      const tile = card.closest('section[style*="--tile-span"]')
      return card.getBoundingClientRect().bottom <= tile.getBoundingClientRect().bottom
    })
  assert.equal(chartCardFits, true, 'The chart card fits in the default full-width tile')
  await page.clock.fastForward(30_000)
  assert.equal(await readCount(), 2)
  await page.evaluate(() => window.setConnected(false))
  await page.getByRole('status').getByText('Computer offline.').waitFor()
  await page.clock.fastForward(30_000)
  assert.equal(await readCount(), 2)
  await page.evaluate(() => window.setConnected(true))
  await page.getByRole('status').getByText('Computer offline.').waitFor({ state: 'hidden' })
  await page.waitForFunction(
    () => window.calls.filter(({ path }) => path.endsWith('/command-data')).length === 3,
  )
  await page.getByRole('button', { name: 'Stop auto refresh' }).click()
  await page.clock.fastForward(30_000)
  assert.equal(await readCount(), 3)
  await page.evaluate(() => window.showExtensions(true))
  await page.getByRole('button', { name: 'Browse extension marketplace' }).waitFor()
  await page.evaluate(() => window.showExtensions(false))
  await page.getByLabel('Dashboard', { exact: true }).selectOption({ label: 'Local metrics' })
  await page
    .getByRole('region', { name: 'Total builds' })
    .getByText('42', { exact: true })
    .waitFor()
  await page.getByText(/Last result .* stale/).waitFor()
  await cliTile.getByRole('button', { name: 'Start auto refresh (30s)' }).waitFor()
  await page.clock.fastForward(30_000)
  assert.equal(
    await readCount(),
    3,
    'Reopening a CLI view restores its result without running the command',
  )
  await page.evaluate(() => window.replacePairing())
  await cliTile.getByRole('region', { name: 'Total builds' }).waitFor({ state: 'detached' })
  assert.equal(
    await readCount(),
    3,
    'A new pairing does not inherit the old result or run the CLI command',
  )
  const runCount = () =>
    page.evaluate(() => window.calls.filter(({ path }) => path === '/api/dashboards/run').length)
  const beforeTui = await runCount()
  await page.getByRole('button', { name: 'New dashboard' }).click()
  await page.getByLabel('Dashboard title').fill('Machine console')
  await addTile('TUI')
  assert.equal(await page.getByLabel('Start in', { exact: true }).inputValue(), 'dovo:scratch')
  await page.getByLabel('Startup command', { exact: true }).fill('top')
  await page.getByRole('button', { name: 'Save dashboard' }).click()
  await page.getByText('Home folder · Test runtime', { exact: true }).waitFor()
  assert.equal(await runCount(), beforeTui)
  await page.getByRole('button', { name: 'Start TUI', exact: true }).click()
  assert.equal(confirmations.at(-1), 'Start this TUI in Home folder on Test runtime?\n\ntop')
  const tui = page.getByText('Terminal tty-2', { exact: true })
  await tui.waitFor()
  assert.equal(await tui.getAttribute('data-read-only'), 'false')
  await page.evaluate(() => window.showExtensions(true))
  await page.getByRole('button', { name: 'Browse extension marketplace' }).waitFor()
  await page.evaluate(() => window.showExtensions(false))
  await page.getByLabel('Dashboard', { exact: true }).selectOption({ label: 'Machine console' })
  await tui.waitFor()
  assert.equal(
    await runCount(),
    beforeTui + 1,
    'Returning to the dashboard reattaches the live TUI',
  )
  await page.getByRole('button', { name: 'Close session' }).click()
  await tui.waitFor({ state: 'detached' })
  assert.deepEqual(errors, [])
  console.log(
    'Dashboard editor, offline draft, chart, run recovery, template export, timed CLI data and reconnect, compound data cards, and Studio extension pages and sidebar pins passed.',
  )
} finally {
  await browser.close()
}
