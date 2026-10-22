import { beforeEach, expect, it, vi } from 'vite-plus/test'
import { Schema } from 'effect'
const fs = vi.hoisted(() => ({
  files: new Map<string, string>(),
  directories: new Set<string>(),
  writing: false,
  failWrite: false,
  writeGate: undefined as Promise<void> | undefined,
}))
vi.mock('expo-file-system', () => {
  const uri = (parts: unknown[]) =>
    parts.map((part) => (part instanceof Directory ? part.uri : String(part))).join('/')
  class Directory {
    uri: string
    constructor(...parts: unknown[]) {
      this.uri = uri(parts)
    }
    get exists() {
      return fs.directories.has(this.uri)
    }
  }
  class File {
    uri: string
    constructor(...parts: unknown[]) {
      this.uri = uri(parts)
    }
    get name() {
      return this.uri.split('/').at(-1)!
    }
    get exists() {
      return fs.files.has(this.uri)
    }
    async text() {
      const text = fs.files.get(this.uri)
      if (text === undefined) throw new Error('Missing file')
      return text
    }
    async move(target: File) {
      fs.files.set(target.uri, await this.text())
      fs.files.delete(this.uri)
      this.uri = target.uri
    }
  }
  return { Directory, File, Paths: { document: '/documents' } }
})
vi.mock('expo-file-system/legacy', () => ({
  async makeDirectoryAsync(uri: string) {
    fs.directories.add(uri)
  },
  async writeAsStringAsync(uri: string, value: string) {
    fs.writing = true
    await fs.writeGate
    if (fs.failWrite) throw new Error('Storage unavailable')
    fs.files.set(uri, value)
  },
  async deleteAsync(uri: string) {
    for (const key of fs.files.keys())
      if (key === uri || key.startsWith(uri + '/')) fs.files.delete(key)
  },
}))
vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA256' },
  digestStringAsync: async (_algorithm: string, value: string) => {
    const { createHash } = await import('node:crypto')
    return createHash('sha256').update(value).digest('hex')
  },
}))
import { mobileReadCache } from './read-cache'
const connection = { address: 'http://host.lan:4310', token: 'device' }
beforeEach(() => {
  fs.files.clear()
  fs.directories.clear()
  fs.writing = false
  fs.failWrite = false
  fs.writeGate = undefined
})
it('keeps the committed value readable until the asynchronous replacement completes', async () => {
  const cache = mobileReadCache(connection)
  await cache.write('snapshot', 'committed')
  const gate = Promise.withResolvers<void>()
  fs.writeGate = gate.promise
  fs.writing = false
  const write = cache.write('snapshot', 'replacement')
  await vi.waitFor(() => expect(fs.writing).toBe(true))
  expect((await cache.read('snapshot', Schema.String))?.value).toBe('committed')
  gate.resolve()
  await write
  expect((await cache.read('snapshot', Schema.String))?.value).toBe('replacement')
  expect([...fs.files.keys()].some((key) => key.endsWith('.tmp'))).toBe(false)
  await cache.close()
})
it('preserves committed data on failure, reports the storage error and recovers', async () => {
  const cache = mobileReadCache(connection)
  await cache.write('snapshot', 'committed')
  fs.failWrite = true
  await expect(cache.write('snapshot', 'lost')).rejects.toThrow('Storage unavailable')
  expect((await cache.read('snapshot', Schema.String))?.value).toBe('committed')
  fs.failWrite = false
  await cache.write('snapshot', 'recovered')
  expect((await cache.read('snapshot', Schema.String))?.value).toBe('recovered')
  await cache.close()
})
it('isolates credentials and clears every credential for only the forgotten computer', async () => {
  const cache = mobileReadCache(connection)
  const replaced = mobileReadCache({ ...connection, token: 'replaced' })
  const other = mobileReadCache({ ...connection, address: 'http://other.lan:4310' })
  await cache.write('snapshot', 'private')
  expect(await replaced.read('snapshot', Schema.String)).toBeNull()
  await replaced.write('snapshot', 'replacement')
  await other.write('snapshot', 'other computer')
  await cache.clear()
  expect(replaced.closed).toBe(true)
  await replaced.write('late', 'late response')
  expect([...fs.files.values()]).toHaveLength(1)
  expect((await other.read('snapshot', Schema.String))?.value).toBe('other computer')
  await other.close()
})
it('waits for an in-flight native write before forgetting the computer', async () => {
  const cache = mobileReadCache(connection)
  const gate = Promise.withResolvers<void>()
  fs.writeGate = gate.promise
  const write = cache.write('snapshot', 'pending')
  await vi.waitFor(() => expect(fs.writing).toBe(true))
  const clear = cache.clear()
  gate.resolve()
  await Promise.all([write, clear])
  expect(fs.files.size).toBe(0)
  expect(cache.closed).toBe(true)
})
