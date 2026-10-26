import { expect, it, afterEach, vi } from 'vite-plus/test'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'protobufjs'
import {
  chromeStoreId,
  verifiedStoreArchive,
  unpackStoreExtension,
  downloadStoreExtension,
} from './browser-web-store'
const root = parse(
  `syntax="proto2"; message Proof { optional bytes public_key=1; optional bytes signature=2; } message Header { repeated Proof sha256_with_rsa=2; optional bytes signed_header_data=10000; } message SignedData { optional bytes crx_id=1; }`,
).root
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const key = publicKey.export({ type: 'spki', format: 'der' })
const digest = createHash('sha256').update(key).digest().subarray(0, 16)
const id = digest
  .toString('hex')
  .replace(/[0-9a-f]/g, (d) => String.fromCharCode(97 + parseInt(d, 16)))
function packed(
  zip = Buffer.from(
    'UEsDBBQAAAAIAGQ8Wl3kp11+OwAAAEAAAAANAAAAbWFuaWZlc3QuanNvbqtWyk3My0xLLS6JL0stKs7Mz1OyMtZRykvMTVWyUgrOTM9LTVFIy6woKS1KVdJRgqtRMtQz0DNQqgUAUEsBAhQDFAAAAAgAZDxaXeSnXX47AAAAQAAAAA0AAAAAAAAAAAAAAIABAAAAAG1hbmlmZXN0Lmpzb25QSwUGAAAAAAEAAQA7AAAAZgAAAAAA',
    'base64',
  ),
) {
  const signed = root.lookupType('SignedData').encode({ crxId: digest }).finish()
  const length = Buffer.alloc(4)
  length.writeUInt32LE(signed.length)
  const signature = sign(
    'sha256',
    Buffer.concat([Buffer.from('CRX3 SignedData\0'), length, signed, zip]),
    privateKey,
  )
  const header = root
    .lookupType('Header')
    .encode({ sha256WithRsa: [{ publicKey: key, signature }], signedHeaderData: signed })
    .finish()
  const prefix = Buffer.alloc(12)
  prefix.write('Cr24')
  prefix.writeUInt32LE(3, 4)
  prefix.writeUInt32LE(header.length, 8)
  return Buffer.concat([prefix, header, zip])
}
afterEach(() => vi.unstubAllGlobals())
it('accepts store links and IDs, but rejects other origins, credentials and non-extension pages', () => {
  expect(chromeStoreId(id)).toBe(id)
  expect(chromeStoreId('https://chromewebstore.google.com/detail/helper/' + id + '?hl=en')).toBe(id)
  expect(chromeStoreId('https://chrome.google.com/webstore/detail/' + id)).toBe(id)
  for (const url of [
    'http://chromewebstore.google.com/detail/' + id,
    'https://evil.test/detail/' + id,
    'https://user@chromewebstore.google.com/detail/' + id,
    'https://chromewebstore.google.com/category/' + id,
  ])
    expect(() => chromeStoreId(url)).toThrow(/Chrome Web Store/)
})
it('verifies the actual archive signature and binds it to the requested developer ID', () => {
  expect(verifiedStoreArchive(packed(), id).key).toBe(key.toString('base64'))
  expect(() => verifiedStoreArchive(packed(), 'a'.repeat(32))).toThrow(/match/)
  const corrupt = packed()
  corrupt[corrupt.length - 1] ^= 1
  expect(() => verifiedStoreArchive(corrupt, id)).toThrow(/signature/)
  const truncated = packed().subarray(0, 13)
  expect(() => verifiedStoreArchive(truncated, id)).toThrow(/header/)
})
it('unpacks only safe entries after signature verification', async () => {
  const target = await mkdtemp(join(tmpdir(), 'dovo-store-test-'))
  try {
    await unpackStoreExtension(packed(), id, target)
    expect(JSON.parse(await readFile(join(target, 'manifest.json'), 'utf8')).name).toBe(
      'Signed fixture',
    )
    await expect(
      unpackStoreExtension(
        packed(
          Buffer.from(
            'UEsDBBQAAAAIAGQ8Wl3kp11+OwAAAEAAAAAJAAAALi4vZXNjYXBlq1bKTczLTEstLokvSy0qzszPU7Iy1lHKS8xNVbJSCs5Mz0tNUUjLrCgpLUpV0lGCq1Ey1DPQM1CqBQBQSwECFAMUAAAACABkPFpd5KddfjsAAABAAAAACQAAAAAAAAAAAAAAgAEAAAAALi4vZXNjYXBlUEsFBgAAAAABAAEANwAAAGIAAAAAAA==',
            'base64',
          ),
        ),
        id,
        target,
      ),
    ).rejects.toThrow(/unsafe|invalid relative path/)
  } finally {
    await rm(target, { recursive: true, force: true })
  }
})
it('restricts redirects to HTTPS store download hosts and bounds response sizes', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'http://evil.test/file' } }),
    )
  vi.stubGlobal('fetch', request)
  await expect(downloadStoreExtension(id, '148.0.0.0')).rejects.toThrow(/outside/)
  request.mockResolvedValueOnce(
    new Response('x', { headers: { 'content-length': String(65 * 1024 * 1024) } }),
  )
  await expect(downloadStoreExtension(id, '148.0.0.0')).rejects.toThrow(/64 MB/)
  request.mockResolvedValueOnce(new Response(packed()))
  expect(await downloadStoreExtension(id, '148.0.0.0')).toEqual(packed())
  const requested = request.mock.calls[0][0]
  if (!(requested instanceof URL)) throw new Error('Expected official store URL')
  const url = requested
  expect(url.hostname).toBe('clients2.google.com')
  expect(url.searchParams.get('x')).toBe(`id=${id}&uc`)
})
