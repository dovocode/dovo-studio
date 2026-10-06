import { mutableStruct } from '@dovo/protocol'
import { maxValue, minValue } from '@dovo/protocol'
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { androidTool } from './devices.js'
import { once } from 'node:events'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { Schema } from 'effect'
import type { PreviewDevice, RemoteBrowserInput } from '@dovo/protocol'
import type { BrowserFrame } from './browser.js'
import { SimulatorRpc } from './simulator-rpc.js'
import { androidProtocol, iosProtocol } from './simulator-protocols.js'
import { HttpError } from '../errors.js'
import { emulatorKey } from './emulator-auth.js'
// sharp is a native image library that is only needed once a frame is decoded. Loading it
// lazily keeps it out of the runtime's startup module graph.
let sharpModule: typeof import('sharp').default | undefined
async function loadSharp() {
  sharpModule ??= (await import('sharp')).default
  return sharpModule
}
export interface NativeSimulator {
  screenPoints?: () => { width: number; height: number }
  start(frame: (frame: BrowserFrame) => void, error: (error: Error) => void): () => void
  input(input: RemoteBrowserInput): Promise<void>
  release(): Promise<void>
  close(): Promise<void>
}
const empty = mutableStruct({})
const pixels = maxValue(
  Schema.Number.pipe(Schema.finite())
    .pipe(Schema.int(), Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER))
    .pipe(Schema.positive()),
  8192,
)
const bytes = Schema.instanceOf(Uint8Array)

// idb's MINICAP output has a bounded header and length-prefixed JPEG frames.
// This is framing only; JPEG decoding/dimensions are handled by libvips.
export class MinicapFrames {
  private buffer = Buffer.alloc(0)
  private header = false
  push(chunk: Uint8Array, frame: (jpeg: Buffer) => void) {
    if (this.buffer.length + chunk.byteLength > 16 * 1024 * 1024)
      throw new Error('Simulator frame exceeds limit')
    this.buffer = Buffer.concat([this.buffer, chunk])
    if (!this.header) {
      if (this.buffer.length < 2) return
      const length = this.buffer[1]
      if (this.buffer[0] !== 1 || length < 24 || length > 64)
        throw new Error('Invalid simulator stream header')
      if (this.buffer.length < length) return
      this.buffer = this.buffer.subarray(length)
      this.header = true
    }
    while (this.buffer.length >= 4) {
      const size = this.buffer.readUInt32LE(0)
      if (!size || size > 16 * 1024 * 1024) throw new Error('Invalid simulator frame length')
      if (this.buffer.length < size + 4) break
      frame(this.buffer.subarray(4, size + 4))
      this.buffer = this.buffer.subarray(size + 4)
    }
  }
}
async function stopChild(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return
  const exited = once(child, 'exit')
  child.kill('SIGTERM')
  const timer = setTimeout(() => child.kill('SIGKILL'), 3000)
  try {
    await exited
  } finally {
    clearTimeout(timer)
  }
}

