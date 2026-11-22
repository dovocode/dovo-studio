import { expect, it } from 'vite-plus/test'
import { decodeResult } from '../shared/schema.js'
import { dashboardReadRequestSchema, dashboardSchema, dashboardTileSchema } from './dashboards.js'

const tile = {
  id: '280d90f5-7152-4631-9874-a6f40d88f709',
  kind: 'api',
  title: 'Build duration',
  span: 2,
  height: 2,
  url: 'http://builds.lan/api/v1',
  pointer: '/duration',
  chart: 'line',
}
const dashboard = {
  id: '6be5a47b-47b8-46be-a76e-0f0056e3347a',
  title: 'Delivery',
  revision: 1,
  tiles: [tile],
}

it('allows LAN HTTP dashboards and rejects executable or credential-bearing URLs', () => {
  expect(decodeResult(dashboardSchema, dashboard).success).toBe(true)
  for (const url of [
    'javascript:alert(1)',
    'file:///opt/app',
    'http://user:password@lan/',
    'http:builds.lan/api/v1',
  ])
    expect(decodeResult(dashboardTileSchema, { ...tile, url }).success).toBe(false)
})

it('requires a current revision and rejects duplicate IDs and unknown tile settings', () => {
  expect(
    decodeResult(dashboardReadRequestSchema, { id: dashboard.id, tileId: tile.id }).success,
  ).toBe(false)
  expect(decodeResult(dashboardSchema, { ...dashboard, tiles: [tile, tile] }).success).toBe(false)
  expect(decodeResult(dashboardTileSchema, { ...tile, autoRun: true }).success).toBe(false)
  expect(decodeResult(dashboardTileSchema, { ...tile, span: 5 }).success).toBe(false)
})

it('accepts timed API and CLI sources while keeping refresh optional', () => {
  expect(decodeResult(dashboardTileSchema, { ...tile, refreshSeconds: 60 }).success).toBe(true)
  for (const refreshSeconds of [0, 29, 30.5, 86401, '60'])
    expect(decodeResult(dashboardTileSchema, { ...tile, refreshSeconds }).success).toBe(false)
  const { url: _url, ...fields } = tile
  expect(
    decodeResult(dashboardTileSchema, {
      ...fields,
      kind: 'cli',
      chart: 'number',
      command: 'your-cli --json',
      repositoryId: 'repo',
      refreshSeconds: 30,
    }).success,
  ).toBe(true)
})
