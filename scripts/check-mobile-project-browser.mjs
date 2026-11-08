import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const resolveDir = new URL('../apps/mobile/', import.meta.url).pathname
const controls = `
const flat=style=>Object.assign({},...(Array.isArray(style)?style:[style]));
export const View=({children,style})=><div style={{display:'flex',flexDirection:'column',...flat(style)}}>{children}</div>;
export const Image=({source,style})=><img src={source.uri} style={flat(style)} alt=""/>;
export const Pressable=({children,onPress,disabled,accessibilityLabel,accessibilityState,style})=><button style={{display:"flex",...flat(style)}} aria-label={accessibilityLabel} aria-pressed={accessibilityState?.selected} disabled={disabled} onClick={onPress}>{children}</button>;
export const Text=({children,accessibilityRole,style})=><span style={flat(style)} role={accessibilityRole}>{children}</span>;
export const Icon=({name})=><span aria-hidden data-icon={name}/>;
export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;
export const SearchField=({label,value,onChangeText})=><input aria-label={label} value={value} onChange={event=>onChangeText(event.target.value)}/>;
export const Sheet=({title,children,onClose,busy,headerAction})=><div role="dialog" aria-label={title}>{headerAction&&<button aria-label={headerAction.label} disabled={busy||headerAction.disabled} onClick={headerAction.onPress}>+</button>}{children}<button disabled={busy} onClick={onClose}>Close picker</button></div>;
export const useTheme=()=>({styles:{row:{flexDirection:'row',alignItems:'center',gap:8},text:{color:'#eee',fontSize:14},muted:{color:'#999'}},colors:{surface:'#222'}});
`
const mocks = {
  'expo-router': `export const router={push:()=>{throw new Error('Unexpected navigation in project picker fixture')}};`,
  'react-native': controls,
  '../../ui/content/text': controls,
  '../../ui/controls/action': controls,
  '../../ui/controls/icon': controls,
  '../controls/icon': controls,
  '../../ui/controls/field': controls,
  '../../ui/controls/choice': `export const Choice=({label,value,items,onChange,disabled})=><label>{label}<select aria-label={label} value={value} disabled={disabled} onChange={event=>onChange(event.target.value)}>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>;`,
  '../../ui/layout/sheet': controls,
  '../../ui/theme': controls,
  '../../runtime/state/application-state': `export {useState as useApplicationState} from 'react';`,
  '../../runtime/connection/provider': `export const useRuntime=()=>window.runtime;export const RuntimeScope=({children,runtimeId})=><div data-runtime={runtimeId}>{children}</div>;`,
  '../../scm/connections/project-transfer': `export const ProjectTransferDialog=({repository,onClose})=><div role="dialog" aria-label="Add to another machine"><output>{repository.id}</output><button onClick={onClose}>Close transfer</button></div>;`,
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
        const [stacked,setStacked]=useState(false),[active,setActive]=useState('local'),[repository,setRepository]=useState('local'),[multiple,setMultiple]=useState(false),[remoteOnline,setRemoteOnline]=useState(true),[allow,setAllow]=useState(true),[auto,setAuto]=useState(false),[autoEnabled,setAutoEnabled]=useState(false);
        window.update=changes=>{if('stacked' in changes)setStacked(changes.stacked);if('autoEnabled' in changes)setAutoEnabled(changes.autoEnabled);if('multiple' in changes)setMultiple(changes.multiple);if('remoteOnline' in changes)setRemoteOnline(changes.remoteOnline);if('allow' in changes)setAllow(changes.allow)};
        const defaults={scopedSettings:{environment:{},shared:[{key:'project:host/team/project',updatedAt:1,changeId:'one',value:{taskDefaults:{defaultServerId:'remote'}}}]}};
        const overviews=(multiple?['local','remote','empty']:['local']).map(id=>({profile:{id,name:id+' server',nameIsCustom:true,connection:{address:'http://'+id,token:'test'}},connected:id==='local'||remoteOnline,snapshot:{defaults,workspace:{repositories:inventory[id]}}}));
        window.runtime={connected:true,activeId:active,overviews,profile:overviews.find(entry=>entry.profile.id===active)?.profile};window.active=active;window.repository=repository;
        return <div data-stacked={stacked}><FolderPicker stacked={stacked} repositories={inventory[active]} value={repository} allowMachineChange={allow} autoProject={auto} onAuto={autoEnabled?async()=>{setAuto(true);setRepository(inventory[active].find(repo=>repo.kind==='scratch').id)}:undefined}
          onChange={async(id,target,runtimeId,preserveAuto)=>{if(window.fail)throw Error('Fixture move failed');window.choices.push({id,runtimeId});if(!preserveAuto)setAuto(false);setActive(runtimeId);setRepository(id)}}/></div>;
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
  const page = await browser.newPage({ viewport: { width: 320, height: 900 } })
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
  assert.equal(await panel.getByRole('button').nth(1).getAttribute('aria-label'), 'No Project')
  await search.fill('Missing')
  assert.equal(
    await page.getByRole('button', { name: 'No Project', exact: true }).isVisible(),
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
  await server.click()
  await page.getByRole('button', { name: 'Add to another machine', exact: true }).click()
  const transfer = page.getByRole('dialog', { name: 'Add to another machine', exact: true })
  await transfer.waitFor()
  assert.equal(await transfer.locator('output').textContent(), 'local')
  assert.equal(await page.getByRole('dialog', { name: 'Server', exact: true }).count(), 0)
  await page.getByRole('button', { name: 'Close transfer', exact: true }).click()

  const appearance = (locator) =>
    locator.evaluate((node) => {
      const style = getComputedStyle(node),
        text = getComputedStyle(node.querySelector('span:not([aria-hidden])') ?? node)
      return {
        height: style.minHeight,
        padding: style.padding,
        radius: style.borderRadius,
        background: style.backgroundColor,
        color: text.color,
        fontSize: text.fontSize,
      }
    })
  assert.deepEqual(await appearance(project), await appearance(server))
  for (const stacked of [true, false]) {
    await page.evaluate((stacked) => window.update({ stacked }), stacked)
    // A state setter returns before React commits. Otherwise the two reads can
    // measure opposite sides of the row/column layout transition.
    await page.locator(`[data-stacked="${stacked}"]`).waitFor()
    const projectBounds = await project.boundingBox(),
      serverBounds = await server.boundingBox()
    assert.ok(
      Math.abs(projectBounds.width - serverBounds.width) < 1,
      JSON.stringify({ stacked, projectBounds, serverBounds }),
    )
    assert.ok(serverBounds.x + serverBounds.width <= 320)
  }
  await project.click()
  assert.equal(await page.getByRole('button', { name: 'Shared project', exact: true }).count(), 1)
  assert.equal(await page.getByRole('button', { name: 'No Project', exact: true }).count(), 1)
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
  await page.getByRole('button', { name: 'No Project', exact: true }).click()
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
  await project.click()
  assert.equal(await page.getByRole('button', { name: 'Scope mode', exact: true }).count(), 0)
  await page.evaluate(() => window.update({ autoEnabled: true }))
  await page
    .getByRole('button', { name: 'Scope mode', exact: true })
    .locator('[data-icon=scope]')
    .waitFor({ state: 'attached' })
  await page.getByRole('button', { name: 'Scope mode', exact: true }).click()
  assert.equal(await project.locator('[data-icon=scope]').count(), 1)
  assert.match(await project.textContent(), /Scope/)
  await page.evaluate(() => window.update({ autoEnabled: false }))
  await project.filter({ hasText: 'Scope (disabled)' }).waitFor()
  assert.match(await project.textContent(), /Scope \(disabled\)/)
  assert.equal(await page.evaluate(() => window.active), 'local')
  await project.click()
  assert.equal(
    await page
      .getByRole('button', { name: 'No Project', exact: true })
      .getAttribute('aria-pressed'),
    'false',
  )
  await page.getByRole('button', { name: 'No Project', exact: true }).click()
  assert.match(await project.textContent(), /No Project/)
  assert.deepEqual(errors, [])
  console.log(
    'Native FolderPicker with browser control adapters: project-first listing, grouped copies, pinned General, preferred server, explicit server changes, offline fallback, retry and machine restrictions passed.',
  )
} finally {
  await browser.close()
}
