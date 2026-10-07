import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { chromium } from '../packages/runtime/node_modules/playwright/index.mjs'

const mocks = {
  '@dovo/studio-core': `export const useWorkspace=()=>window.store; export const useStudioHost=()=>({navigate:target=>window.navigation=target});`,
  '@dovo/studio-ui': `import React,{createContext,useContext} from 'react';const Context=createContext(false);export const Button=({children,variant,size,...props})=><button {...props}>{children}</button>;export const Dialog=({open,children})=><Context.Provider value={open}>{children}</Context.Provider>;export const DialogContent=({children})=>useContext(Context)?<div role="dialog">{children}</div>:null;export const DialogTitle=({children})=><h2>{children}</h2>;export const DialogDescription=({children})=><p>{children}</p>;`,
}
const built = await build({
  stdin: {
    contents: `import {createRoot} from 'react-dom/client';import {TaskTransfer} from './src/detail/task-transfer';
const source={id:'source',name:'Laptop',connection:{address:'http://source',token:'source-token'}},target={id:'target',name:'Desktop',connection:{address:'http://target',token:'target-token'}};
const task={id:'task',title:'Handoff',repositoryId:'repo',agentId:'agent',status:'review',createdAt:'',messages:[{id:'u',role:'user',text:'Continue me'}],files:[],draft:'',example:false};
window.calls=[];window.navigation=null;window.fail=true;window.switched='';
const options={runtimeId:'11111111-1111-4111-8111-111111111111',projects:[{id:'one',name:'Project one',identity:'git-project',agents:[{id:'a',name:'Agent A',provider:'codex',model:'test'},{id:'b',name:'Agent B',provider:'codex',model:'test'}]},{id:'two',name:'Project two',identity:'git-project',agents:[{id:'c',name:'Agent C',provider:'codex',model:'test'}]}]};
window.store={workspace:{tasks:[task],repositories:[{id:'repo',name:'Source',path:'/repo'}],agents:[{id:'agent',name:'Source agent',provider:'codex',model:'test',instructions:'',permission:'ask',endpoint:''}]},runtimeRegistry:{profiles:[source,target]},activeRuntimeId:'source',connection:source.connection,connected:true,flush:async()=>{},refreshRuntimes:async()=>{},switchRuntime:async id=>window.switched=id,
readRuntime:async(profile,path,input)=>{window.calls.push({runtime:profile.id,path,input});if(path.endsWith('/options'))return profile.id==='source'?{runtimeId:'22222222-2222-4222-8222-222222222222',projects:[{id:'repo',identity:'git-project',agents:[]}]}:options;if(path.endsWith('/prepare'))return{package:{id:input.id,target:input.target},checksum:'a'.repeat(64)};if(path.endsWith('/stage')){if(window.fail)throw new Error('Destination disconnected');return{id:input.package.id,taskId:input.package.target.taskId,checksum:input.checksum}};if(path.endsWith('/seal'))return{...input,secret:'b'.repeat(64)};if(path.endsWith('/activate'))return{...input,state:'active'};return{state:'aborted'};}};
createRoot(document.getElementById('app')).render(<TaskTransfer task={task}/>);`,
    resolveDir: fileURLToPath(new URL('../packages/extension-tasks/', import.meta.url)),
    loader: 'tsx',
  },
  plugins: [
    {
      name: 'transfer-harness',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, ({ path }) =>
          Object.hasOwn(mocks, path) ? { path, namespace: 'transfer-harness' } : undefined,
        )
        builder.onLoad({ filter: /.*/, namespace: 'transfer-harness' }, ({ path }) => ({
          contents: mocks[path],
          loader: 'tsx',
          resolveDir: fileURLToPath(new URL('../packages/extension-tasks/', import.meta.url)),
        }))
      },
    },
  ],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
})
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage(),
    errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('http://dovo.test/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }),
  )
  await page.goto('http://dovo.test/')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.getByRole('button', { name: 'Move to computer…' }).click()
  await page.getByLabel('Computer').selectOption('target')
  await page.getByLabel('Project').selectOption('one')
  if (await page.getByRole('button', { name: 'Move task', exact: true }).isEnabled())
    throw new Error('Ambiguous agent must be selected explicitly')
  await page.getByLabel('Agent', { exact: true }).selectOption('b')
  await page.getByLabel('Agent context').selectOption('replay')
  await page.getByRole('button', { name: 'Move task', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Destination disconnected' }).waitFor()
  const initial = await page.evaluate(
    () => window.calls.find((call) => call.path.endsWith('/prepare')).input,
  )
  await page.evaluate(() => (window.fail = false))
  await page.getByRole('button', { name: 'Retry move' }).click()
  await page.waitForFunction(() => window.navigation !== null)
  const result = await page.evaluate(() => ({
    calls: window.calls,
    navigation: window.navigation,
    switched: window.switched,
  }))
  const attempts = result.calls.filter((call) => call.path.endsWith('/prepare'))
  if (
    attempts.length !== 2 ||
    attempts.some(
      (call) => call.input.id !== initial.id || call.input.target.taskId !== initial.target.taskId,
    )
  )
    throw new Error('Retry changed the transfer identity')
  if (
    initial.target.repositoryId !== 'one' ||
    initial.target.agentId !== 'b' ||
    initial.mode !== 'replay'
  )
    throw new Error('Explicit project, agent or mode choice was lost')
  if (result.navigation.entityId !== initial.target.taskId || result.switched !== 'target')
    throw new Error('Did not open the imported task on destination')
  if (errors.length) throw new Error(errors.join('\n'))
  console.log(
    'Task transfer browser checks passed: explicit selection, visible failure, stable retry and destination navigation.',
  )
} finally {
  await browser.close()
}
