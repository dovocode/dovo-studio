import { build } from 'esbuild'
import { chromium } from './browser/harness.mjs'
import { fileURLToPath } from 'node:url'
import { readFileSync, readdirSync, mkdirSync } from 'node:fs'
const root = fileURLToPath(new URL('../', import.meta.url))
const built = await build({
  stdin: {
    contents: `import {createRoot} from 'react-dom/client';import Settings from '../studio-shell/src/app-settings/browser.tsx';import {TooltipProvider} from '@dovo/studio-ui';createRoot(document.getElementById('app')).render(<TooltipProvider><Settings/></TooltipProvider>);`,
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
let preferences={browserViewport:'fill',browserProfiles:[{id:'default',name:'Local Default'}]};const listeners=new Set();
export const useAppPreferences=()=>useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>preferences);
export const updateAppPreferences=changes=>{preferences={...preferences,...changes};for(const notify of listeners)notify()};
export const useStudioHost=()=>({browser:async()=>{}});
const runtimes=[{profile:{id:'one',name:'Mac',connection:{address:'http://one',token:'token-one'}},connected:true},{profile:{id:'two',name:'Server',connection:{address:'http://two',token:'token-two'}},connected:true}];
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
  page.on('dialog', (dialog) => dialog.accept())
  await page.route('http://localhost/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<html class="dark"><body style="margin:0"><div id="app"></div></body></html>',
    }),
  )
  await page.goto('http://localhost/')
  for (const file of readdirSync(root + 'apps/web/dist/client/assets').filter((file) =>
    file.endsWith('.css'),
  ))
    await page.addStyleTag({
      content: readFileSync(root + 'apps/web/dist/client/assets/' + file, 'utf8'),
    })
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const local = page
    .getByRole('heading', { name: 'Local browser profiles', exact: true })
    .locator('xpath=ancestor::section[1]')
  const remote = page
    .getByRole('heading', { name: 'Remote browser profiles', exact: true })
    .locator('xpath=ancestor::section[1]')
  await local.getByRole('textbox', { name: 'New profile name' }).fill('Local Work')
  await local.getByRole('button', { name: 'Add profile', exact: true }).click()
  await local.getByRole('textbox', { name: 'Name for Local Work' }).waitFor()
  await remote.getByRole('textbox', { name: 'Name for Remote Default' }).waitFor()
  await remote.getByRole('textbox', { name: 'New profile name' }).fill('Remote Work')
  await remote.getByRole('button', { name: 'Add profile', exact: true }).click()
  await remote.getByRole('textbox', { name: 'Name for Remote Work' }).waitFor()
  await remote.getByRole('textbox', { name: 'Name for Remote Work' }).fill('Remote Personal')
  await remote.getByRole('button', { name: 'Save', exact: true }).last().click()
  await remote.getByRole('textbox', { name: 'Name for Remote Personal' }).waitFor()
  await remote.getByRole('button', { name: 'Remove', exact: true }).click()
  await page.waitForFunction(
    () => window.calls.filter((c) => c.path.endsWith('/save')).length === 3,
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
  console.log(
    'Actual settings and profile hook: local add, remote add/rename/remove, runtime-specific catalogs, and metadata save passed.',
  )
} finally {
  await browser.close()
}
