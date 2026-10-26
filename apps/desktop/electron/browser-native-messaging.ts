import { app } from 'electron'
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { Schema } from 'effect'
import { randomUUID } from 'node:crypto'

const HOST = /^[a-z0-9_]+(?:\.[a-z0-9_]+)*$/
const CONNECTION = /^[a-zA-Z0-9-]{1,100}$/
const MAX_MESSAGE = 1024 * 1024
const MAX_WRITE = 64 * 1024 * 1024

export type NativeSender = {
  ipc: {
    on: (channel: string, listener: (event: unknown, message: unknown) => void) => unknown
    off: (channel: string, listener: (event: unknown, message: unknown) => void) => unknown
  }
  send: (channel: string, ...args: unknown[]) => void
  isDestroyed: () => boolean
} & ({ getURL: () => string } | { scope: string; startTask: () => { end: () => void } })
type Sender = NativeSender
export type NativeExtensionEvent = {
  sender: Sender
  extension: Pick<Electron.Extension, 'id' | 'path'>
}
type Event = NativeExtensionEvent
type Handler = (event: Event, ...args: unknown[]) => unknown
type Register = (name: string, callback: Handler, options?: { permission?: string }) => void
const internals = Schema.Struct({
  ctx: Schema.Struct({
    router: Schema.Struct({
      apiHandler: Schema.declare(
        (value: unknown): value is () => Register => typeof value === 'function',
      ),
    }),
  }),
})

/** Chrome's stdio protocol is a stream: chunks may contain partial or several UTF-8 messages. */
export function nativeMessageDecoder(receive: (message: unknown) => void) {
  let pending = Buffer.alloc(0)
  return (chunk: Buffer) => {
    pending = Buffer.concat([pending, chunk])
    while (pending.length >= 4) {
      const size = pending.readUInt32LE(0)
      if (!size || size > MAX_MESSAGE) throw new Error('Invalid native helper message size.')
      if (pending.length < size + 4) return
      const message: unknown = JSON.parse(pending.subarray(4, size + 4).toString('utf8'))
      pending = pending.subarray(size + 4)
      receive(message)
    }
  }
}
export function encodeNativeMessage(message: unknown) {
  const json = JSON.stringify(message)
  if (json === undefined) throw new Error('Native messages must be JSON values.')
  const bytes = Buffer.from(json, 'utf8')
  if (bytes.length > MAX_WRITE) throw new Error('Native message is too large.')
  const header = Buffer.alloc(4)
  header.writeUInt32LE(bytes.length)
  return Buffer.concat([header, bytes])
}
function registryPath(key: string) {
  return new Promise<string | undefined>((accept) => {
    execFile(
      'reg.exe',
      ['query', key, '/ve'],
      { windowsHide: true, timeout: 5000 },
      (error, stdout) => {
        accept(error ? undefined : /REG_SZ\s+([^\r\n]+)/.exec(stdout)?.[1]?.trim())
      },
    )
  })
}
export async function nativeHostPaths(name: string, userData: string) {
  if (!HOST.test(name) || name.length > 200) throw new Error('Invalid native helper name.')
  const file = `${name}.json`
  if (process.platform === 'win32') {
    const values = await Promise.all(
      ['HKCU', 'HKLM'].map((hive) =>
        registryPath(`${hive}\\Software\\Google\\Chrome\\NativeMessagingHosts\\${name}`),
      ),
    )
    return values.filter((value): value is string => !!value)
  }
  return process.platform === 'darwin'
    ? [
        join(homedir(), 'Library/Application Support/Google/Chrome/NativeMessagingHosts', file),
        join('/Library/Google/Chrome/NativeMessagingHosts', file),
        join(homedir(), 'Library/Application Support/Chromium/NativeMessagingHosts', file),
        join(userData, 'NativeMessagingHosts', file),
      ]
    : [
        join(
          process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'),
          'google-chrome/NativeMessagingHosts',
          file,
        ),
        join(
          process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'),
          'chromium/NativeMessagingHosts',
          file,
        ),
        join('/etc/opt/chrome/native-messaging-hosts', file),
        join('/etc/chromium/native-messaging-hosts', file),
        join(userData, 'NativeMessagingHosts', file),
      ]
}
export async function resolveNativeHost(name: string, extensionId: string, paths: string[]) {
  if (!HOST.test(name) || !/^[a-p]{32}$/.test(extensionId))
    throw new Error('Invalid native helper identity.')
  const origin = `chrome-extension://${extensionId}/`
  for (const file of paths) {
    let raw: string
    try {
      const info = await stat(file)
      if (!info.isFile() || info.size > 64 * 1024)
        throw new Error('Invalid native helper registration.')
      raw = await readFile(file, 'utf8')
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') continue
      throw error
    }
    const value: unknown = JSON.parse(raw)
    const schema = Schema.Struct({
      name: Schema.Literal(name),
      type: Schema.Literal('stdio'),
      path: Schema.String,
      allowed_origins: Schema.Array(Schema.String),
    })
    if (!Schema.is(schema)(value) || !value.allowed_origins.includes(origin))
      throw new Error('This desktop helper does not allow this extension.')
    if (process.platform !== 'win32' && !isAbsolute(value.path))
      throw new Error('The desktop helper must have an absolute executable path.')
    const path = resolve(dirname(file), value.path)
    if (!(await stat(path)).isFile()) throw new Error('The desktop helper executable is missing.')
    return { path, origin }
  }
  throw new Error(`Desktop helper “${name}” is not installed.`)
}