// Keep one native encode in progress and only the newest pending frame.
function latest<T>(
  encode: (value: T) => Promise<BrowserFrame>,
  publish: (value: BrowserFrame) => void,
  report: (error: Error) => void,
) {
  let pending: T | undefined,
    busy = false,
    stopped = false
  return {
    stop() {
      stopped = true
      pending = undefined
    },
    async push(value: T) {
      pending = value
      if (busy || stopped) return
      busy = true
      try {
        while (pending && !stopped) {
          const next = pending
          pending = undefined
          const result = await encode(next)
          if (!stopped) publish(result)
        }
      } catch (error) {
        if (!stopped) report(error instanceof Error ? error : new Error(String(error)))
      } finally {
        busy = false
      }
    },
  }
}
export const specialKeys: Record<string, number> = {
  Enter: 40,
  Escape: 41,
  Backspace: 42,
  Tab: 43,
  Space: 44,
  Delete: 76,
  ArrowRight: 79,
  ArrowLeft: 80,
  ArrowDown: 81,
  ArrowUp: 82,
  Meta: 227,
  Control: 224,
  Alt: 226,
  Shift: 225,
}
export function asciiKey(char: string):
  | {
      code: number
      shift: boolean
    }
  | undefined {
  if (/^[a-z]$/i.test(char))
    return {
      code: char.toLowerCase().charCodeAt(0) - 93,
      shift: char !== char.toLowerCase(),
    }
  const plain = "1234567890\n\x1b\b\t -=[]\\\x00;'`,./"
  const shifted = '!@#$%^&*()\n\x1b\b\t _+{}|\x00:"~<>?'
  const index = plain.indexOf(char)
  if (index >= 0)
    return {
      code: 30 + index,
      shift: false,
    }
  const upper = shifted.indexOf(char)
  if (upper >= 0)
    return {
      code: 30 + upper,
      shift: true,
    }
  return undefined
}
export async function iosSimulator(device: PreviewDevice): Promise<NativeSimulator> {
  const udid = device.id.slice(4)
  const directory = await mkdtemp(join(tmpdir(), 'dovo-sim-'))
  const socket = join(directory, 'control.sock')
  let diagnostic = ''
  const child = spawn(
    process.env.DOVO_IDB_COMPANION || 'idb_companion',
    ['--udid', udid, '--only', 'simulator', '--grpc-domain-sock', socket, '--log-level', 'info'],
    {
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  )
  child.stderr?.on('data', (chunk: Buffer) => {
    diagnostic = (diagnostic + chunk.toString()).slice(-3000)
  })
  let startupError: Error | undefined
  child.on('error', (error) => {
    startupError = error
  })
  // A missing or crashing companion fails now instead of after the 15 second ready timeout.
  const exited = new Promise<never>((_, reject) => {
    child.once('error', (error) => reject(error))
    child.once('exit', (code, signal) =>
      reject(new Error(`idb_companion exited (${signal ?? code}). ${diagnostic}`.trim())),
    )
  })
  exited.catch(() => undefined)
  const rpc = new SimulatorRpc(`unix:${socket}`, iosProtocol, 'idb.CompanionService')
  try {
    await Promise.race([rpc.ready(), exited])
    const description = await rpc.unary(
      'describe',
      'idb.Empty',
      'idb.Description',
      {},
      mutableStruct({
        targetDescription: mutableStruct({
          udid: Schema.String,
          screenDimensions: mutableStruct({
            widthPoints: pixels,
            heightPoints: pixels,
          }),
        }),
      }),
    )
    if (description.targetDescription.udid !== udid) throw new Error('Simulator identity changed')
    const size = description.targetDescription.screenDimensions
    let width = size.widthPoints,
      height = size.heightPoints
    let touch:
      | {
          x: number
          y: number
        }
      | undefined
    let hidError: Error | null = null
    const hid = rpc.writeStream('hid', 'idb.HIDEvent', 'idb.Empty', empty, (error) => {
      hidError = error
    })
    hid.on('error', (error) => {
      hidError = error
    })
    const write = (event: object) =>
      new Promise<void>((resolve, reject) => {
        if (hidError) {
          reject(hidError)
          return
        }
        hid.write(event, (error: Error | null | undefined) => (error ? reject(error) : resolve()))
      })
    const key = async (code: number, down: boolean) =>
      write({
        press: {
          direction: down ? 0 : 1,
          action: {
            key: {
              keycode: code,
            },
          },
        },
      })
    const press = async (code: number) => {
      await key(code, true)
      await key(code, false)
    }
    const release = async () => {
      if (!touch) return
      const point = touch
      touch = undefined
      await write({
        press: {
          direction: 1,
          action: {
            touch: {
              point,
            },
          },
        },
      })
    }
    let stop: (() => void) | undefined
    return {
      screenPoints: () => ({ width: size.widthPoints, height: size.heightPoints }),
      start(publish, report) {
        const parser = new MinicapFrames()
        const stream = rpc.duplex(
          'video_stream',
          'idb.VideoRequest',
          'idb.VideoResponse',
          mutableStruct({
            payload: Schema.optional(
              Schema.NullOr(
                mutableStruct({
                  data: bytes,
                }),
              ),
            ),
          }),
        )
        let stopped = false
        const encoder = latest<Buffer>(
          async (data) => {
            const info = await (await loadSharp())(data).metadata()
            const landscape = (info.width ?? 0) > (info.height ?? 0)
            width = landscape
              ? Math.max(size.widthPoints, size.heightPoints)
              : Math.min(size.widthPoints, size.heightPoints)
            height = landscape
              ? Math.min(size.widthPoints, size.heightPoints)
              : Math.max(size.widthPoints, size.heightPoints)
            return {
              type: 'frame',
              data,
              width,
              height,
            }
          },
          publish,
          report,
        )
        stream.on('data', (response) => {
          try {
            if (response.payload?.data.length)
              parser.push(response.payload.data, (jpeg) => {
                void encoder.push(jpeg)
              })
          } catch (error) {
            report(error instanceof Error ? error : new Error(String(error)))
            stop?.()
          }
        })
        stream.on('error', (error) => {
          if (!stopped) report(error)
        })
        stream.on('end', () => {
          if (!stopped) report(new Error('Simulator stream ended'))
        })
        stream.write({
          start: {
            fps: 30,
            format: 3,
            compressionQuality: 0.75,
            scaleFactor: 0.5,
          },
        })
        stop = () => {
          stopped = true
          encoder.stop()
          stream.cancel()
        }
        return stop
      },
      async input(input) {
        if (input.type === 'pointer') {
          if (input.phase === 'move' && !touch) return
          const point = {
            x: Math.min(width - 1, input.x),
            y: Math.min(height - 1, input.y),
          }
          touch = input.phase === 'up' ? undefined : point
          await write({
            press: {
              direction: input.phase === 'up' ? 1 : 0,
              action: {
                touch: {
                  point,
                },
              },
            },
          })
        } else if (input.type === 'text') {
          const keys = Array.from(input.text).map(asciiKey)
          if (keys.some((value) => !value)) {
            // Paste arbitrary Unicode into this simulator, never the host clipboard.
            await new Promise<void>((resolve, reject) => {
              const copy = spawn('xcrun', ['simctl', 'pbcopy', udid], {
                stdio: ['pipe', 'ignore', 'pipe'],
              })
              const timeout = setTimeout(() => copy.kill(), 10000)
              copy.on('error', (error) => {
                clearTimeout(timeout)
                reject(error)
              })
              copy.on('exit', (code) => {
                clearTimeout(timeout)
                if (code === 0) resolve()
                else reject(new Error('Could not paste into simulator'))
              })
              copy.stdin.on('error', reject)
              copy.stdin.end(input.text)
            })
            await key(227, true)
            await press(25)
            await key(227, false)
          } else
            for (const value of keys)
              if (value) {
                if (value.shift) await key(225, true)
                await press(value.code)
                if (value.shift) await key(225, false)
              }
        } else if (input.type === 'key') {
          if (input.key === 'Home') {
            await write({
              press: {
                direction: 0,
                action: {
                  button: {
                    button: 1,
                  },
                },
              },
            })
            await write({
              press: {
                direction: 1,
                action: {
                  button: {
                    button: 1,
                  },
                },
              },
            })
          } else {
            const parts = input.key.split('+'),
              final = parts.pop() ?? ''
            const code = specialKeys[final] ?? asciiKey(final)?.code
            if (code === undefined) throw new Error('This simulator key is not supported')
            for (const modifier of parts)
              if (specialKeys[modifier]) await key(specialKeys[modifier], true)
            await press(code)
            for (const modifier of parts.reverse())
              if (specialKeys[modifier]) await key(specialKeys[modifier], false)
          }
        } else if (input.type === 'scroll') {
          await write({
            swipe: {
              start: {
                x: input.x,
                y: input.y,
              },
              end: {
                x: Math.max(1, Math.min(width - 1, input.x - input.deltaX)),
                y: Math.max(1, Math.min(height - 1, input.y - input.deltaY)),
              },
              duration: 0.12,
            },
          })
        }
      },
      release,
      async close() {
        stop?.()
        await release().catch((error) => console.warn('Could not release simulator touch', error))
        hid.end()
        rpc.close()
        await stopChild(child)
        await rm(directory, {
          recursive: true,
          force: true,
        })
      },
    }
  } catch (error) {
    rpc.close()
    await stopChild(child)
    await rm(directory, {
      recursive: true,
      force: true,
    })
    throw new HttpError(
      503,
      `iOS live preview requires idb_companion and a booted simulator. ${startupError?.message ?? (error instanceof Error ? error.message : String(error))} ${diagnostic}`,
    )
  }
}
export async function emulatorEndpoint(device: PreviewDevice) {
  const directories = [
    join(homedir(), 'Library/Caches/TemporaryItems/avd/running'),
    join(tmpdir(), 'avd/running'),
    join(process.env.XDG_RUNTIME_DIR || tmpdir(), 'avd/running'),
  ]
  for (const directory of new Set(directories)) {
    let files: string[]
    try {
      files = await readdir(directory)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue
      throw error
    }
    for (const file of files.filter((file) => /^pid_\d+\.ini$/.test(file))) {
      try {
        process.kill(Number(file.slice(4, -4)), 0)
      } catch {
        continue
      }
      const data = Object.fromEntries(
        (await readFile(join(directory, file), 'utf8')).split('\n').flatMap((line) => {
          const at = line.indexOf('=')
          return at > 0 ? [[line.slice(0, at).trim(), line.slice(at + 1).trim()]] : []
        }),
      )
      if (data['avd.name'] !== device.name || `emulator-${data['port.serial']}` !== device.runtime)
        continue
      const port = Number(data['grpc.port'])
      if (!Number.isInteger(port) || port < 1 || port > 65535) continue
      const address = `127.0.0.1:${port}`
      // Started by Dovo (-grpc-use-token) or by Android Studio (signed keys), like any booted
      // iOS simulator.
      if (data['grpc.token']) return { address, token: data['grpc.token'] }
      if (data['grpc.jwks'] && data['grpc.jwk_active'])
        return { address, keys: { directory: data['grpc.jwks'], active: data['grpc.jwk_active'] } }
      throw new HttpError(
        409,
        'This emulator’s control port is not secured. Restart it from Dovo or Android Studio.',
      )
    }
  }
  throw new HttpError(
    503,
    'No authenticated emulator control endpoint. Start this emulator using Dovo or with -grpc-use-token.',
  )
}
/** `wm size` reports the physical size and, when set, an override that the display uses. */
export function androidScreenSize(output: string) {
  const sizes = [...output.matchAll(/(Physical|Override) size: (\d+)x(\d+)/g)]
  const size = sizes.find((match) => match[1] === 'Override') ?? sizes[0]
  if (!size) return undefined
  const width = Number(size[2]),
    height = Number(size[3])
  return width > 0 && height > 0 && width <= 8192 && height <= 8192 ? { width, height } : undefined
}
export async function androidSimulator(device: PreviewDevice): Promise<NativeSimulator> {
  const endpoint = await emulatorEndpoint(device)
  const signer = endpoint.keys
    ? await emulatorKey(endpoint.keys.directory, endpoint.keys.active)
    : undefined
  const rpc = new SimulatorRpc(
    endpoint.address,
    androidProtocol,
    'android.emulation.control.EmulatorController',
    endpoint.token ?? signer?.token(),
  )
  try {
    await rpc.ready()
  } catch (error) {
    rpc.close()
    await signer?.dispose()
    throw error
  }
  // Signed tokens are short-lived; renew before each call.
  const authorize = () => {
    if (signer) rpc.metadata.set('authorization', `Bearer ${signer.token()}`)
  }
  const adb = await androidTool('adb')
  const execute = promisify(execFile)
  // Touches use device pixels; the phone sees half of them, like points on iOS.
  const screen = await execute(adb, ['-s', device.runtime, 'shell', 'wm', 'size'], {
    windowsHide: true,
    timeout: 10000,
  })
    .then(({ stdout }) => androidScreenSize(stdout))
    .catch(() => undefined)
  let width = screen?.width ?? 0,
    height = screen?.height ?? 0,
    touching = false
  const unary = (method: string, type: string, request: object) => {
    authorize()
    return rpc.unary(method, type, 'android.emulation.control.Empty', request, empty)
  }
  const keyCodes: Record<string, number> = {
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
    End: 123,
    PageUp: 92,
    PageDown: 93,
    Control: 113,
    Meta: 117,
    Shift: 59,
    Alt: 57,
  }
  const key = async (name: string) => {
    const codes = name
      .split('+')
      .map(
        (part) =>
          keyCodes[part] ??
          (/^[a-z]$/i.test(part) ? part.toLowerCase().charCodeAt(0) - 68 : undefined),
      )
    if (codes.some((code) => code === undefined))
      throw new Error('This emulator key is not supported')
    // gRPC keyboard events require hw.keyboard=yes. Software input works for
    // touch-only AVDs too; framebuffer and gesture streaming remain native gRPC.
    await execute(
      adb,
      [
        '-s',
        device.runtime,
        'shell',
        'input',
        codes.length > 1 ? 'keycombination' : 'keyevent',
        ...codes.map(String),
      ],
      {
        timeout: 10000,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      },
    )
  }
  const release = async () => {
    if (!touching) return
    touching = false
    await unary('sendTouch', 'android.emulation.control.TouchEvent', {
      touches: [
        {
          identifier: 0,
          pressure: 0,
        },
      ],
    })
  }
  let stop: (() => void) | undefined
  const touch = (x: number, y: number, pressure: number) =>
    unary('sendTouch', 'android.emulation.control.TouchEvent', {
      touches: [
        {
          x: Math.round(Math.max(0, Math.min(width - 1, x))),
          y: Math.round(Math.max(0, Math.min(height - 1, y))),
          identifier: 0,
          pressure,
        },
      ],
    })
  return {
    start(publish, report) {
      const schema = mutableStruct({
        format: mutableStruct({
          width: maxValue(
            minValue(
              Schema.Number.pipe(Schema.finite()).pipe(
                Schema.int(),
                Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
              ),
              0,
            ),
            8192,
          ),
          height: maxValue(
            minValue(
              Schema.Number.pipe(Schema.finite()).pipe(
                Schema.int(),
                Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
              ),
              0,
            ),
            8192,
          ),
        }),
        image: bytes,
      })
      authorize()
      // Let the emulator scale frames (a 1080×2400 RGB frame is ~7.8 MB); the box fits both
      // orientations because the emulator keeps the aspect ratio.
      const stream = rpc.stream(
        'streamScreenshot',
        'android.emulation.control.ImageFormat',
        'android.emulation.control.Image',
        screen ? { format: 2, width: 1600, height: 1600 } : { format: 2 },
        schema,
      )
      let stopped = false
      const encoder = latest<Schema.Schema.Type<typeof schema>>(
        async (value) => {
          const w = value.format.width,
            h = value.format.height
          if (!w || !h || w * h * 3 !== value.image.length)
            throw new Error('Invalid emulator framebuffer')
          // protobuf already owns this immutable frame buffer. Avoid copying the full
          // RGB framebuffer again for every encode (several MB per frame).
          const pixels = Buffer.from(
            value.image.buffer,
            value.image.byteOffset,
            value.image.byteLength,
          )
          const data = await (
            await loadSharp()
          )(pixels, {
            raw: {
              width: w,
              height: h,
              channels: 3,
            },
          })
            .resize({
              width: 960,
              height: 1600,
              fit: 'inside',
              withoutEnlargement: true,
            })
            .jpeg({
              quality: 75,
            })
            .toBuffer()
          // Scaled frames keep the device's orientation; touch space follows it.
          if (screen) {
            const long = Math.max(screen.width, screen.height),
              short = Math.min(screen.width, screen.height)
            width = w > h ? long : short
            height = w > h ? short : long
          } else {
            width = w
            height = h
          }
          return {
            type: 'frame',
            data,
            width: Math.round(width / 2),
            height: Math.round(height / 2),
          }
        },
        publish,
        report,
      )
      stream.on('data', (value) => {
        if (value.image.length) void encoder.push(value)
      })
      stream.on('error', (error) => {
        if (!stopped) report(error)
      })
      stream.on('end', () => {
        if (!stopped) report(new Error('Emulator stream ended'))
      })
      stop = () => {
        stopped = true
        encoder.stop()
        stream.cancel()
      }
      return stop
    },
    async input(input) {
      if (input.type === 'pointer') {
        if (!width || !height || (input.phase === 'move' && !touching)) return
        touching = input.phase !== 'up'
        await touch(input.x * 2, input.y * 2, touching ? 1 : 0)
      } else if (input.type === 'text') {
        if (/^[\x20-\x7e]+$/.test(input.text) && !input.text.includes('%s')) {
          // adb joins shell arguments. Quote explicitly; input's %s escape means a space.
          const text = "'" + input.text.replaceAll(' ', '%s').replaceAll("'", "'\\''") + "'"
          await execute(adb, ['-s', device.runtime, 'shell', 'input', 'text', text], {
            windowsHide: true,
            timeout: 10000,
            maxBuffer: 1024 * 1024,
          })
        } else {
          // Android's shell keyboard map cannot represent arbitrary Unicode.
          await unary('setClipboard', 'android.emulation.control.ClipData', {
            text: input.text,
          })
          await execute(adb, ['-s', device.runtime, 'shell', 'input', 'keyevent', '279'], {
            windowsHide: true,
            timeout: 10000,
            maxBuffer: 1024 * 1024,
          })
        }
      } else if (input.type === 'scroll') {
        // A short swipe, like the iOS simulator; never while a finger is already down.
        if (!width || !height || touching) return
        const from = { x: input.x * 2, y: input.y * 2 }
        const to = { x: from.x - input.deltaX * 2, y: from.y - input.deltaY * 2 }
        await touch(from.x, from.y, 1)
        for (let step = 1; step <= 4; step++) {
          await new Promise((resolve) => setTimeout(resolve, 25))
          await touch(
            from.x + ((to.x - from.x) * step) / 4,
            from.y + ((to.y - from.y) * step) / 4,
            1,
          )
        }
        await touch(to.x, to.y, 0)
      } else if (input.type === 'back') await key('GoBack')
      else if (input.type === 'key') await key(input.key)
    },
    release,
    async close() {
      stop?.()
      await release().catch((error) => console.warn('Could not release simulator touch', error))
      rpc.close()
      await signer?.dispose()
    },
  }
}
