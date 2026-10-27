import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test'
import { mkdtemp, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const state = vi.hoisted(() => ({ root: '' }))
vi.mock('electron', () => ({ app: { getPath: () => state.root } }))
import { browserPermissions, forgetPrivateBrowserPermissions } from './browser-permissions'
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

it('persists device grants independently and preserves helper and notification approvals', () => {
  const work = browserPermissions('work')
  const origin = 'https://teams.microsoft.com'
  work.allowHelper('extension:host:/Applications/helper')
  work.setNotification(origin, true)
  work.allowMedia(origin, { audio: true, video: false })
  expect(browserPermissions('work').media(origin)).toEqual({ audio: true, video: false })
  work.allowMedia(origin, { audio: false, video: true })
  expect(browserPermissions('work').media(origin)).toEqual({ audio: true, video: true })
  expect(browserPermissions('personal').media(origin)).toBeUndefined()
  expect(work.media('https://other.example')).toBeUndefined()
  expect(work.helper('extension:host:/Applications/helper')).toBe(true)
  expect(work.notification(origin)).toBe(true)
})

it('keeps private approvals in memory and discards them on close', async () => {
  const id = 'private-00000000-0000-4000-8000-000000000001'
  const permissions = browserPermissions(id)
  permissions.allowMedia('https://meet.example', { audio: true, video: true })
  permissions.setNotification('https://meet.example', true)
  expect(browserPermissions(id).media('https://meet.example')).toEqual({ audio: true, video: true })
  expect(await readdir(state.root)).toEqual([])
  forgetPrivateBrowserPermissions(id)
  expect(browserPermissions(id).media('https://meet.example')).toBeUndefined()
})

it('resets legacy grants to ask and blocks each device without affecting another origin or profile', () => {
  const origin = 'https://meet.example'
  const permissions = browserPermissions('work')
  permissions.allowMedia(origin, { audio: true, video: true })
  permissions.setNotification(origin, true)
  permissions.setSite(origin, 'camera', 'block')
  expect(browserPermissions('work').site(origin).permissions).toEqual({
    notifications: 'allow',
    microphone: 'allow',
    camera: 'block',
  })
  expect(permissions.media(origin)).toEqual({ audio: true, video: false })
  permissions.setSite(origin, 'microphone', 'ask')
  permissions.setSite(origin, 'notifications', 'ask')
  expect(permissions.notification(origin)).toBeUndefined()
  expect(permissions.media(origin)).toEqual({ audio: false, video: false })
  expect(browserPermissions('personal').site(origin).permissions).toEqual({
    notifications: 'ask',
    microphone: 'ask',
    camera: 'ask',
  })
  expect(permissions.site('http://lan.example:3000').permissions).toEqual({
    notifications: 'ask',
    microphone: 'ask',
    camera: 'ask',
  })
  permissions.allowMedia(origin, { audio: false, video: true })
  expect(permissions.site(origin).permissions.camera).toBe('allow')
  expect(permissions.site(origin).permissions.microphone).toBe('ask')
})
