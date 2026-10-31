import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from './browser/harness.mjs'
import { startRuntime } from '../packages/runtime/dist/index.js'
import { STUDIO_BROWSER_SCOPE, BROWSER_UPLOAD_MAX_BYTES } from '../packages/protocol/dist/index.js'
import { remoteBrowserHtml } from '../packages/protocol/dist/generated/browser-viewer.js'

const root = await mkdtemp(join(tmpdir(), 'dovo-browser-uploads-check-'))
const server = createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html')
  response.end(
    request.url === '/frame'
      ? '<iframe src="/upload"></iframe>'
      : '<title>Upload fixture</title><input id="files" type="file" multiple accept=".csv,.txt,image/*"><button id="read" onclick="window.saved=Promise.all(Array.from(document.querySelector(\'#files\').files,async file=>({name:file.name,size:file.size,text:await file.text()})))">Read files later</button>',
  )
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const origin = `http://127.0.0.1:${server.address().port}`
const token = 'browser-upload-fixture-owner-token-with-32-characters'
const runtime = await startRuntime({
  databasePath: join(root, 'runtime.db'),
  ownerToken: token,
  port: 0,
})
const browser = await chromium.launch()
const errors = []
const until = async (condition, message) => {
  for (let i = 0; i < 100; i++) {
    if (await condition()) return
    await delay(50)
  }
  throw new Error(message)
}
const call = async (body) => {
  const response = await fetch(`http://127.0.0.1:${runtime.port}/api/previews/browser/open`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId: STUDIO_BROWSER_SCOPE, ...body }),
  })
  assert.equal(response.status, 200)
  return response.json()
}
const body = 'name,value\n' + 'chunk-boundary,hello\n'.repeat(10000)
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
  'base64',
)
try {
  for (const mobile of [false, true]) {
    const tabId = randomUUID()
    const ticket = await call({ tabId, url: origin + '/upload' })
    const resourceId = JSON.stringify([STUDIO_BROWSER_SCOPE, tabId])
    const session = await runtime.services.browsers.sessions.get(resourceId)
    assert.ok(session)
    const viewer = await browser.newPage({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1100, height: 760 },
      hasTouch: mobile,
    })
    await viewer.context().grantPermissions(['local-network-access'])
    viewer.setDefaultTimeout(10000)
    viewer.on('pageerror', (error) => {
      errors.push(error.message)
      console.error('Viewer error:', error.message)
    })
    viewer.on('console', (message) => {
      if (message.type() === 'error') console.error('Viewer console:', message.text())
    })
    await viewer.route(`http://127.0.0.1:${runtime.port}/upload-viewer-fixture`, (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: remoteBrowserHtml.replace(
          '<head>',
          '<head><script>window.picking=[];' +
            (mobile
              ? 'window.ReactNativeWebView={postMessage(raw){const m=JSON.parse(raw);if(m.type==="filePicking"){window.picking.push(m.active);if(m.active)window.postMessage({channel:"dovo-browser",type:"filePickingReady",id:m.id},"*")}}};'
              : '') +
            '</script>',
        ),
      }),
    )
    await viewer.goto(`http://127.0.0.1:${runtime.port}/upload-viewer-fixture`)
    await viewer.evaluate(
      (url) => window.postMessage({ channel: 'dovo-browser', type: 'connect', url }, '*'),
      `ws://127.0.0.1:${runtime.port}/ws/browser?ticket=${ticket.ticket}`,
    )
    await viewer
      .getByText('Connected', { exact: true })
      .waitFor()
      .catch(async (error) => {
        console.error(await viewer.locator('#status').textContent())
        throw error
      })
    await session.page.locator('#files').click()
    const dialog = viewer.getByRole('dialog', { name: 'Select files for this website' })
    await dialog.waitFor()
    // User gesture opens the actual managed Chromium file chooser in the shared viewer.
    const chosen = viewer.waitForEvent('filechooser')
    await dialog.getByRole('button', { name: 'Choose files', exact: true }).click()
    await (
      await chosen
    ).setFiles([
      { name: 'large.csv', mimeType: 'text/csv', buffer: Buffer.from(body) },
      { name: 'empty.txt', mimeType: 'text/plain', buffer: Buffer.alloc(0) },
      { name: 'image.png', mimeType: 'image/png', buffer: png },
    ])
    await dialog.waitFor({ state: 'hidden' })
    await viewer.getByText('Files selected for this website.', { exact: true }).waitFor()
    const delivered = session.uploads.delivered.flatMap((offer) =>
      [...offer.files.values()].map((file) => file.path),
    )
    assert.equal(delivered.length, 3)
    assert.ok(
      delivered.every((path) => existsSync(path)),
      'Committed paths survive lazy Chromium reads',
    )
    await session.page.locator('#read').click()
    const saved = await session.page.evaluate(() => window.saved)
    assert.deepEqual(saved, [
      { name: 'large.csv', size: Buffer.byteLength(body), text: body },
      { name: 'empty.txt', size: 0, text: '' },
      { name: 'image.png', size: png.length, text: png.toString('utf8') },
    ])
    assert.deepEqual(
      await session.page
        .locator('#files')
        .evaluate(async (input) => Array.from(new Uint8Array(await input.files[2].arrayBuffer()))),
      [...png],
    )
    if (mobile)
      assert.deepEqual(
        await viewer.evaluate(() =>
          window.picking.filter((value, i, array) => value || array[i - 1]),
        ),
        [true, false],
      )

    // Cancel is a no-op for the website's prior selection, and owns no host paths.
    await session.page.locator('#files').click()
    await dialog.waitFor()
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await until(() => !session.uploads.message(), 'Cancelled chooser must disappear')
    assert.equal(await session.page.locator('#files').evaluate((input) => input.files.length), 3)
    await session.page.goto(origin + '/upload')
    await until(
      () => delivered.every((path) => !existsSync(path)),
      'Navigation must remove delivered files',
    )

    // Local over-limit selection does not transfer any bytes or close the chooser.
    await session.page.locator('#files').click()
    await dialog.waitFor()
    const oversizedChooser = viewer.waitForEvent('filechooser')
    await dialog.getByRole('button', { name: 'Choose files', exact: true }).click()
    await oversizedChooser
    await viewer.evaluate((size) => {
      const input = document.querySelector('#uploadFiles')
      const transfer = new DataTransfer()
      transfer.items.add(new File([new Uint8Array(size)], 'oversized.txt'))
      input.files = transfer.files
      input.dispatchEvent(new Event('change'))
    }, BROWSER_UPLOAD_MAX_BYTES + 1)
    await dialog
      .getByText('Select up to 5 files, totaling at most 50 MB.', { exact: true })
      .waitFor()
    assert.equal(session.uploads.offered.files.size, 0)
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await until(() => !session.uploads.message(), 'Oversized chooser cancellation')

    // An iframe owns its chooser; navigating it invalidates that exact offer.
    await session.page.goto(origin + '/frame')
    await session.page.frameLocator('iframe').locator('#files').click()
    await dialog.waitFor()
    const stale = session.uploads.message().id
    await session.page
      .frameLocator('iframe')
      .locator('#files')
      .evaluate(() => {
        location.href = '/upload?replacement'
      })
    await dialog.waitFor({ state: 'hidden' })
    const owner = () => {}
    await assert.rejects(
      runtime.services.browsers.upload(
        resourceId,
        {
          type: 'fileUploadStart',
          chooserId: stale,
          requestId: randomUUID(),
          name: 'stale.txt',
          mimeType: '',
          size: 1,
        },
        owner,
      ),
      /expired/,
    )
    await session.page.goto(origin + '/upload')

    // One socket owns a staged transfer. Other viewers cannot consume or cancel it.
    await session.page.locator('#files').click()
    await dialog.waitFor()
    const chooserId = session.uploads.message().id
    const fileId = randomUUID()
    let authorized = true
    const authorize = () => {
      if (!authorized) throw new Error('fixture revoked')
    }
    await runtime.services.browsers.upload(
      resourceId,
      {
        type: 'fileUploadStart',
        chooserId,
        requestId: fileId,
        name: '../../owned.txt',
        mimeType: '',
        size: 3,
      },
      authorize,
    )
    const staged = [...session.uploads.offered.files.values()][0].path
    assert.ok(staged.startsWith(session.uploads.offered.directory + '/'))
    assert.ok(staged.endsWith('/owned.txt'))
    await assert.rejects(
      runtime.services.browsers.upload(
        resourceId,
        { type: 'fileUploadCancel', chooserId, requestId: randomUUID() },
        owner,
      ),
      /another viewer/,
    )
    await runtime.services.browsers.upload(
      resourceId,
      {
        type: 'fileUploadChunk',
        chooserId,
        requestId: randomUUID(),
        fileId,
        offset: 0,
        data: Buffer.from('abc').toString('base64'),
      },
      authorize,
    )
    authorized = false
    await assert.rejects(
      runtime.services.browsers.upload(
        resourceId,
        { type: 'fileUploadCommit', chooserId, requestId: randomUUID() },
        authorize,
      ),
      /revoked/,
    )
    await runtime.services.browsers.disconnectUploads(resourceId, authorize)
    await until(() => !existsSync(staged), 'Revocation/disconnect must remove staged bytes')
    assert.equal(await session.page.locator('#files').evaluate((input) => input.files.length), 0)

    for (const invalid of [
      { offset: 1, data: 'YWJj' }, // out of order
      { offset: 0, data: '!!!!' }, // invalid base64
      { offset: 0, data: 'YWJjZA==' }, // exceeds declared size
    ]) {
      await session.page.locator('#files').click()
      await dialog.waitFor()
      const chooserId = session.uploads.message().id
      const fileId = randomUUID()
      await runtime.services.browsers.upload(
        resourceId,
        {
          type: 'fileUploadStart',
          chooserId,
          requestId: fileId,
          name: 'bounded.txt',
          mimeType: '',
          size: 3,
        },
        owner,
      )
      const path = [...session.uploads.offered.files.values()][0].path
      await assert.rejects(
        runtime.services.browsers.upload(
          resourceId,
          { type: 'fileUploadChunk', chooserId, requestId: randomUUID(), fileId, ...invalid },
          owner,
        ),
      )
      await until(() => !existsSync(path), 'Failed chunk cleanup')
      await dialog.waitFor({ state: 'hidden' })
    }
    // A late device result belongs to its original chooser, never its replacement.
    await session.page.locator('#files').click()
    await dialog.waitFor()
    const oldPicker = viewer.waitForEvent('filechooser')
    await dialog.getByRole('button', { name: 'Choose files', exact: true }).click()
    const oldNativePicker = await oldPicker
    const oldId = session.uploads.message().id
    await session.page.locator('#files').click()
    await until(() => session.uploads.message()?.id !== oldId, 'Replacement chooser')
    await oldNativePicker.setFiles({
      name: 'late.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('must not transfer'),
    })
    await until(
      () => dialog.getByRole('button', { name: 'Choose files', exact: true }).isEnabled(),
      'Late picker completion',
    )
    assert.equal(session.uploads.offered.files.size, 0)
    assert.equal(await session.page.locator('#files').evaluate((input) => input.files.length), 0)
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await until(() => !session.uploads.message(), 'Replacement chooser cancelled')

    const stage = async () => {
      await session.page.locator('#files').click()
      await dialog.waitFor()
      const chooserId = session.uploads.message().id,
        fileId = randomUUID()
      await runtime.services.browsers.upload(
        resourceId,
        {
          type: 'fileUploadStart',
          chooserId,
          requestId: fileId,
          name: 'race.txt',
          mimeType: '',
          size: 3,
        },
        owner,
      )
      return { chooserId, fileId, file: [...session.uploads.offered.files.values()][0] }
    }
    const barrier = () => {
      let resolve
      const promise = new Promise((done) => {
        resolve = done
      })
      return { promise, resolve }
    }
    // Cancel invalidates a commit behind slow IO; admission never queues more than eight commands.
    const race = await stage()
    const writing = barrier(),
      finishWrite = barrier()
    const write = race.file.handle.write.bind(race.file.handle)
    race.file.handle.write = async (...args) => {
      writing.resolve()
      await finishWrite.promise
      return write(...args)
    }
    const chunk = {
      type: 'fileUploadChunk',
      requestId: randomUUID(),
      chooserId: race.chooserId,
      fileId: race.fileId,
      offset: 0,
      data: 'YWJj',
    }
    const slowChunk = session.uploads.execute(chunk, owner)
    await writing.promise
    const queued = [
      slowChunk,
      session.uploads.execute(
        { type: 'fileUploadCommit', chooserId: race.chooserId, requestId: randomUUID() },
        owner,
      ),
    ]
    for (let i = 0; i < 6; i++)
      queued.push(session.uploads.execute({ ...chunk, requestId: randomUUID() }, owner))
    const settled = Promise.allSettled(queued)
    await assert.rejects(
      session.uploads.execute({ ...chunk, requestId: randomUUID() }, owner),
      /Wait for the current file transfer/,
    )
    const cancelling = session.uploads.execute(
      { type: 'fileUploadCancel', chooserId: race.chooserId, requestId: randomUUID() },
      owner,
    )
    assert.equal(
      session.uploads.message(),
      undefined,
      'Cancel invalidates immediately without waiting for disk',
    )
    finishWrite.resolve()
    assert.ok((await settled).every((result) => result.status === 'rejected'))
    await cancelling
    assert.equal(existsSync(race.file.path), false)
    assert.equal(await session.page.locator('#files').evaluate((input) => input.files.length), 0)
    await dialog.waitFor({ state: 'hidden' })

    // Disconnect after Chromium accepted paths must preserve files for later form submission.
    const accepted = await stage()
    await session.uploads.execute(
      { ...chunk, requestId: randomUUID(), chooserId: accepted.chooserId, fileId: accepted.fileId },
      owner,
    )
    const picked = barrier(),
      finishCommit = barrier()
    const chooser = session.uploads.offered.chooser
    const setFiles = chooser.setFiles.bind(chooser)
    chooser.setFiles = async (...args) => {
      await setFiles(...args)
      picked.resolve()
      await finishCommit.promise
    }
    const committing = session.uploads.execute(
      { type: 'fileUploadCommit', chooserId: accepted.chooserId, requestId: randomUUID() },
      owner,
    )
    await picked.promise
    const disconnecting = session.uploads.disconnect(owner)
    finishCommit.resolve()
    await committing
    await disconnecting
    assert.equal(existsSync(accepted.file.path), true)
    assert.equal(
      await session.page.locator('#files').evaluate((input) => input.files[0].text()),
      'abc',
    )
    await session.page.goto(origin + '/upload')
    await until(
      () => !existsSync(accepted.file.path),
      'Disconnect-race delivered cleanup after navigation',
    )

    // Session close releases an in-progress staging directory.
    await session.page.locator('#files').click()
    await dialog.waitFor()
    const last = session.uploads.message().id
    await runtime.services.browsers.upload(
      resourceId,
      {
        type: 'fileUploadStart',
        chooserId: last,
        requestId: randomUUID(),
        name: 'closing.txt',
        mimeType: '',
        size: 3,
      },
      owner,
    )
    const closingPath = [...session.uploads.offered.files.values()][0].path
    await runtime.services.browsers.close(resourceId)
    assert.equal(existsSync(closingPath), false)
    await viewer.close()
  }
  assert.deepEqual(errors, [])
  console.log(
    'Streamed browser uploads passed: real runtime + authenticated socket + shared viewer, desktop/touch, chunked multi-file/empty/lazy read, limits, cancel, iframe navigation, ownership, revocation, invalid chunks, replacement results, queued cancellation, bounded admission, commit/disconnect race and close cleanup.',
  )
} finally {
  await browser.close()
  await runtime.close()
  server.close()
  await once(server, 'close')
  await rm(root, { recursive: true, force: true })
}
