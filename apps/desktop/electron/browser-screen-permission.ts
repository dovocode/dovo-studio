import { app, BrowserWindow, dialog, shell, systemPreferences } from 'electron'

/** macOS owns the permission prompt. Explain it in front of Studio before requesting access. */
export async function prepareScreenRecording(windowId: number, origin: string) {
  if (process.platform !== 'darwin') return true
  const status = systemPreferences.getMediaAccessStatus('screen')
  if (status === 'granted') return true
  const parent = BrowserWindow.fromId(windowId)
  app.focus({ steal: true })
  if (parent && !parent.isDestroyed()) {
    parent.show()
    parent.focus()
  }
  const first = status === 'not-determined'
  const options: Electron.MessageBoxOptions = {
    type: 'info',
    title: 'Allow screen recording in macOS',
    message: first ? 'Allow Dovo to share windows and screens' : 'Screen recording is off for Dovo',
    detail: `${origin} is asking to share. ${
      first
        ? 'Next, macOS will ask for Screen & System Audio Recording permission. Allow Dovo Studio to share windows or screens.'
        : 'Open System Settings → Privacy & Security → Screen & System Audio Recording and enable Dovo Studio. macOS may require you to reopen Dovo. Then start sharing again.'
    }\n\nTabs and threads can be shared without this macOS permission. You still choose the source in Dovo before anything is shared.`,
    buttons: [
      first ? 'Continue to macOS permission' : 'Open System Settings',
      'Use tabs or threads',
    ],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  }
  const { response } = await (parent && !parent.isDestroyed()
    ? dialog.showMessageBox(parent, options)
    : dialog.showMessageBox(options))
  if (response !== 0) return false
  if (first) {
    app.focus({ steal: true })
    return true
  }
  await shell.openExternal(
    'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  )
  return false
}
