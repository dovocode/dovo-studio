import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const built = await bundleBrowser(
  {
    stdin: {
      contents: `
  import {useState} from 'react';
  import {ThreadSuggestions} from '${root}/packages/extension-tasks/src/chat/thread-suggestions';
  import {createRoot} from 'react-dom/client';
  import {SharingPanel} from '${root}/packages/extension-tasks/src/chat/sharing-panel';
  import {createSharingFixture} from '${root}/apps/design-system/src/sharing-fixture';
  const fixture=createSharingFixture();window.fixture=fixture;
  window.sharingRequests=[];
  const request=fixture.client.sharing.request.bind(fixture.client.sharing);
  fixture.client.sharing.request=(...args)=>{window.sharingRequests.push(args[1]);return request(...args)};
  function Inline(){const [source,setSource]=useState(fixture.sourceId),[active,setActive]=useState(true),[draft,setDraft]=useState('Existing draft');window.setSource=setSource;window.setActive=setActive;return <><ThreadSuggestions client={fixture.client} sourceId={source} active={active} onUseSuggestion={text=>setDraft(previous=>previous+'\\n\\n'+text)}/><textarea aria-label="Draft" value={draft} readOnly/></>}
  fixture.ready().then(()=>{window.sharingRequests=[];return createRoot(document.getElementById('app')).render(window.inline ? <Inline/> : <SharingPanel client={fixture.client} sourceId={fixture.sourceId} kind="thread" runtime={fixture.runtime} onUseSuggestion={text=>window.draft=text}/>)});
`,
      loader: 'tsx',
      resolveDir: root + '/apps/web',
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
  },
  [
    {
      path: '@dovo/studio-ui',
      contents: `export {Button} from '${root}/packages/studio-ui/src/components/ui/button';export {Input} from '${root}/packages/studio-ui/src/components/ui/input';export {Textarea} from '${root}/packages/studio-ui/src/components/ui/textarea';export * from '${root}/packages/studio-ui/src/components/ui/select';`,
    },
    {
      path: '@dovo/studio-core',
      contents: `export {useThreadSuggestions} from '${root}/packages/studio-core/src/use-thread-suggestions';export {useEncryptedSharing} from '${root}/packages/studio-core/src/use-encrypted-sharing';`,
    },
  ],
)
const browser = await chromium.launch()
try {
  const inline = await browser.newPage()
  inline.on('pageerror', (error) => console.error(error))
  await inline.setContent('<div id="app"></div>')
  await inline.evaluate(() => {
    window.inline = true
  })
  await inline.addScriptTag({ content: built.outputFiles[0].text })
  await inline.getByRole('heading', { name: 'Suggested next prompts', exact: true }).waitFor()
  assert.equal(
    await inline.evaluate(() =>
      window.sharingRequests.some((path) => /^\/v2\/shares\/[^/]+$/.test(path)),
    ),
    false,
    'inbox must not download transcript',
  )
  await inline.getByRole('button', { name: 'Use in composer', exact: true }).click()
  assert.match(await inline.getByLabel('Draft').inputValue(), /^Existing draft\n\nCould we/)
  await inline.evaluate(() => window.setSource('another-thread'))
  await inline.getByRole('heading').waitFor({ state: 'hidden' })
  await inline.evaluate(() => window.setSource(window.fixture.sourceId))
  await inline.getByRole('heading').waitFor()
  await inline.evaluate(() => window.fixture.fail(true))
  await inline.getByRole('button', { name: 'Dismiss', exact: true }).click()
  await inline.getByRole('alert').waitFor()
  assert.equal(await inline.getByRole('button', { name: 'Use in composer' }).count(), 1)
  await inline.evaluate(() => window.fixture.fail(false))
  await inline.getByRole('button', { name: 'Dismiss', exact: true }).click()
  await inline.getByRole('heading').waitFor({ state: 'hidden' })
  await inline.clock.install()
  const before = await inline.evaluate(() => window.sharingRequests.length)
  await inline.evaluate(() => window.setActive(false))
  await inline.clock.fastForward(60000)
  assert.equal(
    await inline.evaluate(() => window.sharingRequests.length),
    before,
    'hidden thread stops polling',
  )
  await inline.close()
  console.log(
    'Inline suggestions: encrypted inbox, draft preservation, thread isolation, dismissal failure and inactive cleanup passed',
  )
  const page = await browser.newPage(),
    errors = [],
    requests = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => requests.push(request.url()))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.getByRole('heading', { name: 'Suggested next prompts · 1' }).waitFor()
  await page.getByRole('button', { name: 'Use in composer', exact: true }).click()
  assert.match(await page.evaluate(() => window.draft), /cancelled/)
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click()
  await page.getByRole('heading', { name: 'Suggested next prompts · 0' }).waitFor()
  await page.getByLabel('Recipient sharing ID', { exact: true }).fill('second-recipient')
  await page.evaluate(() => window.fixture.fail(true))
  await page.getByRole('button', { name: 'Invite account', exact: true }).click()
  await page.getByRole('alert').waitFor()
  assert.equal(
    await page.getByLabel('Recipient sharing ID', { exact: true }).inputValue(),
    'second-recipient',
  )
  await page.evaluate(() => window.fixture.fail(false))
  await page.getByRole('button', { name: 'Invite account', exact: true }).click()
  await page.getByText('Invited account · second-recipient', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Revoke access', exact: true }).count(), 3)
  const beforeKey = await page.evaluate(
    () => [...window.fixture.records.values()][0].packet.generation,
  )
  await page.getByRole('button', { name: 'Revoke access', exact: true }).last().click()
  await page.waitForFunction(() => [...window.fixture.records.values()][0].grants.length === 2)
  const afterKey = await page.evaluate(
    () => [...window.fixture.records.values()][0].packet.generation,
  )
  assert.notEqual(beforeKey, afterKey)
  await page.getByRole('button', { name: 'Pause automatic updates', exact: true }).click()
  await page.getByRole('button', { name: 'Resume automatic updates', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Resume automatic updates', exact: true }).click()
  await page.getByRole('button', { name: 'Pause automatic updates', exact: true }).waitFor()
  await page.getByText('Recovery and another device', { exact: true }).click()
  await page.getByRole('button', { name: 'Show recovery key', exact: true }).click()
  await page.getByRole('textbox', { name: 'Sharing recovery key', exact: true }).waitFor()
  assert.match(
    await page.getByRole('textbox', { name: 'Sharing recovery key', exact: true }).inputValue(),
    /^[a-f0-9]{64}$/,
  )
  await page.getByRole('button', { name: 'Hide key', exact: true }).click()
  await page.getByText('Delete hosted copy', { exact: true }).click()
  await page.getByRole('button', { name: 'Delete hosted copy…', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm delete hosted copy', exact: true }).click()
  await page.getByRole('heading', { name: 'Publish private thread', exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.fixture.records.size), 0)
  assert.deepEqual(errors, [])
  assert.deepEqual(requests, [])
  console.log(
    'Encrypted sharing controls: invitations, composer insertion, dismissal, rotation, pause/resume, recovery and deletion passed',
  )
} finally {
  await browser.close()
}
