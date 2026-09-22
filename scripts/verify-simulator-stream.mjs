// Requires explicitly named, already-booted QA simulators. Never chooses a user's device.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomBytes } from 'node:crypto'
import { startRuntime } from '../packages/runtime/dist/index.js'
import { remoteBrowserHtml } from '../packages/protocol/dist/generated/browser-viewer.js'
const ids = process.argv.slice(2)
assert(ids.length, 'Pass explicit ios:UDID and/or android:AVD QA devices')
const exec = promisify(execFile)
const require = createRequire(new URL('../packages/runtime/package.json', import.meta.url))
const { chromium } = require('playwright')
const token = randomBytes(32).toString('base64url')
const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
const site = createServer((_, res) => {
  res.setHeader('Content-Type', 'text/html')
  res.end(
    '<iframe style="position:fixed;inset:0;border:0;width:100%;height:100%" sandbox="allow-scripts allow-forms" srcdoc="' +
      remoteBrowserHtml.replaceAll('&', '&amp;').replaceAll('"', '&quot;') +
      '"></iframe>',
  )
})
await new Promise((resolve) => site.listen(0, '127.0.0.1', resolve))
const call = async (path, body) => {
  const response = await fetch(`http://127.0.0.1:${runtime.port}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const result = await response.json()
  assert.equal(response.status, 200, JSON.stringify(result))
  return result
}
let browser
const errors = []
const report = []
try {
  runtime.services.store.update((w) => ({
    ...w,
    tasks: [
      {
        id: 'sim-qa',
        title: 'Simulator QA',
        repositoryId: '',
        agentId: '',
        status: 'draft',
        createdAt: new Date().toISOString(),
        messages: [],
        files: [],
        draft: '',
        example: false,
      },
    ],
  }))
  browser = await chromium.launch({
    executablePath:
      process.env.DOVO_BROWSER_EXECUTABLE ||
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  })
  const page = await browser.newPage({ viewport: { width: 430, height: 932 } })
  page.on('pageerror', (error) => errors.push(error.message))
  await mkdir('work/design/remote-browser/simulators', { recursive: true })
  for (const id of ids) {
    const opened = await call('/api/previews/simulator/open', { taskId: 'sim-qa', id })
    if (id.startsWith('ios:'))
      await exec('xcrun', ['simctl', 'launch', id.slice(4), 'com.apple.Preferences'])
    else {
      // Reset the fixture, including a previously focused search/IME. Otherwise
      // the drag assertion may draw in Gboard's handwriting tutorial on reruns.
      for (const app of [
        'com.google.android.inputmethod.latin',
        'com.google.android.settings.intelligence',
        'com.android.settings',
      ])
        await exec('adb', ['-s', opened.device.runtime, 'shell', 'am', 'force-stop', app])
      await exec('adb', [
        '-s',
        opened.device.runtime,
        'shell',
        'am',
        'start',
        '-a',
        'android.settings.SETTINGS',
      ])
    }
    await page.goto(`http://127.0.0.1:${site.address().port}`)
    const viewer = page.frameLocator('iframe')
    await viewer.getByLabel('Host browser URL').waitFor()
    await page.evaluate(
      (message) => document.querySelector('iframe').contentWindow.postMessage(message, '*'),
      {
        channel: 'dovo-browser',
        type: 'connect',
        url: `ws://127.0.0.1:${runtime.port}/ws/simulator?ticket=${opened.ticket}`,
        device: opened.device,
      },
    )
    const canvas = viewer.locator('canvas')
    await canvas.waitFor({ state: 'visible', timeout: 20000 })
    await page.waitForTimeout(800)
    const before = await canvas.evaluate((c) => c.toDataURL())
    const bounds = await canvas.boundingBox()
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height * 0.72)
    await page.mouse.down()
    for (let step = 0; step < 20; step++) {
      await page.mouse.move(
        bounds.x + bounds.width / 2,
        bounds.y + bounds.height * (0.72 - step * 0.018),
      )
      await page.waitForTimeout(16)
    }
    await page.mouse.up()
    await until(async () => (await canvas.evaluate((c) => c.toDataURL())) !== before)
    await page.waitForTimeout(500)
    const platform = opened.device.platform
    await page.screenshot({ path: `work/design/remote-browser/simulators/${platform}-drag.png` })
    // Focus Settings search through the streamed touch surface, then send mobile text.
    await page.mouse.click(
      bounds.x + bounds.width * 0.4,
      bounds.y + bounds.height * (platform === 'ios' ? 0.94 : 0.1),
    )
    if (platform === 'android') {
      await until(async () => {
        await exec('adb', [
          '-s',
          opened.device.runtime,
          'shell',
          'uiautomator',
          'dump',
          '/sdcard/dovo-stream-qa.xml',
        ])
        const xml = (
          await exec('adb', [
            '-s',
            opened.device.runtime,
            'shell',
            'cat',
            '/sdcard/dovo-stream-qa.xml',
          ])
        ).stdout
        return /class="android.widget.EditText"[^>]*focused="true"/.test(xml)
      })
    } else await page.waitForTimeout(600)
    await viewer.getByRole('button', { name: 'Keyboard', exact: true }).click()
    await page.keyboard.insertText("Dovo QA #42's & $HOME")
    await page.waitForTimeout(1000)
    await page.screenshot({
      path: `work/design/remote-browser/simulators/${platform}-keyboard.png`,
    })
    if (platform === 'android') {
      await exec('adb', [
        '-s',
        opened.device.runtime,
        'shell',
        'uiautomator',
        'dump',
        '/sdcard/dovo-stream-qa.xml',
      ])
      const xml = (
        await exec('adb', [
          '-s',
          opened.device.runtime,
          'shell',
          'cat',
          '/sdcard/dovo-stream-qa.xml',
        ])
      ).stdout
      await exec('adb', ['-s', opened.device.runtime, 'shell', 'rm', '/sdcard/dovo-stream-qa.xml'])
      assert(
        xml.replaceAll('&amp;', '&').includes("Dovo QA #42's & $HOME"),
        'Android did not receive the exact keyboard text',
      )
    }
    await viewer.getByRole('button', { name: 'Keyboard', exact: true }).click()
    const scrolled = await canvas.evaluate((c) => c.toDataURL())
    await viewer.getByRole('button', { name: 'Home', exact: true }).click()
    await until(async () => (await canvas.evaluate((c) => c.toDataURL())) !== scrolled)
    await page.waitForTimeout(600)
    await page.screenshot({ path: `work/design/remote-browser/simulators/${platform}-home.png` })
    if (platform === 'android') {
      await until(async () =>
        /nexuslauncher|launcher3/.test(
          (
            await exec('adb', [
              '-s',
              opened.device.runtime,
              'shell',
              'dumpsys',
              'activity',
              'activities',
            ])
          ).stdout.match(/topResumedActivity=.*/)?.[0] ?? '',
        ),
      )
    }
    const status = await viewer.locator('#status').innerText()
    assert.equal(status, '')
    await call('/api/previews/simulator/close', { taskId: 'sim-qa', id })
    await viewer.getByRole('button', { name: 'Reconnect', exact: true }).waitFor()
    report.push({
      platform,
      device: id,
      frames: true,
      drag: true,
      home: true,
      keyboardScreenshot: true,
      closed: true,
    })
    console.log(`PASS ${platform}: real frames, drag, Home and close`)
  }
  assert.deepEqual(errors, [])
  await writeFile(
    'work/design/remote-browser/simulators/verification.json',
    JSON.stringify({ report, errors }, null, 2) + '\n',
  )
} finally {
  await browser?.close()
  await runtime.close()
  await new Promise((resolve) => site.close(resolve))
}
async function until(predicate) {
  const end = Date.now() + 15000
  while (!(await predicate())) {
    if (Date.now() > end) throw new Error('Simulator assertion timed out')
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}
