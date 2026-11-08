import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const resolveDir = new URL('../packages/studio-ui/', import.meta.url).pathname
const mocks = {
  '@dovo/studio-core': `import {createContext,useContext} from 'react';export const Context=createContext(null);export const useWorkspace=()=>useContext(Context);`,
  '@dovo/studio-ui': `
    export const Button=({children,size,variant,...props})=><button {...props}>{children}</button>;
    export const Dialog=({open,children})=>open?<div role="dialog">{children}</div>:null;
    const Box=({children,...props})=><div {...props}>{children}</div>;
    export const DialogContent=Box,DialogDescription=Box,DialogTitle=Box,ErrorBoundary=Box;
    export const ChoicePicker=({children,onValueChange,...props})=><select {...props} onChange={event=>onValueChange(event.target.value)}>{children}</select>;
    export const FileBrowserTree=({files,onSelect})=><nav>{files.map(file=><button key={file.path} onClick={()=>onSelect(file.path)}>{file.path}</button>)}</nav>;
  `,
  './saved-file-diff': `export const CheckpointDiff=({file})=><div data-preview={file.path}>{file.path}: {file.before} → {file.after}</div>;`,
}
const built = await build({
  conditions: ['development'],
  stdin: {
    contents: `
      import {useState} from 'react';import {createRoot} from 'react-dom/client';
      import {Context} from '@dovo/studio-core';
      import {ReviewSideThreadChangesButton} from '../extension-tasks/src/detail/side-thread-changes';
      window.reads=[];window.after='snapshot-one';
      const request=async(path,input)=>{window.reads.push({path,input});
        if(path.endsWith('/changes')){
          if(window.failNext){window.failNext=false;throw Error('Wait for the side thread to finish')}
          return {before:'creation-snapshot',after:window.after,files:[{path:'one.ts',before:'old',after:'new',viewed:false},{path:'two.ts',before:'old',after:'new',viewed:false}],omitted:['large.bin']};
        }
        return {before:{kind:'text',text:'old',size:3,truncated:false},after:{kind:'text',text:input.full?'full-new':'new',size:3,truncated:!input.full}};
      };
      function App(){const [runtime,setRuntime]=useState('mac');window.setRuntime=setRuntime;
        return <Context.Provider value={{request,connected:true,activeRuntimeId:runtime,connection:{address:'http://'+runtime,token:'token'}}}>
          <ReviewSideThreadChangesButton task={{id:'child',sideThread:{source:'snapshot'}}}/>
        </Context.Provider>;
      }
      createRoot(document.getElementById('app')).render(<App/>);
    `,
    resolveDir,
    loader: 'tsx',
  },
  plugins: [
    {
      name: 'side-thread-review-fixture',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, ({ path }) =>
          Object.hasOwn(mocks, path) ? { path, namespace: 'mock' } : undefined,
        )
        builder.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({
          contents: mocks[path],
          loader: 'tsx',
          resolveDir,
        }))
      },
    },
  ],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"development"' },
})
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.getByRole('button', { name: 'Review changes', exact: true }).click()
  await page.getByRole('button', { name: 'two.ts', exact: true }).click()
  await page.getByRole('button', { name: 'Load full diff', exact: true }).click()
  await page.locator('[data-preview="two.ts"]').filter({ hasText: 'full-new' }).waitFor()
  const input = await page.evaluate(() =>
    window.reads.filter((read) => read.path.endsWith('/file-preview')).at(-1),
  )
  assert.deepEqual(input, {
    path: '/api/tasks/side-thread/file-preview',
    input: {
      id: 'child',
      path: 'two.ts',
      before: 'creation-snapshot',
      after: 'snapshot-one',
      full: true,
    },
  })
  await page.evaluate(() => {
    window.after = 'snapshot-two'
  })
  await page.getByRole('button', { name: 'Refresh changes', exact: true }).click()
  await page.getByRole('button', { name: 'Load full diff', exact: true }).waitFor()
  assert.equal(
    await page.getByRole('combobox', { name: 'Side-chat changed file' }).inputValue(),
    'two.ts',
  )
  await page.evaluate(() => {
    window.failNext = true
  })
  await page.getByRole('button', { name: 'Refresh changes', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Wait for the side thread to finish' }).waitFor()
  assert.equal(
    await page.getByRole('combobox', { name: 'Side-chat changed file' }).inputValue(),
    'two.ts',
  )
  await page.getByRole('button', { name: 'large.bin', exact: true }).click()
  await page.waitForFunction(() =>
    window.reads.some(
      (read) =>
        read.path.endsWith('/file-preview') &&
        read.input.path === 'large.bin' &&
        read.input.after === 'snapshot-two',
    ),
  )
  await page.evaluate(() => window.setRuntime('other'))
  await page.getByRole('dialog').waitFor({ state: 'detached' })
  assert.deepEqual(errors, [])
  console.log(
    'Desktop side-chat snapshot review: pinned full previews, omitted paths, retained selection/errors and connection scope passed',
  )
} finally {
  await browser.close()
}
