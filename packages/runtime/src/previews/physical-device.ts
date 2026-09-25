import { mutableStruct } from '@dovo/protocol'
import { decodeResult } from '@dovo/protocol'
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { mkdir, readFile, access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { Dicer } from '@fastify/busboy'
import { Schema } from 'effect'
import type { PreviewDevice } from '@dovo/protocol'
import { asciiKey, specialKeys, type NativeSimulator } from './simulator-native.js'
import type { BrowserFrame } from './browser.js'
import { HttpError } from '../errors.js'
// sharp is a native image library that is only needed once a frame is decoded. Loading it
// lazily keeps it out of the runtime's startup module graph.
let sharpModule: typeof import('sharp').default | undefined
async function loadSharp() {
  sharpModule ??= (await import('sharp')).default
  return sharpModule
}
const exec = promisify(execFile)
let building: Promise<string> | undefined
async function helper() {
  if (process.env.DOVO_IOS_DEVICE_HELPER) return process.env.DOVO_IOS_DEVICE_HELPER
  building ??= (async () => {
    const source = fileURLToPath(new URL('./ios-device/', import.meta.url))
    const hash = createHash('sha256')
    for (const file of ['Cargo.toml', 'Cargo.lock', 'src/main.rs', 'src/media.rs'])
      hash.update(await readFile(join(source, file)))
    const target = join(homedir(), '.dovo', 'helpers', 'ios-device', hash.digest('hex'))
    const executable = join(target, 'release', 'dovo-ios-device')
    try {
      await access(executable)
      return executable
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    }
    await mkdir(target, {
      recursive: true,
    })
    await exec(
      'cargo',
      [
        'build',
        '--locked',
        '--release',
        '--manifest-path',
        join(source, 'Cargo.toml'),
        '--target-dir',
        target,
      ],
      {
        timeout: 180000,
        maxBuffer: 4 * 1024 * 1024,
      },
    )
    return executable
  })().catch((error) => {
    building = undefined
    throw error
  })
  return building
}
export function physicalPoint(x: number, y: number, width: number, height: number) {
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0)
    throw new Error('Wait for the physical device screen before sending input')
  return {
    x: Math.round(Math.max(0, Math.min(1, x / width)) * 65535),
    y: Math.round(Math.max(0, Math.min(1, y / height)) * 65535),
  }
}
export function physicalKeys(key: string): number[] {
  const parts = key.split('+'),
    final = parts.pop() ?? ''
  const character = asciiKey(final)
  const code = specialKeys[final] ?? (final.length === 1 ? character?.code : undefined)
  const modifiers = parts.map(
    (part) =>
      ({
        Meta: 227,
        Control: 224,
        Alt: 226,
        Shift: 225,
      })[part],
  )
  if (code === undefined || modifiers.some((value) => value === undefined))
    throw new Error('This physical device key is not supported')
  return [
    ...new Set([
      ...modifiers.filter((value): value is number => value !== undefined),
      ...(character?.shift ? [225] : []),
      code,
    ]),
  ]
}
const eventSchema = Schema.Union(
  ...[
    mutableStruct({
      type: Schema.Literal('ready'),
      device: Schema.String,
    }),
    mutableStruct({
      type: Schema.Literal('ack'),
      id: Schema.Number.pipe(Schema.finite()).pipe(
        Schema.int(),
        Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
      ),
    }),
    mutableStruct({
      type: Schema.Literal('error'),
      message: Schema.String,
    }),
  ],
)
async function stop(child: ChildProcess) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit')
  child.stdin?.end()
  // The native helper allows three seconds to end its iOS screen-sharing session.
  const timeout = setTimeout(() => child.kill('SIGTERM'), 4000)
  const kill = setTimeout(() => child.kill('SIGKILL'), 6000)
  try {
    await exited
  } finally {
    clearTimeout(timeout)
    clearTimeout(kill)
  }
}
export async function physicalDevice(device: PreviewDevice): Promise<NativeSimulator> {
  if (process.platform !== 'darwin' || device.platform !== 'ios')
    throw new HttpError(
      409,
      'Physical iPhone control requires a trusted iPhone or iPad with Developer Mode connected to this Mac.',
    )
  const executable = await helper()
  const child = spawn(executable, [device.runtime], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const decoder = spawn(
    process.env.DOVO_FFMPEG || 'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-probesize',
      '32',
      '-analyzeduration',
      '0',
      // Frame threading buffers future frames; use one decoder thread for live input.
      '-flags',
      'low_delay',
      '-threads',
      '1',
      '-filter_threads',
      '1',
      '-f',
      'hevc',
      '-i',
      'pipe:0',
      '-an',
      '-vf',
      'scale=960:1600:force_original_aspect_ratio=decrease:force_divisible_by=2',
      '-c:v',
      'mjpeg',
      '-q:v',
      '5',
      '-threads',
      '1',
      '-fps_mode',
      'passthrough',
      '-flush_packets',
      '1',
      '-f',
      'mpjpeg',
      '-boundary_tag',
      'dovo-frame',
      'pipe:1',
    ],
    {
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  )
  let closed = false,
    failure: Error | undefined,
    lastFrame: BrowserFrame | undefined
  let frameListener: ((frame: BrowserFrame) => void) | undefined
  let errorListener: ((error: Error) => void) | undefined
  const pending = new Map<
    number,
    {
      resolve: () => void
      reject: (error: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  const report = (error: Error) => {
    if (closed || failure) return
    failure = error
    for (const operation of pending.values()) {
      clearTimeout(operation.timer)
      operation.reject(error)
    }
    pending.clear()
    errorListener?.(error)
  }
  child.on('error', report)
  decoder.on('error', report)
  child.stdin?.on('error', report)
  decoder.stdin?.on('error', report)
  child.stdout?.pipe(decoder.stdin!)
  let diagnostics = ''
  decoder.stderr?.on('data', (data: Buffer) => {
    diagnostics = (diagnostics + data.toString()).slice(-2000)
  })
  for (const process of [child, decoder])
    process.on('exit', () => {
      report(
        new Error(
          process === child
            ? 'Physical device disconnected. Reconnect to continue.'
            : `Device video decoder stopped. ${diagnostics}`,
        ),
      )
    })
  const lines = createInterface({
    input: child.stderr!,
  })
  const parser = new Dicer({
    boundary: 'dovo-frame',
  })
  let nativeReady = false
  let completeStartup = () => {}
  let encoding = false,
    next: Buffer | undefined
  const publish = async (data: Buffer) => {
    next = data
    if (encoding) return
    encoding = true
    try {
      while (next && !closed) {
        const frame = next
        next = undefined
        const { width, height } = await (await loadSharp())(frame).metadata()
        if (!width || !height || width > 1600 || height > 1600)
          throw new Error('Invalid physical device frame')
        lastFrame = {
          type: 'frame',
          data: frame,
          width,
          height,
        }
        completeStartup()
        frameListener?.(lastFrame)
      }
    } catch (error) {
      report(error instanceof Error ? error : new Error(String(error)))
    } finally {
      encoding = false
    }
  }
  parser.on('error', report)
  parser.on('part', (part) => {
    const chunks: Buffer[] = []
    let length = 0
    part.on('data', (chunk: Buffer) => {
      length += chunk.length
      if (length > 8 * 1024 * 1024) {
        report(new Error('Physical device frame exceeds limit'))
        parser.destroy()
        return
      }
      chunks.push(chunk)
    })
    part.on('error', report)
    part.on('end', () => {
      if (!failure && length) void publish(Buffer.concat(chunks))
    })
  })
  decoder.stdout?.pipe(parser)
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new Error(
              nativeReady
                ? 'The phone connected but did not send a screen frame. Wake and unlock it, then reconnect.'
                : 'Physical device did not become ready. Connect and unlock the phone, trust this Mac, and enable Developer Mode.',
            ),
          ),
        20000,
      )
      completeStartup = () => {
        if (nativeReady && lastFrame) {
          clearTimeout(timer)
          resolve()
        }
      }
      errorListener = (error) => {
        clearTimeout(timer)
        reject(error)
      }
      lines.on('line', (line) => {
        if (!line.startsWith('{')) return
        let value: unknown
        try {
          value = JSON.parse(line)
        } catch {
          report(new Error('Invalid native device response'))
          return
        }
        const parsed = decodeResult(eventSchema, value)
        if (!parsed.success) {
          report(new Error('Invalid native device response'))
          return
        }
        const event = parsed.data
        if (event.type === 'error') report(new Error(event.message))
        else if (event.type === 'ready') {
          if (event.device !== device.runtime) {
            report(new Error('Physical device identity changed'))
            return
          }
          nativeReady = true
          completeStartup()
        } else {
          const operation = pending.get(event.id)
          if (operation) {
            pending.delete(event.id)
            clearTimeout(operation.timer)
            operation.resolve()
          }
        }
      })
      if (failure) {
        clearTimeout(timer)
        reject(failure)
      }
    })
  } catch (error) {
    closed = true
    await Promise.all([stop(child), stop(decoder)])
    lines.close()
    parser.destroy()
    throw error
  }
  completeStartup = () => {}
  errorListener = undefined
  let sequence = 0
  const send = (command: object) =>
    new Promise<void>((resolve, reject) => {
      if (failure || closed) {
        reject(failure ?? new Error('Device preview is closed'))
        return
      }
      const id = ++sequence
      const timer = setTimeout(() => {
        pending.delete(id)
        const error = new Error('Physical device input timed out')
        reject(error)
        report(error)
      }, 10000)
      pending.set(id, {
        resolve,
        reject,
        timer,
      })
      child.stdin!.write(
        JSON.stringify({
          id,
          ...command,
        }) + '\n',
        (error) => {
          if (error) report(error)
        },
      )
    })
  const release = () =>
    send({
      type: 'release',
    })
  return {
    start(frame, error) {
      frameListener = frame
      errorListener = error
      if (failure) error(failure)
      else if (lastFrame) frame(lastFrame)
      return () => {
        frameListener = undefined
        errorListener = undefined
      }
    },
    async input(input) {
      if (input.type === 'pointer') {
        if (!lastFrame) throw new Error('Wait for the device screen before sending input')
        await send({
          type: 'pointer',
          phase: input.phase,
          ...physicalPoint(input.x, input.y, lastFrame.width, lastFrame.height),
        })
      } else if (input.type === 'key') {
        const buttons: Record<string, number> = {
          Home: 0x40,
          Lock: 0x30,
          VolumeUp: 0xe9,
          VolumeDown: 0xea,
          Mute: 0xe2,
        }
        if (buttons[input.key] !== undefined)
          await send({
            type: 'button',
            code: buttons[input.key],
          })
        else
          await send({
            type: 'key',
            codes: physicalKeys(input.key),
          })
      } else if (input.type === 'text') {
        const keys = Array.from(input.text).map(asciiKey)
        if (keys.some((value) => !value)) {
          await new Promise<void>((resolve, reject) => {
            const copy = spawn(
              'xcrun',
              [
                'devicectl',
                'device',
                'pasteboard',
                'copy',
                '--device',
                device.runtime,
                '--timeout',
                '10',
              ],
              {
                stdio: ['pipe', 'ignore', 'pipe'],
              },
            )
            copy.on('error', reject)
            copy.stdin.on('error', reject)
            copy.on('exit', (code) =>
              code === 0
                ? resolve()
                : reject(new Error('Could not copy text to the device pasteboard')),
            )
            copy.stdin.end(input.text)
          })
          await send({
            type: 'key',
            codes: [227, 25],
          })
        } else
          for (const key of keys)
            if (key)
              await send({
                type: 'key',
                codes: [...(key.shift ? [225] : []), key.code],
              })
      } else if (input.type === 'scroll') {
        if (!lastFrame) return
        const { width, height } = lastFrame
        const start = physicalPoint(input.x, input.y, width, height)
        const end = physicalPoint(input.x - input.deltaX, input.y - input.deltaY, width, height)
        await send({
          type: 'pointer',
          phase: 'down',
          ...start,
        })
        try {
          for (let step = 1; step <= 8; step++) {
            await send({
              type: 'pointer',
              phase: 'move',
              x: Math.round(start.x + ((end.x - start.x) * step) / 8),
              y: Math.round(start.y + ((end.y - start.y) * step) / 8),
            })
            await new Promise((resolve) => setTimeout(resolve, 12))
          }
        } finally {
          await send({
            type: 'pointer',
            phase: 'up',
            ...end,
          })
        }
      } else throw new Error('This action is unavailable on a physical device')
    },
    release,
    async close() {
      if (closed) return
      closed = true
      frameListener = undefined
      errorListener = undefined
      for (const operation of pending.values()) {
        clearTimeout(operation.timer)
        operation.reject(new Error('Device preview closed'))
      }
      pending.clear()
      await Promise.all([stop(child), stop(decoder)])
      lines.close()
      parser.destroy()
    },
  }
}
