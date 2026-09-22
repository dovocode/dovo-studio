import { expect, it } from 'vitest'
import { parseIosDevices, parsePhysicalIosDevices, parsePhysicalAndroidDevices } from './devices'
it('only offers available simulators and preserves transition state', () => {
  const devices = parseIosDevices(
    JSON.stringify({
      devices: {
        'iOS 26': [
          { udid: 'one', name: 'Phone', state: 'Booted', isAvailable: true },
          { udid: 'two', name: 'Old', state: 'Shutdown', isAvailable: false },
          { udid: 'three', name: 'Tablet', state: 'Booting', isAvailable: true },
        ],
      },
    }),
  )
  expect(devices.map((d) => [d.id, d.state])).toEqual([
    ['ios:one', 'booted'],
    ['ios:three', 'starting'],
  ])
})
it('rejects malformed tool output instead of offering invalid device identifiers', () => {
  expect(() => parseIosDevices('{"devices":{"iOS":[{"name":"Phone"}]}}')).toThrow(/udid/)
})
it('discovers physical iPhones from modern and legacy Xcode output without duplicating simulators', () => {
  const modern = {
    identifier: 'phone',
    properties: {
      hardware: { reality: 'physical', platform: 'iOS', udid: 'usb-phone' },
      state: { name: 'My iPhone' },
      connection: { state: 'connected' },
    },
  }
  const legacy = {
    identifier: 'tablet',
    hardwareProperties: { reality: 'physical', platform: 'iOS', udid: 'usb-tablet' },
    deviceProperties: { name: 'iPad' },
    connectionProperties: { tunnelState: 'disconnected' },
  }
  const simulator = {
    ...modern,
    properties: {
      ...modern.properties,
      hardware: { ...modern.properties.hardware, reality: 'simulated' },
    },
  }
  expect(
    parsePhysicalIosDevices(JSON.stringify({ result: { devices: [modern, legacy, simulator] } })),
  ).toMatchObject([
    { id: 'physical-ios:usb-phone', kind: 'physical', connection: 'connected', state: 'booted' },
    {
      id: 'physical-ios:usb-tablet',
      kind: 'physical',
      connection: 'disconnected',
      state: 'stopped',
    },
  ])
})
it('includes Android authorization problems without presenting phones as emulators', () => {
  expect(
    parsePhysicalAndroidDevices(
      'List of devices attached\nemulator-5554 device model:emulator\nusb-one device product:test model:Pixel_9 device:test\nusb-two unauthorized\nusb-three offline\n',
    ),
  ).toMatchObject([
    { id: 'physical-android:usb-one', name: 'Pixel 9', state: 'booted' },
    { id: 'physical-android:usb-two', connection: 'unauthorized', state: 'stopped' },
    { id: 'physical-android:usb-three', connection: 'offline', state: 'stopped' },
  ])
})
