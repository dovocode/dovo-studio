import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
    import {createRoot} from 'react-dom/client';
    import {useState} from 'react';
    import {ActivityBar} from './packages/studio-shell/src/activity-bar';
    window.checks=0;window.downloads=0;
    function App(){const[state,setState]=useState({status:'idle'});window.update=setState;return <ActivityBar views={[]} activeId="" onSelect={()=>{}} update={state} onCheckUpdates={()=>window.checks++} onUpdate={()=>window.downloads++}/>}
    createRoot(document.getElementById('app')).render(<App/>);
  `,
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    nodePaths: [root + 'packages/studio-ui/node_modules'],
  },
  [
    {
      path: '@dovo/studio-ui',
      contents: `
  export * as Popover from '@radix-ui/react-popover';
  export const useNavigationSidebar=()=>null;export const Button=({children,variant,size,...props})=><button {...props}>{children}</button>;
  export const MessageResponse=({children})=>children;
  export const Tooltip=({children})=>children;export const TooltipTrigger=({children})=>children;export const TooltipContent=()=>null;
  export const cn=(...values)=>values.filter(Boolean).join(' ');
`,
    },
  ],
)
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const rail = page.getByRole('navigation', { name: 'Main navigation' })
  assert.equal(await rail.getByRole('button').count(), 1)
  await rail.getByRole('button').click()
  await page.getByRole('button', { name: 'Check updates', exact: true }).click()
  assert.equal(await page.evaluate(() => window.checks), 1)
  await page.evaluate(() =>
    window.update({ status: 'available', version: '0.0.9', notes: 'New release' }),
  )
  assert.equal(await rail.getByRole('button').count(), 1)
  await page.getByRole('button', { name: 'Download update', exact: true }).click()
  assert.equal(await page.evaluate(() => window.downloads), 1)
  await page.evaluate(() =>
    window.update({ status: 'downloading', version: '0.0.9', progress: 42 }),
  )
  await page.getByText('Downloading 42%', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Download update', exact: true }).count(), 0)
  await page.evaluate(() => window.update({ status: 'downloaded', version: '0.0.9' }))
  await page.getByRole('button', { name: 'Restart and install', exact: true }).click()
  assert.equal(await page.evaluate(() => window.downloads), 2)
  assert.equal(await rail.getByRole('button').count(), 1)
  console.log('One update button handles checking, downloading, progress and restarting.')
} finally {
  await browser.close()
}
