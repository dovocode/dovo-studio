import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const resolveDir = new URL('../apps/mobile/', import.meta.url).pathname
const controls = `
  export const View=({children})=><div>{children}</div>;
  export const Text=({children,accessibilityRole})=><span role={accessibilityRole}>{children}</span>;
  export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;
  export const Field=({label,value,onChangeText,editable})=><input aria-label={label} value={value} disabled={!editable} onChange={event=>onChangeText(event.target.value)}/>;
  export const useTheme=()=>({styles:{},colors:{}});
`
const built = await build({
  stdin: {
    resolveDir,
    loader: 'tsx',
    contents: `
      import {useState} from 'react';import {createRoot} from 'react-dom/client';import {Effect} from 'effect';
      import {CommitSection} from './src/tasks/detail/commit-section';
      const initial={id:'task',repositoryId:'repo',title:'Task',status:'done',execution:'main',messages:[],files:[]};
      window.reads=[];window.writes=[];window.links=[];window.foreground=true;
      function App(){
        const [revision,setRevision]=useState(0),[task,setTask]=useState(initial),[connected,setConnected]=useState(true);
        window.configure=changes=>{if('connected'in changes)setConnected(changes.connected);if('foreground'in changes)window.foreground=changes.foreground;if('task'in changes)setTask({...initial,...changes.task});setRevision(value=>value+1)};
        window.runtime={connected,profile:{id:'local',connection:{address:'http://runtime'}},snapshot:{workspace:{repositories:[{id:'repo',path:'/repo',name:'Project'}]}},
          readEffect:(path,input)=>Effect.tryPromise({try:()=>new Promise((resolve,reject)=>window.reads.push({resolve,reject,input,revision})),catch:cause=>cause}),
          callEffect:(path,input)=>Effect.sync(()=>{window.writes.push({path,input});if(path==='/api/tasks/commit-message')return {message:'Generated message'};if(path==='/api/tasks/commit')return {commit:'123456789',pushError:input.push?'Fixture push failed':undefined};return {ok:true}})};
        return <CommitSection task={task}/>;
      }
      createRoot(document.getElementById('app')).render(<App/>);
    `,
  },
  plugins: [
    {
      name: 'native-git-controls',
      setup(builder) {
        const mocks = {
          'react-native': controls,
          '../../ui/content/text': controls,
          '../../ui/controls/action': controls,
          '../../ui/controls/field': controls,
          '../../ui/theme': controls,
          '../../runtime/state/application-state': `export {useState as useApplicationState} from 'react';`,
          '../../runtime/state/app-active': `export const useAppActive=()=>window.foreground;`,
          '../../runtime/connection/provider': `export const useRuntime=()=>window.runtime;`,
          '../../ui/content/open-link': `export const openAppLink=async url=>{window.links.push(url)};`,
        }
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
  define: { 'process.env.NODE_ENV': '"production"' },
})
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(5000)
  const errors = []
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.error(error.message)
  })
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const clean = {
    dirty: false,
    canPush: true,
    branch: 'feature',
    ahead: 0,
    behind: 0,
    tracking: true,
  }
  const finish = (index, state) =>
    page.evaluate(({ index, state }) => window.reads[index].resolve(state), { index, state })
  const countReads = (count) =>
    page.waitForFunction((count) => window.reads.length === count, count)
  const action = page.getByRole('button', { name: 'Commit & push', exact: true })
  await action.waitFor()
  assert.equal(await action.isDisabled(), true)
  await countReads(1)
  await finish(0, { ...clean, dirty: true })
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll('button')).find(
        (button) => button.textContent === 'Commit & push',
      )?.disabled === false,
  )
  await action.click()
  const working = page.getByRole('button', { name: 'Working…', exact: true })
  await working.waitFor()
  await countReads(2)
  assert.equal(await working.isDisabled(), true)
  await finish(1, { ...clean, ahead: 1 })
  const push = page.getByRole('button', { name: 'Push branch', exact: true })
  await push.waitFor()
  assert.match(await page.locator('body').textContent(), /push failed: Fixture push failed/)
  await push.click()
  await countReads(3)
  await finish(2, clean)
  await action.waitFor()
  assert.equal(await action.isDisabled(), true)
  assert.deepEqual(await page.evaluate(() => window.writes.map((value) => value.path)), [
    '/api/tasks/commit-message',
    '/api/tasks/commit',
    '/api/scm/push',
  ])
  // Preserve status while re-reading, then select commit-only when behind.
  await page.evaluate(() => window.configure({}))
  await countReads(4)
  assert.equal(await action.isDisabled(), true)
  await finish(3, { ...clean, dirty: true, behind: 1 })
  const commit = page.getByRole('button', { name: 'Commit', exact: true })
  await commit.waitFor()
  await page.getByRole('textbox', { name: 'Commit message' }).fill('Manual message')
  await commit.click()
  await countReads(5)
  await finish(4, clean)
  await action.waitFor()
  assert.equal(await page.evaluate(() => window.writes.at(-1).input.push), false)
  assert.equal(await page.evaluate(() => window.writes.at(-1).input.message), 'Manual message')
  // Explicit refresh failures retain status, block mutations and allow retry.
  await page.getByRole('button', { name: 'Refresh Git status' }).click()
  await countReads(6)
  await page.evaluate(() => window.reads[5].reject(new Error('Status unavailable')))
  await page.getByRole('alert').waitFor()
  assert.equal(await page.getByRole('alert').textContent(), 'Status unavailable')
  assert.equal(await action.isDisabled(), true)
  await page.getByRole('button', { name: 'Refresh Git status' }).click()
  await countReads(7)
  await finish(6, { ...clean, dirty: true })
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll('button')).find(
        (button) => button.textContent === 'Commit & push',
      )?.disabled === false,
  )
  // Foreground resumes status reads; background and disconnected states pause them.
  await page.evaluate(() => window.configure({ foreground: false }))
  assert.equal(await page.evaluate(() => window.reads.length), 7)
  await page.evaluate(() => window.configure({ foreground: true }))
  await countReads(8)
  await finish(7, clean)
  await page.evaluate(() =>
    window.configure({
      task: {
        linkedPullRequests: [
          { url: 'https://github.com/team/project/pull/1', number: 1, title: 'PR' },
        ],
      },
    }),
  )
  await countReads(9)
  const open = page.getByRole('button', { name: 'Open PR', exact: true })
  await open.click()
  assert.deepEqual(await page.evaluate(() => window.links), [
    'https://github.com/team/project/pull/1',
  ])
  await finish(8, clean)
  await page.evaluate(() => window.configure({ connected: false, task: {} }))
  await action.waitFor()
  assert.equal(await action.isDisabled(), true)
  assert.equal(await page.evaluate(() => window.reads.length), 9)
  // A different task never inherits the previous task's result.
  await page.evaluate(() => window.configure({ connected: true, task: { id: 'second' } }))
  await countReads(10)
  assert.equal(await action.isDisabled(), true)
  await finish(9, clean)
  assert.deepEqual(errors, [])
  console.log(
    'Mobile Git controls: status-aware commit/push/PR, manual messages, push-only retry, busy refresh, errors, foreground polling and task isolation passed.',
  )
} finally {
  await browser.close()
}
