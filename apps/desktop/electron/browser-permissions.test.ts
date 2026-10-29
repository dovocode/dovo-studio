import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test'
import { mkdtemp, rm, readdir, mkdir, writeFile } from 'node:fs/promises'
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
  permissions.setSite('https://meet.example', 'idle-detection', 'allow')
  expect(browserPermissions(id).media('https://meet.example')).toEqual({ audio: true, video: true })
  expect(browserPermissions(id).site('https://meet.example').permissions['idle-detection']).toBe(
    'allow',
  )
  expect(await readdir(state.root)).toEqual([])
  forgetPrivateBrowserPermissions(id)
  expect(browserPermissions(id).media('https://meet.example')).toBeUndefined()
  expect(browserPermissions(id).site('https://meet.example').permissions['idle-detection']).toBe(
    'ask',
  )
})

it('resets legacy grants to ask and blocks each device without affecting another origin or profile', () => {
  const origin = 'https://meet.example'
  const permissions = browserPermissions('work')
  permissions.allowMedia(origin, { audio: true, video: true })
  permissions.setNotification(origin, true)
  permissions.setSite(origin, 'camera', 'block')
  expect(browserPermissions('work').site(origin).permissions).toMatchObject({
    notifications: 'allow',
    microphone: 'allow',
    camera: 'block',
  })
  expect(permissions.media(origin)).toEqual({ audio: true, video: false })
  permissions.setSite(origin, 'microphone', 'ask')
  permissions.setSite(origin, 'notifications', 'ask')
  expect(permissions.notification(origin)).toBeUndefined()
  expect(permissions.media(origin)).toEqual({ audio: false, video: false })
  expect(browserPermissions('personal').site(origin).permissions).toMatchObject({
    notifications: 'ask',
    microphone: 'ask',
    camera: 'ask',
  })
  expect(permissions.site('http://lan.example:3000').permissions).toMatchObject({
    notifications: 'ask',
    microphone: 'ask',
    camera: 'ask',
  })
  permissions.allowMedia(origin, { audio: false, video: true })
  expect(permissions.site(origin).permissions.camera).toBe('allow')
  expect(permissions.site(origin).permissions.microphone).toBe('ask')
})

it('persists common API settings by origin and profile with explicit automatic PiP opt-in', () => {
  const origin = 'https://teams.microsoft.com'
  const work = browserPermissions('work')
  expect(work.site(origin).permissions['automatic-pip']).toBe('block')
  expect(work.site(origin).permissions['screen-wake-lock']).toBe('allow')
  expect(work.site(origin).permissions['idle-detection']).toBe('ask')
  work.setSite(origin, 'idle-detection', 'allow')
  work.setSite(origin, 'clipboard-read', 'block')
  work.setSite(origin, 'automatic-pip', 'allow')
  expect(browserPermissions('work').site(origin).permissions['clipboard-read']).toBe('block')
  expect(browserPermissions('work').site(origin).permissions['automatic-pip']).toBe('allow')
  expect(browserPermissions('personal').site(origin).permissions['automatic-pip']).toBe('block')
  expect(work.site('https://other.example').permissions['clipboard-read']).toBe('ask')
  expect(browserPermissions('work').site(origin).permissions['idle-detection']).toBe('allow')
  expect(browserPermissions('personal').site(origin).permissions['idle-detection']).toBe('ask')
  expect(work.site('https://other.example').permissions['idle-detection']).toBe('ask')
})

it('records actual requests without turning defaults into requested permissions', () => {
  const origin = 'http://lan.example:3000'
  const work = browserPermissions('work')
  expect(work.site(origin).requested).toEqual([])
  expect(work.site(origin).permissions['screen-wake-lock']).toBe('allow')
  work.recordRequest(origin, 'microphone', 'clipboard-read')
  work.recordRequest(origin, 'microphone')
  expect(browserPermissions('work').site(origin).requested).toEqual([
    'microphone',
    'clipboard-read',
  ])
  expect(work.site(origin).permissions.microphone).toBe('ask')
  work.setSite(origin, 'microphone', 'block')
  work.setSite(origin, 'microphone', 'ask')
  expect(work.site(origin).requested).toEqual(['microphone', 'clipboard-read'])
  expect(work.site('https://other.example').requested).toEqual([])
  expect(browserPermissions('personal').site(origin).requested).toEqual([])
})

it('keeps existing site choices and legacy grants visible without exposing unused defaults', async () => {
  const origin = 'https://meet.example'
  await mkdir(join(state.root, 'browser-permissions'))
  await writeFile(
    join(state.root, 'browser-permissions', 'work.json'),
    JSON.stringify({
      helpers: [],
      notifications: { [origin]: false },
      media: { [origin]: { audio: true, video: false } },
      sites: { [origin]: { geolocation: 'block' } },
      devices: { [origin]: ['usb:remembered-device'] },
    }),
  )
  expect(browserPermissions('work').site(origin).requested).toEqual([
    'notifications',
    'microphone',
    'geolocation',
    'usb',
  ])
})

it('forgets private request history on close without writing to disk', async () => {
  const id = 'private-00000000-0000-4000-8000-000000000002'
  const origin = 'https://meet.example'
  browserPermissions(id).recordRequest(origin, 'camera')
  expect(browserPermissions(id).site(origin).requested).toEqual(['camera'])
  expect(await readdir(state.root)).toEqual([])
  forgetPrivateBrowserPermissions(id)
  expect(browserPermissions(id).site(origin).requested).toEqual([])
})
