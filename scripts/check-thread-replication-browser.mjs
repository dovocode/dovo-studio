import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const controls = `
export const View=({children})=><div>{children}</div>;export const ScrollView=View;
// Native virtualization/gestures require device verification; this adapter checks data and actions.
export const FlatList=({data,renderItem,keyExtractor,ListFooterComponent})=><div>{ListFooterComponent}{[...data].reverse().map(item=><div key={keyExtractor(item)}>{renderItem({item})}</div>)}</div>;
export {Conversation,ConversationContent,ConversationHistory,ConversationScrollButton,useConversationHistory} from './packages/studio-ui/src/components/ai-elements/conversation.tsx';

export const Text=({children,accessibilityRole})=><div role={accessibilityRole}>{children}</div>;
export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;
export const Field=({label,value,onChangeText,editable})=><label>{label}<input aria-label={label} value={value} disabled={editable===false} onChange={e=>onChangeText(e.target.value)}/></label>;
export const Button=({children,...props})=><button {...props}>{children}</button>;
export const Input=props=><input {...props}/>;
export const ScreenHeader=({title,subtitle,leading})=><header><h1>{title}</h1><p>{subtitle}</p>{leading}</header>;
export const useTheme=()=>({styles:{}});
`
const browser = await chromium.launch()
try {
  for (const mobile of [false, true]) {
    const built = await build({
      stdin: {
        resolveDir: root,
        loader: 'tsx',
        contents: `
import {useState} from 'react';import{createRoot}from'react-dom/client';
import {ReplicatedThread}from'./${mobile ? 'apps/mobile' : 'packages/extension-tasks'}/src/${mobile ? 'tasks/' : ''}detail/replicated-thread.tsx';
import{replicatedThread,threadRecordKey}from'@dovo/protocol';
let values=[];window.writes=[];
const version=value=>({key:threadRecordKey(value),updatedAt:100,changeId:'owner:100',deleted:false,value});
const identity=id=>({ownerRuntimeId:'owner',threadId:id});
const seed=(id,title,count=85)=>{
 const who=identity(id);values.push(version({...who,kind:'thread',ownerName:'Owning computer',projectName:'Shared project',createdAt:'2026-01-01',status:'review',historyRevision:0,removed:false}),version({...who,kind:'title',value:title}),...Array.from({length:count},(_,position)=>version({...who,kind:'message',messageId:id+'-'+position,position,message:{id:id+'-'+position,role:position%2?'assistant':'user',text:id+' message '+position}})));
};seed('first','First thread');seed('second','Second thread');seed('large','Large thread',1000);
const project=(id,before,messages=true)=>replicatedThread(values,'owner',id,before,messages);
let selected='first';let render;
const request=async(path,input)=>{
 if(window.failRequest)throw Error('Connection interrupted');
 if(path==='/api/threads/metadata'){
   window.writes.push(input);const record={...identity(input.threadId),kind:input.field,value:input.value};const key=threadRecordKey(record);values=values.filter(v=>v.key!==key).concat(version(record));window.updateTask();return{ok:true};
 }
 if(path==='/api/threads/replica/read'){
   const reply={task:project(input.threadId,input.before)};
   if(window.delayRead)await new Promise(resolve=>window.releaseRead=resolve);
   return reply;
 }
 throw Error(path);
};
window.store={connected:true,request,call:request,read:request};
function App(){const[task,setTask]=useState(project(selected,undefined,false));const[,refresh]=useState(0);
 window.updateTask=()=>setTask(project(selected,undefined,false));
 window.setConnection=connected=>{window.store.connected=connected;refresh(n=>n+1)};
 window.switchThread=id=>{selected=id;setTask(project(id,undefined,false))};
 window.remoteRename=title=>{const record={...identity(selected),kind:'title',value:title};values=values.filter(v=>v.key!==threadRecordKey(record)).concat(version(record));window.updateTask()};
 window.offlineAppend=()=>{const who=identity('first');values.push(...Array.from({length:100},(_,i)=>{const position=85+i;return version({...who,kind:'message',messageId:'first-'+position,position,message:{id:'first-'+position,role:'assistant',text:'first message '+position}})}))};
 window.showLarge=()=>{selected='large';const task=project(selected);setTask({...task,historyBefore:undefined,messages:values.flatMap(v=>v.value.threadId===selected&&v.value.kind==='message'?[v.value.message]:[])})};
 return <ReplicatedThread key={task.id} task={task} onBack={()=>{}}/>;
}createRoot(document.getElementById('app')).render(<App/>);
`,
      },
      bundle: true,
      write: false,
      platform: 'browser',
      format: 'iife',
      jsx: 'automatic',
      alias: {
        react: root + '/packages/studio-ui/node_modules/react',
        '@dovo/protocol': root + '/packages/protocol/src/index.ts',
      },
      nodePaths: [root + '/packages/studio-ui/node_modules'],
      plugins: [
        {
          name: 'replica-fixture',
          setup(builder) {
            builder.onResolve({ filter: /.*/ }, ({ path }) => {
              if (path === '@dovo/studio-core' || /runtime\/connection\/provider$/.test(path))
                return { path: 'store', namespace: 'fixture' }
              if (path === '@dovo/studio-core/state') return { path: 'state', namespace: 'fixture' }
              if (
                path === '@dovo/studio-ui' ||
                path === 'react-native' ||
                /ui\/(content\/text|controls\/(action|field)|layout\/screen-header|theme)$/.test(
                  path,
                )
              )
                return { path: 'controls', namespace: 'fixture' }
            })
            builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
              contents:
                path === 'store'
                  ? 'export const reducedMotion=()=>true;export const useWorkspace=()=>window.store;export const useRuntime=useWorkspace;'
                  : path === 'state'
                    ? "export {useState as useApplicationState} from 'react'"
                    : controls,
              loader: 'tsx',
              resolveDir: root,
            }))
          },
        },
      ],
    })
    const page = await browser.newPage({ viewport: { width: mobile ? 390 : 1000, height: 900 } })
    page.setDefaultTimeout(6000)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setContent(
      '<style>html,body,#app{height:100%;margin:0}section{height:100%;display:flex;flex-direction:column}section>header{flex:none}[role=log]{flex:1;min-height:0;position:relative;overflow:hidden}[role=log]>div{height:100%;overflow:auto}article{margin:16px 0}article p{margin:0}header{padding:12px}header p{margin:8px 0}</style><div id="app"></div>',
    )
    await page.addScriptTag({ content: built.outputFiles[0].text })
    await page.getByText('first message 84', { exact: true }).waitFor()
    assert.equal(await page.getByText('first message 44', { exact: true }).count(), 0)
    await page.getByRole('button', { name: 'Load older messages', exact: true }).click()
    if (!mobile) await page.locator('article').first().scrollIntoViewIfNeeded()
    await page.getByText('first message 5', { exact: true }).waitFor()
    await page.evaluate(() => window.updateTask())
    if (mobile) {
      await page.getByRole('button', { name: 'Load older messages', exact: true }).click()
    } else {
      await page.locator('article').first().scrollIntoViewIfNeeded()
    }
    await page.getByText('first message 0', { exact: true }).waitFor()
    assert.equal(
      await page.getByRole('button', { name: 'Load older messages', exact: true }).count(),
      0,
    )
    assert.equal(await page.getByLabel('Thread title', { exact: true }).count(), 0)
    assert.equal(
      await page
        .getByRole('button', { name: /^(Save title|Pin|Unpin|Run|Resume|Send|Stop)$/ })
        .count(),
      0,
    )
    assert.deepEqual(await page.evaluate(() => window.writes), [])
    await page.evaluate(() => window.setConnection(false))
    // Wait for React to commit offline state; the cached message may already be visible.
    await page
      .getByRole('button', { name: 'Refresh messages', exact: true, disabled: true })
      .waitFor()
    if (!mobile) await page.locator('article').last().scrollIntoViewIfNeeded()
    await page.getByText('first message 84', { exact: true }).waitFor()
    await page.evaluate(() => {
      window.failRequest = true
      window.setConnection(true)
    })
    await page.getByRole('alert').filter({ hasText: 'Connection interrupted' }).waitFor()
    await page.evaluate(() => {
      window.failRequest = false
    })
    await page.getByRole('button', { name: 'Refresh messages', exact: true }).click()
    await page.waitForFunction(() => !document.querySelector('[role="alert"]'))
    await page.evaluate(() => {
      window.failRequest = false
      window.delayRead = true
      window.switchThread('second')
    })
    await page.getByRole('heading', { name: 'Second thread', exact: true }).waitFor()
    await page.waitForFunction(() => !!window.releaseRead)
    await page.evaluate(() => {
      window.delayRead = false
      window.switchThread('first')
    })
    await page.getByText('first message 84', { exact: true }).waitFor()
    await page.evaluate(() => window.releaseRead())
    assert.equal(await page.getByRole('heading', { name: 'First thread', exact: true }).count(), 1)
    assert.equal(await page.getByText('second message 84', { exact: true }).count(), 0)
    await page.evaluate(() => {
      window.delayRead = true
      window.releaseRead = undefined
    })
    await page.getByRole('button', { name: 'Load older messages', exact: true }).click()
    await page.waitForFunction(() => !!window.releaseRead)
    await page.evaluate(() => {
      window.delayRead = false
      window.offlineAppend()
    })
    await page.getByRole('button', { name: 'Refresh messages', exact: true }).click()
    await page.getByText('first message 184', { exact: true }).waitFor()
    await page.evaluate(() => window.releaseRead())
    await page.waitForFunction(
      () =>
        !Array.from(document.querySelectorAll('button')).some(
          (button) => button.textContent === 'Load older messages' && button.disabled,
        ),
    )
    assert.equal(await page.getByText('first message 5', { exact: true }).count(), 0)
    assert.equal(await page.getByText('first message 84', { exact: true }).count(), 0)
    if (!mobile) {
      assert.equal(await page.locator('article').count(), 40)
      await page.evaluate(() => window.showLarge())
      await page.getByText('large message 999', { exact: true }).waitFor()
      assert.equal(await page.locator('article').count(), 1000)
      await page.waitForFunction(
        () => document.querySelectorAll('article .whitespace-pre-wrap').length < 100,
      )
      await page.locator('article').nth(500).scrollIntoViewIfNeeded()
      await page.getByText('large message 500', { exact: true }).waitFor()
      assert.ok((await page.locator('article .whitespace-pre-wrap').count()) < 100)
    }
    assert.deepEqual(errors, [])
    await page.close()
    console.log(
      `${mobile ? 'Mobile' : 'Desktop'} recovery archive: read-only paging, offline display and stale response checks passed`,
    )
  }
} finally {
  await browser.close()
}
