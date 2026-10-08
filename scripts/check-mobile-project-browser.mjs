import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const resolveDir = new URL('../apps/mobile/', import.meta.url).pathname
const controls = `
export const View=({children})=><div>{children}</div>;
export const Pressable=({children,onPress,disabled,accessibilityLabel,accessibilityState})=><button aria-label={accessibilityLabel} aria-pressed={accessibilityState?.selected} disabled={disabled} onClick={onPress}>{children}</button>;
export const Text=({children,accessibilityRole})=><span role={accessibilityRole}>{children}</span>;
export const Icon=()=>null;
export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;
export const SearchField=({label,value,onChangeText})=><input aria-label={label} value={value} onChange={event=>onChangeText(event.target.value)}/>;
export const Sheet=({title,children,onClose,busy,headerAction})=><div role="dialog" aria-label={title}>{headerAction&&<button aria-label={headerAction.label} disabled={busy||headerAction.disabled} onClick={headerAction.onPress}>+</button>}{children}<button disabled={busy} onClick={onClose}>Close picker</button></div>;
export const useTheme=()=>({styles:{},colors:{}});
`
const mocks = {
  'react-native': controls,
  '../../ui/content/text': controls,
  '../../ui/controls/action': controls,
  '../../ui/controls/icon': controls,
  '../../ui/controls/field': controls,
  '../../ui/layout/sheet': controls,
  '../../ui/theme': controls,
  '../../runtime/state/application-state': `export {useState as useApplicationState} from 'react';`,
  '../../runtime/connection/provider': `export const useRuntime=()=>window.runtime;export const RuntimeScope=({children,runtimeId})=><div data-runtime={runtimeId}>{children}</div>;`,
  '../../screens/repositories': `export const AddProject=({onClose,onAdded})=><div role="dialog" aria-label="Add project flow"><button onClick={()=>{onAdded({id:'added',name:'Added project',path:'/added'});onClose()}}>Finish adding</button><button onClick={onClose}>Cancel adding</button></div>;`,
}
const built = await build({
  stdin: {
    resolveDir,
    loader: 'tsx',
    contents: `
      import {useState} from 'react';import {createRoot} from 'react-dom/client';
      import {FolderPicker} from './src/tasks/creation/folder-picker';
      const repo=(id,name,gitIdentity)=>({id,name,path:'/'+id,branch:'main',gitIdentity});
      const scratch=id=>({...repo(id,'Private folder'),kind:'scratch'});
      const inventory={local:[scratch('scratch'),repo('local','Shared project','host/team/project')],remote:[scratch('remote-scratch'),repo('remote','Shared project','host/team/project'),repo('notes','Remote notes')],empty:[scratch('empty-scratch')]};
      window.choices=[];window.fail=false;
      function App(){
        const [active,setActive]=useState('local'),[repository,setRepository]=useState('local'),[multiple,setMultiple]=useState(false),[remoteOnline,setRemoteOnline]=useState(true),[allow,setAllow]=useState(true);
        window.update=changes=>{if('multiple' in changes)setMultiple(changes.multiple);if('remoteOnline' in changes)setRemoteOnline(changes.remoteOnline);if('allow' in changes)setAllow(changes.allow)};
        const defaults={scopedSettings:{environment:{},shared:[{key:'project:host/team/project',updatedAt:1,changeId:'one',value:{taskDefaults:{defaultServerId:'remote'}}}]}};
        const overviews=(multiple?['local','remote','empty']:['local']).map(id=>({profile:{id,name:id+' server',nameIsCustom:true,connection:{address:'http://'+id,token:'test'}},connected:id==='local'||remoteOnline,snapshot:{defaults,workspace:{repositories:inventory[id]}}}));
        window.runtime={activeId:active,overviews,profile:overviews.find(entry=>entry.profile.id===active)?.profile};window.active=active;window.repository=repository;
        return <FolderPicker repositories={inventory[active]} value={repository} allowMachineChange={allow}
          onChange={async(id,target,runtimeId)=>{if(window.fail)throw Error('Fixture move failed');window.choices.push({id,runtimeId});setActive(runtimeId);setRepository(id)}}/>;
      }
      createRoot(document.getElementById('app')).render(<App/>);
    `,
  },
  plugins: [
    {
      name: 'native-project-picker',
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
  define: { 'process.env.NODE_ENV': '"production"' },
})
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const project = page.getByRole('button', { name: 'Folder', exact: true })
  const server = page.getByRole('button', { name: 'Task server', exact: true })
  const search = page.getByRole('textbox', { name: 'Search projects', exact: true })
  const panel = page.getByRole('dialog', { name: 'Project', exact: true })
  await project.click()
  assert.equal(await server.count(), 0)
  assert.equal(await panel.getByRole('button').nth(1).getAttribute('aria-label'), 'No project')
  await search.fill('Missing')
  assert.equal(
    await page.getByRole('button', { name: 'No project', exact: true }).isVisible(),
    true,
  )
  await page.getByRole('button', { name: 'Close picker' }).click()

  await project.click()
  await page.getByRole('button', { name: 'Add project', exact: true }).click()
  const runtimePanel = page.getByRole('dialog', { name: 'Select runtime', exact: true })
  await runtimePanel.waitFor()
  await runtimePanel.getByRole('button', { name: 'local server', exact: true }).click()
  await page.getByRole('dialog', { name: 'Add project flow' }).waitFor()
  await page.getByRole('button', { name: 'Cancel adding' }).click()
  await runtimePanel.waitFor({ state: 'hidden' })

  await page.evaluate(() => window.update({ multiple: true }))
  await project.click()
  assert.equal(await page.getByRole('button', { name: 'Shared project', exact: true }).count(), 1)
  assert.equal(
    await page.getByRole('button', { name: 'Remote notes', exact: true }).isVisible(),
    true,
  )
  await page.getByRole('button', { name: 'Shared project', exact: true }).click()
  await panel.waitFor({ state: 'hidden' })
  assert.deepEqual(await page.evaluate(() => window.choices.at(-1)), {
    id: 'remote',
    runtimeId: 'remote',
  })
  await server.click()
  assert.equal(await page.getByRole('button', { name: 'empty server', exact: true }).count(), 0)
  await page.getByRole('button', { name: 'local server', exact: true }).click()
  await page.getByRole('dialog', { name: 'Server', exact: true }).waitFor({ state: 'hidden' })
  assert.deepEqual(await page.evaluate(() => window.choices.at(-1)), {
    id: 'local',
    runtimeId: 'local',
  })

  await project.click()
  await page.getByRole('button', { name: 'Remote notes', exact: true }).click()
  await panel.waitFor({ state: 'hidden' })
  await server.click()
  assert.equal(await page.getByRole('button', { name: 'local server', exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: 'empty server', exact: true }).count(), 0)
  assert.equal(
    await page.getByRole('button', { name: 'remote server', exact: true }).isEnabled(),
    true,
  )
  await page.getByRole('button', { name: 'Close picker' }).click()
  assert.equal(await page.evaluate(() => window.repository), 'notes')
  await project.click()
  await page.getByRole('button', { name: 'Shared project', exact: true }).click()
  await panel.waitFor({ state: 'hidden' })

  await page.evaluate(() => window.update({ remoteOnline: false }))
  await project.click()
  await page.getByRole('button', { name: 'Add project', exact: true }).click()
  assert.equal(
    await runtimePanel.getByRole('button', { name: 'remote server', exact: true }).isDisabled(),
    true,
  )
  await page.getByRole('button', { name: 'Close picker' }).click()

  await project.click()
  assert.equal(
    await page.getByRole('button', { name: 'Remote notes', exact: true }).isDisabled(),
    true,
  )
  await page.getByRole('button', { name: 'Shared project', exact: true }).click()
  await panel.waitFor({ state: 'hidden' })
  assert.deepEqual(await page.evaluate(() => window.choices.at(-1)), {
    id: 'local',
    runtimeId: 'local',
  })

  await page.evaluate(() => {
    window.update({ remoteOnline: true })
    window.fail = true
  })
  await project.click()
  await page.getByRole('button', { name: 'Shared project', exact: true }).click()
  await page.getByRole('alert').waitFor()
  assert.equal(await panel.isVisible(), true)
  await page.evaluate(() => {
    window.fail = false
  })
  await page.getByRole('button', { name: 'Shared project', exact: true }).click()
  await panel.waitFor({ state: 'hidden' })
  await page.evaluate(() => window.update({ allow: false }))
  await project.click()
  assert.equal(await server.count(), 0)
  await search.fill('local server')
  assert.equal(await page.getByRole('button', { name: 'Shared project', exact: true }).count(), 0)
  await page.getByRole('button', { name: 'No project', exact: true }).click()
  await panel.waitFor({ state: 'hidden' })
  assert.equal(await page.evaluate(() => window.repository), 'remote-scratch')
  await page.evaluate(() => window.update({ allow: true }))
  await project.click()
  await page.getByRole('button', { name: 'Add project', exact: true }).click()
  await runtimePanel.getByRole('button', { name: 'local server', exact: true }).click()
  const addFlow = page.getByRole('dialog', { name: 'Add project flow' })
  assert.equal(await addFlow.locator('..').getAttribute('data-runtime'), 'local')
  await page.getByRole('button', { name: 'Finish adding' }).click()
  await addFlow.waitFor({ state: 'hidden' })
  assert.deepEqual(await page.evaluate(() => window.choices.at(-1)), {
    id: 'added',
    runtimeId: 'local',
  })
  assert.deepEqual(errors, [])
  console.log(
    'Native FolderPicker with browser control adapters: project-first listing, grouped copies, pinned No project, preferred server, explicit server changes, offline fallback, retry and machine restrictions passed.',
  )
} finally {
  await browser.close()
}
