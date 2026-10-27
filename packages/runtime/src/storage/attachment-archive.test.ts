import { expect, it, afterEach } from 'vite-plus/test'
import { zipSync, strToU8 } from 'fflate'
import { randomUUID } from 'node:crypto'
import { listAttachmentArchive, readAttachmentArchive } from './attachment-archive'
import { startRuntime } from '../index'
import { fixture } from '../testing/fixture'
import type { Attachment } from '@dovo/protocol'

const id = randomUUID()
const source = (bytes: Uint8Array) => ({
  read: () => ({
    attachment: { id, name: 'report.zip', mime: 'application/zip', size: bytes.length },
    data: Buffer.from(bytes).toString('base64'),
  }),
})
const input = { taskId: 'task', id }
const central = (data: Buffer) => data.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))

it('lists folders, reads text/image/empty entries and supports long archive comments without writing files', async () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1kAAAAASUVORK5CYII=',
    'base64',
  )
  const zipped = Buffer.from(
    zipSync({
      'report/': new Uint8Array(),
      'report/notes.txt': strToU8('Release results'),
      'images/screen.png': png,
      'empty.txt': new Uint8Array(),
    }),
  )
  const bytes = Buffer.concat([zipped, Buffer.alloc(200, 'a')])
  bytes.writeUInt16LE(200, zipped.length - 2)
  expect((await listAttachmentArchive(source(bytes), input)).entries).toEqual([
    { path: 'report/', directory: true, size: 0 },
    { path: 'report/notes.txt', directory: false, size: 15 },
    { path: 'images/screen.png', directory: false, size: png.length },
    { path: 'empty.txt', directory: false, size: 0 },
  ])
  expect(
    await readAttachmentArchive(source(bytes), { ...input, path: 'report/notes.txt' }),
  ).toMatchObject({
    name: 'notes.txt',
    mime: 'text/plain',
    size: 15,
    data: Buffer.from('Release results').toString('base64'),
  })
  expect(
    await readAttachmentArchive(source(bytes), { ...input, path: 'images/screen.png' }),
  ).toMatchObject({ mime: 'image/png', data: png.toString('base64') })
  expect(await readAttachmentArchive(source(bytes), { ...input, path: 'empty.txt' })).toMatchObject(
    { size: 0, data: '' },
  )
  await expect(readAttachmentArchive(source(bytes), { ...input, path: 'report/' })).rejects.toThrow(
    'not found',
  )
})

it.each(['../secret', '/absolute', 'C:/file', 'a\\b', 'a/./b', 'a/../b', 'a//b', 'a\u0000b'])(
  'rejects unsafe archive paths: %s',
  async (path) => {
    const bytes = zipSync({ [path]: strToU8('test') })
    await expect(listAttachmentArchive(source(bytes), input)).rejects.toThrow('cannot be browsed')
  },
)

it('rejects symlinks, encryption, duplicate paths, file/folder conflicts and malformed archives', async () => {
  for (const mutate of [
    (data: Buffer) => data.writeUInt32LE(0xa1ff0000, central(data) + 38),
    (data: Buffer) => data.writeUInt16LE(1, central(data) + 8),
  ]) {
    const data = Buffer.from(zipSync({ 'a.txt': strToU8('test') }))
    mutate(data)
    await expect(listAttachmentArchive(source(data), input)).rejects.toThrow('cannot be browsed')
  }
  const duplicates = Buffer.from(zipSync({ 'a.txt': strToU8('a'), 'b.txt': strToU8('b') }))
  const second = duplicates.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), central(duplicates) + 4)
  duplicates.write('a.txt', second + 46)
  await expect(listAttachmentArchive(source(duplicates), input)).rejects.toThrow(
    'cannot be browsed',
  )
  await expect(
    listAttachmentArchive(source(zipSync({ a: strToU8('a'), 'a/child': strToU8('b') })), input),
  ).rejects.toThrow('cannot be browsed')
  for (const data of [Buffer.from('not a ZIP'), Buffer.alloc(30), Buffer.from([0x50, 0x4b])])
    await expect(listAttachmentArchive(source(data), input)).rejects.toThrow('cannot be browsed')
})

