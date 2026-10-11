import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'

const built = await build({
  stdin: {
    resolveDir: fileURLToPath(new URL('../packages/extension-tasks/', import.meta.url)),
    loader: 'tsx',
    contents: `
      import {useLayoutEffect} from 'react';
      import {createRoot} from 'react-dom/client';
      import {flushSync} from 'react-dom';
      import {useCommittedCallback} from './src/detail/use-committed-callback';
      const root=createRoot(document.getElementById('app'));
      window.retained=[];
      function Actions({task,busy}) {
        const surface=useCommittedCallback(()=>task.id);
        const start=useCommittedCallback(()=>busy?'busy':task.id);
        useLayoutEffect(()=>{window.commands??={surface,start}},[]);
        return <button onClick={start}>{task.id}</button>;
      }
      window.renderActions=(iteration,busy)=>{
        const task={id:'thread-'+iteration,text:'Conversation '+iteration+' '+('History '.repeat(10000))};
        window.retained.push(new WeakRef(task));
        flushSync(()=>root.render(<Actions task={task} busy={busy}/>));
      };
      window.renderActions(0,false);
    `,
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
})
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  assert.equal(await page.evaluate(() => window.commands.start()), 'thread-0')
  await page.evaluate(() => {
    for (let iteration = 1; iteration <= 200; iteration++) {
      window.renderActions(iteration, true)
      if (window.commands.start() !== 'busy') throw new Error('Command kept an old busy state')
      window.renderActions(iteration, false)
      if (window.commands.start() !== 'thread-' + iteration)
        throw new Error('Command kept an old thread')
      if (window.commands.surface() !== 'thread-' + iteration)
        throw new Error('Surface selection kept an old thread')
    }
  })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('HeapProfiler.collectGarbage')
  const retained = await page.evaluate(
    () => window.retained.filter((reference) => reference.deref() !== undefined).length,
  )
  assert.ok(retained <= 4, `${retained} old conversation objects survived GC`)
  console.log('Task callback browser checks passed: current commands and bounded render scopes')
} finally {
  await browser.close()
}
