import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { chromium } from 'playwright'
import type { RemoteBrowserMessage } from '@dovo/protocol'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { runtimeIntegration } from '../testing/integration'
import { BrowserTransferStorage } from './browser-transfer-storage.js'
import { BrowserUploads } from './browser-uploads.js'

vi.setConfig(runtimeIntegration)
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

it('stages selections in runtime-owned storage that Chromium reads lazily until the document is replaced', async () => {
  const data = mkdtempSync(join(tmpdir(), 'dovo-browser-uploads-'))
  cleanups.push(async () => rmSync(data, { recursive: true, force: true }))
  const root = join(data, 'browser-transfers')
  const storage = new BrowserTransferStorage(root)
  cleanups.push(() => storage.dispose())
  const browser = await chromium.launch()
  cleanups.push(() => browser.close())
  const page = await browser.newPage()
  await page.setContent('<input type="file" id="file">')

  const messages: Exclude<RemoteBrowserMessage, { type: 'frame' }>[] = []
  const uploads = new BrowserUploads(
    (message) => messages.push(message),
    (error) => {
      throw error
    },
    () => storage.allocate('upload'),
  )
  const chooser = page.waitForEvent('filechooser')
  await page.click('#file')
  await uploads.offer(await chooser)
  const offer = messages.find((message) => message.type === 'fileChooser')
  if (offer?.type !== 'fileChooser') throw new Error('No file chooser was offered')
  const authorize = () => {}
  const fileId = randomUUID()
  const contents = 'name,total\nDovo,3\n'
  const base = { requestId: randomUUID(), chooserId: offer.id }
  await uploads.execute(
    {
      ...base,
      type: 'fileUploadStart',
      requestId: fileId,
      name: 'report.csv',
      size: contents.length,
      mimeType: 'text/csv',
    },
    authorize,
  )
  await uploads.execute(
    {
      ...base,
      type: 'fileUploadChunk',
      fileId,
      offset: 0,
      data: Buffer.from(contents).toString('base64'),
    },
    authorize,
  )
  await uploads.execute({ ...base, type: 'fileUploadCommit' }, authorize)

  const staged = readdirSync(root, { recursive: true, encoding: 'utf8' }).find((path) =>
    path.endsWith('report.csv'),
  )
  const [run, upload, request, name] = staged?.split(sep) ?? []
  expect(run).toMatch(/^run-/)
  expect(upload).toMatch(/^upload-/)
  expect([request, name]).toEqual([fileId, 'report.csv'])
  // Another run's startup recovery must leave a live run's selection alone.
  await expect(new BrowserTransferStorage(root).recover()).resolves.toBe(0)
  expect(await page.$eval('#file', (input) => (input as HTMLInputElement).files![0].text())).toBe(
    contents,
  )

  await page.goto('data:text/html,<p>Replaced</p>')
  await uploads.navigation()
  expect(existsSync(join(root, staged!))).toBe(false)
  await uploads.release()
})
