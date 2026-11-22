import { expect, it } from 'vite-plus/test'
import { randomUUID } from '@dovo/protocol'
import {
  dashboardDataRows,
  dashboardLinePlot,
  dashboardTemplate,
  dashboardTemplateFilename,
  maxDashboardTemplateBytes,
  importDashboardTemplate,
  moveDashboardTile,
  newDashboardTile,
} from './dashboards'

it('keeps dashboard templates portable and gives copied tiles new identities', () => {
  const command = {
    ...newDashboardTile('command'),
    kind: 'command' as const,
    repositoryId: 'project',
    command: 'pnpm build',
  }
  const terminal = {
    ...newDashboardTile('terminal'),
    kind: 'terminal' as const,
    terminalId: 'session',
  }
  const dashboard = { id: randomUUID(), title: 'Delivery', revision: 3, tiles: [command, terminal] }
  const imported = importDashboardTemplate(dashboardTemplate(dashboard))
  expect(imported.id).not.toBe(dashboard.id)
  expect(imported.revision).toBe(0)
  expect(imported.tiles[0]).toMatchObject({ repositoryId: '', command: 'pnpm build' })
  expect(imported.tiles[1]).toMatchObject({ terminalId: '' })
  expect(imported.tiles[0]?.id).not.toBe(command.id)
  expect(moveDashboardTile(imported.tiles, 1, -1).map((tile) => tile.kind)).toEqual([
    'terminal',
    'command',
  ])
})

it('keeps source fields in a stable order and renders finite chart coordinates', () => {
  expect(dashboardDataRows([{ status: 'ok' }, { count: 2, status: 'failed' }])).toEqual({
    columns: ['status', 'count'],
    rows: [
      ['ok', ''],
      ['failed', '2'],
    ],
  })
  expect(dashboardLinePlot([1])).toBeNull()
  expect(dashboardLinePlot([-Number.MAX_VALUE, { value: Number.MAX_VALUE }])?.points).toBe(
    '5,115 315,5',
  )
})

it('rebinds imported local references and handles UTF-8 template files', () => {
  const terminal = {
    ...newDashboardTile('terminal'),
    kind: 'terminal' as const,
    terminalId: 'local-shell',
  }
  const dashboard = {
    id: randomUUID(),
    title: 'Équipe / livraison',
    revision: 9,
    tiles: [terminal],
  }
  const imported = importDashboardTemplate('\uFEFF' + JSON.stringify(dashboard))
  expect(imported.tiles[0]).toMatchObject({ terminalId: '' })
  expect(imported.title).toBe(dashboard.title)
  expect(dashboardTemplateFilename(dashboard.title)).toBe('equipe-livraison.dovo-dashboard.json')
  expect(dashboardTemplateFilename('///')).toBe('dashboard.dovo-dashboard.json')
  expect(dashboardTemplateFilename('CON')).toBe('dashboard-con.dovo-dashboard.json')
  expect(() => importDashboardTemplate('é'.repeat(maxDashboardTemplateBytes / 2 + 1))).toThrow(
    '1 MB',
  )
  expect(() => importDashboardTemplate('{')).toThrow('valid dashboard JSON')
})
