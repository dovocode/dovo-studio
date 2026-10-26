import { createHash, createPublicKey, verify } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parse } from 'protobufjs'
import { fromBuffer, type ZipFile, type Entry } from 'yauzl'
import type { Readable } from 'node:stream'

const ID = /^[a-p]{32}$/
const MAX_DOWNLOAD = 64 * 1024 * 1024
const MAX_UNPACKED = 256 * 1024 * 1024
// Chromium components/crx_file/crx3.proto. protobufjs handles the protobuf wire format.
const proto = parse(`syntax = "proto2";
message Proof { optional bytes public_key = 1; optional bytes signature = 2; }
message Header { repeated Proof sha256_with_rsa = 2; repeated Proof sha256_with_ecdsa = 3;
 optional bytes signed_header_data = 10000; }
message SignedData { optional bytes crx_id = 1; }`).root
const headerType = proto.lookupType('Header')
const signedType = proto.lookupType('SignedData')
const extensionId = (key: Uint8Array) =>
  createHash('sha256')
    .update(key)
    .digest('hex')
    .slice(0, 32)
    .replace(/[0-9a-f]/g, (digit) => String.fromCharCode(97 + parseInt(digit, 16)))
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

/** Accept a store detail URL or ID, never an arbitrary download URL. */
export function chromeStoreId(input: string) {
  const value = input.trim()
  if (ID.test(value)) return value
  try {
    const url = new URL(value)
    const id = url.pathname.split('/').filter(Boolean).at(-1) ?? ''
    if (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      ((url.hostname === 'chromewebstore.google.com' && url.pathname.startsWith('/detail/')) ||
        (url.hostname === 'chrome.google.com' && url.pathname.startsWith('/webstore/detail/'))) &&
      ID.test(id)
    )
      return id
  } catch {
    /* Report the same validation error for malformed URLs and IDs. */
  }
  throw new Error('Paste a Chrome Web Store extension URL or its 32-character ID.')
}

/** Verify the developer proof and requested identity before reading or writing archive entries. */
export function verifiedStoreArchive(bytes: Buffer, id: string) {
  if (
    !ID.test(id) ||
    bytes.length < 12 ||
    bytes.length > MAX_DOWNLOAD ||
    bytes.toString('ascii', 0, 4) !== 'Cr24' ||
    bytes.readUInt32LE(4) !== 3
  )
    throw new Error('The store did not return a supported CRX3 extension.')
  const length = bytes.readUInt32LE(8)
  if (length > 1024 * 1024 || length > bytes.length - 12)
    throw new Error('Invalid extension header.')
  const header: unknown = headerType.toObject(headerType.decode(bytes.subarray(12, 12 + length)))
  if (!record(header) || !(header.signedHeaderData instanceof Uint8Array))
    throw new Error('Missing extension proof.')
  const signed = header.signedHeaderData
  const data: unknown = signedType.toObject(signedType.decode(signed))
  const idBytes = Buffer.from(
    id.replace(/[a-p]/g, (digit) => (digit.charCodeAt(0) - 97).toString(16)),
    'hex',
  )
  if (!record(data) || !(data.crxId instanceof Uint8Array) || !idBytes.equals(data.crxId))
    throw new Error('The downloaded extension does not match the requested store ID.')
  const payload = bytes.subarray(12 + length)
  const size = Buffer.alloc(4)
  size.writeUInt32LE(signed.length)
  const signedBytes = Buffer.concat([Buffer.from('CRX3 SignedData\0'), size, signed, payload])
  const proofs = [header.sha256WithRsa, header.sha256WithEcdsa].flatMap((value) =>
    Array.isArray(value) ? value : [],
  )
  const valid = proofs.some((proof: unknown) => {
    if (
      !record(proof) ||
      !(proof.publicKey instanceof Uint8Array) ||
      !(proof.signature instanceof Uint8Array) ||
      extensionId(proof.publicKey) !== id
    )
      return false
    try {
      return verify(
        'sha256',
        signedBytes,
        createPublicKey({ key: Buffer.from(proof.publicKey), format: 'der', type: 'spki' }),
        proof.signature,
      )
    } catch {
      return false
    }
  })
  if (!valid) throw new Error('The extension signature could not be verified.')
  const proof = proofs.find(
    (value: unknown) =>
      record(value) && value.publicKey instanceof Uint8Array && extensionId(value.publicKey) === id,
  )
  if (!record(proof) || !(proof.publicKey instanceof Uint8Array))
    throw new Error('Missing extension key.')
  return { payload, key: Buffer.from(proof.publicKey).toString('base64') }
}

