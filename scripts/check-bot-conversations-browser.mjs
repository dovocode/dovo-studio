import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'
const root = fileURLToPath(new URL('../', import.meta.url))
const mocks = {
  '@dovo/studio-core': `export const useWorkspace=()=>window.store;`,
  '@dovo/studio-ui': `export const Button=({children,variant,size,...props})=><button {...props}>{children}</button>;export const Input=props=><input {...props}/>;export const Dialog=({open,children})=>open?<section role="dialog">{children}</section>:null;export const DialogContent=({children})=><div>{children}</div>;export const DialogTitle=({children})=><h2>{children}</h2>;export const DialogDescription=({children})=><p>{children}</p>;`,
  'react-native': `const flat=s=>Object.assign({},...(Array.isArray(s)?s.flat(Infinity):[s]));export const View=({children,style,accessibilityLabel})=><div aria-label={accessibilityLabel} style={{display:'flex',flexDirection:'column',...flat(style)}}>{children}</div>;export const Pressable=({children,onPress,disabled,accessibilityLabel,style})=><button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress} style={{display:'flex',font:'inherit',...flat(typeof style==='function'?style({pressed:false}):style)}}>{children}</button>;`,
}
const shell = (path) => {
  if (path.endsWith('/runtime/connection/provider'))
    return `export const useRuntime=()=>window.runtime;`
  if (path.endsWith('/ui/theme'))
    return `export const useTheme=()=>({styles:{muted:{color:'#a2a2ad'},error:{color:'#ff7272'}},colors:{border:'#393940',surface:'#242428',elevated:'#34343a',muted:'#a2a2ad',accent:'#94aaff'}});`
  if (path.endsWith('/ui/controls/field'))
    return `export const Field=({label,value,editable,onChangeText})=><label>{label}<input aria-label={label} value={value} disabled={editable===false} onChange={event=>onChangeText(event.target.value)}/></label>;`
  if (path.endsWith('/ui/controls/action'))
    return `export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;`
  if (path.endsWith('/ui/controls/icon'))
    return `export const Icon=({size,color})=><svg width={size} height={size} style={{color}} aria-hidden="true"><circle cx="8" cy="8" r="5" fill="none" stroke="currentColor"/></svg>;`
  if (path.endsWith('/ui/content/text'))
    return `export const Text=({children,style,accessibilityRole})=><span role={accessibilityRole} style={Object.assign({},...(Array.isArray(style)?style:[style]))}>{children}</span>;`
  if (path.endsWith('/ui/layout/sheet'))
    return `export const Sheet=({children,title,onClose})=><section role="dialog" aria-label={title}><h2>{title}</h2>{children}<button onClick={onClose}>Close</button></section>;`
  if (path.endsWith('/ui/controls/use-action'))
    return `import {useState,useRef} from 'react';export const useAction=()=>{const[busy,setBusy]=useState(false),[error,setError]=useState(''),pending=useRef(false);return{busy,error,act:work=>{if(pending.current)return;pending.current=true;setBusy(true);setError('');Promise.resolve().then(work).catch(error=>setError(error.message)).finally(()=>{pending.current=false;setBusy(false)})}}};`
}
const built = await build({
  stdin: {
    resolveDir: root + 'packages/studio-ui',
    loader: 'tsx',
    contents: `
import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {BotWorkSummary as DesktopWork} from '${root}packages/extension-tasks/src/bots/bot-work-summary';
import {BotWorkSummary as MobileWork} from '${root}apps/mobile/src/bots/bot-work-summary';
import {ChildThreadName as DesktopName} from '${root}packages/extension-tasks/src/detail/child-thread-name';
import {ChildThreadName as MobileName} from '${root}apps/mobile/src/tasks/detail/child-thread-name';
window.calls=[];window.mode='desktop-work';const task={id:'bot',title:'Dory',status:'review',messages:[{id:'last',role:'assistant',text:'Done'}],files:[],draft:'Keep my draft',createdAt:'2026-11-15T12:00:00Z',bot:{revision:'first-revision'}};
const profiles=[{id:'mac',connection:{address:'http://mac.lan'}},{id:'remote',connection:{address:'http://remote.lan'}}];
const request=(owner,path,input)=>{window.calls.push({owner,path,input});if(window.hold)return new Promise(resolve=>window.finish=()=>resolve({revision:2,outcome:'applied'}));if(window.fail){window.fail=false;return Promise.reject(Error('Temporary disconnection'))}return Promise.resolve({revision:2,outcome:window.conflict?'rejected':'applied'})};
window.store={activeRuntimeId:'mac',connection:profiles[0].connection,connected:true,snapshot:{runtimeId:'mac-identity',botConversationArchiveSupported:true,runs:[]},workspace:{tasks:[task],automations:[]},runtimes:[{profile:profiles[1],connected:true,snapshot:{runtimeId:'remote-identity'}}],request:(...args)=>request('mac',...args),readRuntime:(owner,...args)=>request(owner.id,...args),refreshRuntime:async()=>{}};
window.runtime={profile:profiles[0],profiles,overviews:window.store.runtimes,connected:true,snapshot:{...window.store.snapshot,workspace:window.store.workspace},call:window.store.request,readRuntime:window.store.readRuntime};
window.child={id:'child',title:'Research'};window.owner='mac';window.identity='mac-identity';
const root=createRoot(document.getElementById('app'));
window.show=(mode=window.mode)=>{window.mode=mode;flushSync(()=>root.render(mode==='desktop-work'?<DesktopWork task={task} onRoutines={()=>window.target='routines'} onWorkers={()=>window.target='workers'}/>:mode==='mobile-work'?<MobileWork task={task} onRoutines={()=>window.target='routines'} onWorkers={()=>window.target='workers'}/>:mode==='desktop-name'?<DesktopName child={window.child} runtimeId={window.owner} runtimeIdentity={window.identity}/>:<MobileName child={window.child} runtimeId={window.owner} runtimeIdentity={window.identity}/>))};window.show();
`,
  },
  bundle: true,
  format: 'iife',
  write: false,
  jsx: 'automatic',
  platform: 'browser',
  conditions: ['development'],
  plugins: [
    {
      name: 'shells',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, ({ path, importer }) => {
          const contents =
            mocks[path] ??
            (importer.startsWith(root + 'apps/mobile/src/') ? shell(path) : undefined)
          if (contents) return { path, namespace: 'shell', pluginData: contents }
        })
        builder.onLoad({ filter: /.*/, namespace: 'shell' }, ({ pluginData }) => ({
          contents: pluginData,
          loader: 'tsx',
          resolveDir: root + 'packages/studio-ui',
        }))
      },
    },
  ],
})
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent(
    '<style>body{margin:0;background:#17171b;color:#fafafa;font-family:system-ui}button,input{font:inherit}button{color:inherit}#app{width:390px}</style><main id="app"></main>',
  )
  await page.addScriptTag({ content: built.outputFiles[0].text })
  for (const platform of ['desktop', 'mobile']) {
    await page.evaluate((mode) => window.show(mode), platform + '-work')
    if (platform === 'desktop') {
      for (const [name, text] of [
        ['Routines · 0', '0'],
        ['Workers · 0 active', '0'],
        ['Archive and start new', ''],
      ]) {
        const control = page.getByRole('button', { name, exact: true })
        assert.equal(await control.textContent(), text)
        assert.equal(await control.getAttribute('title'), name)
      }
    }
    await page.getByRole('button', { name: 'Routines · 0', exact: true }).click()
    assert.equal(await page.evaluate(() => window.target), 'routines')
    await page.getByRole('button', { name: 'Workers · 0 active', exact: true }).click()
    assert.equal(await page.evaluate(() => window.target), 'workers')
    if (platform === 'mobile') {
      const bounds = await page.getByLabel('Bot work overview').boundingBox()
      assert.ok(bounds.height <= 64, JSON.stringify(bounds))
      for (const button of await page.getByRole('button').all()) {
        const box = await button.boundingBox()
        assert.ok(box.height >= 44 && box.width >= 44)
      }
      await page.screenshot({ path: '/tmp/dovo-bot-work-mobile.png' })
    }
    await page.getByRole('button', { name: 'Archive and start new', exact: true }).click()
    await page
      .getByRole('dialog')
      .getByText(/Save this conversation in Side threads/)
      .waitFor()
    await page
      .getByRole('dialog')
      .getByText(/Settings, memory, routines/)
      .waitFor()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    assert.equal(await page.evaluate(() => window.calls.length), platform === 'desktop' ? 0 : 2)
    await page.getByRole('button', { name: 'Archive and start new', exact: true }).click()
    await page.evaluate(() => (window.fail = true))
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Archive and start new', exact: true })
      .click()
    await page.getByRole('alert').getByText('Temporary disconnection').waitFor()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Archive and start new', exact: true })
      .click()
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    const calls = await page.evaluate(() => window.calls.slice(-2))
    assert.deepEqual(calls[0], calls[1])
    assert.equal(calls[0].input.expectedRevision, 'first-revision')
  }
  for (const platform of ['desktop', 'mobile']) {
    for (const owner of ['mac', 'remote']) {
      await page.evaluate(
        ({ mode, owner }) => {
          window.owner = owner
          window.identity = owner + '-identity'
          window.child = { id: 'child', title: 'Research' }
          window.show(mode)
        },
        { mode: platform + '-name', owner },
      )
      await page.getByRole('button', { name: 'Rename Research', exact: true }).click()
      await page.getByLabel('Thread title').fill('   ')
      assert.equal(
        await page.getByRole('button', { name: 'Save title', exact: true }).isDisabled(),
        true,
      )
      await page.getByLabel('Thread title').fill('Named child')
      await page.evaluate(() => (window.fail = true))
      await page.getByRole('button', { name: 'Save title', exact: true }).click()
      await page.getByRole('alert').waitFor()
      assert.equal(await page.getByLabel('Thread title').inputValue(), 'Named child')
      await page.getByRole('button', { name: 'Save title', exact: true }).click()
      await page.getByLabel('Thread title').waitFor({ state: 'detached' })
      const call = await page.evaluate(() => window.calls.at(-1))
      assert.equal(call.owner, owner)
      assert.deepEqual(call.input.changes.title, { before: 'Research', after: 'Named child' })
      await page.getByRole('button', { name: 'Rename Research', exact: true }).click()
      await page.getByLabel('Thread title').fill('Conflict draft')
      await page.evaluate(() => (window.conflict = true))
      await page.getByRole('button', { name: 'Save title', exact: true }).click()
      await page.getByRole('alert').waitFor()
      assert.equal(await page.getByLabel('Thread title').inputValue(), 'Conflict draft')
      await page.evaluate(() => (window.conflict = false))
      await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    }
    await page.evaluate((mode) => {
      window.owner = 'remote'
      window.identity = 'wrong-runtime'
      window.show(mode)
    }, platform + '-name')
    assert.equal(
      await page.getByRole('button', { name: 'Rename Research', exact: true }).isDisabled(),
      true,
    )
  }
  assert.deepEqual(errors, [])
  console.log(
    'Bot controls and child renaming: compact mobile targets, confirmation, stable retry, draft retention, conflicts and correct computer ownership pass on desktop and mobile.',
  )
} finally {
  await browser.close()
}
