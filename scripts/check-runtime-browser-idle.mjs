// Build the runtime/dependencies and install Playwright Chromium before running.
// Exercises real idle retirement and relaunch; Linux PSS is isolated child memory,
// not whole-app memory or a physical-device energy measurement.
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { RemoteBrowsers } from '../packages/runtime/dist/previews/browser.js'

async function chromiumMemory() {
  if (process.platform !== 'linux') return undefined
  const records = await Promise.all(
    (await readdir('/proc'))
      .filter((value) => /^\d+$/.test(value))
      .map(async (value) => {
        try {
          const status = await readFile(`/proc/${value}/status`, 'utf8')
          return { pid: Number(value), parent: Number(/^PPid:\s+(\d+)/m.exec(status)?.[1]) }
        } catch {
          // A process can exit while /proc is being read.
          return undefined
        }
      }),
  )
  const descendants = new Set([process.pid])
  let changed = true
  while (changed) {
    changed = false
    for (const record of records)
      if (record && descendants.has(record.parent) && !descendants.has(record.pid)) {
        descendants.add(record.pid)
        changed = true
      }
  }
  let processes = 0
  let pssKiB = 0
  for (const pid of descendants) {
    if (pid === process.pid) continue
    try {
      if (!/chrome|chromium/i.test(await readFile(`/proc/${pid}/comm`, 'utf8'))) continue
      const rollup = await readFile(`/proc/${pid}/smaps_rollup`, 'utf8')
      pssKiB += Number(/^Pss:\s+(\d+)/m.exec(rollup)?.[1] ?? 0)
      processes++
    } catch {
      // A process can exit while its memory is being read.
    }
  }
  return { processes, pssMiB: Math.round((pssKiB / 1024) * 10) / 10 }
}

// Keep this check on Playwright's managed executable, independent of daemon settings.
delete process.env.DOVO_BROWSER_EXECUTABLE
const browsers = new RemoteBrowsers()
const html = '<html><body><h1>Idle browser regression</h1></body></html>'
try {
  const firstImage = await browsers.artifactSnapshot(html)
  assert(firstImage.startsWith('data:image/jpeg;base64,'))
  const first = await browsers.browser
  assert(first?.isConnected())
  assert.equal(first.contexts().length, 0)
  const afterRender = await chromiumMemory()
  console.log(JSON.stringify({ stage: 'after-render', memory: afterRender }))
  let deadline
  try {
    await Promise.race([
      new Promise((resolve) => first.once('disconnected', resolve)),
      new Promise((_, reject) => {
        deadline = setTimeout(() => reject(new Error('Idle Chromium did not retire')), 75_000)
      }),
    ])
  } finally {
    clearTimeout(deadline)
  }
  await browsers.closingBrowser
  const afterIdle = await chromiumMemory()
  if (afterIdle) assert.equal(afterIdle.processes, 0)
  console.log(JSON.stringify({ stage: 'after-idle', memory: afterIdle }))
  const secondImage = await browsers.artifactSnapshot(html)
  const second = await browsers.browser
  assert(second?.isConnected())
  assert.notEqual(second, first)
  assert.equal(second.contexts().length, 0)
  assert.equal(secondImage, firstImage)
  console.log('Idle Chromium retirement and identical-image relaunch passed')
} finally {
  await browsers.dispose()
}
