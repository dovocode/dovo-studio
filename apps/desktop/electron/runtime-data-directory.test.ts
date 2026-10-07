import { expect, it } from 'vite-plus/test'
import { join } from 'node:path'
import { desktopDataRoot } from './runtime-data-directory'

it('isolates development data from packaged workspaces', () => {
  expect(desktopDataRoot('/home/test', false)).toBe(join('/home/test', '.dovo-dev'))
  expect(desktopDataRoot('/home/test', true)).toBe(join('/home/test', '.dovo'))
})