/** Replace the pinned library's unbounded stdio transport, retaining its extension IPC router. */
export function attachNativeMessaging(
  library: unknown,
  options: {
    enabled: () => boolean
    session: { extensions: Pick<Electron.Session['extensions'], 'getExtension'> }
    allow: (extension: Electron.Extension, host: string, executable: string) => Promise<boolean>
  },
) {
  if (!Schema.is(internals)(library))
    throw new Error('Native messaging is unavailable in this build.')
  const handle = library.ctx.router.apiHandler()
  type Port = { extensionId: string; sender: Sender; close: () => void }
  const ports = new Map<string, Port>()
  const check = (event: Event) => {
    const extension = options.session.extensions.getExtension(event.extension.id)
    const manifest = extension?.manifest
    const permissions: unknown = manifest?.permissions
    const optional: unknown = manifest?.optional_permissions
    const url = 'scope' in event.sender ? event.sender.scope : event.sender.getURL()
    if (
      !options.enabled() ||
      !extension ||
      extension.path !== event.extension.path ||
      event.sender.isDestroyed() ||
      !url.startsWith(`chrome-extension://${extension.id}/`) ||
      ![permissions, optional].some(
        (list) => Array.isArray(list) && list.includes('nativeMessaging'),
      )
    )
      throw new Error('Native messaging requires an enabled extension with desktop-helper access.')
    return extension
  }
  const connect = async (
    event: Event,
    id: unknown,
    host: unknown,
    first?: { message: unknown },
  ) => {
    if (typeof id !== 'string' || !CONNECTION.test(id) || ports.has(id))
      throw new Error('Invalid or duplicate native connection.')
    if (typeof host !== 'string') throw new Error('Invalid native helper name.')
    const extension = check(event)
    const sender = event.sender
    if (ports.size >= 32) throw new Error('Too many desktop helper connections.')
    const channel = `crx-native-msg-${id}`
    let child: ChildProcessWithoutNullStreams | undefined
    let ended = false
    const workerTask = 'startTask' in sender ? sender.startTask() : undefined
    let queued = 0
    const messages: Buffer[] = []
    let finish: ((value: unknown) => void) | undefined
    let fail: ((error: Error) => void) | undefined
    const response = first
      ? new Promise<unknown>((yes, no) => {
          finish = yes
          fail = no
        })
      : undefined
    // Attach rejection handling while registration or user consent is pending.
    void response?.catch(() => {})
    const send = (suffix: string, value?: unknown) => {
      if (!sender.isDestroyed()) {
        try {
          sender.send(`${channel}${suffix}`, value)
        } catch {
          /* Renderer went away. */
        }
      }
    }
    const close = (error = new Error('Desktop helper disconnected.')) => {
      if (ended) return
      ended = true
      workerTask?.end()
      clearInterval(lifetime)
      clearTimeout(deadline)
      sender.ipc.off(channel, receive)
      ports.delete(id)
      child?.kill()
      fail?.(error)
      if (!first) send('-disconnect')
    }
    const write = (message: unknown) => {
      try {
        if (ended) return
        check(event)
        const bytes = encodeNativeMessage(message)
        if ((child?.stdin.writableLength ?? queued) + bytes.length > MAX_WRITE)
          throw new Error('Desktop helper message queue is full.')
        if (child) child.stdin.write(bytes)
        else {
          messages.push(bytes)
          queued += bytes.length
        }
      } catch (error) {
        close(error instanceof Error ? error : new Error('Invalid native message.'))
      }
    }
    const receive = (_event: unknown, message: unknown) => write(message)
    const lifetime = setInterval(() => {
      try {
        check(event)
      } catch {
        close()
      }
    }, 1000)
    lifetime.unref()
    const deadline = setTimeout(
      () => close(new Error('Desktop helper connection timed out.')),
      first ? 30_000 : 120_000,
    )
    deadline.unref()
    ports.set(id, { extensionId: extension.id, sender, close })
    if (!first) sender.ipc.on(channel, receive)
    try {
      const config = await resolveNativeHost(
        host,
        extension.id,
        await nativeHostPaths(host, app.getPath('userData')),
      )
      if (ended) return response
      if (!(await options.allow(extension, host, config.path)))
        throw new Error('Desktop helper connection was not approved.')
      if (ended) return response
      check(event)
      const approved = await resolveNativeHost(
        host,
        extension.id,
        await nativeHostPaths(host, app.getPath('userData')),
      )
      if (approved.path !== config.path)
        throw new Error('The desktop helper registration changed. Connect again to review it.')
      if (ended) return response
      check(event)
      child = spawn(
        config.path,
        [config.origin, ...(process.platform === 'win32' ? ['--parent-window=0'] : [])],
        {
          shell: false,
          windowsHide: true,
          cwd: dirname(config.path),
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      )
      if (!first) clearTimeout(deadline)
      const decode = nativeMessageDecoder((message) => {
        if (ended) return
        try {
          check(event)
        } catch {
          close()
          return
        }
        if (first) {
          finish?.(message)
          fail = undefined
          close()
        } else send('', message)
      })
      child.stdout.on('data', (data: Buffer) => {
        try {
          decode(data)
        } catch {
          close(new Error('Desktop helper sent an invalid message.'))
        }
      })
      // Never log native payloads or helper stderr: password managers send sensitive data.
      child.stderr.resume()
      child.on('error', () => close(new Error('Desktop helper could not start.')))
      child.on('exit', () => close())
      child.stdin.on('error', () => close())
      for (const message of messages) child.stdin.write(message)
      messages.length = 0
      if (first) write(first.message)
      return response
    } catch (error) {
      close(error instanceof Error ? error : new Error('Desktop helper could not connect.'))
      if (first) return response
    }
  }
  handle('runtime.connectNative', (event, id, host) => connect(event, id, host))
  handle('runtime.disconnectNative', (event, id) => {
    if (typeof id !== 'string') return
    const port = ports.get(id)
    if (port?.sender === event.sender && port.extensionId === event.extension.id) port.close()
  })
  handle('runtime.sendNativeMessage', (event, host, message) =>
    connect(event, randomUUID(), host, { message }),
  )
  return {
    close: (extensionId?: string) => {
      for (const port of ports.values())
        if (!extensionId || port.extensionId === extensionId) port.close()
    },
  }
}
