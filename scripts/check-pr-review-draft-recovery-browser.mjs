import assert from 'node:assert/strict'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = new URL('../', import.meta.url).pathname
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { usePullCodeReview, pullReviewDraftScope } from './packages/studio-core/src/scm/use-pull-code-review'
const target = { repositoryId: 'repo', number: 42, connectionId: 'forge', expectedDestination: 'source' }
const request = async (path, input) => {
  const response = await fetch(path, { method: 'POST', body: JSON.stringify(input) })
  if (!response.ok) throw new Error(await response.text())
  return response.json()
}
function Review() {
  const [connected, setConnected] = useState(true)
  window.setConnected = setConnected
  const review = usePullCodeReview({
    target, scope: 'saved-computer', request, connected,
    draftScope: pullReviewDraftScope({ address: 'https://draft.test', runtimeId: 'computer', token: 'device-token' }),
  })
  return <>
    {review.draft && <textarea aria-label="Review draft" value={review.draft.body} onChange={event => review.edit({ body: event.target.value })} />}
    <output>{review.error}</output>
    {review.draftConflict && <button onClick={review.replaceSavedDraft}>Save my draft over this version</button>}
    {review.draft && !review.dirty && <p>Saved on computer</p>}
  </>
}
createRoot(document.getElementById('app')).render(<Review />)
`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    jsx: 'automatic',
    platform: 'browser',
    nodePaths: [root + 'packages/studio-ui/node_modules'],
  },
  [],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const host = {
    id: 'review',
    status: 'completed',
    createdAt: '2026-10-19T12:00:00Z',
    version: 1,
    sequence: 1,
    draft: { body: 'Existing saved draft', selected: [], dismissed: [], event: 'comment' },
  }
  let rejectSave = true
  let dropAcknowledgement = false
  const saves = []
  const actions = []
  await page.route('https://draft.test/**', async (route) => {
    const action = new URL(route.request().url()).pathname.split('/').at(-1)
    if (!action) return route.fulfill({ body: '<div id="app"></div>', contentType: 'text/html' })
    actions.push(action)
    if (action === 'save') {
      const input = route.request().postDataJSON()
      saves.push(input)
      if (rejectSave) return route.fulfill({ status: 503, body: 'Computer unavailable' })
      assert.equal(input.version, host.version)
      host.draft = input.draft
      host.version++
      host.sequence++
      if (dropAcknowledgement) return route.fulfill({ status: 503, body: 'Response unavailable' })
    }
    return route.fulfill({ json: { reviews: [host] } })
  })
  const open = async () => {
    await page.addScriptTag({ content: built.outputFiles[0].text })
    await page.getByRole('textbox', { name: 'Review draft' }).waitFor()
  }
  await page.goto('https://draft.test/')
  await open()
  const editor = page.getByRole('textbox', { name: 'Review draft' })
  assert.equal(await editor.inputValue(), host.draft.body)
  await editor.fill('Keep my review edits')
  await page.getByText('Computer unavailable', { exact: true }).waitFor()

  // Another client saves while the first client is unavailable.
  host.draft.body = 'Edit on another computer'
  host.version++
  host.sequence++
  rejectSave = false
  await page.reload()
  await open()
  assert.equal(await editor.inputValue(), 'Keep my review edits')
  const localKeys = await page.evaluate(() => Object.keys(localStorage))
  assert.equal(localKeys.length, 1)
  assert.ok(!localKeys[0].includes('device-token'))
  const resolveConflict = page.getByRole('button', { name: 'Save my draft over this version' })
  await resolveConflict.waitFor()
  assert.equal(saves.length, 1)
  await page.evaluate(() => window.setConnected(false))
  await resolveConflict.click()
  await page.evaluate(() => window.setConnected(true))
  await page.getByText('Saved on computer', { exact: true }).waitFor()
  assert.equal(saves.length, 2)
  assert.equal(host.draft.body, 'Keep my review edits')
  assert.deepEqual(await page.evaluate(() => Object.keys(localStorage)), [])

  // An acknowledged host write whose response was lost is reconciled on reload.
  dropAcknowledgement = true
  await editor.fill('The computer receives this once')
  await page.getByText('Response unavailable', { exact: true }).waitFor()
  dropAcknowledgement = false
  await page.reload()
  await open()
  assert.equal(await editor.inputValue(), host.draft.body)
  await page.getByText('Saved on computer', { exact: true }).waitFor()
  assert.equal(saves.length, 3)
  assert.deepEqual(await page.evaluate(() => Object.keys(localStorage)), [])
  assert.ok(actions.every((action) => action === 'read' || action === 'save'))
  console.log(
    'Review edits survived rejected save, reload, reconnect, conflicting edits and a lost acknowledgement.',
  )
} finally {
  await browser.close()
}
