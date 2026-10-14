import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const desktop = await build({
  stdin: {
    loader: 'tsx',
    resolveDir: root,
    contents: `
import {createRoot} from 'react-dom/client';import {useEffect,useState} from 'react';import {Effect,Schema} from 'effect';
import {WorkspaceValueProvider} from '${root}/packages/studio-core/src/workspace/selector';
import {useWorkspace} from '${root}/packages/studio-core/src/workspace/context';
import {WorkspaceRuntimeScope} from '${root}/packages/studio-core/src/workspace/runtime-scope';
window.calls=[];window.mounts=0;
const workspace=name=>({version:1,runtimeAddress:'',repositories:[{id:'same-id',name,path:'/'+name,branch:'main'}],tasks:[],agents:[],automations:[]});
const snapshot=name=>({revision:1,workspace:workspace(name)});
const profile=id=>({id,connection:{address:'http://'+id+'.local',token:'paired-'+id}});
const cache={readEffect:()=>Effect.succeed(null),writeEffect:()=>Effect.void};
function Panel(){const value=useWorkspace();const[message,setMessage]=useState('');useEffect(()=>{window.mounts++},[]);
  const invoke=async(path,method)=>{try{setMessage((await value.request(path,{repositoryId:'same-id',action:'comment'},Schema.Unknown,method)).result)}catch(error){setMessage(error.message)}};
  return <section aria-label="Integration details"><p>{value.workspace.repositories[0]?.name??'Unavailable'}</p><p>{value.connected?'Connected':'Offline'}</p><input aria-label="Comment draft"/>
  {['PR','issue','pipeline','Jira'].map(kind=><button key={kind} onClick={()=>invoke(kind==='Jira'?'/api/scm/jira/issues/detail':kind==='PR'?'/api/scm/pulls/detail':'/api/scm/work/'+kind+'s/detail','GET')}>Read {kind}</button>)}
  <button onClick={()=>invoke('/api/scm/pulls/action','POST')}>Write PR</button><p role="status">{message}</p></section>;
}
function App(){const[active,setActive]=useState('a'),[online,setOnline]=useState(true),[removed,setRemoved]=useState(false);
  window.changeActive=setActive;window.setOnline=setOnline;window.removeOwner=()=>setRemoved(true);window.globalActive=active;
  const runtimes=['a',...(!removed?['b']:[])].map(id=>({profile:profile(id),snapshot:snapshot(id),connected:id==='a'||online,error:null}));
  const value={activeRuntimeId:active,runtimeRegistry:{activeId:active,profiles:runtimes.map(entry=>entry.profile)},runtimes,
    workspace:workspace(active),snapshot:snapshot(active),connected:true,runtimeReadCache:()=>cache,
    readRuntimeEffect:(owner,path,input,schema,method)=>Effect.tryPromise({try:async()=>{
      if(!runtimes.some(entry=>entry.profile.id===owner.id))throw new Error('Owner removed');
      if(owner.id==='b'&&!online)throw new Error('Owner offline');
      window.calls.push({id:owner.id,path,input,method});return {result:owner.id+':'+path};},catch:error=>error}),
    pendingMessages:()=>[],refreshRuntime:async()=>{},syncConflicts:[],setWorkspace:()=>{throw new Error('Unexpected global workspace edit')},switchRuntime:()=>{throw new Error('Unexpected server switch')}};
  return <WorkspaceValueProvider value={value}><p>Global {active}</p><WorkspaceRuntimeScope runtimeId="b"><Panel/></WorkspaceRuntimeScope></WorkspaceValueProvider>;
}
createRoot(document.getElementById('app')).render(<App/>);`,
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  alias: {
    react: root + '/packages/studio-ui/node_modules/react',
    'react-dom': root + '/packages/studio-ui/node_modules/react-dom',
    '@dovo/protocol': root + '/packages/protocol/src/index.ts',
    '@dovo/client-runtime': root + '/packages/client-runtime/src/index.ts',
  },
  nodePaths: [root + '/node_modules'],
})
const mobileMocks = {
  '../runtime/connection/provider': `import {createContext,useContext} from 'react';export const RuntimeContext=createContext(null);export const useRuntime=()=>useContext(RuntimeContext);export const RuntimeScope=({runtimeId,children})=>{const root=useRuntime(),entry=root.overviews.find(entry=>entry.profile.id===runtimeId);return <RuntimeContext.Provider value={{...root,activeId:runtimeId,snapshot:entry.snapshot,connected:entry.connected,refresh:()=>root.refreshRuntime(entry.profile)}}>{children}</RuntimeContext.Provider>};`,
  'react-native': `export const View=({children})=><div>{children}</div>;export const ActivityIndicator=()=> <span>Loading</span>;`,
  '../ui/controls/action': `export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;`,
  '../ui/controls/use-action': `import {useState} from 'react';export const useAction=()=>{const[error,setError]=useState('');return{error,busy:false,act:async action=>{try{await action()}catch(error){setError(error.message)}}}};`,
  '../ui/layout/screen-header': `export const ScreenHeader=({title,leading})=><header>{title}{leading}</header>;`,
  '../ui/content/text': `export const Text=({children})=><span>{children}</span>;`,
  '../ui/theme': `export const useTheme=()=>({colors:{},styles:{}});`,
  './navigation': `export const useNavigation=()=>({focused:true,navigate:()=>{}});`,
  './source-route': `export const backToCollection=()=>{};`,
}
const mobile = await build({
  stdin: {
    loader: 'tsx',
    resolveDir: root,
    contents: `import {createRoot} from 'react-dom/client';import {useState} from 'react';import {RuntimeContext} from '../runtime/connection/provider';import {RuntimeRoute} from '${root}/apps/mobile/src/shell/runtime-route';
window.switches=0;window.refreshes=[];
const profile=id=>({id,name:id});const snapshot={workspace:{repositories:[{id:'same-id'}],jiraSources:[{id:'jira'}]}};
function App(){const[offline,setOffline]=useState(false),[removed,setRemoved]=useState(false),[kind,setKind]=useState('PR');window.offline=()=>setOffline(true);window.remove=()=>setRemoved(true);window.setKind=setKind;
const value={ready:true,activeId:'a',profiles:['a',...(!removed?['b']:[])].map(profile),snapshot,
overviews:(!removed?[{profile:profile('b'),snapshot,connected:!offline}]:[]),connected:true,selectRuntime:()=>{window.switches++;throw new Error('Unexpected switch')},refreshRuntime:async owner=>window.refreshes.push(owner.id)};
return <RuntimeContext.Provider value={value}><RuntimeRoute runtimeId="b" repositoryId="same-id" jiraSourceId={kind==='Jira'?'jira':undefined} title={kind} backTo="/pulls"><p>{kind} content on b</p></RuntimeRoute></RuntimeContext.Provider>}
createRoot(document.getElementById('app')).render(<App/>);`,
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  alias: {
    react: root + '/packages/studio-ui/node_modules/react',
    'react-dom': root + '/packages/studio-ui/node_modules/react-dom',
  },
  plugins: [
    {
      name: 'mobile-route-boundaries',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, ({ path }) => {
          const key =
            path === '../../runtime/connection/provider' ? '../runtime/connection/provider' : path
          return Object.hasOwn(mobileMocks, key) ? { path: key, namespace: 'fixture' } : undefined
        })
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          contents: mobileMocks[path],
          loader: 'tsx',
          resolveDir: root,
        }))
      },
    },
  ],
})
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: desktop.outputFiles[0].text })
  const draft = page.getByRole('textbox', { name: 'Comment draft' })
  await draft.fill('Keep this draft')
  for (const kind of ['PR', 'issue', 'pipeline', 'Jira']) {
    await page.getByRole('button', { name: 'Read ' + kind, exact: true }).click()
    await page.waitForFunction(() => window.calls.length > 0)
  }
  await page.getByRole('button', { name: 'Write PR', exact: true }).click()
  await page.waitForFunction(() => window.calls.length === 5)
  assert.deepEqual(await page.evaluate(() => window.calls.map((call) => call.id)), [
    'b',
    'b',
    'b',
    'b',
    'b',
  ])
  assert.equal(await page.evaluate(() => window.globalActive), 'a')
  await page.evaluate(() => window.changeActive('b'))
  await page.getByText('Global b', { exact: true }).waitFor()
  await page.evaluate(() => window.changeActive('a'))
  await page.getByText('Global a', { exact: true }).waitFor()
  assert.equal(await draft.inputValue(), 'Keep this draft')
  assert.equal(await page.evaluate(() => window.mounts), 1)
  await page.evaluate(() => window.setOnline(false))
  await page.getByText('Offline', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Write PR', exact: true }).click()
  await page.getByText('Owner offline', { exact: true }).waitFor()
  assert.equal(
    await page.evaluate(() => window.calls.length),
    5,
    'An uncertain or unavailable write must not migrate to another server',
  )
  await page.evaluate(() => window.setOnline(true))
  await page.getByText('Connected', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Read PR', exact: true }).click()
  await page.waitForFunction(() => window.calls.length === 6)
  await page.evaluate(() => window.removeOwner())
  await page.getByText('This computer is no longer saved.', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Read PR', exact: true }).count(), 0)
  assert.deepEqual(errors, [])
  await page.close()
  const native = await browser.newPage()
  native.on('pageerror', (error) => errors.push(error.message))
  await native.setContent('<div id="app"></div>')
  await native.addScriptTag({ content: mobile.outputFiles[0].text })
  for (const kind of ['PR', 'Issue', 'Pipeline', 'Jira']) {
    await native.evaluate((kind) => window.setKind(kind), kind)
    await native.getByText(kind + ' content on b', { exact: true }).waitFor()
  }
  await native.evaluate(() => window.offline())
  await native.getByText('Jira content on b', { exact: true }).waitFor()
  assert.equal(await native.evaluate(() => window.switches), 0)
  await native.evaluate(() => window.remove())
  await native.getByText('Computer unavailable', { exact: true }).waitFor()
  assert.deepEqual(errors, [])
  console.log(
    'Desktop/native integration routes: explicit ownership, overlapping project IDs, retained drafts, offline recovery, removed connections and no global server switches passed.',
  )
} finally {
  await browser.close()
}