it('bounds compressed input, entry count, declared entry/total size and compression ratio', async () => {
  await expect(
    listAttachmentArchive(source(Buffer.alloc(5 * 1024 * 1024 + 1)), input),
  ).rejects.toThrow('5 MB')
  const tooMany = Buffer.from(zipSync({ 'a.txt': strToU8('a') }))
  tooMany.writeUInt16LE(513, tooMany.length - 12)
  await expect(listAttachmentArchive(source(tooMany), input)).rejects.toThrow('512 entries')
  const tooLarge = Buffer.from(zipSync({ 'a.txt': strToU8('a') }))
  tooLarge.writeUInt32LE(5 * 1024 * 1024 + 1, central(tooLarge) + 24)
  await expect(listAttachmentArchive(source(tooLarge), input)).rejects.toThrow('expanded ZIP')
  const bomb = zipSync({ 'repeated.txt': new Uint8Array(2 * 1024 * 1024) })
  await expect(listAttachmentArchive(source(bomb), input)).rejects.toThrow('expanded ZIP')
  const total = Buffer.from(
    zipSync(
      Object.fromEntries(
        Array.from({ length: 5 }, (_, index) => [`file-${index}`, new Uint8Array(900000)]),
      ),
      { level: 0 },
    ),
  )
  let offset = central(total)
  for (let i = 0; i < 5; i++) {
    total.writeUInt32LE(5 * 1024 * 1024, offset + 24)
    offset = total.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), offset + 4)
  }
  await expect(listAttachmentArchive(source(total), input)).rejects.toThrow('expanded ZIP')
})

it('bounds actual inflated bytes and validates size/checksum instead of trusting the directory', async () => {
  const bytes = Buffer.from(
    zipSync({ 'notes.txt': strToU8('Actual contents longer than claimed') }),
  )
  bytes.writeUInt32LE(2, central(bytes) + 24)
  await expect(
    readAttachmentArchive(source(bytes), { ...input, path: 'notes.txt' }),
  ).rejects.toThrow('expanded file')
  const badCrc = Buffer.from(zipSync({ 'notes.txt': strToU8('CRC content') }))
  badCrc.writeUInt32LE(123, central(badCrc) + 16)
  await expect(
    readAttachmentArchive(source(badCrc), { ...input, path: 'notes.txt' }),
  ).rejects.toThrow('cannot be browsed')
})

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
it('authenticates HTTP requests, isolates thread attachments and attaches a selected entry through the existing draft flow', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const token = 'zip-owner-token-with-more-than-32-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanups.push(runtime.close)
  const s = runtime.services
  s.store.update(() => f.workspace)
  const task = s.tasks.create({
    title: 'Archive',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: '',
  })
  const bytes = zipSync({ 'nested/notes.txt': strToU8('Selected context') })
  const uploaded = await s.attachments.upload({
    taskId: task.id,
    id,
    name: 'report.zip',
    data: Buffer.from(bytes).toString('base64'),
  })
  const request = (path: string, value: unknown, credential = token) =>
    fetch(`http://127.0.0.1:${runtime.port}/api/attachments/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    })
  expect((await request('archive/list', { taskId: task.id, id }, 'invalid')).status).toBe(401)
  expect((await request('archive/list', { taskId: 'another-task', id })).status).toBe(400)
  expect((await request('archive/list', { taskId: task.id, id })).status).toBe(200)
  const response = await request('archive/read', { taskId: task.id, id, path: 'nested/notes.txt' })
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({
    name: 'notes.txt',
    data: Buffer.from('Selected context').toString('base64'),
  })
  const selectedId = randomUUID()
  const attach = await request('upload', {
    taskId: task.id,
    id: selectedId,
    name: 'notes.txt',
    data: Buffer.from('Selected context').toString('base64'),
  })
  expect(attach.status).toBe(200)
  const attachments: readonly Attachment[] = s.store.task(task.id).draftAttachments ?? []
  expect(attachments.map((file) => file.id)).toEqual([uploaded.attachment.id, selectedId])
  expect(s.attachments.read(task.id, id).data).toBe(Buffer.from(bytes).toString('base64'))
  expect(
    (await request('archive/read', { taskId: task.id, id, path: 'x'.repeat(1025) })).status,
  ).toBe(400)
})
