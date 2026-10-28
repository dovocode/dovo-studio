import { build } from 'esbuild'
import assert from 'node:assert/strict'
import { chromium } from './browser/harness.mjs'
import { fileURLToPath } from 'node:url'
import { readFileSync, readdirSync, mkdirSync } from 'node:fs'
const root = fileURLToPath(new URL('../', import.meta.url))
const built = await build({
  stdin: {
    contents: `import {createRoot} from 'react-dom/client';import Settings from '../studio-shell/src/app-settings/browser.tsx';import {ExternalBrowserLinkChooser} from '../studio-shell/src/external-browser-link-chooser.tsx';import {TooltipProvider} from '@dovo/studio-ui';createRoot(document.getElementById('app')).render(<TooltipProvider><Settings/><ExternalBrowserLinkChooser subscribe={listener=>{window.sendExternal=listener;return()=>{window.sendExternal=undefined}}} onOpen={()=>window.openedBrowser=(window.openedBrowser??0)+1}/></TooltipProvider>);`,
    resolveDir: root + 'packages/extension-tasks',
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  jsx: 'automatic',
  conditions: ['development'],
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [
    {
      name: 'fixture',
      setup(builder) {
        builder.onResolve({ filter: /^@dovo\/studio-ui$/ }, () => ({
          path: 'ui',
          namespace: 'app-settings-ui',
        }))
        builder.onLoad({ filter: /.*/, namespace: 'app-settings-ui' }, () => ({
          loader: 'tsx',
          resolveDir: root + 'packages/studio-ui',
          contents: `
export * from '${root}packages/studio-ui/src/settings-layout.tsx';
export * from '${root}packages/studio-ui/src/components/ui/button.tsx';
export * from '${root}packages/studio-ui/src/components/ui/input.tsx';
export * from '${root}packages/studio-ui/src/components/ui/select.tsx';
export * from '${root}packages/studio-ui/src/components/ui/tooltip.tsx';
export * from '${root}packages/studio-ui/src/components/ui/dialog.tsx';
export * from '${root}packages/studio-ui/src/choice-picker.tsx';
`,
        }))
        builder.onResolve({ filter: /^@dovo\/studio-core$|^\.\/workspace\/context$/ }, () => ({
          path: 'core',
          namespace: 'fixture',
        }))
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          loader: 'js',
          resolveDir: root + 'packages/extension-tasks',
          contents: `
import {useSyncExternalStore} from 'react';
export * from '@dovo/protocol';export {useRemoteBrowserProfiles} from '${root}packages/studio-core/src/browser-profiles.ts';
export const providers=[];export const useResolvedTheme=()=> 'dark';
let preferences={browserAutoSettleMinutes:0,browserCloseSettledMinutes:0,browserViewport:'fill',browserProfiles:[{id:'default',name:'Local Default'}]};const listeners=new Set();
export const useAppPreferences=()=>useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>preferences);
export const updateAppPreferences=changes=>{preferences={...preferences,...changes};window.preferences=preferences;for(const notify of listeners)notify()};
window.defaultStatus={supported:true,isDefault:false};window.defaultRequests=0;window.openedTabs=[];
const defaultBrowser={status:async()=>window.defaultStatus,request:async()=>{window.defaultRequests++;if(window.defaultFailure)throw Error('System settings unavailable')}};
const nativeBrowser=async(command)=>{if(window.browserFailure)throw Error('Could not open tab');window.openedTabs.push(command)};
export const useStudioHost=()=>({browser:nativeBrowser,defaultBrowser});
const allRuntimes=[{profile:{id:'one',name:'Mac',connection:{address:'http://one',token:'token-one'}},connected:true},{profile:{id:'two',name:'Server',connection:{address:'http://two',token:'token-two'}},connected:true}];
let runtimes=allRuntimes;window.setRuntimeCount=count=>{runtimes=allRuntimes.slice(0,count);updateAppPreferences({})};
window.calls=[];const profiles={one:[{id:'default',name:'Remote Default'}],two:[{id:'default',name:'Server Default'}]};
const call=async(id,path,input)=>{window.calls.push({id,path,input});if(path.endsWith('/save'))profiles[id]=input.profiles;return {profiles:profiles[id]}};
const readRuntime=(profile,path,input)=>call(profile.id,path,input);const request=(path,input)=>call('one',path,input);
export const useWorkspace=()=>({runtimes,activeRuntimeId:'one',connection:runtimes[0].profile.connection,connected:true,readRuntime,request});
`,
        }))
      },
    },
  ],
})
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 1000 } })
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  let cancelRemoval = false
  page.on('dialog', (dialog) => (cancelRemoval ? dialog.dismiss() : dialog.accept()))
  await page.route('http://localhost/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<html class="dark"><body style="margin:0"><div id="app"></div></body></html>',
    }),
  )
  await page.goto('http://localhost/')
  for (const file of readdirSync(root + 'apps/desktop/dist/assets').filter((file) =>
    file.endsWith('.css'),
  ))
    await page.addStyleTag({
      content: readFileSync(root + 'apps/desktop/dist/assets/' + file, 'utf8'),
    })
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const makeDefault = page.getByRole('button', { name: 'Set as default browser', exact: true })
  await makeDefault.click()
  assert.equal(await page.evaluate(() => window.defaultRequests), 1)
  await page.evaluate(() => {
    window.defaultStatus = { supported: true, isDefault: true }
    window.dispatchEvent(new Event('focus'))
  })
  await page.getByText('Dovo Studio is your default browser for HTTP and HTTPS links.').waitFor()
  assert.equal(
    await page.getByRole('button', { name: 'Default browser', exact: true }).isDisabled(),
    true,
  )
  await page.evaluate(() => {
    window.defaultStatus = { supported: true, isDefault: false }
    window.defaultFailure = true
    window.dispatchEvent(new Event('focus'))
  })
  await makeDefault.click()
  await page.getByRole('alert').filter({ hasText: 'System settings unavailable' }).waitFor()
  await page.evaluate(() => {
    window.defaultFailure = false
    window.dispatchEvent(new Event('focus'))
  })
  for (const label of [
    'Auto-settle unused tabs after (minutes)',
    'Close settled tabs after (minutes)',
  ]) {
    const timer = page.getByRole('spinbutton', { name: label, exact: true })
    assert.equal(await timer.inputValue(), '0')
    await timer.fill('45')
    assert.equal(await timer.inputValue(), '45')
    await timer.fill('0')
  }
  const local = page
    .getByRole('heading', { name: 'Local browser profiles', exact: true })
    .locator('xpath=ancestor::section[1]')
  const remote = page
    .getByRole('heading', { name: 'Remote browser profiles', exact: true })
    .locator('xpath=ancestor::section[1]')
  await local.getByRole('textbox', { name: 'New profile name' }).fill('Local Work')
  await local.getByRole('button', { name: 'Add profile', exact: true }).click()
  await local.getByRole('textbox', { name: 'Name for Local Work' }).waitFor()
  const language = local.getByRole('textbox', { name: 'Language for Local Work' })
  assert.equal(await language.inputValue(), 'en-US')
  await language.fill('not_a_locale')
  assert.equal(
    await local.getByRole('button', { name: 'Save', exact: true }).last().isDisabled(),
    true,
  )
  await language.fill('nl-NL')
  await local.getByRole('button', { name: 'Save', exact: true }).last().click()
  assert.equal(
    await local.getByRole('textbox', { name: 'Language for Local Work' }).inputValue(),
    'nl-NL',
  )
  await local.getByRole('button', { name: 'Emoji for Local Work', exact: true }).click()
  mkdirSync(root + 'work/shared-browser', { recursive: true })
  await page
    .getByRole('dialog', { name: 'Emoji for Local Work', exact: true })
    .evaluate(async (element) => {
      await Promise.all(
        element.getAnimations({ subtree: true }).map((animation) => animation.finished),
      )
    })
  await page.screenshot({ path: root + 'work/shared-browser/profile-emoji-picker.png' })
  await page.getByRole('option', { name: '💼 Work', exact: true }).click()
  await local
    .getByRole('form', { name: 'Browser profile Local Work' })
    .getByRole('button', { name: 'Save', exact: true })
    .click()
  assert.equal(
    await page.evaluate(
      () =>
        window.preferences.browserProfiles.find((profile) => profile.name === 'Local Work').emoji,
    ),
    '💼',
  )
  const searchForm = local.getByRole('form', { name: 'Browser profile Local Work' })
  const selectSearch = async (name) => {
    await local.getByRole('button', { name: 'Search engine for Local Work', exact: true }).click()
    await page.getByRole('option', { name, exact: true }).click()
  }
  await selectSearch('DuckDuckGo')
  await searchForm.getByRole('button', { name: 'Save', exact: true }).click()
  assert.deepEqual(
    await page.evaluate(
      () =>
        window.preferences.browserProfiles.find((profile) => profile.name === 'Local Work').search,
    ),
    { engine: 'duckduckgo' },
  )
  await selectSearch('Custom URL')
  const searchUrl = local.getByRole('textbox', { name: 'Search URL for Local Work' })
  await searchUrl.fill('https://example.com/search')
  assert.equal(
    await searchForm.getByRole('button', { name: 'Save', exact: true }).isDisabled(),
    true,
  )
  await searchUrl.fill('http://search.lan/find?q=%s')
  await searchForm.getByRole('button', { name: 'Save', exact: true }).click()
  assert.deepEqual(
    await page.evaluate(
      () =>
        window.preferences.browserProfiles.find((profile) => profile.name === 'Local Work').search,
    ),
    { engine: 'custom', url: 'http://search.lan/find?q=%s' },
  )
  await page.screenshot({
    path: root + 'work/shared-browser/search-engine-settings.png',
    fullPage: true,
  })
  const domains = local.getByRole('textbox', { name: 'Link domains for Local Work' })
  await domains.fill('https://invalid.example/path')
  assert.equal(await domains.getAttribute('aria-invalid'), 'true')
  await domains.fill('TEAMS.MICROSOFT.COM, *.example.com, example.com/Work/')
  await local.getByRole('button', { name: 'Save', exact: true }).last().click()
  assert.deepEqual(
    await page.evaluate(
      () => window.preferences.browserProfiles.find((p) => p.name === 'Local Work').linkDomains,
    ),
    ['teams.microsoft.com', '*.example.com', 'example.com/Work'],
  )
  assert.equal(
    await local.getByRole('textbox', { name: 'Link domains for Local Work' }).inputValue(),
    'teams.microsoft.com, *.example.com, example.com/Work',
  )
  assert.equal(
    await remote.getByRole('textbox', { name: /Link domains for/ }).count(),
    0,
    'Rules belong to local desktop profiles',
  )
  await local
    .getByRole('textbox', { name: 'Link domains for Local Default' })
    .fill('teams.microsoft.com')
  await local
    .getByRole('form', { name: 'Browser profile Local Default' })
    .getByRole('button', { name: 'Save', exact: true })
    .click()
  await local
    .getByRole('alert')
    .getByText(/assigned to only one profile/)
    .waitFor()
  assert.equal(
    await page.evaluate(
      () => window.preferences.browserProfiles.find((p) => p.id === 'default').linkDomains,
    ),
    undefined,
  )
  await local
    .getByRole('textbox', { name: 'Link domains for Local Default' })
    .fill('support.example.com')
  await local
    .getByRole('form', { name: 'Browser profile Local Default' })
    .getByRole('button', { name: 'Save', exact: true })
    .click()
  assert.equal(await local.getByRole('alert').count(), 0)

  await remote.getByRole('textbox', { name: 'Name for Remote Default' }).waitFor()
  await remote.getByRole('textbox', { name: 'New profile name' }).fill('Remote Work')
  await remote.getByRole('button', { name: 'Add profile', exact: true }).click()
  await remote.getByRole('textbox', { name: 'Name for Remote Work' }).waitFor()
  await remote.getByRole('textbox', { name: 'Name for Remote Work' }).fill('Remote Personal')
  await remote.getByRole('button', { name: 'Emoji for Remote Work', exact: true }).click()
  await page.getByRole('option', { name: '🏠 Home', exact: true }).click()
  await remote.getByRole('button', { name: 'Save', exact: true }).last().click()
  await remote.getByRole('textbox', { name: 'Name for Remote Personal' }).waitFor()
  assert.equal(
    await page.evaluate(
      () =>
        window.calls
          .filter((call) => call.path.endsWith('/save'))
          .at(-1)
          .input.profiles.find((profile) => profile.name === 'Remote Personal').emoji,
    ),
    '🏠',
  )
  await remote
    .getByRole('button', { name: 'Search engine for Remote Personal', exact: true })
    .click()
  await page.getByRole('option', { name: 'Kagi', exact: true }).click()
  await remote
    .getByRole('form', { name: 'Browser profile Remote Personal' })
    .getByRole('button', { name: 'Save', exact: true })
    .click()
  await page.waitForFunction(
    () =>
      window.calls
        .filter((call) => call.path.endsWith('/save'))
        .at(-1)
        .input.profiles.find((profile) => profile.name === 'Remote Personal')?.search?.engine ===
      'kagi',
  )
  assert.equal(
    await page.evaluate(() => window.calls.filter((call) => call.path.endsWith('/save')).at(-1).id),
    'one',
  )
  const savesBeforeRemoval = await page.evaluate(
    () => window.calls.filter((call) => call.path.endsWith('/save')).length,
  )
  await remote.getByRole('textbox', { name: 'Name for Remote Personal' }).fill('Unsaved rename')
  cancelRemoval = true
  await remote.getByRole('button', { name: 'Remove', exact: true }).click()
  assert.equal(
    await remote.getByRole('textbox', { name: 'Name for Remote Personal' }).inputValue(),
    'Unsaved rename',
  )
  assert.equal(
    await page.evaluate(() => window.calls.filter((c) => c.path.endsWith('/save')).length),
    savesBeforeRemoval,
  )
  cancelRemoval = false
  await remote.getByRole('button', { name: 'Remove', exact: true }).click()
  await page.waitForFunction(
    (count) => window.calls.filter((c) => c.path.endsWith('/save')).length === count + 1,
    savesBeforeRemoval,
  )
  await remote.getByRole('button', { name: 'Computer for browser profiles' }).click()
  await page.getByRole('option', { name: 'Server', exact: true }).click()
  await remote.getByRole('textbox', { name: 'Name for Server Default' }).waitFor()
  if (await remote.getByRole('textbox', { name: 'Name for Remote Default' }).count())
    throw new Error('Profiles leaked between runtimes')
  if (!(await local.getByRole('textbox', { name: 'Name for Local Work' }).count()))
    throw new Error('Local profiles changed with remote profiles')
  const calls = await page.evaluate(() => window.calls)
  if (calls.filter((c) => c.path.endsWith('/save')).some((c) => c.id !== 'one') || errors.length)
    throw new Error(JSON.stringify({ calls, errors }))
  await page.evaluate(() => window.setRuntimeCount(1))
  await remote.getByRole('textbox', { name: 'Name for Remote Default' }).waitFor()
  assert.equal(
    await remote.getByRole('button', { name: 'Computer for browser profiles' }).count(),
    0,
  )
  await page.evaluate(() => {
    window.sendExternal('https://unmatched.example/one#anchor')
    window.sendExternal('http://unmatched.example/two')
  })
  const chooser = page.getByRole('dialog', { name: 'Open external link' })
  await chooser.getByText('https://unmatched.example/one#anchor', { exact: true }).waitFor()
  await chooser.getByRole('button', { name: 'Local Work · This computer', exact: true }).click()
  await chooser.getByText('http://unmatched.example/two', { exact: true }).waitFor()
  await page.evaluate(() => (window.browserFailure = true))
  await chooser.getByRole('button', { name: 'Remote Default · Mac', exact: true }).click()
  await chooser.getByRole('alert').filter({ hasText: 'Could not open tab' }).waitFor()
  await page.evaluate(() => (window.browserFailure = false))
  await chooser.getByRole('button', { name: 'Remote Default · Mac', exact: true }).click()
  await chooser.waitFor({ state: 'detached' })
  const opened = await page.evaluate(() => window.openedTabs)
  assert.equal(opened.length, 2)
  assert.equal(opened[0].tab.kind, 'web')
  assert.equal(
    opened[0].tab.profileId,
    await page.evaluate(
      () => window.preferences.browserProfiles.find((profile) => profile.name === 'Local Work').id,
    ),
  )
  assert.equal(opened[0].tab.url, 'https://unmatched.example/one#anchor')
  assert.equal(opened[1].tab.kind, 'remote')
  assert.equal(opened[1].tab.runtimeId, 'one')
  assert.equal(opened[1].tab.url, 'http://unmatched.example/two')
  mkdirSync('/tmp/dovo-settings-screenshots/browser-profiles-polished', { recursive: true })
  await page.screenshot({
    path: '/tmp/dovo-settings-screenshots/browser-profiles-polished/settings.png',
    fullPage: true,
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({
    path: '/tmp/dovo-settings-screenshots/browser-profiles-polished/settings-narrow.png',
    fullPage: true,
  })
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth))
    throw new Error('Browser settings overflowed a narrow window')
  await page.evaluate(() => {
    window.sendExternal('https://unmatched.example/' + 'long-path'.repeat(40))
    window.sendExternal('https://unmatched.example/next')
  })
  await chooser.waitFor()
  assert.equal(
    await chooser.evaluate((element) => element.scrollWidth > element.clientWidth),
    false,
    'The external-link chooser must fit a narrow window.',
  )
  await chooser.getByRole('button', { name: 'Cancel this link', exact: true }).click()
  await chooser.getByText('https://unmatched.example/next', { exact: true }).waitFor()
  await chooser.getByRole('button', { name: 'Cancel this link', exact: true }).click()
  await chooser.waitFor({ state: 'detached' })
  assert.equal(
    await page.evaluate(() => window.openedTabs.length),
    2,
    'Cancelling one queued link must not open it or lose the next link.',
  )
  console.log(
    'Browser settings: profiles, domain/path rules, default-browser setup and queued local/remote external links passed.',
  )
} finally {
  await browser.close()
}
