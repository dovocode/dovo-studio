import type { BrowserWindow } from 'electron'

/** Extension actions are transient, including when focus moves outside Studio. */
export function dismissExtensionPopupOnBlur(popup: BrowserWindow, parent: BrowserWindow) {
  const popupContents = popup.webContents
  const parentContents = parent.webContents
  const dismiss = () => {
    if (!popup.isDestroyed()) popup.destroy()
  }
  const escape = (event: Electron.Event, input: Electron.Input) => {
    if (input.type !== 'keyDown' || input.key !== 'Escape') return
    event.preventDefault()
    dismiss()
  }
  popup.on('blur', dismiss)
  parent.on('focus', dismiss)
  parent.on('hide', dismiss)
  parent.on('minimize', dismiss)
  popupContents.on('before-input-event', escape)
  parentContents.on('before-input-event', escape)
  popup.once('closed', () => {
    popup.off('blur', dismiss)
    parent.off('focus', dismiss)
    parent.off('hide', dismiss)
    parent.off('minimize', dismiss)
    if (!popupContents.isDestroyed()) popupContents.off('before-input-event', escape)
    if (!parentContents.isDestroyed()) parentContents.off('before-input-event', escape)
  })
}
