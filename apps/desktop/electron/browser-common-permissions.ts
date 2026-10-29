import { BrowserWindow, dialog } from 'electron'
import { browserPermissions } from './browser-permissions.js'

const labels = {
  'clipboard-read': 'read your clipboard',
  'clipboard-sanitized-write': 'write to your clipboard',
  'speaker-selection': 'select an audio output device',
  'screen-wake-lock': 'keep your screen awake',
  'idle-detection': 'detect whether you are active, idle, or have locked your device',
  'persistent-storage': 'keep website data from automatic storage cleanup',
  geolocation: 'access your precise location',
  'geolocation-approximate': 'access your approximate location',
  fileSystem: 'read or write files and folders you choose',
  'local-fonts': 'use fonts installed on this computer',
  midi: 'communicate with MIDI devices, including system-exclusive messages',
  pointerLock: 'capture your mouse pointer (press Escape to release it)',
  keyboardLock: 'capture keyboard shortcuts (hold Escape to release them)',
  'window-management': 'see your displays and position windows on them',
} as const
export const commonBrowserPermission = (permission: string): permission is keyof typeof labels =>
  Object.hasOwn(labels, permission)

// Native APIs can check again after the request callback (IdleDetector.start, for example).
// "Allow once" applies to this document, and is never persisted.
const documentGrants = new WeakMap<
  Electron.WebContents,
  {
    profileId: string
    origin: string
    frame: Electron.WebFrameMain
    permissions: Set<keyof typeof labels>
  }
>()
const generations = new WeakMap<Electron.WebContents, number>()
const tracked = new WeakSet<Electron.WebContents>()
export const revokeCommonBrowserPermissions = (contents: Electron.WebContents) => {
  documentGrants.delete(contents)
  generations.set(contents, (generations.get(contents) ?? 0) + 1)
}

export function commonBrowserPermissionAllowed(
  contents: Electron.WebContents,
  profileId: string,
  origin: string,
  permission: keyof typeof labels,
) {
  const setting = browserPermissions(profileId).site(origin).permissions[permission]
  if (setting !== 'ask') return setting === 'allow'
  const grant = documentGrants.get(contents)
  return !!(
    grant &&
    !contents.isDestroyed() &&
    grant.permissions.has(permission) &&
    grant.profileId === profileId &&
    grant.origin === origin &&
    grant.frame === contents.mainFrame
  )
}

const pending = new WeakMap<
  Electron.WebContents,
  { permission: string; promise: Promise<boolean> }
>()

/** One native prompt per tab; repeated requests share its answer. */
export function requestCommonBrowserPermission(
  contents: Electron.WebContents,
  profileId: string,
  origin: string,
  permission: keyof typeof labels,
  windowId?: number,
  file?: { filePath?: string; fileAccessType?: string; isDirectory?: boolean },
): Promise<boolean> {
  browserPermissions(profileId).recordRequest(origin, permission)
  const current = pending.get(contents)
  if (current) return current.permission === permission ? current.promise : Promise.resolve(false)
  const promise = request(contents, profileId, origin, permission, windowId, file).finally(() =>
    pending.delete(contents),
  )
  pending.set(contents, { permission, promise })
  return promise
}

/** Native Chromium APIs retain their own secure-context, focus and activation requirements. */
async function request(
  contents: Electron.WebContents,
  profileId: string,
  origin: string,
  permission: keyof typeof labels,
  windowId?: number,
  file?: { filePath?: string; fileAccessType?: string; isDirectory?: boolean },
) {
  const permissions = browserPermissions(profileId)
  const setting = permissions.site(origin).permissions[permission]
  if (setting !== 'ask') return setting === 'allow'
  if (commonBrowserPermissionAllowed(contents, profileId, origin, permission)) return true
  const frame = contents.mainFrame
  const generation = generations.get(contents) ?? 0
  let navigated = false
  const onNavigate = () => {
    navigated = true
  }
  contents.on('did-navigate', onNavigate)
  try {
    const owner =
      windowId === undefined
        ? BrowserWindow.fromWebContents(contents)
        : BrowserWindow.fromId(windowId)
    const options: Electron.MessageBoxOptions = {
      type: 'question',
      title: 'Website permission',
      message: `${origin} wants to ${labels[permission]}.`,
      ...(file?.filePath
        ? {
            detail: `${file.isDirectory ? 'Folder' : 'File'}: ${file.filePath}\nAccess: ${file.fileAccessType ?? 'read/write'}`,
          }
        : {}),
      buttons: ['Allow once', 'Always allow', 'Block'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    }
    const { response } = await (owner
      ? dialog.showMessageBox(owner, options)
      : dialog.showMessageBox(options))
    if (
      navigated ||
      (generations.get(contents) ?? 0) !== generation ||
      contents.isDestroyed() ||
      contents.mainFrame !== frame ||
      new URL(frame.url).origin !== origin
    )
      return false
    // A permission changed through website controls while the dialog was open takes precedence.
    const latest = permissions.site(origin).permissions[permission]
    if (latest !== 'ask') return latest === 'allow'
    if (response === 1 || response === 2)
      permissions.setSite(origin, permission, response === 1 ? 'allow' : 'block')
    if (response === 0) {
      if (!tracked.has(contents)) {
        tracked.add(contents)
        const clear = () => revokeCommonBrowserPermissions(contents)
        contents.on('did-navigate', clear)
        contents.once('destroyed', clear)
      }
      const previous = documentGrants.get(contents)
      const permissions = new Set(
        previous?.profileId === profileId && previous.origin === origin && previous.frame === frame
          ? previous.permissions
          : [],
      )
      permissions.add(permission)
      documentGrants.set(contents, { profileId, origin, frame, permissions })
    }
    return response === 0 || response === 1
  } finally {
    contents.removeListener('did-navigate', onNavigate)
  }
}
