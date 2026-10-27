import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'
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
window.hideWork=()=>updateAppPreferences({toolActivity:'hidden'});function App(){const[failed,setFailed]=useState(false);const[source,setSource]=useState(tools);window.museCase=()=>{updateAppPreferences({toolActivity:'expanded',showToolDetails:false});setFailed(false);setSource(museTools)};window.discoveryCase=()=>{updateAppPreferences({toolActivity:'expanded',showToolDetails:true});setFailed(false);setSource(recentTools([{id:'search-start',time:'2026-10-02T12:00:00Z',kind:'tool',scope:'task',summary:'ToolSearch',payload:JSON.stringify({turnId:'turn',toolId:'search',status:'running',event:{message:{content:[{type:'server_tool_use',id:'search',name:'ToolSearch',input:{query:'browser profiles'}}]}}})},{id:'search-result',time:'2026-10-02T12:00:01Z',kind:'tool',scope:'task',summary:'Tool result',payload:JSON.stringify({turnId:'turn',toolId:'search',status:'completed',event:{message:{content:[{type:'tool_search_tool_result',tool_use_id:'search',content:{type:'tool_search_tool_search_result',tool_references:[{type:'tool_reference',tool_name:'mcp__dovo_task__studio_browsers'}]}}]}}})}]))};window.interruptTool=()=>{updateAppPreferences({toolActivity:'hidden'});setFailed(false);setSource(tools.map(tool=>({...tool,status:'interrupted'})))};window.failTool=()=>setFailed(true);window.terminalCase=()=>{updateAppPreferences({toolActivity:'expanded',showToolDetails:false});setFailed(false);const command='pnpm dev -- --host 0.0.0.0';const base={kind:'tool',scope:'task',time:'2026-10-02T12:00:00Z',summary:'Terminal command'};setSource(recentTools(compactActivityEvents([{...base,id:'terminal',payload:JSON.stringify({turnId:'turn',toolId:'terminal:1',status:'completed',terminalCommand:true,presentation:{kind:'command',title:command,input:command,output:'Started in terminal.'}})},{...base,id:'native',summary:'terminal_run',payload:JSON.stringify({turnId:'turn',toolId:'native',status:'completed',event:{item:{tool:'terminal_run',arguments:{command}}}})}])))};return <TaskActivity tools={failed?source.map(tool=>({...tool,status:'failed'})):source}/>};createRoot(document.getElementById('app')).render(<ApplicationStateProvider><App/></ApplicationStateProvider>);
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
const root = fileURLToPath(new URL('../', import.meta.url))
const mobile = root + 'apps/mobile/src/'
const controls = `
export const View=({children})=><div>{children}</div>;
export const Text=({children})=><span>{children}</span>;
export const Pressable=({children,onPress,disabled,accessibilityLabel})=><button disabled={disabled} aria-label={accessibilityLabel} onClick={onPress}>{children}</button>;
export const ActivityIndicator=()=>null,Icon=()=>null;
export const useTheme=()=>({colors:{muted:'#777',text:'#222'},styles:{muted:{},error:{}}});
`
const mobileBuilt = await bundleBrowser(
  {
    stdin: {
      resolveDir: root + 'apps/mobile',
      loader: 'tsx',
      contents: `
import {createRoot} from 'react-dom/client';import {ToolActivityRow} from './src/tasks/conversation/components/tool-activity-row';import {recentTools} from '@dovo/protocol';
const root=createRoot(document.getElementById('app'));
window.renderDiscovery=(failed=false)=>{
 const content=failed?{type:'tool_search_tool_result_error',error_code:'unavailable'}:{type:'tool_search_tool_search_result',tool_references:[{type:'tool_reference',tool_name:'mcp__dovo_task__studio_browsers'}]};
 const events=[{id:'start',time:'2026-10-02T12:00:00Z',kind:'tool',scope:'task',summary:'ToolSearch',payload:JSON.stringify({turnId:'turn',toolId:'search',status:'running',event:{message:{content:[{type:'server_tool_use',id:'search',name:'ToolSearch',input:{query:'browser profiles'}}]}}})},{id:'end',time:'2026-10-02T12:00:01Z',kind:'tool',scope:'task',summary:'Tool result',payload:JSON.stringify({turnId:'turn',toolId:'search',status:'completed',event:{message:{content:[{type:'tool_search_tool_result',tool_use_id:'search',content}]}}})}];
 root.render(<ToolActivityRow event={recentTools(events)[0]}/>);
};window.renderDiscovery();`,
    },
    conditions: ['development'],
    bundle: true,
    write: false,
    format: 'iife',
    jsx: 'automatic',
    alias: {
      react: root + 'packages/studio-ui/node_modules/react',
      'react-dom': root + 'packages/studio-ui/node_modules/react-dom',
    },
  },
  [
    ...[
      'react-native',
      '../../../ui/content/text',
      '../../../ui/controls/icon',
      '../../../ui/theme',
    ].map((path) => ({
      path,
      importer: mobile + 'tasks/conversation/components/',
      contents: controls,
    })),
    {
      path: '../../../runtime/preferences/app-preferences',
      importer: mobile + 'tasks/conversation/components/',
      contents: 'export const useMobilePreferences=()=>({showToolDetails:true});',
    },
    {
      path: '../../../runtime/state/application-state',
      importer: mobile + 'tasks/conversation/components/',
      contents: "export {useState as useApplicationState} from 'react';",
    },
    {
      path: './thread-markdown',
      importer: mobile + 'tasks/conversation/components/',
      contents: 'export const ThreadMarkdown=({text})=><div>{text}</div>;',
    },
    {
      path: './tool-result-images',
      importer: mobile + 'tasks/conversation/components/',
      contents: 'export const ToolResultImages=()=>null;',
    },
    {
      path: '../../../ui/content/mcp-app',
      importer: mobile + 'tasks/conversation/components/',
      contents: 'export const McpAppView=()=>null;',
    },
    {
      path: '../../../ui/content/artifacts',
      importer: mobile + 'tasks/conversation/components/',
      contents: 'export const ArtifactCard=()=>null;',
    },
  ],
)
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
  await page.evaluate(() => window.interruptTool())
  await page.getByText(/1 interrupted/).waitFor()
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
  await page.evaluate(() => window.discoveryCase())
  const discovery = page.locator('details.group\\/action')
  await discovery.getByText('Find tools browser profiles', { exact: true }).waitFor()
  await discovery.locator(':scope > summary').click()
  await discovery.getByText('mcp__dovo_task__studio_browsers', { exact: true }).waitFor()
  if (errors.length) throw new Error(errors.join('\n'))
  const mobilePage = await browser.newPage()
  const mobileErrors = []
  mobilePage.setDefaultTimeout(5000)
  mobilePage.on('pageerror', (error) => mobileErrors.push(error.message))
  await mobilePage.setContent('<div id="app"></div>')
  await mobilePage.addScriptTag({ content: mobileBuilt.outputFiles[0].text })
  await mobilePage.getByRole('button', { name: 'Find tools browser profiles', exact: true }).click()
  await mobilePage.getByText('mcp__dovo_task__studio_browsers', { exact: true }).waitFor()
  await mobilePage.evaluate(() => window.renderDiscovery(true))
  await mobilePage
    .getByRole('button', { name: 'Find tools browser profiles · Failed', exact: true })
    .waitFor()
  await mobilePage.getByText('Tool search failed: unavailable', { exact: true }).waitFor()
  if (mobileErrors.length) throw new Error(mobileErrors.join('\n'))
  console.log(
    'Tool details and discovery pass on desktop and mobile adapter, including typed errors and original queries.',
  )
} finally {
  await browser.close()
}
