import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { chromium } from './browser/harness.mjs'

// Synthetic drafts and an isolated browser origin only. No runtime or user storage is opened.
const root = fileURLToPath(new URL('../', import.meta.url))
const temporary = await mkdtemp(join(tmpdir(), 'dovo-stability-audit-'))
try {
  const output = join(temporary, 'memory.mjs')
  await build({
    stdin: {
      resolveDir: root,
      loader: 'ts',
      contents: `
import {createDraftStorage} from './apps/mobile/src/tasks/draft/storage';
import {randomBytes} from 'node:crypto';
global.gc(); const before=process.memoryUsage().heapUsed;
const drafts=createDraftStorage({getItem:async()=>null,setItem:async()=>{},removeItem:async()=>{}});
for(let i=0;i<500;i++) { const off=drafts.subscribe(String(i),()=>{}); await drafts.write(String(i),randomBytes(24000).toString('hex')); off(); }
global.gc(); console.log(JSON.stringify({threads:500,charactersPerDraft:48000,retainedMiB:(process.memoryUsage().heapUsed-before)/1048576}));
// Keep the singleton alive through the measurement, as the mobile runtime does.
await drafts.read('0');
`,
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: output,
    banner: {
      js: "import {createRequire} from 'node:module';const require=createRequire(import.meta.url);",
    },
  })
  const memory = JSON.parse(
    execFileSync(process.execPath, ['--expose-gc', output], { encoding: 'utf8' }),
  )
  const fixture = await build({
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
import {createRoot} from 'react-dom/client';import {useState} from 'react';
import {useComposerDraft} from './packages/extension-tasks/src/chat/composer/use-composer-draft';
import {Provider} from '@dovo/studio-core';
function Composer(){const draft=useComposerDraft({id:'audit-task',draft:window.savedText});window.draft=draft.controller;return <div>Composer</div>}
createRoot(document.getElementById('app')).render(<Provider><Composer/></Provider>);
`,
    },
    bundle: true,
    platform: 'browser',
    format: 'iife',
    write: false,
    jsx: 'automatic',
    nodePaths: [join(root, 'packages/extension-tasks/node_modules')],
    plugins: [
      {
        name: 'isolated-workspace',
        setup(builder) {
          builder.onResolve({ filter: /^@dovo\/studio-core$/ }, () => ({
            path: 'fixture',
            namespace: 'audit',
          }))
          builder.onLoad({ filter: /.*/, namespace: 'audit' }, () => ({
            loader: 'tsx',
            resolveDir: root,
            contents: `
import {createContext,useContext,useState} from 'react';const Context=createContext(null);
export {composerRecoveryKey,createComposerRecovery} from './packages/studio-core/src/workspace/composer-recovery';
export const useWorkspace=()=>useContext(Context);
export const updateTask=(workspace,id,update)=>({...workspace,tasks:workspace.tasks.map(task=>task.id===id?update(task):task)});
export function Provider({children}) { const [workspace,set]=useState({tasks:[{id:'audit-task',draft:localStorage.getItem('audit-draft')??''}]});window.savedText=workspace.tasks[0].draft;
const setWorkspace=update=>set(current=>{const next=typeof update==='function'?update(current):update;localStorage.setItem('audit-draft',next.tasks[0].draft);return next});
return <Context.Provider value={{setWorkspace,connection:{address:'http://audit-runtime.test',token:'audit-token'},flush:async()=>{}}}>{children}</Context.Provider> }
`,
          }))
        },
      },
    ],
  })
  const browser = await chromium.launch()
  try {
    const context = await browser.newContext()
    await context.route('http://dovo-audit.test/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }),
    )
    const page = await context.newPage()
    await page.goto('http://dovo-audit.test/')
    await page.addScriptTag({ content: fixture.outputFiles[0].text })
    await page.waitForFunction(() => !!window.draft)
    const beforeClose = await page.evaluate(() => {
      window.draft.update('Newest unsent text')
      window.dispatchEvent(new Event('pagehide'))
      return { draft: window.draft.text, stored: localStorage.getItem('audit-draft') }
    })
    await page.close()
    const reopened = await context.newPage()
    await reopened.goto('http://dovo-audit.test/')
    const restored = await reopened.evaluate(() => localStorage.getItem('audit-draft'))
    console.log(
      JSON.stringify({ memory, closeBeforeDebounce: { ...beforeClose, restored } }, null, 2),
    )
  } finally {
    await browser.close()
  }
} finally {
  await rm(temporary, { recursive: true, force: true })
}
