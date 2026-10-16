import { setTimeout as delay } from 'node:timers/promises'
import type { PreviewDevice, SimulatorInput } from '@dovo/protocol'
import type { NativeSimulator } from './simulator-native.js'
import { HttpError } from '../errors.js'

export function deviceControls(device: PreviewDevice) {
  const pinch = device.kind !== 'physical'
  return {
    controls: [
      'tap',
      'swipe',
      'text',
      'key',
      'double-tap',
      'long-press',
      'drag',
      'home',
      'back',
      ...(device.platform === 'android' ? ['app-switcher'] : []),
      'lock',
      'deep-link',
      'apps',
      'launch',
      'relaunch',
      'stop',
      'uninstall',
      'volume-up',
      'volume-down',
      ...(device.platform === 'android' || device.kind === 'physical' ? ['mute'] : []),
      ...(pinch ? ['pinch'] : []),
    ],
    limitations: [
      ...(!pinch
        ? ['Multi-touch pinch is unavailable through this device’s native control transport.']
        : []),
      ...(device.platform === 'ios'
        ? [
            'Back uses the standard left-edge navigation gesture; apps must support it. App switching requires an automation runner with system-gesture support.',
          ]
        : []),
      ...(device.platform === 'ios' && device.kind !== 'physical'
        ? [
            'Pinch requires a recent idb_companion with native multi-touch support. The simulator has no mute button.',
          ]
        : []),
      ...(device.platform === 'ios' && device.kind === 'physical'
        ? ['Deep links require the destination app’s bundleId.']
        : []),
      ...(device.platform === 'android' && device.kind === 'physical'
        ? [
            'ADB text entry supports basic Latin text; arbitrary Unicode requires an automation runner.',
          ]
        : []),
    ],
  }
}

/** Runs complete gestures in the owning host’s serialized native input queue. */
export function controlNativeDevice(
  driver: NativeSimulator,
  device: PreviewDevice,
): NativeSimulator {
  return {
    ...driver,
    async input(input, authorize, signal) {
      if (input.type !== 'gesture' && input.type !== 'device-button')
        return driver.input(input, authorize, signal)
      const check = () => {
        authorize?.()
        signal?.throwIfAborted()
      }
      const send = async (value: SimulatorInput) => {
        check()
        await driver.input(value, authorize, signal)
      }
      const wait = async (ms: number) => {
        await delay(ms, undefined, { signal })
        check()
      }
      const press = (key: string) => send({ type: 'key', key })
      if (input.type === 'device-button') {
        if (input.button === 'home') return press('Home')
        if (input.button === 'app-switcher') {
          if (device.platform === 'android') return press('AppSwitch')
          throw new HttpError(
            409,
            'iOS app switching requires an automation runner with system-gesture support.',
          )
        }
        if (input.button === 'back') {
          if (device.platform === 'android') return send({ type: 'back' })
          const screen = driver.screenPoints?.()
          if (!screen)
            throw new HttpError(
              409,
              'Device dimensions are unavailable. Open the live preview first.',
            )
          return send({
            type: 'scroll',
            x: 1,
            y: screen.height / 2,
            deltaX: -screen.width * 0.8,
            deltaY: 0,
          })
        }
        if (device.platform === 'ios' && device.kind !== 'physical' && input.button === 'mute')
          throw new HttpError(409, 'iOS simulators do not expose a mute button.')
        return press(
          { lock: 'Lock', 'volume-up': 'VolumeUp', 'volume-down': 'VolumeDown', mute: 'Mute' }[
            input.button
          ],
        )
      }
      if (input.gesture === 'pinch') {
        if (device.kind === 'physical')
          throw new HttpError(
            409,
            'Multi-touch pinch is unavailable through this device’s native control transport.',
          )
        return send(input)
      }
      if (
        device.platform === 'android' &&
        device.kind === 'physical' &&
        input.gesture !== 'double-tap'
      )
        return send(input)
      let point = { x: input.x, y: input.y }
      const pointer = (phase: 'down' | 'move' | 'up') =>
        send({
          type: 'pointer',
          phase,
          pointerType: 'touch',
          button: 'left',
          ...point,
        })
      const contact = async (move: () => Promise<void>) => {
        try {
          await pointer('down')
          await move()
        } finally {
          // Always lift the finger, even if authority is revoked during a hold or drag.
          await driver.input({
            type: 'pointer',
            phase: 'up',
            pointerType: 'touch',
            button: 'left',
            ...point,
          })
        }
      }
      if (input.gesture === 'double-tap') {
        await contact(async () => {})
        await wait(100)
        return contact(async () => {})
      }
      return contact(async () => {
        if (input.gesture !== 'drag') return wait(input.durationMs)
        await wait(500)
        const steps = Math.max(2, Math.ceil(input.durationMs / 25))
        for (let step = 1; step <= steps; step++) {
          await wait(input.durationMs / steps)
          point = {
            x: input.x + ((input.endX - input.x) * step) / steps,
            y: input.y + ((input.endY - input.y) * step) / steps,
          }
          await pointer('move')
        }
      })
    },
  }
}
