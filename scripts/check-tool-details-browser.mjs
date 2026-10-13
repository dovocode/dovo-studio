import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { chromium } from './browser/harness.mjs'
const built = await build({
  stdin: {
    contents: `
import {createRoot} from 'react-dom/client';import {useState} from 'react';
import {ApplicationStateProvider} from '@dovo/studio-core/state';
import {updateAppPreferences} from '@dovo/studio-core';
import {TaskActivity} from './src/chat/thread/task-activity.tsx';import {recentTools,compactActivityEvents} from '@dovo/protocol';
const payload=JSON.stringify({event:{item:{type:'command_execution',command:'echo command-visible',aggregatedOutput:'OUTPUT-ONLY-WHEN-ENABLED'}}});
const tools=[{id:'command',summary:'Command',status:'completed',time:'2026-10-02T12:00:00Z',payload}];
const museTool=(id,tool,args,extra={})=>({id,summary:tool,status:'completed',time:'2026-10-02T12:00:00Z',payload:JSON.stringify({event:{item:{kind:'toolCall',tool,args:JSON.stringify(args),...extra}}})});
const museTools=[
 museTool('muse-bash','bash',{command:'pnpm test',description:'Run tests'},{visibleOutput:'ok'}),
 museTool('muse-read','read_file',{path:'src/app.ts',limit:120},{visibleOutput:['Read text file src/app.ts.','1|one','2|two'].join(String.fromCharCode(10))}),
 museTool('muse-edit','edit_file',{path:'src/app.ts',find:'a',replace:'b'},{patchSummary:{added:1,files:1,removed:1},visibleOutput:['edited','changed lines: line 3','--- original','+++ updated','@@ -1 +1 @@','-a','+b'].join(String.fromCharCode(10))}),
 museTool('muse-search','search',{pattern:'needle',paths:['src']},{visibleOutput:''}),
];
updateAppPreferences({toolActivity:'expanded',showToolDetails:false});
window.setDetails=enabled=>updateAppPreferences({showToolDetails:enabled});
window.hideWork=()=>updateAppPreferences({toolActivity:'hidden'});function App(){const[failed,setFailed]=useState(false);const[source,setSource]=useState(tools);window.museCase=()=>{updateAppPreferences({toolActivity:'expanded',showToolDetails:false});setFailed(false);setSource(museTools)};window.failTool=()=>setFailed(true);window.terminalCase=()=>{updateAppPreferences({toolActivity:'expanded',showToolDetails:false});setFailed(false);const command='pnpm dev -- --host 0.0.0.0';const base={kind:'tool',scope:'task',time:'2026-10-02T12:00:00Z',summary:'Terminal command'};setSource(recentTools(compactActivityEvents([{...base,id:'terminal',payload:JSON.stringify({turnId:'turn',toolId:'terminal:1',status:'completed',terminalCommand:true,presentation:{kind:'command',title:command,input:command,output:'Started in terminal.'}})},{...base,id:'native',summary:'terminal_run',payload:JSON.stringify({turnId:'turn',toolId:'native',status:'completed',event:{item:{tool:'terminal_run',arguments:{command}}}})}])))};return <TaskActivity tools={failed?source.map(tool=>({...tool,status:'failed'})):source}/>};createRoot(document.getElementById('app')).render(<ApplicationStateProvider><App/></ApplicationStateProvider>);
`,
    resolveDir: fileURLToPath(new URL('../packages/extension-tasks/', import.meta.url)),
    loader: 'tsx',
  },
  conditions: ['development'],
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
  await page.evaluate(() => window.terminalCase())
  const terminalCard = page.locator('details.group\\/action')
  await terminalCard.getByText('pnpm dev -- --host 0.0.0.0', { exact: true }).first().waitFor()
  if ((await terminalCard.count()) !== 1)
    throw new Error('Agent terminal commands must render once, using the Bash command card.')
  await terminalCard.locator('summary').click()
  await terminalCard.locator('pre').filter({ hasText: 'pnpm dev -- --host 0.0.0.0' }).waitFor()
  await page.evaluate(() => window.museCase())
  const text = () => page.locator('body').textContent()
  await page.getByText('Read app.ts', { exact: true }).waitFor()
  for (const expected of [
    'Run tests',
    'src/app.ts · lines 1–2',
    'Edit app.ts',
    'src/app.ts · +1 −1',
    'Search needle',
    '@@ -1 +1 @@',
    '-a',
    '+b',
  ])
    if (!(await text()).includes(expected))
      throw new Error(`Muse tool context missing: ${expected}`)
  const editRows = page.locator('details.group\\/action').filter({ hasText: 'Edit app.ts' })
  await editRows.locator('summary').click()
  await editRows.getByText('+b', { exact: true }).waitFor()
  if ((await editRows.locator('[data-diff="added"]').count()) !== 1)
    throw new Error('Diff additions must carry the added marker rendered green in the app.')
  if ((await editRows.locator('[data-diff="removed"]').count()) !== 1)
    throw new Error('Diff removals must carry the removed marker rendered red in the app.')
  if (errors.length) throw new Error(errors.join('\n'))
  console.log(
    'Commands remain visible; tool output and raw details mount only when settings enable them and unmount immediately when disabled.',
  )
} finally {
  await browser.close()
}
