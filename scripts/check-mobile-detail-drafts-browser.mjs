// Renders the real PR line comment editor, saved draft store and storage notice in Chromium.
// Browser storage stands in for AsyncStorage. A page reload stands in for the OS ending the app.
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { bundleBrowser } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const ui = '../../../ui'
const text = `export const Text=({children,accessibilityRole})=><span role={accessibilityRole}>{children}</span>;`
const action = `export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;`
const theme = `export const useTheme=()=>({colors:{},styles:{}});`
const mocks = {
  '@dovo/protocol': `export * from '${root}packages/protocol/src/index.ts';`,
  'react-native': `
    export const View=({children})=><div>{children}</div>;
    export const Alert={alert:(...args)=>{(window.alerts??=[]).push(args)}};
  `,
  // Device storage that survives a reload. Flags in storage apply before the app starts.
  '../../../runtime/state/detail-draft-storage': `
    const fail=kind=>{if(localStorage.getItem('fixture.fail.'+kind))throw new Error('Storage '+kind+' failed')};
    const keys=()=>Object.keys(localStorage).filter(key=>!key.startsWith('fixture.'));
    export const detailDraftStorage={
      getAllKeys:async()=>{fail('read');return keys()},
      getItem:async key=>{fail('read');return localStorage.getItem(key)},
      // window.writeGate holds writes, like slow device storage.
      setItem:async(key,value)=>{await window.writeGate;fail('write');localStorage.setItem(key,value)},
      removeItem:async key=>{fail('write');fail('remove');localStorage.removeItem(key)},
    };
  `,
  // The fixture origin is plain HTTP, where browsers omit crypto.randomUUID.
  'expo-crypto': `export const randomUUID=()=>'10000000-1000-4000-8000-100000000000'.replace(/[018]/g,c=>(c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>c/4).toString(16));`,
  '../../../runtime/state/application-state': `export {useState as useApplicationState} from 'react';`,
  '../../../runtime/connection/provider': `
    import {createContext,useContext} from 'react';
    export const RuntimeContext=createContext(null);
    export const useRuntime=()=>useContext(RuntimeContext);
  `,
  [`${ui}/layout/sheet`]: `import {useImperativeHandle} from 'react';export const Sheet=({children,ref,onClose})=>{useImperativeHandle(ref,()=>({dismiss:after=>{onClose();after?.()}}));return <section>{children}</section>};`,
  [`${ui}/controls/field`]: `export const Field=({label,value,onChangeText,editable})=><textarea aria-label={label} value={value} disabled={editable===false} onChange={event=>onChangeText(event.target.value)}/>;`,
  [`${ui}/controls/choice`]: `export const Choice=()=>null;`,
  [`${ui}/controls/action`]: action,
  [`${ui}/content/text`]: text,
  [`${ui}/theme`]: theme,
  '../controls/action': action,
  '../theme': theme,
  './text': text,
}
const mobileRequire = createRequire(root + 'apps/mobile/package.json')
const built = await build({
  alias: {
    react: mobileRequire.resolve('react'),
    'react/jsx-runtime': mobileRequire.resolve('react/jsx-runtime'),
  },
  stdin: {
    contents: `
      import {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {Effect} from 'effect';
      import {RuntimeContext} from '../../../runtime/connection/provider';
      import {LineComment} from './src/scm/pulls/detail/line-comment';
      const pull={number:7,headSha:'a'.repeat(40),baseSha:'b'.repeat(40),repositoryUrl:'https://github.com/acme/app',connectionId:'github',destination:'acme'};
      const detail={pull,capabilities:{}};
      const profile={id:'http://studio.local:51464',name:'Studio',connection:{address:'http://studio.local:51464',token:'fixture-device-token-123456',runtimeId:'runtime-a'}};
      window.posts=[];
      const url='https://github.com/acme/app/pull/7#discussion_r1';
      // The runtime keeps each submission's outcome across an app restart, like its SQLite receipts.
      const posted=()=>JSON.parse(localStorage.getItem('fixture.posted')??'[]');
      // An older runtime keeps no submission records. The flag applies before the app starts.
      const snapshot={pullCommentReceiptsSupported:localStorage.getItem('fixture.legacy')?undefined:true,workspace:{repositories:[],jiraSources:[]}};
      // window.loseResponse: the runtime posts, then the response never arrives.
      // window.statusGate: holds the status check, like a slow connection.
      // window.forgetReceipts: the comment posts, but this device's receipts cannot see it, as after
      // a renewed pairing or a restored computer.
      const runtime={connected:true,profile,snapshot,
        callEffect:(path,input)=>Effect.suspend(()=>{window.posts.push({path,input});if(input.submissionId&&!window.forgetReceipts)localStorage.setItem('fixture.posted',JSON.stringify([...posted(),input.submissionId]));return window.loseResponse?Effect.fail(new Error('The connection closed before the computer answered.')):Effect.succeed({url})}),
        readEffect:(path,input)=>Effect.promise(async()=>{window.statusChecks=(window.statusChecks??0)+1;await window.statusGate;return path==='/api/scm/pulls/comment-status'&&posted().includes(input.submissionId)?{status:'posted',url}:{status:'unknown'}})};
      function App(){
        const [path,setPath]=useState(null);
        window.openEditor=setPath;
        return <RuntimeContext.Provider value={runtime}>
          {path&&<LineComment key={path} repositoryId="repo" detail={detail} latestDetail={detail} path={path} onClose={()=>setPath(null)} onDone={()=>{}}/>}
        </RuntimeContext.Provider>;
      }
      createRoot(document.getElementById('app')).render(<App/>);
    `,
    resolveDir: root + 'apps/mobile/',
    loader: 'tsx',
  },
  plugins: [
    {
      name: 'native-boundaries',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, ({ path }) =>
          Object.hasOwn(mocks, path) ? { path, namespace: 'native-boundary' } : undefined,
        )
        builder.onLoad({ filter: /.*/, namespace: 'native-boundary' }, ({ path }) => ({
          contents: mocks[path],
          loader: 'tsx',
          resolveDir: root + 'apps/mobile/',
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

const origin = 'http://drafts.fixture'
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route(`${origin}/**`, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<div id="app"></div><script>${built.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script>`,
    }),
  )
  const comment = page.getByLabel('Comment')
  const line = page.getByLabel('Line in the diff')
  const savedRecords = () =>
    page.evaluate(() =>
      Object.keys(localStorage).filter((key) => key.startsWith('dovo.detail-drafts.v1.')),
    )
  /** A new app process with the same device storage. */
  const restart = async (flags = {}) => {
    await page.evaluate((values) => {
      for (const kind of ['read', 'write', 'remove'])
        localStorage.removeItem('fixture.fail.' + kind)
      for (const [kind, on] of Object.entries(values))
        if (on) localStorage.setItem('fixture.fail.' + kind, '1')
    }, flags)
    await page.reload()
  }
  const open = (path) => page.evaluate((value) => window.openEditor(value), path)

  await page.goto(origin + '/')
  await open('src/review.ts')
  await line.fill('12')
  await comment.fill('Unsent review')
  await page.waitForFunction(() =>
    Object.keys(localStorage).some((key) => key.startsWith('dovo.detail-drafts.v1.')),
  )
  await open('src/other.ts')
  await comment.fill('Other file comment')
  await page.waitForFunction(
    () =>
      Object.keys(localStorage).filter((key) => key.startsWith('dovo.detail-drafts.v1.')).length ===
      2,
  )
  const stored = await page.evaluate(() => JSON.stringify(localStorage))
  assert.ok(!stored.includes('fixture-device-token-123456'), 'Pairing token reached storage')

  // The OS ends the app before submit.
  await restart()
  await open('src/review.ts')
  await page.waitForFunction(
    () => document.querySelector('textarea[aria-label="Comment"]')?.value === 'Unsent review',
  )
  assert.equal(await line.inputValue(), '12')

  // A write failure is visible, keeps the text and recovers on retry.
  await page.evaluate(() => localStorage.setItem('fixture.fail.write', '1'))
  await comment.fill('Unsent review, edited offline')
  await page.getByText('This draft is not saved on this phone.', { exact: false }).waitFor()
  await page.evaluate(() => localStorage.removeItem('fixture.fail.write'))
  await page.getByRole('button', { name: 'Retry saving drafts' }).click()
  await page
    .getByText('This draft is not saved on this phone.', { exact: false })
    .waitFor({ state: 'detached' })
  await restart()
  await open('src/review.ts')
  await page.waitForFunction(
    () =>
      document.querySelector('textarea[aria-label="Comment"]')?.value ===
      'Unsent review, edited offline',
  )

  // A read failure at startup is visible, overwrites nothing and restores on retry.
  await restart({ read: true })
  await open('src/review.ts')
  await page.getByText('Saved drafts could not be read.', { exact: false }).waitFor()
  assert.equal(await comment.inputValue(), '')
  assert.equal((await savedRecords()).length, 2)
  await page.evaluate(() => localStorage.removeItem('fixture.fail.read'))
  await page.getByRole('button', { name: 'Retry saving drafts' }).click()
  await page.waitForFunction(
    () =>
      document.querySelector('textarea[aria-label="Comment"]')?.value ===
      'Unsent review, edited offline',
  )
  await page
    .getByText('Saved drafts could not be read.', { exact: false })
    .waitFor({ state: 'detached' })

  // Posting clears only that draft.
  await page.getByRole('button', { name: 'Post comment' }).click()
  await page.waitForFunction(() => window.posts.length === 1)
  await page.waitForFunction(
    () =>
      Object.keys(localStorage).filter((key) => key.startsWith('dovo.detail-drafts.v1.')).length ===
      1,
  )
  await restart()
  await open('src/review.ts')
  await page.waitForFunction(() =>
    Object.keys(localStorage).some((key) => key.startsWith('dovo.detail-drafts.v1.')),
  )
  assert.equal(await comment.inputValue(), '')
  await open('src/other.ts')
  await page.waitForFunction(
    () => document.querySelector('textarea[aria-label="Comment"]')?.value === 'Other file comment',
  )

  // The runtime accepts the comment, then the phone cannot remove its saved draft.
  await line.fill('3')
  await page.evaluate(() => localStorage.setItem('fixture.fail.remove', '1'))
  await page.getByRole('button', { name: 'Post comment' }).click()
  await page
    .getByText('Comment posted. This phone could not remove its saved copy.', { exact: false })
    .waitFor()
  assert.equal(
    await page.evaluate(() => window.posts.length),
    1,
    'Accepted comment was posted once',
  )
  assert.equal(await page.getByRole('button', { name: 'Post comment' }).count(), 0)
  // The OS ends the app before cleanup succeeds. The draft comes back with its submission ID.
  await restart({ remove: true })
  await open('src/other.ts')
  await page.getByText('This comment was already posted.', { exact: false }).waitFor()
  assert.equal(await comment.inputValue(), 'Other file comment')
  assert.equal(await page.getByRole('button', { name: 'Post comment' }).isDisabled(), true)
  assert.equal(await page.evaluate(() => window.posts.length), 0, 'Reopening never posts again')
  // Removal still fails: the saved copy stays and the accepted status explains it.
  await page.getByRole('button', { name: 'Remove saved copy' }).click()
  await page
    .getByText('Comment posted. This phone could not remove its saved copy.', { exact: false })
    .waitFor()
  await page.evaluate(() => localStorage.removeItem('fixture.fail.remove'))
  await page.getByRole('button', { name: 'Retry removing saved copy' }).click()
  await comment.waitFor({ state: 'detached' })
  assert.deepEqual(await savedRecords(), [])
  await restart()
  await open('src/other.ts')
  await page.waitForFunction(() => document.querySelector('textarea[aria-label="Comment"]'))
  assert.equal(await comment.inputValue(), '')
  assert.equal(await page.getByText('already posted', { exact: false }).count(), 0)
  assert.equal(await page.evaluate(() => window.posts.length), 0)
  await checkSubmissionMarkers(page, { open, restart, comment, line, savedRecords })
  assert.deepEqual(errors, [])
  await checkStartupDefaults(browser)
  console.log('Mobile saved detail drafts browser check passed.')
} finally {
  await browser.close()
}

/**
 * Posting needs a durable submission ID first. A lost response is checked before anything posts
 * again. A saved ID is checked before Post is ever enabled. Older runtimes show their limit.
 */
async function checkSubmissionMarkers(page, { open, restart, comment, line, savedRecords }) {
  const post = page.getByRole('button', { name: /^(Post comment|Saving…|Posting…)$/ })
  const posts = () => page.evaluate(() => window.posts.length)
  const fill = async (path, text) => {
    await open(path)
    await line.fill('5')
    await comment.fill(text)
  }

  // Slow storage: nothing posts until the device holds the ID, and the sheet stays usable.
  await fill('src/slow.ts', 'Slow storage comment')
  await page.waitForFunction(() =>
    Object.keys(localStorage).some((key) => key.includes('src/slow.ts')),
  )
  await page.evaluate(() => {
    window.writeGate = new Promise((resolve) => (window.releaseWrites = resolve))
  })
  await post.click()
  await page.getByText('Saving a record of this post on this phone before sending…').waitFor()
  assert.equal(await posts(), 0)
  await page.getByRole('button', { name: 'Cancel posting' }).click()
  await page.getByRole('button', { name: 'Post comment' }).waitFor()
  await page.evaluate(() => window.releaseWrites())
  await page.waitForTimeout(100)
  assert.equal(await posts(), 0, 'A cancelled press never posts after storage catches up')
  await page.evaluate(() => {
    window.writeGate = new Promise((resolve) => (window.releaseWrites = resolve))
  })
  await post.click()
  await page.getByText('Saving a record of this post on this phone before sending…').waitFor()
  assert.equal(await posts(), 0)
  await page.evaluate(() => {
    window.releaseWrites()
    window.writeGate = undefined
  })
  await page.waitForFunction(() => window.posts.length === 1)
  await comment.waitFor({ state: 'detached' })
  assert.ok(
    (await page.evaluate(() => window.posts[0].input.submissionId)) !== undefined,
    'The posted ID is the one the device saved',
  )

  // Failed storage: Dovo does not send the comment, then posts once after a storage retry.
  await restart()
  await fill('src/failed.ts', 'Failed storage comment')
  await page.waitForFunction(() =>
    Object.keys(localStorage).some((key) => key.includes('src/failed.ts')),
  )
  await page.evaluate(() => localStorage.setItem('fixture.fail.write', '1'))
  await post.click()
  await page
    .getByText('This phone could not save a record of this post', { exact: false })
    .waitFor()
  assert.equal(await posts(), 0)
  await page.evaluate(() => localStorage.removeItem('fixture.fail.write'))
  await page.getByRole('button', { name: 'Retry saving drafts' }).click()
  await post.click()
  await page.waitForFunction(() => window.posts.length === 1)
  await comment.waitFor({ state: 'detached' })

  // The runtime accepts the comment and the response is lost. This sheet checks the original
  // ID, finds it posted, removes the draft and never posts again.
  await restart()
  await fill('src/lost.ts', 'Lost response comment')
  await page.evaluate(() => {
    window.loseResponse = true
  })
  await post.click()
  await comment.waitFor({ state: 'detached' })
  assert.equal(await posts(), 1, 'A lost response does not post twice')
  assert.equal(
    (await savedRecords()).some((key) => key.includes('src/lost.ts')),
    false,
    'The posted draft is removed',
  )

  // A saved ID is checking from the first render. Post is never enabled before the answer.
  await restart()
  await fill('src/process-death.ts', 'Posted before the app stopped')
  await page.evaluate(() => {
    window.loseResponse = true
    // The app stops before the status check answers.
    window.statusGate = new Promise(() => {})
  })
  await post.click()
  await page.getByText('Checking whether this comment was already posted…').waitFor()
  await restart()
  await page.evaluate(() => {
    window.statusGate = new Promise((resolve) => (window.releaseStatus = resolve))
    window.postEnabled = false
    new MutationObserver(() => {
      for (const button of document.querySelectorAll('button'))
        if (button.textContent === 'Post comment' && !button.disabled) window.postEnabled = true
    }).observe(document.body, { subtree: true, childList: true, attributes: true })
  })
  await open('src/process-death.ts')
  await page.getByText('Checking whether this comment was already posted…').waitFor()
  assert.equal(await page.getByRole('button', { name: 'Post comment' }).isDisabled(), true)
  await page.evaluate(() => window.releaseStatus())
  await page.getByText('This comment was already posted.', { exact: false }).waitFor()
  assert.equal(await page.evaluate(() => window.postEnabled), false, 'Post was never enabled')
  assert.equal(await posts(), 0)
  await page.getByRole('button', { name: 'Remove saved copy' }).click()
  await comment.waitFor({ state: 'detached' })

  // An older runtime cannot confirm outcomes. The editor says so before and after a failure.
  await page.evaluate(() => localStorage.setItem('fixture.legacy', '1'))
  await restart()
  await fill('src/legacy.ts', 'Older runtime comment')
  await page
    .getByText('This computer cannot confirm a comment after a lost connection.', { exact: false })
    .waitFor()
  await page.evaluate(() => {
    window.loseResponse = true
  })
  await post.click()
  await page
    .getByText('This computer cannot confirm whether this comment was posted.', { exact: false })
    .waitFor()
  assert.equal(await posts(), 1)
  assert.equal(await page.evaluate(() => window.posts[0].input.submissionId), undefined)
  // Posting again is an explicit choice, never a silent Post.
  assert.equal(await page.getByRole('button', { name: 'Post comment' }).isDisabled(), true)
  await page.evaluate(() => {
    window.loseResponse = false
  })
  await page.getByRole('button', { name: 'Post anyway' }).click()
  await page.waitForFunction(() => window.posts.length === 2)
  await comment.waitFor({ state: 'detached' })
  await page.evaluate(() => localStorage.removeItem('fixture.legacy'))
  await restart()

  // The comment posts, but this device's receipts cannot see it. `unknown` is not proof that it
  // never posted, so the editor asks, in this sheet and after a restart.
  await fill('src/repaired.ts', 'Posted before a renewed pairing')
  await page.evaluate(() => {
    window.loseResponse = true
    window.forgetReceipts = true
  })
  await post.click()
  await page.getByText('This computer has no record of this comment.', { exact: false }).waitFor()
  const firstId = await page.evaluate(() => window.posts[0].input.submissionId)
  assert.equal(await page.getByRole('button', { name: 'Post comment' }).isDisabled(), true)
  assert.equal(await posts(), 1)
  await restart()
  await open('src/repaired.ts')
  await page.getByText('This computer has no record of this comment.', { exact: false }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Post comment' }).isDisabled(), true)
  assert.equal(await posts(), 0, 'Reopening never posts')
  // The user checked the PR and chooses to post. The retry keeps the same ID, so a receipt that
  // this device can see returns its outcome instead of posting again.
  await page.getByRole('button', { name: 'Post anyway' }).click()
  await page.waitForFunction(() => window.posts.length === 1)
  assert.equal(await page.evaluate(() => window.posts[0].input.submissionId), firstId)
  await comment.waitFor({ state: 'detached' })
  assert.equal(
    (await savedRecords()).some((key) => key.includes('src/repaired.ts')),
    false,
  )
}

/**
 * Renders the real Create Bot, Create pull request and pipeline run editors. Each fills a default
 * by itself: the active computer, the destination of a reader whose identity is already known, and
 * the first pipeline when the list arrives. Device storage can be slow or fail at startup. A
 * default set then must not replace or remove saved text. A field typed during startup must stay,
 * and the saved fields the user did not touch must load.
 */
async function checkStartupDefaults(browser) {
  const mobile = root + 'apps/mobile/src/'
  const bots = mobile + 'bots/'
  const pulls = mobile + 'scm/pulls/list/'
  const work = mobile + 'scm/work/'
  const content = mobile + 'ui/content/'
  // A held read stands in for slow device storage. Flags in storage apply before the app starts.
  const storage = `
    window.storageWrites??=[];
    window.storageGate??=localStorage.getItem('fixture.slow')?new Promise(resolve=>window.releaseStorage=resolve):Promise.resolve();
    const fail=kind=>{if(localStorage.getItem('fixture.fail.'+kind))throw new Error('Storage '+kind+' failed')};
    const keys=()=>Object.keys(localStorage).filter(key=>!key.startsWith('fixture.'));
    export const detailDraftStorage={
      getAllKeys:async()=>{await window.storageGate;fail('read');return keys()},
      getItem:async key=>{fail('read');return localStorage.getItem(key)},
      setItem:async(key,value)=>{fail('write');window.storageWrites.push(key);localStorage.setItem(key,value)},
      removeItem:async key=>{fail('write');window.storageWrites.push('remove '+key);localStorage.removeItem(key)},
    };
  `
  const provider = `export const RuntimeScope=({children})=>children;export const useRuntime=()=>window.runtime;`
  const sheet = `export const Sheet=({title,children,footer})=><section aria-label={title}>{children}{footer}</section>;`
  const field = `export const Field=({label,value,onChangeText,editable})=><textarea aria-label={label} value={value} disabled={editable===false} onChange={event=>onChangeText(event.target.value)}/>;`
  const choice = `export const Choice=()=>null;`
  const select = `export const Choice=({label,value,items,disabled,onChange})=><select aria-label={label} data-value={value} value={value} disabled={disabled} onChange={event=>onChange(event.target.value)}>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>;`
  const built = await bundleBrowser(
    {
      stdin: {
        resolveDir: root,
        loader: 'tsx',
        contents: `
          import {useState} from 'react';
          import {createRoot} from 'react-dom/client';
          import {Effect} from 'effect';
          import {CreateBot} from './apps/mobile/src/bots/bot-create';
          import {CreatePull} from './apps/mobile/src/scm/pulls/list/create-pull';
          import {WorkForm} from './apps/mobile/src/scm/work/work-form';
          const connection={address:'http://studio.local:51464',token:'fixture-device-token-123456',runtimeId:'runtime-a'};
          const profile={id:'computer-a',name:'Studio',connection};
          const repositories=[{id:'repo',name:'App',path:'/app',branch:'main'},{id:'dovo:scratch',name:'No Project',kind:'scratch',path:'/scratch',branch:'main'}];
          const snapshot={botsSupported:true,workspace:{repositories,tasks:[],agents:[],automations:[]}};
          const results={'/api/scm/pulls/options/read':{draft:true},'/api/scm/pulls/overview':{pulls:[],hasMore:false},
            '/api/scm/work/pipelines/definitions':{items:[{id:'build',name:'Build'},{id:'deploy',name:'Deploy'}],manual:false}};
          // A held pipeline list stands in for a slow forge.
          const definitions=localStorage.getItem('fixture.slow-definitions')?new Promise(resolve=>window.releaseDefinitions=resolve):Promise.resolve();
          const unexpected=path=>Effect.fail(new Error('Unexpected '+path));
          const changedDefaults=localStorage.getItem('fixture.changed-defaults')==='1';
          const second={id:'computer-b',name:'Second computer',connection:{...connection,address:'http://second.local',runtimeId:'runtime-b'}};
          window.runtime={profile,connected:true,snapshot,activeId:changedDefaults?second.id:profile.id,overviews:[profile,second].map(profile=>({profile,connected:true,snapshot})),
            callEffect:unexpected,readEffect:unexpected,read:async path=>{throw new Error('Unexpected '+path)}};
          // The reader for this repository was verified before the restart.
          window.sourceReader={identity:{destination:changedDefaults?'github.com/acme/renamed':'github.com/acme/app',readerIdentity:'acme'},ready:true,
            readEffect:path=>path==='/api/scm/work/pipelines/definitions'?Effect.promise(()=>definitions.then(()=>results[path])):Effect.succeed(results[path]),
            read:async path=>results[path]};
          const options={provider:'github',issues:true,issueTypes:[],issueStates:[],assignees:true,labels:false,pipelines:true,pipelineActions:['run']};
          function App(){
            const [editor,setEditor]=useState(null);
            window.openEditor=setEditor;
            return editor==='bot'?<CreateBot onClose={()=>setEditor(null)} onCreated={()=>{}}/>
              :editor==='pull'?<CreatePull repositoryId="repo" onClose={()=>setEditor(null)} onCreated={()=>{}}/>
              :editor==='work'?<WorkForm kind="run" repositoryId="repo" options={options} disabled={false} onClose={()=>setEditor(null)} onDone={()=>{}}/>:null;
          }
          createRoot(document.getElementById('app')).render(<App/>);
        `,
      },
      alias: {
        react: mobileRequire.resolve('react'),
        'react/jsx-runtime': mobileRequire.resolve('react/jsx-runtime'),
        'react-dom/client': mobileRequire.resolve('react-dom/client'),
        '@dovo/protocol': root + 'packages/protocol/src/index.ts',
        '@dovo/client-runtime': root + 'packages/client-runtime/src/index.ts',
      },
      bundle: true,
      write: false,
      format: 'iife',
      platform: 'browser',
      jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"production"' },
    },
    [
      {
        path: 'react-native',
        contents: `
          export const View=({children})=><div>{children}</div>;
          export const Pressable=({children,onPress,accessibilityLabel,disabled})=><button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>{typeof children==='function'?children({pressed:false}):children}</button>;
          export const Alert={alert:(...args)=>{(window.alerts??=[]).push(args)}};
        `,
      },
      {
        path: 'expo-crypto',
        contents: 'export const randomUUID=()=>crypto.randomUUID();',
      },
      { path: '../runtime/state/detail-draft-storage', importer: bots, contents: storage },
      { path: '../../../runtime/state/detail-draft-storage', importer: pulls, contents: storage },
      { path: '../runtime/connection/provider', importer: bots, contents: provider },
      { path: '../../../runtime/connection/provider', importer: pulls, contents: provider },
      {
        path: '../../source-reader',
        importer: pulls,
        contents: 'export const useSourceReader=()=>window.sourceReader;',
      },
      {
        path: '../../../runtime/state/application-state',
        importer: pulls,
        contents: `export {useState as useApplicationState} from 'react';`,
      },
      {
        path: '../../../runtime/preferences/app-preferences',
        importer: pulls,
        contents: 'export const readMobilePreferences=()=>({pullDraft:false});',
      },
      { path: '../ui/layout/sheet', importer: bots, contents: sheet },
      { path: '../../../ui/layout/sheet', importer: pulls, contents: sheet },
      { path: '../ui/controls/field', importer: bots, contents: field },
      { path: '../../../ui/controls/field', importer: pulls, contents: field },
      { path: '../../../ui/controls/choice', importer: pulls, contents: choice },
      {
        path: '../../../ui/controls/switch',
        importer: pulls,
        contents: 'export const Switch=()=>null;',
      },
      { path: '../ui/controls/action', importer: bots, contents: action },
      { path: '../../../ui/controls/action', importer: pulls, contents: action },
      { path: '../controls/action', importer: content, contents: action },
      { path: '../ui/controls/icon', importer: bots, contents: 'export const Icon=()=>null;' },
      { path: '../ui/content/text', importer: bots, contents: text },
      { path: '../../../ui/content/text', importer: pulls, contents: text },
      { path: './text', importer: content, contents: text },
      { path: '../ui/theme', importer: bots, contents: theme },
      { path: '../../../ui/theme', importer: pulls, contents: theme },
      { path: '../theme', importer: content, contents: theme },
      { path: '../../runtime/state/detail-draft-storage', importer: work, contents: storage },
      { path: '../../runtime/connection/provider', importer: work, contents: provider },
      {
        path: '../source-reader',
        importer: work,
        contents: 'export const useSourceReader=()=>window.sourceReader;',
      },
      {
        path: '../../runtime/state/application-state',
        importer: work,
        contents: `export {useState as useApplicationState} from 'react';`,
      },
      {
        path: '../../shell/navigation',
        importer: work,
        contents: 'export const useNavigation=()=>({focused:true});',
      },
      { path: '../../ui/layout/sheet', importer: work, contents: sheet },
      { path: '../../ui/controls/field', importer: work, contents: field },
      { path: '../../ui/controls/choice', importer: work, contents: select },
      { path: '../../ui/controls/action', importer: work, contents: action },
      { path: '../../ui/content/text', importer: work, contents: text },
      { path: '../../ui/theme', importer: work, contents: theme },
    ],
  )
  const origin = 'http://editors.fixture'
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route(`${origin}/**`, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<div id="app"></div><script>${built.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script>`,
    }),
  )
  /** A new app process with the same device storage. */
  const restart = async ({ slow = false, read = false, definitions = false } = {}) => {
    await page.evaluate(
      (flags) => {
        for (const [name, on] of Object.entries(flags))
          if (on) localStorage.setItem('fixture.' + name, '1')
          else localStorage.removeItem('fixture.' + name)
      },
      { slow, 'fail.read': read, 'slow-definitions': definitions },
    )
    await page.reload()
  }
  const open = (editor) => page.evaluate((value) => window.openEditor(value), editor)
  const record = (name) =>
    page.evaluate((prefix) => {
      const key = Object.keys(localStorage).find((item) => item.startsWith(prefix))
      return key ? JSON.parse(localStorage.getItem(key)) : undefined
    }, `dovo.detail-drafts.v1.${name}:`)
  const waitForRecord = (name, field, value) =>
    page.waitForFunction(
      ({ prefix, field, value }) =>
        Object.keys(localStorage).some(
          (key) => key.startsWith(prefix) && JSON.parse(localStorage.getItem(key))[field] === value,
        ),
      { prefix: `dovo.detail-drafts.v1.${name}:`, field, value },
    )
  const waitForValue = (label, value) =>
    page.waitForFunction(
      ({ label, value }) =>
        document.querySelector(`textarea[aria-label="${label}"]`)?.value === value,
      { label, value },
    )
  const release = () => page.evaluate(() => window.releaseStorage())
  const settle = () => page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 50)))

  await page.goto(origin + '/')
  await open('bot')
  await page.getByLabel('Bot name', { exact: true }).fill('Release assistant')
  await page.getByLabel('Role', { exact: true }).fill('Keep releases ready')
  await waitForRecord('bot-create', 'role', 'Keep releases ready')
  assert.equal((await record('bot-create')).runtimeId, 'computer-a')
  await open('pull')
  await page.getByLabel('Title', { exact: true }).fill('Fix the release check')
  await waitForRecord('create-pull', 'title', 'Fix the release check')
  assert.equal((await record('create-pull')).expectedDestination, 'github.com/acme/app')

  // A different active computer and a renamed remote now supply different defaults.
  await page.evaluate(() => localStorage.setItem('fixture.changed-defaults', '1'))

  // Slow storage: each editor fills its default before the saved drafts load.
  for (const [editor, label, value] of [
    ['bot', 'Bot name', 'Release assistant'],
    ['pull', 'Title', 'Fix the release check'],
  ]) {
    await restart({ slow: true })
    await open(editor)
    await settle()
    assert.equal(await page.getByLabel(label, { exact: true }).inputValue(), '')
    await release()
    await waitForValue(label, value)
    await settle()
    assert.deepEqual(await page.evaluate(() => window.storageWrites), [], `${editor} wrote early`)
  }
  assert.equal((await record('bot-create')).name, 'Release assistant')
  assert.equal((await record('create-pull')).title, 'Fix the release check')

  // A failed startup read: the default stays in memory, and retry restores the saved text.
  for (const [editor, label, value] of [
    ['bot', 'Bot name', 'Release assistant'],
    ['pull', 'Title', 'Fix the release check'],
  ]) {
    await restart({ read: true })
    await open(editor)
    await page.getByText('Saved drafts could not be read.', { exact: false }).waitFor()
    await page.evaluate(() => localStorage.removeItem('fixture.fail.read'))
    await page.getByRole('button', { name: 'Retry saving drafts' }).click()
    await waitForValue(label, value)
    await page
      .getByText('Saved drafts could not be read.', { exact: false })
      .waitFor({ state: 'detached' })
    assert.deepEqual(await page.evaluate(() => window.storageWrites), [], `${editor} wrote early`)
  }

  // A field typed before the saved drafts load is newer, so it stays. Untouched saved fields load.
  await restart({ slow: true })
  await open('bot')
  await page.getByLabel('Responsibilities', { exact: true }).fill('Typed during startup')
  await release()
  await waitForRecord('bot-create', 'responsibilities', 'Typed during startup')
  await waitForValue('Bot name', 'Release assistant')
  assert.equal(await page.getByLabel('Role', { exact: true }).inputValue(), 'Keep releases ready')
  assert.equal(
    await page.getByLabel('Responsibilities', { exact: true }).inputValue(),
    'Typed during startup',
  )
  assert.deepEqual(await record('bot-create'), {
    name: 'Release assistant',
    role: 'Keep releases ready',
    responsibilities: 'Typed during startup',
    firstTask: '',
    runtimeId: 'computer-a',
  })

  await open('pull')
  await waitForValue('Title', 'Fix the release check')
  await page.getByLabel('Title', { exact: true }).fill('Review the saved destination')
  await waitForRecord('create-pull', 'title', 'Review the saved destination')
  assert.equal((await record('create-pull')).expectedDestination, 'github.com/acme/app')

  // The pipeline run form fills the first pipeline when the list arrives. It never replaces a
  // saved or chosen pipeline, whether the list arrives before or after the saved drafts load.
  const pipeline = page.getByLabel('Pipeline', { exact: true })
  const waitForPipeline = (value) =>
    page.waitForFunction(
      (value) => document.querySelector('select[aria-label="Pipeline"]')?.dataset.value === value,
      value,
    )
  await open('work')
  await waitForPipeline('build')
  await pipeline.selectOption('deploy')
  await page.getByLabel('Branch or ref', { exact: true }).fill('release')
  await waitForRecord('work-form', 'ref', 'release')
  assert.equal((await record('work-form')).definition, 'deploy')
  await restart({ slow: true })
  await open('work')
  await settle()
  await release()
  await waitForPipeline('deploy')
  await waitForValue('Branch or ref', 'release')
  await restart({ slow: true, definitions: true })
  await open('work')
  await release()
  await waitForPipeline('deploy')
  await page.evaluate(() => window.releaseDefinitions())
  await settle()
  assert.equal(await pipeline.getAttribute('data-value'), 'deploy')
  assert.deepEqual(await page.evaluate(() => window.storageWrites), [], 'work form wrote early')
  // One field typed during startup keeps the saved pipeline.
  await restart({ slow: true })
  await open('work')
  await page.getByLabel('Branch or ref', { exact: true }).fill('hotfix')
  await release()
  await waitForRecord('work-form', 'ref', 'hotfix')
  await waitForPipeline('deploy')
  assert.equal((await record('work-form')).definition, 'deploy')
  const stored = await page.evaluate(() => JSON.stringify(localStorage))
  assert.ok(!stored.includes('fixture-device-token-123456'), 'Pairing token reached storage')
  assert.deepEqual(errors, [])
  await page.close()
}