/** Extract regular files only, with both declared and actual decompressed byte limits. */
export async function unpackStoreExtension(bytes: Buffer, id: string, target: string) {
  const { payload, key } = verifiedStoreArchive(bytes, id)
  const archive = await new Promise<ZipFile>((resolve, reject) =>
    fromBuffer(
      payload,
      { lazyEntries: true, strictFileNames: true, validateEntrySizes: true },
      (error, zip) => (error ? reject(error) : resolve(zip)),
    ),
  )
  let total = 0
  let entries = 0
  const paths = new Set<string>()
  const extract = async (file: Entry) => {
    if (++entries > 10_000) throw new Error('This extension has too many files.')
    const path = file.fileName
    if (
      !path ||
      path.includes('\\') ||
      path.startsWith('/') ||
      path.includes('\0') ||
      path.split('/').some((part) => part === '..' || part === '.') ||
      /^[A-Za-z]:/.test(path) ||
      paths.has(path.toLowerCase())
    )
      throw new Error('The extension contains an unsafe file path.')
    paths.add(path.toLowerCase())
    const mode = (file.externalFileAttributes >>> 16) & 0o170000
    if (mode && mode !== 0o100000 && mode !== 0o040000)
      throw new Error('Extension archives must contain regular files only.')
    total += file.uncompressedSize
    if (total > MAX_UNPACKED) throw new Error('This extension is larger than 256 MB.')
    if (path.endsWith('/')) {
      await mkdir(join(target, path), { recursive: true })
      return
    }
    const stream = await new Promise<Readable>((resolve, reject) =>
      archive.openReadStream(file, (error, stream) =>
        error
          ? reject(error)
          : stream
            ? resolve(stream)
            : reject(new Error('Missing archive entry.')),
      ),
    )
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of stream) {
      if (!Buffer.isBuffer(chunk)) throw new Error('Invalid archive data.')
      size += chunk.length
      if (size > file.uncompressedSize || size > MAX_UNPACKED) {
        stream.destroy()
        throw new Error('Invalid extension archive size.')
      }
      chunks.push(chunk)
    }
    if (size !== file.uncompressedSize) throw new Error('Invalid extension archive size.')
    await mkdir(dirname(join(target, path)), { recursive: true })
    await writeFile(join(target, path), Buffer.concat(chunks), { flag: 'wx' })
  }
  try {
    await new Promise<void>((resolve, reject) => {
      archive.once('error', reject)
      archive.once('end', resolve)
      archive.on('entry', (file: Entry) => {
        void extract(file).then(() => archive.readEntry(), reject)
      })
      archive.readEntry()
    })
  } finally {
    archive.close()
  }
  return key
}

export async function downloadStoreExtension(id: string, chromeVersion: string) {
  if (!ID.test(id)) throw new Error('Invalid Chrome Web Store ID.')
  let url = new URL('https://clients2.google.com/service/update2/crx')
  url.search = new URLSearchParams({
    response: 'redirect',
    acceptformat: 'crx3',
    prodversion: chromeVersion,
    x: `id=${id}&uc`,
  }).toString()
  const signal = AbortSignal.timeout(60_000)
  for (let redirects = 0; redirects <= 5; redirects++) {
    const response = await fetch(url, { redirect: 'manual', signal, credentials: 'omit' })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel()
      const location = response.headers.get('location')
      if (!location) throw new Error('The store returned an invalid redirect.')
      url = new URL(location, url)
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.port ||
        !['google.com', 'googleusercontent.com', 'gvt1.com'].some(
          (host) => url.hostname === host || url.hostname.endsWith('.' + host),
        )
      )
        throw new Error('The store redirected outside its download service.')
      continue
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel()
      throw new Error('This extension could not be downloaded from the Chrome Web Store.')
    }
    if (Number(response.headers.get('content-length')) > MAX_DOWNLOAD) {
      await response.body.cancel()
      throw new Error('The extension download is larger than 64 MB.')
    }
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of response.body) {
      size += chunk.length
      if (size > MAX_DOWNLOAD) throw new Error('The extension download is larger than 64 MB.')
      chunks.push(Buffer.from(chunk))
    }
    return Buffer.concat(chunks)
  }
  throw new Error('The store returned too many redirects.')
}
