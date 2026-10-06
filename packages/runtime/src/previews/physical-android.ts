import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import sharp from 'sharp'
import type { PreviewDevice } from '@dovo/protocol'
import type { NativeSimulator } from './simulator-native.js'
import { androidTool } from './devices.js'
import { androidScreenSize } from './simulator-native.js'
import { HttpError } from '../errors.js'

const exec = promisify(execFile)

/** ADB works for USB and wireless phones without an emulator control port. */
export async function physicalAndroid(device: PreviewDevice): Promise<NativeSimulator> {
  if (device.platform !== 'android' || device.kind !== 'physical' || device.state !== 'booted')
    throw new HttpError(409, 'Connect and authorize this Android phone before opening its preview.')
  const adb = await androidTool('adb')
  const target = ['-s', device.runtime]
  const command = (args: string[]) =>
    exec(adb, [...target, ...args], {
      windowsHide: true,
      timeout: 10000,
      maxBuffer: 12 * 1024 * 1024,
    })
  const size = androidScreenSize((await command(['shell', 'wm', 'size'])).stdout)
  if (!size) throw new HttpError(503, 'Could not read the Android display size.')
  let width = size.width,
    height = size.height,
    down: { x: number; y: number } | undefined,
    stop = () => {}
  const point = (x: number, y: number) => ({
    x: Math.round(Math.max(0, Math.min(width - 1, x * 2))),
    y: Math.round(Math.max(0, Math.min(height - 1, y * 2))),
  })
  const shellInput = (args: string[]) => command(['shell', 'input', ...args]).then(() => undefined)
  const swipe = (from: { x: number; y: number }, to: { x: number; y: number }, ms: number) =>
    shellInput(['swipe', `${from.x}`, `${from.y}`, `${to.x}`, `${to.y}`, `${ms}`])
  const keys: Record<string, number> = {
    Home: 3,
    GoHome: 3,
    GoBack: 4,
    Enter: 66,
    Backspace: 67,
    Delete: 112,
    Tab: 61,
    Escape: 111,
    Space: 62,
    ArrowLeft: 21,
    ArrowRight: 22,
    ArrowUp: 19,
    ArrowDown: 20,
  }
  return {
    screenPoints: () => ({ width: width / 2, height: height / 2 }),
    start(publish, report) {
      let stopped = false,
        failures = 0
      let next: ReturnType<typeof setTimeout> | undefined
      const capture = async () => {
        if (stopped) return
        try {
          const { stdout } = await exec(adb, [...target, 'exec-out', 'screencap', '-p'], {
            windowsHide: true,
            encoding: 'buffer',
            timeout: 10000,
            maxBuffer: 12 * 1024 * 1024,
          })
          const image = sharp(stdout)
          const metadata = await image.metadata()
          if (!metadata.width || !metadata.height) throw new Error('Invalid Android screen frame')
          width = metadata.width
          height = metadata.height
          const data = await image
            .resize({ width: 960, height: 1600, fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 75 })
            .toBuffer()
          failures = 0
          if (!stopped) publish({ type: 'frame', data, width: width / 2, height: height / 2 })
        } catch (error) {
          if (++failures >= 3) {
            if (!stopped) report(error instanceof Error ? error : new Error(String(error)))
            return
          }
        }
        if (!stopped) next = setTimeout(() => void capture(), 350)
      }
      void capture()
      stop = () => {
        stopped = true
        clearTimeout(next)
      }
      return stop
    },
    async input(input) {
      if (input.type === 'pointer') {
        const at = point(input.x, input.y)
        if (input.phase === 'down') down = at
        else if (input.phase === 'up' && down) {
          const from = down
          down = undefined
          if (Math.hypot(at.x - from.x, at.y - from.y) < 8)
            await shellInput(['tap', `${at.x}`, `${at.y}`])
          else await swipe(from, at, 250)
        }
      } else if (input.type === 'scroll') {
        const from = point(input.x, input.y)
        const to = point(input.x - input.deltaX, input.y - input.deltaY)
        await swipe(from, to, 250)
      } else if (input.type === 'back') await shellInput(['keyevent', '4'])
      else if (input.type === 'key') {
        const key =
          keys[input.key] ??
          (/^[a-z]$/i.test(input.key) ? input.key.toLowerCase().charCodeAt(0) - 68 : undefined)
        if (key === undefined) throw new HttpError(400, 'This Android key is not supported.')
        await shellInput(['keyevent', `${key}`])
      } else if (input.type === 'text') {
        if (!/^[\x20-\x7e]+$/.test(input.text) || input.text.includes('%s'))
          throw new HttpError(400, 'This Android keyboard supports basic Latin text only.')
        const quoted = "'" + input.text.replaceAll(' ', '%s').replaceAll("'", "'\\''") + "'"
        await shellInput(['text', quoted])
      }
    },
    async release() {
      down = undefined
    },
    async close() {
      stop()
      down = undefined
    },
  }
}
