import assert from 'node:assert/strict'
import { readFile, readdir, mkdir } from 'node:fs/promises'
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
  import {flushSync} from 'react-dom';
  import {SharingPanel} from '${root}/packages/extension-tasks/src/chat/sharing-panel';
  import {createSharingFixture} from '${root}/apps/design-system/src/sharing-fixture';
  const kind=window.kind??'thread';const fixture=createSharingFixture({kind,withKey:window.withKey!==false});window.fixture=fixture;
  window.sharingRequests=[];
  window.inboxFailures=[];window.inboxRefreshes=0;
  const suggestionInbox=fixture.client.sharing.suggestionInbox.bind(fixture.client.sharing);
  fixture.client.sharing.suggestionInbox=async(origin,sourceId)=>{
    window.inboxRefreshes++;
    try{return await suggestionInbox(origin,sourceId)}
    catch(error){window.inboxFailures.push(sourceId);throw error}
  };
  const request=fixture.client.sharing.request.bind(fixture.client.sharing);
  fixture.client.sharing.request=(...args)=>{window.sharingRequests.push(args[1]);return request(...args)};
  function Inline(){const [source,setSource]=useState(fixture.sourceId),[active,setActive]=useState(true),[draft,setDraft]=useState('Existing draft');window.setSource=setSource;window.setActive=value=>flushSync(()=>setActive(value));return <><ThreadSuggestions client={fixture.client} sourceId={source} active={active} onUseSuggestion={text=>setDraft(previous=>previous+'\\n\\n'+text)}/><textarea aria-label="Draft" value={draft} readOnly/></>}
  function Manager(){const [shown,setShown]=useState(true);window.showManager=setShown;return shown?<SharingPanel client={fixture.client} sourceId={fixture.sourceId} kind={kind} content={kind==='artifact'?fixture.content:undefined} runtime={window.offline?undefined:fixture.runtime}/>:null}fixture.ready(window.published!==false).then(async()=>{if(window.forgetKey){window.recoveryKey=await fixture.client.sharing.key();fixture.forgetKey(!!window.legacyKey);}window.sharingRequests=[];return createRoot(document.getElementById('app')).render(window.inline ? <Inline/> : <Manager/>)});
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
      contents: `export {Button} from '${root}/packages/studio-ui/src/components/ui/button';export {Input} from '${root}/packages/studio-ui/src/components/ui/input';export {Textarea} from '${root}/packages/studio-ui/src/components/ui/textarea';export * from '${root}/packages/studio-ui/src/components/ui/select';export * from '${root}/packages/studio-ui/src/components/ui/dialog';`,
    },
    {
      path: '@dovo/studio-core',
      contents: `export {useThreadSuggestions} from '${root}/packages/studio-core/src/use-thread-suggestions';export {useEncryptedSharing} from '${root}/packages/studio-core/src/use-encrypted-sharing';export {useSharingPeople} from '${root}/packages/studio-core/src/use-sharing-people';`,
    },
  ],
)
const visibility = await bundleBrowser(
  {
    stdin: {
      contents: `
    import {useState} from 'react';import {createRoot} from 'react-dom/client';
    import {ThreadSharing,InlineThreadSuggestions} from '${root}/packages/extension-tasks/src/chat/thread-sharing';
    import {ArtifactSharing} from '${root}/packages/extension-tasks/src/chat/artifact-sharing';
    function App(){const [account,setAccount]=useState({directory:null});window.account=account;window.setAccount=setAccount;return <><ThreadSharing taskId="thread" title="Thread"/><ArtifactSharing artifact={{id:'artifact',title:'Notes',revision:1,format:'markdown',content:'Notes'}}/><InlineThreadSuggestions taskId="thread" active onUseSuggestion={()=>{}}/></>};createRoot(document.getElementById('app')).render(<App/>);
  `,
      loader: 'tsx',
      resolveDir: root + '/apps/web',
    },
    bundle: true,
    write: false,
    format: 'iife',
    jsx: 'automatic',
  },
  [
    {
      path: '@dovo/studio-core',
      contents: `export const useAccount=()=>window.account;export const useAppPreferences=()=>({});export const useStudioHost=()=>({accountStorage:{},openExternalLink:async()=>{}});export const useWorkspace=()=>({connected:true,activeRuntimeId:'runtime'});export const sharedContentSchema={};export const sharingStatusSchema={};`,
    },
    {
      path: '@dovo/studio-ui',
      contents: `export {Button} from '${root}/packages/studio-ui/src/components/ui/button';export * from '${root}/packages/studio-ui/src/components/ui/dialog';`,
    },
    {
      path: './sharing-panel',
      importer: root + '/packages/extension-tasks/src/chat/',
      contents: `export const SharingPanel=()=> <p>Sharing controls</p>;`,
    },
    {
      path: './artifact-feed',
      importer: root + '/packages/extension-tasks/src/chat/',
      contents: `export const ArtifactFeedSetup=()=>null;`,
    },
    {
      path: './thread-suggestions',
      importer: root + '/packages/extension-tasks/src/chat/',
      contents: `export const ThreadSuggestions=()=> <p>Suggestion inbox</p>;`,
    },
  ],
)
const browser = await chromium.launch()
try {
  const auth = await browser.newPage()
  await auth.setContent('<div id="app"></div>')
  await auth.addScriptTag({ content: visibility.outputFiles[0].text })
  assert.equal(await auth.getByRole('button').count(), 0)
  assert.equal(await auth.getByText('Suggestion inbox').count(), 0)
  await auth.evaluate(() =>
    window.setAccount({ directory: {}, client: { sessionId: () => 'session' } }),
  )
  await auth.getByRole('button', { name: 'Share thread', exact: true }).click()
  await auth.getByRole('dialog').waitFor()
  await auth.getByText('Suggestion inbox').waitFor()
  await auth.evaluate(() => window.setAccount({ directory: null }))
  await auth.getByRole('dialog').waitFor({ state: 'hidden' })
  assert.equal(await auth.getByRole('button').count(), 0)
  assert.equal(await auth.getByText('Suggestion inbox').count(), 0)
  await auth.evaluate(() => window.setAccount({ directory: {}, deletionPending: true }))
  assert.equal(await auth.getByRole('button').count(), 0)
  await auth.evaluate(() =>
    window.setAccount({ directory: {}, client: { sessionId: () => 'session' } }),
  )
  await auth.getByRole('dialog').waitFor()
  await auth.keyboard.press('Escape')
  await auth.getByRole('dialog').waitFor({ state: 'hidden' })
  await auth.getByRole('button', { name: 'Share artifact', exact: true }).click()
  await auth.getByRole('dialog').waitFor()
  await auth.evaluate(() => window.setAccount({ directory: null }))
  await auth.getByRole('dialog').waitFor({ state: 'hidden' })
  await auth.close()
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
  assert.equal(await inline.getByRole('region', { name: 'Suggested next prompts' }).count(), 0)
  await inline.clock.install()
  await inline.evaluate(() => {
    window.fixture.fail(true)
    window.setSource('empty-inbox-with-error')
  })
  await inline.waitForFunction(() => window.inboxFailures.includes('empty-inbox-with-error'))
  assert.equal(await inline.getByRole('alert').count(), 0, 'background refresh failure stays quiet')
  await inline.clock.fastForward(30000)
  await inline.waitForFunction(() => window.inboxFailures.length === 2)
  assert.equal(await inline.getByRole('alert').count(), 0, 'automatic retry failure stays quiet')
  assert.equal(await inline.getByRole('heading', { name: 'Suggested next prompts' }).count(), 0)
  assert.equal(await inline.getByRole('region', { name: 'Suggested next prompts' }).count(), 0)
  await inline.evaluate(() => {
    window.fixture.fail(false)
    window.setSource(window.fixture.sourceId)
  })
  await inline.getByRole('heading').waitFor()
  await inline.evaluate(() => {
    window.inboxFailures = []
    window.fixture.fail(true)
  })
  await inline.clock.fastForward(30000)
  await inline.waitForFunction(() => window.inboxFailures.includes(window.fixture.sourceId))
  assert.equal(await inline.getByRole('alert').count(), 0)
  assert.equal(
    await inline.getByRole('button', { name: 'Use in composer' }).count(),
    1,
    'refresh failures retain the last inbox',
  )
  await inline.getByRole('button', { name: 'Dismiss', exact: true }).click()
  await inline.getByRole('alert').waitFor()
  assert.equal(await inline.getByRole('button', { name: 'Use in composer' }).count(), 1)
  await inline.evaluate(() => window.fixture.fail(false))
  await inline.getByRole('button', { name: 'Dismiss', exact: true }).click()
  await inline.getByRole('heading').waitFor({ state: 'hidden' })
  await inline.evaluate(() => window.setActive(false))
  const before = await inline.evaluate(() => window.inboxRefreshes)
  await inline.clock.fastForward(60000)
  assert.equal(
    await inline.evaluate(() => window.inboxRefreshes),
    before,
    'hidden thread stops polling',
  )
  await inline.close()
  console.log(
    'Inline suggestions: encrypted inbox, draft preservation, thread isolation, quiet refresh retries, retained inbox, dismissal failure and inactive cleanup passed',
  )
  const assets = root + '/apps/web/dist/client/assets/'
  const css = (
    await Promise.all(
      (await readdir(assets))
        .filter((file) => file.endsWith('.css'))
        .map((file) => readFile(assets + file, 'utf8')),
    )
  ).join('\n')
  const errors = []
  async function manager(options = {}) {
    const page = await browser.newPage({ viewport: { width: 480, height: 900 } })
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setContent(
      '<html class="dark"><body style="background:var(--background);color:var(--foreground);padding:20px"><main id="app" style="max-width:480px;margin:auto"></main></body></html>',
    )
    await page.addStyleTag({ content: css })
    await page.evaluate((options) => Object.assign(window, options), options)
    await page.addScriptTag({ content: built.outputFiles[0].text })
    await page.getByRole('combobox', { name: 'General access', exact: true }).waitFor()
    await page.waitForFunction(
      () =>
        !document.querySelector('[aria-label="Sharing settings"]').getAttribute('aria-busy') ||
        document.querySelector('[aria-label="Sharing settings"]').getAttribute('aria-busy') ===
          'false',
    )
    return page
  }
  async function access(page, label) {
    await page.getByRole('combobox', { name: 'General access', exact: true }).click()
    await page.getByRole('option', { name: label, exact: true }).click()
  }
  const page = await manager()
  assert.equal(await page.getByRole('button', { name: 'Copy link', exact: true }).isEnabled(), true)
  assert.equal(
    await page.getByRole('textbox', { name: 'Share link', exact: true }).isVisible(),
    false,
  )
  await page
    .getByRole('textbox', { name: 'Add people by sharing ID', exact: true })
    .fill('second-recipient')
  await page.evaluate(() => window.fixture.fail(true))
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByRole('alert').waitFor()
  assert.equal(
    await page.getByLabel('Add people by sharing ID', { exact: true }).inputValue(),
    'second-recipient',
  )
  await page.evaluate(() => window.fixture.fail(false))
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByLabel('Access for second-recipient', { exact: true }).waitFor()
  const beforeKey = await page.evaluate(
    () => [...window.fixture.records.values()][0].packet.generation,
  )
  await page.getByRole('button', { name: 'Remove access', exact: true }).last().click()
  await page.getByRole('dialog').getByRole('button', { name: 'Keep access', exact: true }).click()
  assert.equal(await page.getByLabel('Access for second-recipient', { exact: true }).count(), 1)
  await page.getByRole('button', { name: 'Remove access', exact: true }).last().click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Confirm remove access', exact: true })
    .click()
  await page.getByLabel('Access for second-recipient', { exact: true }).waitFor({ state: 'hidden' })
  assert.notEqual(
    beforeKey,
    await page.evaluate(() => [...window.fixture.records.values()][0].packet.generation),
  )
  await page.getByText('Advanced', { exact: true }).click()
  await page.getByRole('button', { name: 'Pause automatic updates', exact: true }).click()
  await page.getByRole('button', { name: 'Resume automatic updates', exact: true }).click()
  await page.getByRole('button', { name: 'Pause automatic updates', exact: true }).waitFor()
  await page.getByText('Recovery and another device', { exact: true }).click()
  await page.getByRole('button', { name: 'Show recovery key', exact: true }).click()
  assert.match(
    await page.getByRole('textbox', { name: 'Sharing recovery key', exact: true }).inputValue(),
    /^[a-f0-9]{64}$/,
  )
  await page.getByRole('button', { name: 'Hide key', exact: true }).click()
  await page.getByRole('button', { name: 'Delete hosted copy…', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm delete hosted copy', exact: true }).click()
  await page.waitForFunction(() => window.fixture.records.size === 0)
  await page.getByRole('button', { name: 'Copy link', exact: true }).waitFor({ state: 'visible' })
  assert.equal(
    await page.getByRole('button', { name: 'Copy link', exact: true }).isDisabled(),
    true,
  )
  await page.close()

  for (const kind of ['thread', 'artifact']) {
    const invited = await manager({ kind, published: false, withKey: false })
    await invited.getByRole('textbox', { name: 'Add people by sharing ID' }).fill('private-reader')
    await invited.getByRole('button', { name: 'Add', exact: true }).click()
    await invited.getByText('private-reader', { exact: true }).waitFor()
    assert.equal(
      await invited.evaluate(() =>
        [...window.fixture.records.values()][0].grants.every(
          (grant) => grant.userId === 'private-reader',
        ),
      ),
      true,
      'inviting must not enable anonymous access',
    )
    assert.equal(
      await invited.getByRole('button', { name: 'Copy link', exact: true }).isDisabled(),
      true,
    )
    await invited.close()
    const first = await manager({ kind, published: false, withKey: false })
    assert.equal(
      await first.evaluate(() => window.fixture.records.size),
      0,
      'opening must not publish',
    )
    await first.evaluate(() => window.fixture.fail(true))
    await access(first, 'Anyone with the link')
    await first.getByRole('alert').waitFor()
    assert.equal(await first.evaluate(() => window.fixture.records.size), 0)
    await first.evaluate(() => window.fixture.fail(false))
    await access(first, 'Anyone with the link')
    await first.waitForFunction(
      () =>
        [...window.fixture.records.values()][0]?.grants.length === 1 ||
        !!document.querySelector('[role="alert"]'),
    )
    assert.equal(await first.getByRole('alert').count(), 0, await first.locator('body').innerText())
    const shared = await first.evaluate(() => [...window.fixture.records.values()][0])
    assert.equal(shared.kind, kind)
    assert.equal(shared.paused, kind !== 'thread')
    const grantId = shared.grants[0].id
    assert.equal(
      await first.getByRole('button', { name: 'Copy link', exact: true }).isEnabled(),
      true,
    )
    // Reopening retains the publication and link without key setup, review or a new grant.
    await first.evaluate(() => window.showManager(false))
    await first
      .getByRole('combobox', { name: 'General access', exact: true })
      .waitFor({ state: 'hidden' })
    await first.evaluate(() => window.showManager(true))
    await first.waitForFunction(
      () =>
        !document.querySelector('[aria-label="Sharing settings"]').getAttribute('aria-busy') ||
        document.querySelector('[aria-label="Sharing settings"]').getAttribute('aria-busy') ===
          'false',
    )
    assert.equal(await first.evaluate(() => window.fixture.records.size), 1)
    assert.equal(
      await first.evaluate(() => [...window.fixture.records.values()][0].grants[0].id),
      grantId,
    )
    await first.getByRole('textbox', { name: 'Add people by sharing ID' }).fill('trusted-reader')
    await first.getByRole('button', { name: 'Add', exact: true }).click()
    await first.getByText('trusted-reader', { exact: true }).waitFor()
    await access(first, 'Restricted')
    await first
      .getByRole('dialog')
      .getByRole('button', { name: 'Confirm remove access', exact: true })
      .click()
    await first.waitForFunction(() =>
      [...window.fixture.records.values()][0].grants.every((grant) => !!grant.userId),
    )
    assert.equal(
      await first.getByRole('button', { name: 'Copy link', exact: true }).isDisabled(),
      true,
    )
    assert.equal(
      await first.getByRole('button', { name: 'Copy invitation link', exact: true }).isEnabled(),
      true,
    )
    await mkdir(root + '/work/sharing-settings', { recursive: true })
    for (const mode of ['dark', 'light']) {
      await first.evaluate((mode) => (document.documentElement.className = mode), mode)
      for (const width of [390, 1100]) {
        await first.setViewportSize({ width, height: 900 })
        assert.equal(
          await first.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
          false,
          'sharing must fit narrow screens',
        )
        await first.screenshot({
          path: root + `/work/sharing-settings/${kind}-${mode}-${width}.png`,
          fullPage: true,
        })
      }
    }
    await first.close()
  }
  const recovered = await manager({ forgetKey: true })
  await recovered.getByRole('button', { name: 'Copy link', exact: true }).waitFor()
  assert.equal(await recovered.getByRole('heading', { name: 'Recover sharing access' }).count(), 0)
  assert.equal(await recovered.evaluate(() => window.fixture.client.sharing.recoveryState), 'ready')
  await recovered.close()
  const reset = await manager({ forgetKey: true, legacyKey: true })
  await reset.getByRole('heading', { name: 'Recover sharing access' }).waitFor()
  await reset.getByRole('button', { name: 'I no longer have the key', exact: true }).click()
  assert.equal(await reset.evaluate(() => window.fixture.records.size), 1)
  await reset.getByRole('button', { name: 'Cancel', exact: true }).click()
  assert.equal(await reset.evaluate(() => window.fixture.records.size), 1)
  await reset.getByRole('button', { name: 'I no longer have the key', exact: true }).click()
  await reset.setViewportSize({ width: 360, height: 780 })
  assert.equal(await reset.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await reset.screenshot({
    path: root + '/work/sharing-settings/account-recovery-reset.png',
    fullPage: true,
  })
  await reset
    .getByRole('button', { name: 'Delete old hosted copies and reset sharing', exact: true })
    .click()
  await reset.getByText('Sharing is ready with account recovery', { exact: true }).waitFor()
  assert.equal(await reset.evaluate(() => window.fixture.records.size), 0)
  await reset.close()
  const restored = await manager({ forgetKey: true, legacyKey: true })
  await restored.getByRole('heading', { name: 'Recover sharing access' }).waitFor()
  assert.equal(await restored.getByLabel('Recovery key', { exact: true }).isVisible(), false)
  await restored.getByText('Restore from a backup', { exact: true }).click()
  await restored.getByRole('heading', { name: 'Restore sharing on this device' }).waitFor()
  assert.equal(await restored.getByRole('button', { name: 'Add', exact: true }).isDisabled(), true)
  const recovery = restored.getByLabel('Recovery key', { exact: true })
  await recovery.fill('invalid-recovery-key')
  await recovery.press('Enter')
  await restored.getByRole('alert').waitFor()
  assert.equal(
    await recovery.inputValue(),
    'invalid-recovery-key',
    'A failed restore keeps the entered value',
  )
  await recovery.fill(await restored.evaluate(() => window.recoveryKey))
  await recovery.press('Enter')
  await restored
    .getByRole('heading', { name: 'Restore sharing on this device' })
    .waitFor({ state: 'hidden' })
  assert.equal(
    await restored.getByRole('button', { name: 'Copy link', exact: true }).isEnabled(),
    true,
  )
  await restored.close()
  const offline = await manager({ offline: true })
  await offline
    .getByText('Waiting for the source computer. Readers see the last published messages.')
    .waitFor()
  assert.equal(
    await offline.getByRole('button', { name: 'Copy link', exact: true }).isEnabled(),
    true,
  )
  await offline.close()
  const social = await manager({ published: false, withKey: false })
  await social.getByRole('combobox', { name: 'Add friends or organisations' }).click()
  await social.getByRole('option', { name: 'Sam', exact: true }).click()
  await social.getByLabel('Access for second-recipient', { exact: true }).waitFor()
  await social.getByRole('combobox', { name: 'Add friends or organisations' }).click()
  await social.getByRole('option', { name: 'Dovo team (organisation)', exact: true }).click()
  await social
    .getByLabel('Access for d3d97ead-0292-448d-bdf8-1260fd675d10', { exact: true })
    .waitFor()
  assert.equal(
    await social.getByRole('combobox', { name: 'General access', exact: true }).textContent(),
    'Restricted',
  )
  assert.equal(
    await social.evaluate(() =>
      [...window.fixture.records.values()][0].grants.some((grant) => grant.tokenHash),
    ),
    false,
    'friends and organisations never enable public access',
  )
  await social.getByText('Friends and organisations', { exact: true }).click()
  const managerPanel = social.getByLabel('Friends and organisations', { exact: true })
  await managerPanel.getByRole('button', { name: 'Accept friend', exact: true }).click()
  await managerPanel.getByText('new-friend · Friend', { exact: true }).waitFor()
  await managerPanel
    .getByRole('textbox', { name: 'Organisation name', exact: true })
    .fill('Design team')
  await managerPanel.getByRole('button', { name: 'Create', exact: true }).click()
  const organization = managerPanel.getByLabel('Organisation Design team', { exact: true })
  await organization.waitFor()
  await organization.getByLabel('Invite to Design team', { exact: true }).fill('second-recipient')
  await organization.getByRole('button', { name: 'Invite', exact: true }).click()
  await organization.getByText('Sam').waitFor()
  await social.getByText('Friends and organisations', { exact: true }).first().click()
  await access(social, 'Anyone with the link')
  await access(social, 'Restricted')
  await social
    .getByRole('dialog')
    .getByRole('button', { name: 'Confirm remove access', exact: true })
    .click()
  await social.getByRole('dialog').waitFor({ state: 'hidden' })
  assert.equal(
    await social.evaluate(() => [...window.fixture.records.values()][0].grants.length),
    2,
    'restriction preserves friends and organisation grants',
  )
  await social.close()
  assert.deepEqual(errors, [])
  console.log(
    'Compact sharing: one-step encrypted thread/artifact access, saved links, invitations, recoverable failures, restriction/revocation confirmation, live updates, key recovery, deletion and narrow light/dark layouts passed',
  )
} finally {
  await browser.close()
}
