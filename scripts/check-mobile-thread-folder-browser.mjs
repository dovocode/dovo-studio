import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from 'playwright'
const mocks = {
  '../../ui/controls/use-action': `export const useAction=()=>({busy:false,error:'',act:work=>{Promise.resolve(work()).catch(error=>window.transferError=String(error))}});`,
  '../../shell/navigation': `export const useNavigation=()=>({navigate:(...args)=>window.navigation=args});`,
  '../draft/use-draft': `export const saveRuntimeDraft=async(...args)=>{window.savedDraft=args};`,
  'react-native': `export const View=({children})=><div>{children}</div>;export const ScrollView=View;export const Pressable=({children,onPress,disabled,accessibilityLabel,accessibilityValue,accessibilityState})=><button aria-label={accessibilityLabel} aria-pressed={accessibilityState?.selected} disabled={disabled} onClick={onPress}>{children}</button>;`,
  '../../runtime/state/application-state': `export {useState as useApplicationState} from 'react';`,
  '../../runtime/connection/provider': `import {createContext,useContext} from 'react'; export const Context=createContext(null);export const useRuntime=()=>useContext(Context);export const RuntimeScope=({runtimeId,children})=>{const root=useRuntime();return <Context.Provider value={{...root,scope:runtimeId}}>{children}</Context.Provider>};`,
  '../../ui/layout/sheet': `export const Sheet=({title,children,onClose})=><div role="dialog" aria-label={title}>{children}<button onClick={onClose}>Close sheet</button></div>;`,
  '../../ui/controls/field': `export const SearchField=({label,value,onChangeText})=><input aria-label={label} value={value} onChange={e=>onChangeText(e.target.value)}/>;`,
  '../../ui/controls/action': `export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;`,
  '../../ui/controls/choice': `export const Choice=({label,value,onChange,items,disabled})=><select aria-label={label} value={value} disabled={disabled} onChange={e=>onChange(e.target.value)}>{items.map(item=><option key={item.id} value={item.id} disabled={item.disabled}>{item.name}</option>)}</select>;`,
  '../../ui/controls/icon': `export const Icon=()=>null;`,
  '../../ui/content/text': `export const Text=({children})=><span>{children}</span>;`,
  '../../ui/theme': `export const styles={},colors={};`,
  '../../screens/repositories': `import {useRuntime} from '../../runtime/connection/provider';export const AddProject=({initialSource,onClose,onAdded})=>{const runtime=useRuntime();window.addScope=runtime.scope;return <div role="dialog" aria-label="Add project"><span>{initialSource}</span><button onClick={()=>{onAdded({id:'added',name:'Added',path:'/added'});onClose()}}>Add</button></div>;};`,
  './new-task': `export const NewTask=({repositoryId})=><span>Draft {repositoryId}</span>;`,
}
const built = await build({
  stdin: {
    contents: `
import {useState} from 'react';import {createRoot} from 'react-dom/client';import {Context} from '../../runtime/connection/provider';import {ProjectMachinePicker} from './src/tasks/creation/project-machine-picker';import {TaskMachineSelector} from './src/tasks/creation/task-machine-selector';
function Transfer({scratch}){const repository={id:'origin',name:'Origin',path:'/origin',kind:scratch?'scratch':undefined,gitIdentity:scratch?undefined:'github.com/test/repo'};const origin={id:'a',name:'Selected',connection:{address:'http://a'}};const destination={id:'b',name:'Other',connection:{address:'http://b'}};const task={id:'task',title:'Draft',createdAt:'2026-10-05T00:00:00Z',repositoryId:'origin',agentId:'',status:'draft',messages:[],files:[],draft:'Persisted',example:false};return <Context.Provider value={{activeId:'a',profile:origin,snapshot:{workspace:{repositories:[repository]}},overviews:[{profile:origin,connected:true,snapshot:{workspace:{repositories:[repository]}}},{profile:destination,connected:true,snapshot:{workspace:{repositories:[{id:'destination-chat',kind:'scratch',name:'Chat',path:'/scratch'}]}}}],readRuntime:async(profile,path,input)=>{window.requests.push({runtimeId:profile.id,path,input});return input.task??{ok:true}},refreshRuntime:async()=>{}}}><TaskMachineSelector task={task} text="Current draft" disabled={false} onMoving={()=>{}} onProjectChange={async()=>{}}/></Context.Provider>};
function App(){const [mode,setMode]=useState('picker');window.transfer=scratch=>{window.requests=[];window.navigation=null;setMode(scratch?'scratch':'repo')};if(mode!=='picker')return <Transfer scratch={mode==='scratch'}/>;return <Context.Provider value={{activeId:'a',overviews:[{profile:{id:'a',name:'Selected machine',connection:{address:'http://a'}},connected:true,snapshot:{workspace:{repositories:[{id:'chat',kind:'scratch',name:'Temporary',path:'/scratch'},{id:'local',name:'Local folder',path:'/local'},{id:'broken',name:'Broken folder',path:'/broken',gitIdentityError:'Invalid'}]}}},{profile:{id:'b',name:'Other machine',connection:{address:'http://b'}},connected:true,snapshot:{workspace:{repositories:[{id:'remote',name:'Remote folder',path:'/remote'}]}}}]}}><ProjectMachinePicker onCreated={()=>{}} onCancel={()=>{}}/></Context.Provider>};createRoot(document.getElementById('app')).render(<App/>);
`,
    resolveDir: new URL('../apps/mobile/', import.meta.url).pathname,
    loader: 'tsx',
  },
  plugins: [
    {
      name: 'mocks',
      setup(b) {
        b.onResolve({ filter: /.*/ }, ({ path }) =>
          Object.hasOwn(mocks, path) ? { path, namespace: 'mock' } : undefined,
        )
        b.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({
          contents: mocks[path],
          loader: 'tsx',
          resolveDir: new URL('../apps/mobile/', import.meta.url).pathname,
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
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  const load = async () => {
    await page.setContent('<div id="app"></div>')
    await page.addScriptTag({ content: built.outputFiles[0].text })
  }
  await load()
  await page.getByRole('button', { name: 'Folder', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: 'Chat', exact: true }).count(), 1)
  assert.equal(
    await page.getByRole('button', { name: 'Broken folder', exact: true }).isDisabled(),
    true,
  )
  await page.getByLabel('Search folders').fill('local')
  assert.equal(await page.getByRole('button', { name: 'Chat', exact: true }).count(), 0)
  await page.getByRole('button', { name: 'Local folder', exact: true }).click()
  assert.equal(await page.getByText('Draft local').count(), 1)
  await load()
  await page.getByRole('button', { name: 'Folder', exact: true }).click()
  await page.getByRole('button', { name: 'Other machine', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: 'Local folder', exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Remote folder', exact: true }).count(), 1)
  await page.getByRole('button', { name: 'Add project', exact: true }).click()
  assert.equal(await page.evaluate(() => window.addScope), 'b')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  assert.equal(await page.getByText('Draft added').count(), 1)
  await page.evaluate(() => window.transfer(false))
  await page.getByRole('button', { name: 'Folder', exact: true }).click()
  await page.getByRole('button', { name: 'Other', exact: true }).click()
  await page.getByRole('button', { name: 'Chat', exact: true }).click()
  await page.waitForFunction(() => window.navigation)
  assert.deepEqual(
    await page.evaluate(() =>
      window.requests.map(({ runtimeId, path, input }) => [
        runtimeId,
        path,
        input.gitIdentity,
        input.projectKind,
      ]),
    ),
    [
      ['b', '/api/tasks/draft-receive', '', 'scratch'],
      ['a', '/api/tasks/draft-moved', 'github.com/test/repo', undefined],
    ],
  )
  assert.equal(await page.evaluate(() => window.requests[0].input.task.draft), 'Current draft')
  assert.deepEqual(await page.evaluate(() => window.savedDraft), ['b', 'task', 'Current draft'])
  await load()
  await page.evaluate(() => window.transfer(true))
  await page.getByRole('button', { name: 'Folder', exact: true }).click()
  await page.getByRole('button', { name: 'Other', exact: true }).click()
  await page.getByRole('button', { name: 'Chat', exact: true }).click()
  await page.waitForFunction(() => window.navigation)
  assert.deepEqual(
    await page.evaluate(() =>
      window.requests.map(({ input }) => [input.gitIdentity, input.projectKind]),
    ),
    [
      ['', 'scratch'],
      ['', 'scratch'],
    ],
  )
  assert.equal(await page.evaluate(() => window.transferError), undefined)
  assert.deepEqual(errors, [])
  console.log('Mobile thread folder browser checks passed')
} finally {
  await browser.close()
}
