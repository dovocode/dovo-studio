import { BrowserWindow, dialog, webContents } from 'electron'
import type { MediaHost } from './browser-media.js'
import { browserPermissions } from './browser-permissions.js'
import { openBrowserDeviceChooser, type BrowserDeviceChooser } from './browser-device-chooser.js'

export type BrowserDeviceKind = 'usb' | 'hid' | 'serial'
type Device = Electron.USBDevice | Electron.HIDDevice | Electron.SerialPort
export const browserDevicePermission = (value: string): value is BrowserDeviceKind =>
  value === 'usb' || value === 'hid' || value === 'serial'
const originOf = (value: string) => {
  try {
    const url = new URL(value)
    return /^https?:$/.test(url.protocol) ? url.origin : undefined
  } catch {
    return undefined
  }
}
const idOf = (device: Device) => ('portId' in device ? device.portId : device.deviceId)
export function browserDeviceKey(kind: BrowserDeviceKind, device: Device, persistent = false) {
  const serial = device.serialNumber
  if (persistent && !serial) return undefined
  return (
    kind +
    ':' +
    JSON.stringify(
      serial
        ? [
            device.vendorId,
            device.productId,
            serial,
            'portName' in device ? device.portName : 'guid' in device ? device.guid : '',
          ]
        : [idOf(device)],
    )
  )
}
const labelOf = (device: Device) =>
  'portName' in device
    ? `${device.displayName || device.portName} (${device.portName})`
    : 'name' in device
      ? device.name || `HID ${device.vendorId}:${device.productId}`
      : device.productName || `USB ${device.vendorId}:${device.productId}`

