import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const state = vi.hoisted(() => ({ root: '' }))
vi.mock('electron', () => ({ app: { getPath: () => state.root } }))
import { browserPermissions } from './browser-permissions'
beforeEach(async () => {
  state.root = await mkdtemp(join(tmpdir(), 'browser-permissions-'))
})
afterEach(async () => {
  await rm(state.root, { recursive: true, force: true })
})
it('remembers explicit website answers across reloads, isolated by origin and profile', () => {
  const work = browserPermissions('work')
  expect(work.notification('https://teams.microsoft.com')).toBeUndefined()
  work.setNotification('https://teams.microsoft.com', true)
  expect(browserPermissions('work').notification('https://teams.microsoft.com')).toBe(true)
  expect(work.notification('https://unrelated.example')).toBeUndefined()
  expect(browserPermissions('personal').notification('https://teams.microsoft.com')).toBeUndefined()
  work.setNotification('https://teams.microsoft.com', false)
  expect(browserPermissions('work').notification('https://teams.microsoft.com')).toBe(false)
})
it('retains helper consent for the exact extension, host and executable until removal', () => {
  const key = 'extension:com.1password.helper:/Applications/helper'
  const work = browserPermissions('work')
  work.allowHelper(key)
  work.setNotification('http://lan.example:3000', true)
  expect(browserPermissions('work').helper(key)).toBe(true)
  expect(work.helper(key + '-changed')).toBe(false)
  expect(browserPermissions('personal').helper(key)).toBe(false)
  work.revokeHelpers('extension')
  expect(browserPermissions('work').helper(key)).toBe(false)
  expect(work.notification('http://lan.example:3000')).toBe(true)
})
