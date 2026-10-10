import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { chromium } from './browser/harness.mjs'
const built = await build({
  stdin: {
    contents: `
import {createRoot} from 'react-dom/client';import {useState} from 'react';
import {ApplicationStateProvider} from '@dovo/studio-core/state';
import {updateAppPreferences} from '@dovo/studio-core';
import {TaskActivity} from './src/chat/thread/task-activity.tsx';
const payload=JSON.stringify({event:{item:{type:'command_execution',command:'echo command-visible',aggregatedOutput:'OUTPUT-ONLY-WHEN-ENABLED'}}});
const tools=[{id:'command',summary:'Command',status:'completed',time:'2026-10-02T12:00:00Z',payload}];
updateAppPreferences({toolActivity:'expanded',showToolDetails:false});
window.setDetails=enabled=>updateAppPreferences({showToolDetails:enabled});
window.hideWork=()=>updateAppPreferences({toolActivity:'hidden'});function App(){const[failed,setFailed]=useState(false);window.failTool=()=>setFailed(true);return <TaskActivity tools={failed?tools.map(tool=>({...tool,status:'failed'})):tools}/>};createRoot(document.getElementById('app')).render(<ApplicationStateProvider><App/></ApplicationStateProvider>);
`,
    resolveDir: fileURLToPath(new URL('../packages/extension-tasks/', import.meta.url)),
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  loader: { '.css': 'empty' },
  define: { 'process.env.NODE_ENV': '"production"' },
})
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://dovo.test/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }),
  )
  await page.goto('https://dovo.test/')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.locator('details.group\\/action > summary').click()
  await page.getByText('echo command-visible', { exact: true }).last().waitFor()
  const absent = async () => {
    if ((await page.locator('body').textContent()).includes('OUTPUT-ONLY-WHEN-ENABLED'))
      throw new Error('Disabled tool output must not be mounted, even in closed raw details.')
    if (await page.getByText('Raw event', { exact: false }).count())
      throw new Error('Raw event details must not be mounted by default.')
  }
  await absent()
  await page.evaluate(() => window.setDetails(true))
  await page.getByText('OUTPUT-ONLY-WHEN-ENABLED', { exact: true }).waitFor()
  await page.getByText('Raw event', { exact: false }).waitFor()
  await page.evaluate(() => window.setDetails(false))
  await page.waitForFunction(() => !document.body.textContent.includes('OUTPUT-ONLY-WHEN-ENABLED'))
  await absent()
  await page.getByText('echo command-visible', { exact: true }).last().waitFor()
  await page.evaluate(() => window.hideWork())
  await page.getByRole('region', { name: 'Task tool activity' }).waitFor({ state: 'hidden' })
  await page.evaluate(() => window.failTool())
  await page.getByText(/1 failed/).waitFor()
  if (errors.length) throw new Error(errors.join('\n'))
  console.log(
    'Commands remain visible; tool output and raw details mount only when settings enable them and unmount immediately when disabled.',
  )
} finally {
  await browser.close()
}
