import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const built = await bundleBrowser(
  {
    stdin: {
      contents: `
        import {createRoot} from 'react-dom/client';
        import {BrowserExtensions} from './src/browser/browser-extensions.tsx';
        import {TooltipProvider} from '@dovo/studio-ui';
        import {decode,browserExtensionCommandSchema} from '@dovo/protocol';
        const capabilities={unpackedFolders:true,nativeMessaging:false,chromeWebStore:true,remoteRuntimes:false};
        const extension=(id,name,extra={})=>({id,name,version:'1.2.3',enabled:true,loaded:true,popup:true,unsupportedPermissions:[],removedPermissions:[],...extra});
        window.catalogs={
          work:[extension('a'.repeat(32),'Work helper',{unsupportedPermissions:['debugger'],removedPermissions:['nativeMessaging']}),extension('b'.repeat(32),'Broken helper',{loaded:false,error:'Extension manifest could not load'})],
          personal:[extension('c'.repeat(32),'Personal helper',{popup:false})],
        };
        window.commands=[];
        window.failAction='';
        window.bridge=async command=>{
          decode(browserExtensionCommandSchema,command);
          window.commands.push(command);
          if(window.failAction===command.action)throw new Error('Fixture '+command.action+' failed');
          const entries=window.catalogs[command.profileId];
          if(command.action==='open')return;
          if(command.action==='install')entries.push(extension('d'.repeat(32),'Installed helper'));
          if(command.action==='remove')window.catalogs[command.profileId]=entries.filter(item=>item.id!==command.id);
          if(command.action==='enable'||command.action==='disable')for(const item of entries)if(item.id===command.id){item.enabled=command.action==='enable';item.loaded=item.enabled}
          return {extensions:structuredClone(window.catalogs[command.profileId]),capabilities};
        };
        const root=createRoot(document.getElementById('app'));
        let generation=0;
        window.renderExtensions=(profileId='work',tabKey='current-work-tab',hasPage=true)=>root.render(
          <TooltipProvider><BrowserExtensions key={++generation} profileId={profileId} tabKey={tabKey} hasPage={hasPage}/></TooltipProvider>
        );
        window.hostEnabled=false;
        window.renderExtensions();
      `,
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
  },
  [
    {
      path: '@dovo/studio-core',
      contents:
        'export const useStudioHost=()=>window.hostEnabled?{browserExtensions:window.bridge}:{};',
    },
    // Re-export the real controls without pulling unrelated workspace UI through the barrel.
    {
      path: '@dovo/studio-ui',
      contents: `
      export {Input} from '${root}packages/studio-ui/src/components/ui/input';export {Button} from '${root}packages/studio-ui/src/components/ui/button.tsx';
      export {IconButton} from '${root}packages/studio-ui/src/components/icon-button.tsx';
      export {TooltipProvider} from '${root}packages/studio-ui/src/components/ui/tooltip.tsx';
      export {Dialog,DialogContent,DialogTitle,DialogDescription} from '${root}packages/studio-ui/src/components/ui/dialog.tsx';
    `,
    },
  ],
)

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } })
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('http://localhost/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<html><body><div id="app"></div></body></html>',
    }),
  )
  await page.goto('http://localhost/')
  for (const file of readdirSync(root + 'apps/desktop/dist/assets').filter((name) =>
    name.endsWith('.css'),
  ))
    await page.addStyleTag({
      content: readFileSync(root + 'apps/desktop/dist/assets/' + file, 'utf8'),
    })
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.waitForFunction(() => typeof window.renderExtensions === 'function')
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  // A bridge-less host must not advertise extension controls or make requests.
  assert.equal(await page.getByRole('button', { name: 'Extensions', exact: true }).count(), 0)
  assert.deepEqual(await page.evaluate(() => window.commands), [])
  const render = async (profileId = 'work', tabKey = 'current-work-tab', hasPage = true) => {
    await page.evaluate(
      ({ profileId, tabKey, hasPage }) => {
        window.hostEnabled = true
        window.renderExtensions(profileId, tabKey, hasPage)
      },
      { profileId, tabKey, hasPage },
    )
    await page.getByRole('button', { name: 'Extensions', exact: true }).waitFor()
  }
  const dialog = page.getByRole('dialog', { name: 'Browser extensions' })
  const show = async () => {
    await page.getByRole('button', { name: 'Extensions', exact: true }).click()
    await dialog.waitFor()
    await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'))
  }
  const row = (name) =>
    dialog.locator('.rounded-lg.border').filter({ has: page.getByText(name, { exact: true }) })
  const calls = () => page.evaluate(() => window.commands)
  await render()
  await show()
  assert.deepEqual((await calls()).at(-1), { action: 'list', profileId: 'work' })
  await dialog.getByText('Unsupported access: debugger.', { exact: false }).waitFor()
  await dialog.getByText('Blocked access: nativeMessaging.', { exact: true }).waitFor()
  await dialog.getByRole('alert').filter({ hasText: 'Extension manifest could not load' }).waitFor()
  assert.equal(
    await row('Broken helper').getByRole('button', { name: 'Open popup' }).isEnabled(),
    false,
  )

  await dialog
    .getByRole('textbox', { name: 'Chrome Web Store URL or extension ID' })
    .fill('https://chromewebstore.google.com/detail/helper/' + 'e'.repeat(32))
  await dialog.getByRole('button', { name: 'Install from Web Store', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'))
  assert.deepEqual((await calls()).at(-1), {
    action: 'installStore',
    profileId: 'work',
    url: 'https://chromewebstore.google.com/detail/helper/' + 'e'.repeat(32),
  })
  await dialog.getByRole('button', { name: 'Load extension folder…' }).click()
  await row('Installed helper').waitFor()
  assert.deepEqual((await calls()).at(-1), { action: 'install', profileId: 'work' })
  await row('Work helper').getByRole('button', { name: 'Disable', exact: true }).click()
  await row('Work helper').getByRole('button', { name: 'Enable', exact: true }).waitFor()
  assert.deepEqual((await calls()).at(-1), {
    action: 'disable',
    profileId: 'work',
    id: 'a'.repeat(32),
  })
  assert.equal(
    await row('Work helper').getByRole('button', { name: 'Open popup' }).isEnabled(),
    false,
  )
  await row('Work helper').getByRole('button', { name: 'Enable', exact: true }).click()
  await row('Work helper').getByRole('button', { name: 'Disable', exact: true }).waitFor()
  assert.deepEqual((await calls()).at(-1), {
    action: 'enable',
    profileId: 'work',
    id: 'a'.repeat(32),
  })

  const beforeRemove = (await calls()).length
  await row('Installed helper').getByRole('button', { name: 'Remove…', exact: true }).click()
  await dialog.getByText('Remove Installed helper from this profile?', { exact: true }).waitFor()
  assert.equal((await calls()).length, beforeRemove)
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  assert.equal((await calls()).length, beforeRemove)
  await row('Installed helper').getByRole('button', { name: 'Remove…', exact: true }).click()
  await dialog.getByRole('button', { name: 'Remove extension', exact: true }).click()
  await row('Installed helper').waitFor({ state: 'detached' })
  assert.deepEqual((await calls()).at(-1), {
    action: 'remove',
    profileId: 'work',
    id: 'd'.repeat(32),
  })

  const popup = row('Work helper').getByRole('button', { name: 'Open popup' })
  const bounds = await popup.boundingBox()
  assert.ok(bounds)
  await popup.click()
  await dialog.waitFor({ state: 'hidden' })
  await page.waitForFunction(() => window.commands.at(-1)?.action === 'open')
  assert.deepEqual((await calls()).at(-1), {
    action: 'open',
    profileId: 'work',
    id: 'a'.repeat(32),
    key: 'current-work-tab',
    anchor: {
      x: Math.max(0, Math.round(bounds.x)),
      y: Math.max(0, Math.round(bounds.y)),
      width: Math.max(1, Math.round(bounds.width)),
      height: Math.max(1, Math.round(bounds.height)),
    },
  })
  // Cross two painted frames after bridge fulfillment, catching accidental state-driven reopen.
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  assert.equal(await dialog.count(), 0)

  await page.evaluate(() => {
    window.failAction = 'open'
  })
  await show()
  await row('Work helper').getByRole('button', { name: 'Open popup' }).click()
  await dialog.getByRole('alert').filter({ hasText: 'Fixture open failed' }).waitFor()
  assert.equal(await dialog.isVisible(), true)

  // Remount with another profile/tab, proving commands and catalog stay scoped to their props.
  await page.evaluate(() => {
    window.failAction = ''
  })
  await render('personal', 'current-personal-tab')
  await show()
  await row('Personal helper').waitFor()
  assert.equal(await row('Work helper').count(), 0)
  assert.deepEqual((await calls()).at(-1), { action: 'list', profileId: 'personal' })
  await page.evaluate(() => {
    window.failAction = 'install'
  })
  await dialog.getByRole('button', { name: 'Load extension folder…' }).click()
  await dialog.getByRole('alert').filter({ hasText: 'Fixture install failed' }).waitFor()
  assert.deepEqual((await calls()).at(-1), { action: 'install', profileId: 'personal' })
  await page.evaluate(() => {
    window.failAction = ''
  })
  await row('Personal helper').getByRole('button', { name: 'Run action' }).click()
  await dialog.waitFor({ state: 'hidden' })
  assert.equal((await calls()).at(-1).key, 'current-personal-tab')

  await render('personal', 'empty-tab', false)
  await show()
  assert.equal(
    await row('Personal helper').getByRole('button', { name: 'Run action' }).isEnabled(),
    false,
  )
  await render()
  await page.evaluate(() => {
    window.failAction = 'list'
  })
  await show()
  await dialog.getByRole('alert').filter({ hasText: 'Fixture list failed' }).waitFor()
  assert.deepEqual(errors, [])
  console.log(
    'Browser extensions UI passed: profile scoping, permissions/errors, popup anchors, dialog lifecycle, enable/disable and confirmed removal.',
  )
} finally {
  await browser.close()
}
