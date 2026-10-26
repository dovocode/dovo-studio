import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test'
import { EventEmitter } from 'node:events'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  attachNativeMessaging,
  encodeNativeMessage,
  nativeHostPaths,
  nativeMessageDecoder,
  resolveNativeHost,
  type NativeExtensionEvent,
  type NativeSender,
} from './browser-native-messaging'
const f = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({ app: { getPath: () => f.userData } }))
const extension: Electron.Extension = {
  id: 'a'.repeat(32),
  name: 'Fixture',
  version: '1',
  path: '/managed/fixture',
  url: `chrome-extension://${'a'.repeat(32)}/`,
  manifest: { permissions: ['nativeMessaging'] },
}
const cleanup: (() => void)[] = []
let root = ''
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dovo-native-host-'))
  f.userData = root
})
afterEach(async () => {
  cleanup.splice(0).forEach((close) => close())
  await rm(root, { recursive: true, force: true })
})
async function fixture(overrides: object = {}) {
  const directory = join(root, 'NativeMessagingHosts')
  await mkdir(directory, { recursive: true })
  const path = join(root, 'helper')
  await writeFile(
    path,
    `#!${process.execPath}
const fs=require('fs');fs.writeFileSync(${JSON.stringify(join(root, 'started'))},'yes');
let data=Buffer.alloc(0);process.stdin.on('data',chunk=>{data=Buffer.concat([data,chunk]);while(data.length>=4&&data.length>=4+data.readUInt32LE(0)){const n=data.readUInt32LE(0);const value=JSON.parse(data.subarray(4,n+4));data=data.subarray(n+4);const b=Buffer.from(JSON.stringify({echo:value,origin:process.argv[2]}));const h=Buffer.alloc(4);h.writeUInt32LE(b.length);process.stdout.write(h.subarray(0,2));setTimeout(()=>process.stdout.write(Buffer.concat([h.subarray(2),b])),5)}})
`,
  )
  await chmod(path, 0o700)
  const config = join(directory, 'com.dovo.fixture.json')
  await writeFile(
    config,
    JSON.stringify({
      name: 'com.dovo.fixture',
      path,
      type: 'stdio',
      allowed_origins: [extension.url],
      ...overrides,
    }),
  )
  return config
}
function bridge(allow = vi.fn<() => Promise<boolean>>(async () => true)) {
  let enabled = true
  let loaded: Electron.Extension | undefined = extension
  const handlers = new Map<string, (event: NativeExtensionEvent, ...args: unknown[]) => unknown>()
  const library = {
    ctx: {
      router: {
        apiHandler:
          () =>
          (name: string, callback: (event: NativeExtensionEvent, ...args: unknown[]) => unknown) =>
            handlers.set(name, callback),
      },
    },
  }
  const ipc = new EventEmitter()
  const send = vi.fn<(channel: string, ...args: unknown[]) => void>()
  const end = vi.fn<() => void>()
  const sender: NativeSender = {
    ipc,
    send,
    isDestroyed: () => false,
    scope: extension.url,
    startTask: () => ({ end }),
  }
  const event = { sender, extension }
  const controller = attachNativeMessaging(library, {
    session: { extensions: { getExtension: () => loaded ?? null } },
    enabled: () => enabled,
    allow,
  })
  cleanup.push(() => controller.close())
  return {
    controller,
    allow,
    ipc,
    send,
    end,
    sender,
    event,
    call: (name: string, ...args: unknown[]) => handlers.get(`runtime.${name}`)!(event, ...args),
    disable: () => {
      enabled = false
    },
    unload: () => {
      loaded = undefined
    },
    handlers,
  }
}
it('uses UTF-8 byte lengths and decodes fragmented and batched messages', () => {
  const messages: unknown[] = []
  const decode = nativeMessageDecoder((message) => messages.push(message))
  const first = encodeNativeMessage({ text: '🔐 café 日本語' })
  expect(first.readUInt32LE(0)).toBe(first.length - 4)
  decode(first.subarray(0, 2))
  decode(first.subarray(2, 7))
  expect(messages).toEqual([])
  decode(Buffer.concat([first.subarray(7), encodeNativeMessage({ second: true })]))
  expect(messages).toEqual([{ text: '🔐 café 日本語' }, { second: true }])
})
it('rejects oversized lengths, malformed JSON and non-JSON writes', () => {
  const header = Buffer.alloc(4)
  header.writeUInt32LE(1024 * 1024 + 1)
  expect(() => nativeMessageDecoder(() => {})(header)).toThrow('size')
  expect(() => nativeMessageDecoder(() => {})(Buffer.from([1, 0, 0, 0, 123]))).toThrow(Error)
  expect(() => encodeNativeMessage(undefined)).toThrow('JSON')
})
it('resolves only registered helpers with matching names and allowed extension origins', async () => {
  const config = await fixture()
  expect(await resolveNativeHost('com.dovo.fixture', extension.id, [config])).toMatchObject({
    origin: extension.url,
  })
  await expect(resolveNativeHost('com.other', extension.id, [config])).rejects.toThrow(
    'does not allow',
  )
  await expect(resolveNativeHost('com.dovo.fixture', 'b'.repeat(32), [config])).rejects.toThrow(
    'does not allow',
  )
  for (const host of ['../escape', 'com..host', '/tmp/helper', 'UPPER.case'])
    await expect(nativeHostPaths(host, root)).rejects.toThrow('Invalid')
})
it.skipIf(process.platform === 'win32')(
  'roundtrips one-shot and long-lived messages through a real registered stdio helper',
  async () => {
    await fixture()
    const b = bridge()
    const value = { text: '🔐 café', count: 3 }
    expect(await b.call('sendNativeMessage', 'com.dovo.fixture', value)).toEqual({
      echo: value,
      origin: extension.url,
    })
    await b.call('connectNative', 'port-1', 'com.dovo.fixture')
    b.ipc.emit('crx-native-msg-port-1', {}, value)
    await expect
      .poll(() => b.send.mock.calls)
      .toContainEqual(['crx-native-msg-port-1', { echo: value, origin: extension.url }])
    b.call('disconnectNative', 'port-1')
    expect(b.send).toHaveBeenCalledWith('crx-native-msg-port-1-disconnect', undefined)
    expect(b.ipc.listenerCount('crx-native-msg-port-1')).toBe(0)
    expect(b.end).toHaveBeenCalledTimes(2)
  },
)
it('denial, removed extensions and opt-out cannot launch helper processes', async () => {
  await fixture()
  const b = bridge(vi.fn<() => Promise<boolean>>(async () => false))
  await b.call('connectNative', 'port-1', 'com.dovo.fixture')
  await expect(readFile(join(root, 'started'))).rejects.toThrow(Error)
  b.disable()
  await expect(b.call('connectNative', 'port-2', 'com.dovo.fixture')).rejects.toThrow(
    'enabled extension',
  )
  const second = bridge()
  second.unload()
  await expect(second.call('connectNative', 'port-2', 'com.dovo.fixture')).rejects.toThrow(
    'enabled extension',
  )
})
it('validates source context and prevents another sender disconnecting a live port', async () => {
  await fixture()
  const b = bridge()
  const foreign: NativeSender = { ...b.sender, scope: 'https://example.com/' }
  await expect(
    b.handlers.get('runtime.connectNative')!(
      { ...b.event, sender: foreign },
      'port-1',
      'com.dovo.fixture',
    ),
  ).rejects.toThrow('enabled extension')
  await b.call('connectNative', 'port-1', 'com.dovo.fixture')
  b.handlers.get('runtime.disconnectNative')!({ ...b.event, sender: { ...b.sender } }, 'port-1')
  expect(b.ipc.listenerCount('crx-native-msg-port-1')).toBe(1)
  b.controller.close(extension.id)
  expect(b.ipc.listenerCount('crx-native-msg-port-1')).toBe(0)
})
it('opt-out while consent is pending disconnects without starting the helper', async () => {
  await fixture()
  let approve: (value: boolean) => void = () => {}
  const b = bridge(
    vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          approve = resolve
        }),
    ),
  )
  const connecting = b.call('connectNative', 'port-1', 'com.dovo.fixture')
  await expect.poll(() => b.allow.mock.calls.length).toBe(1)
  b.disable()
  b.controller.close()
  approve(true)
  await connecting
  await expect(readFile(join(root, 'started'))).rejects.toThrow(Error)
})