/** Access is granted only to explicitly chosen devices, never to all devices at an origin. */
export function createBrowserDevices(host: MediaHost) {
  const sessions = new WeakSet<Electron.Session>()
  const grants = new WeakMap<
    Electron.WebContents,
    { frame: Electron.WebFrameMain; keys: Set<string> }
  >()
  const generations = new WeakMap<Electron.WebContents, number>()
  const pending = new Map<
    Electron.WebContents,
    {
      chooser: BrowserDeviceChooser
      update?: (devices: Electron.BluetoothDevice[]) => void
    }
  >()
  const owned = (contents: Electron.WebContents, profileId: string) =>
    !contents.isDestroyed() && host.tabFor(contents)?.profileId === profileId
  const parent = (contents: Electron.WebContents) => {
    const tab = host.tabFor(contents)
    return tab ? (BrowserWindow.fromId(tab.windowId) ?? undefined) : undefined
  }
  const forget = (contents: Electron.WebContents) => {
    generations.set(contents, (generations.get(contents) ?? 0) + 1)
    pending.get(contents)?.chooser.close()
    pending.delete(contents)
    grants.delete(contents)
  }
  const select = async (
    contents: Electron.WebContents,
    profileId: string,
    kind: BrowserDeviceKind,
    initial: Device[],
    watch: (update: (device: Device, removed: boolean) => void) => () => void,
  ) => {
    const origin = originOf(contents.mainFrame.url)
    if (owned(contents, profileId) && origin)
      browserPermissions(profileId).recordRequest(origin, kind)
    if (
      !owned(contents, profileId) ||
      !origin ||
      browserPermissions(profileId).site(origin).permissions[kind] === 'block'
    )
      return
    if (pending.has(contents)) return
    const frame = contents.mainFrame
    const generation = generations.get(contents) ?? 0
    const devices = new Map(initial.map((device) => [idOf(device), device]))
    const choices = () =>
      [...devices.values()].map((device) => ({
        id: idOf(device),
        label: labelOf(device),
        remember: !!browserDeviceKey(kind, device, true),
      }))
    const chooser = openBrowserDeviceChooser({
      parent: parent(contents),
      title: `Connect ${kind.toUpperCase()} device`,
      message: `${origin} wants to connect to a device you choose.`,
      devices: choices(),
    })
    const stop = watch((device, removed) => {
      if (removed) devices.delete(idOf(device))
      else devices.set(idOf(device), device)
      chooser.update(choices())
    })
    pending.set(contents, { chooser })
    try {
      const choice = await chooser.answer
      const device = choice && devices.get(choice.id)
      if (
        !choice ||
        !device ||
        !owned(contents, profileId) ||
        (generations.get(contents) ?? 0) !== generation ||
        contents.mainFrame !== frame ||
        originOf(frame.url) !== origin ||
        browserPermissions(profileId).site(origin).permissions[kind] === 'block'
      )
        return
      const key = browserDeviceKey(kind, device)
      if (!key) return
      const previous = grants.get(contents)
      const keys = previous?.frame === frame ? previous.keys : new Set<string>()
      keys.add(key)
      grants.set(contents, { frame, keys })
      const persistentKey = choice.remember && browserDeviceKey(kind, device, true)
      if (persistentKey) browserPermissions(profileId).setDevice(origin, persistentKey, true)
      return choice.id
    } finally {
      stop()
      if (pending.get(contents)?.chooser === chooser) pending.delete(contents)
    }
  }
  return {
    revokeSite(profileId: string, origin: string) {
      for (const tab of host.tabs())
        if (
          tab.profileId === profileId &&
          !tab.contents.isDestroyed() &&
          originOf(tab.contents.mainFrame.url) === origin
        )
          forget(tab.contents)
    },
    releaseTab: forget,
    attachSession(session: Electron.Session, profileId: string) {
      if (sessions.has(session)) return
      sessions.add(session)
      session.setDevicePermissionHandler(({ deviceType, origin, device }) => {
        const site = originOf(origin)
        if (!site || browserPermissions(profileId).site(site).permissions[deviceType] === 'block')
          return false
        const key = browserDeviceKey(deviceType, device)
        const persistentKey = browserDeviceKey(deviceType, device, true)
        return (
          !!(persistentKey && browserPermissions(profileId).device(site, persistentKey)) ||
          host
            .tabs()
            .some(
              (tab) =>
                tab.profileId === profileId &&
                !tab.contents.isDestroyed() &&
                originOf(tab.contents.mainFrame.url) === site &&
                grants.get(tab.contents)?.frame === tab.contents.mainFrame &&
                !!key &&
                grants.get(tab.contents)?.keys.has(key),
            )
        )
      })
      session.on('select-usb-device', (event, details, callback) => {
        event.preventDefault()
        const contents = details.frame && webContents.fromFrame(details.frame)
        if (!contents || details.frame !== contents.mainFrame) return callback()
        void select(contents, profileId, 'usb', details.deviceList, (update) => {
          const added = (
            _event: Electron.Event,
            device: Electron.USBDevice,
            source: Electron.WebContents,
          ) => {
            if (source === contents) update(device, false)
          }
          const removed = (
            _event: Electron.Event,
            device: Electron.USBDevice,
            source: Electron.WebContents,
          ) => {
            if (source === contents) update(device, true)
          }
          session.on('usb-device-added', added)
          session.on('usb-device-removed', removed)
          return () => {
            session.off('usb-device-added', added)
            session.off('usb-device-removed', removed)
          }
        }).then(callback, (error: unknown) => {
          console.error('USB selection failed.', error)
          callback()
        })
      })
      session.on('select-hid-device', (event, details, callback) => {
        event.preventDefault()
        const contents = details.frame && webContents.fromFrame(details.frame)
        if (!contents || details.frame !== contents.mainFrame) return callback()
        void select(contents, profileId, 'hid', details.deviceList, (update) => {
          const added = (_event: Electron.Event, detail: Electron.HidDeviceAddedDetails) => {
            if (detail.frame === details.frame) update(detail.device, false)
          }
          const removed = (_event: Electron.Event, detail: Electron.HidDeviceRemovedDetails) => {
            if (detail.frame === details.frame) update(detail.device, true)
          }
          session.on('hid-device-added', added)
          session.on('hid-device-removed', removed)
          return () => {
            session.off('hid-device-added', added)
            session.off('hid-device-removed', removed)
          }
        }).then(callback, (error: unknown) => {
          console.error('HID selection failed.', error)
          callback()
        })
      })
      session.on('select-serial-port', (event, ports, contents, callback) => {
        event.preventDefault()
        void select(contents, profileId, 'serial', ports, (update) => {
          const added = (
            _event: Electron.Event,
            port: Electron.SerialPort,
            source: Electron.WebContents,
          ) => {
            if (source === contents) update(port, false)
          }
          const removed = (
            _event: Electron.Event,
            port: Electron.SerialPort,
            source: Electron.WebContents,
          ) => {
            if (source === contents) update(port, true)
          }
          session.on('serial-port-added', added)
          session.on('serial-port-removed', removed)
          return () => {
            session.off('serial-port-added', added)
            session.off('serial-port-removed', removed)
          }
        }).then(
          (id) => callback(id ?? ''),
          (error: unknown) => {
            console.error('Serial selection failed.', error)
            callback('')
          },
        )
      })
      const revoked = (kind: BrowserDeviceKind, rawOrigin: string, device: Device) => {
        const origin = originOf(rawOrigin)
        if (!origin) return
        const persistentKey = browserDeviceKey(kind, device, true)
        if (persistentKey) browserPermissions(profileId).setDevice(origin, persistentKey, false)
        const key = browserDeviceKey(kind, device)
        for (const tab of host.tabs())
          if (
            tab.profileId === profileId &&
            !tab.contents.isDestroyed() &&
            originOf(tab.contents.mainFrame.url) === origin &&
            key
          )
            grants.get(tab.contents)?.keys.delete(key)
      }
      session.on('usb-device-revoked', (_event, details) => {
        if (details.origin) revoked('usb', details.origin, details.device)
      })
      session.on('hid-device-revoked', (_event, details) => {
        if (details.origin) revoked('hid', details.origin, details.device)
      })
      session.on('serial-port-revoked', (_event, details) =>
        revoked('serial', details.origin, details.port),
      )
      session.setBluetoothPairingHandler((details, callback) => {
        const frame = details.frame
        const contents = frame && webContents.fromFrame(frame)
        const origin = frame && originOf(frame.url)
        if (
          !contents ||
          !origin ||
          frame !== contents.mainFrame ||
          !owned(contents, profileId) ||
          browserPermissions(profileId).site(origin).permissions.bluetooth === 'block'
        )
          return callback({ confirmed: false })
        const generation = generations.get(contents) ?? 0
        const valid = () =>
          (generations.get(contents) ?? 0) === generation &&
          owned(contents, profileId) &&
          contents.mainFrame === frame &&
          originOf(frame.url) === origin &&
          browserPermissions(profileId).site(origin).permissions.bluetooth !== 'block'
        if (details.pairingKind === 'providePin') {
          if (pending.has(contents)) return callback({ confirmed: false })
          const chooser = openBrowserDeviceChooser({
            parent: parent(contents),
            title: 'Bluetooth pairing',
            message: `${origin}: enter the PIN for ${details.deviceId}.`,
            devices: [],
            input: true,
          })
          pending.set(contents, { chooser })
          void chooser.answer.then((answer) => {
            if (pending.get(contents)?.chooser === chooser) pending.delete(contents)
            callback({ confirmed: !!answer && valid(), pin: answer?.id })
          })
        } else {
          const options: Electron.MessageBoxOptions = {
            type: 'question',
            title: 'Bluetooth pairing',
            message: `${origin}: pair with ${details.deviceId}?${details.pin ? ` Confirm PIN ${details.pin}.` : ''}`,
            buttons: ['Pair', 'Cancel'],
            defaultId: 1,
            cancelId: 1,
          }
          const owner = parent(contents)
          void (
            owner ? dialog.showMessageBox(owner, options) : dialog.showMessageBox(options)
          ).then(
            ({ response }) => callback({ confirmed: response === 0 && valid() }),
            () => callback({ confirmed: false }),
          )
        }
      })
    },
    attachTab(contents: Electron.WebContents) {
      contents.on('did-navigate', () => forget(contents))
      contents.once('destroyed', () => forget(contents))
      contents.on('render-process-gone', () => forget(contents))
      contents.on('select-bluetooth-device', (event, devices, callback) => {
        event.preventDefault()
        const tab = host.tabFor(contents)
        const origin = originOf(contents.mainFrame.url)
        if (tab && origin) browserPermissions(tab.profileId).recordRequest(origin, 'bluetooth')
        if (
          !tab ||
          !origin ||
          browserPermissions(tab.profileId).site(origin).permissions.bluetooth === 'block'
        )
          return callback('')
        const waiting = pending.get(contents)
        if (waiting) {
          if (waiting.update) waiting.update(devices)
          else callback('')
          return
        }
        const frame = contents.mainFrame
        const generation = generations.get(contents) ?? 0
        let latest = devices
        const choices = () =>
          latest.map((device) => ({
            id: device.deviceId,
            label: device.deviceName || device.deviceId,
          }))
        const chooser = openBrowserDeviceChooser({
          parent: parent(contents),
          title: 'Connect Bluetooth device',
          message: `${origin} wants to connect to a Bluetooth device you choose.`,
          devices: choices(),
        })
        pending.set(contents, {
          chooser,
          update: (next) => {
            latest = next
            chooser.update(choices())
          },
        })
        void chooser.answer.then((answer) => {
          if (pending.get(contents)?.chooser === chooser) pending.delete(contents)
          callback(
            answer &&
              owned(contents, tab.profileId) &&
              (generations.get(contents) ?? 0) === generation &&
              contents.mainFrame === frame &&
              originOf(frame.url) === origin &&
              latest.some((device) => device.deviceId === answer.id) &&
              browserPermissions(tab.profileId).site(origin).permissions.bluetooth !== 'block'
              ? answer.id
              : '',
          )
        })
      })
    },
  }
}
