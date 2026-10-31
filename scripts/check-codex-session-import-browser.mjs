import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const mocks = {
  '@dovo/studio-core': `export {useCodexSessionImport} from '${root}/packages/studio-core/src/use-codex-session-import';export const useAppPreferences=()=>({});export const projectActivity=()=>0;export const useWorkspace=()=>window.store;export const useStudioHost=()=>({navigate:target=>window.navigation=target});`,
  '@dovo/studio-ui': `export const DialogHeader=({children})=><div>{children}</div>;export const DropdownMenu=()=>null;export const Popover=()=>null;export const Input=()=>null;export const ProjectIcon=()=>null;export const TaskDefaultSettings=()=>null;export const Button=({children,onClick,disabled})=><button onClick={onClick} disabled={disabled}>{children}</button>;export const Dialog=({open,children})=>open?<section role="dialog">{children}</section>:null;export const DialogContent=({children})=><div>{children}</div>;export const DialogTitle=({children})=><h2>{children}</h2>;export const DialogDescription=({children})=><p>{children}</p>;`,
  '@dovo/studio-core/state': `export {useState as useApplicationState} from 'react';`,
  'react-native': `const flat=s=>Object.assign({},...(Array.isArray(s)?s.flat(Infinity):[s]));export const View=({children,style,accessibilityLabel})=><div aria-label={accessibilityLabel} style={flat(style)}>{children}</div>;export const Pressable=({children,onPress,disabled,accessibilityLabel})=><button aria-label={accessibilityLabel} onClick={onPress} disabled={disabled}>{children}</button>;export const Image=()=>null;`,
  'expo-router': `export const router={push:target=>window.navigation=target};`,
  '../chat/composer/composer-project': `export const ComposerProject=()=> <button>Selected project</button>;`,
  '../../runtime/connection/provider': `export const useRuntime=()=>window.runtime;export const RuntimeScope=({children})=>children;`,
  '../../runtime/state/application-state': `export {useState as useApplicationState} from 'react';`,
  '../../ui/theme': `export const useTheme=()=>({styles:{row:{display:'flex',gap:8},text:{},muted:{color:'#777'},error:{color:'red'}},colors:{border:'#ddd',accent:'blue',surface:'#eee'}});`,
  '../../ui/content/text': `export const Text=({children,style,accessibilityRole})=><p style={Object.assign({},...(Array.isArray(style)?style.flat(Infinity):[style]))} role={accessibilityRole}>{children}</p>;`,
  '../../ui/content/runtime-icon': `export const RuntimeIcon=()=>null;`,
  '../../ui/controls/icon': `export const Icon=()=>null;`,
  '../../ui/controls/field': `export const SearchField=()=>null;`,
  '../../ui/controls/action': `export const Action=({label,onPress,disabled})=><button onClick={onPress} disabled={disabled}>{label}</button>;`,
  '../../ui/controls/choice': `export const Choice=({label,value,disabled,onChange,items})=><label>{label}<select aria-label={label} value={value} disabled={disabled} onChange={e=>onChange(e.target.value)}>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>;`,
  '../../ui/layout/sheet': `export const useSheetNavigation=()=>navigate=>{window.settingsDismissals++;navigate()};import {useImperativeHandle} from 'react';export const Sheet=({children,title,ref,onClose})=>{useImperativeHandle(ref,()=>({dismiss:after=>{onClose();after?.()}}));return <section role="dialog"><h2>{title}</h2>{children}</section>};`,
  '../../scm/connections/project-transfer': `export const ProjectTransferDialog=()=>null;`,
  './repository-dialog': `export const RepositoryDialog=()=>null;`,
  './repository-checkouts': `export const RepositoryCheckouts=()=>null;`,
  './forge-repository': `export const ProjectForgeBinding=()=>null;`,
  './project-icon-settings': `export const ProjectIconSettings=()=>null;`,
  './project-transfer': `export const ProjectTransferSettings=()=>null;`,
  './project-deletion': `export const ProjectDeletion=()=>null;`,
  './repository-card': `export const RepositoryCard=()=>null;`,
  '../../runtime/preferences/task-default-settings': `export const TaskDefaultSettings=()=>null;`,
  '../../screens/repositories': `export const AddProject=()=>null;`,
}
const bundle = await build({
  stdin: {
    resolveDir: root,
    loader: 'tsx',
    contents: `
import {createRoot} from 'react-dom/client';
import {TaskEmptyState} from '${root}/packages/extension-tasks/src/task-creation/task-empty-state';
import {FolderPicker} from '${root}/apps/mobile/src/tasks/creation/folder-picker';
import {ProjectSettings} from '${root}/packages/extension-scm/src/connections/projects-menu';
import {RepositoryCheckouts} from '${root}/apps/mobile/src/scm/connections/repository-checkouts';
window.calls=[];window.navigation=null;window.activeSession=false;
const repository={id:'repo',name:'Project',path:'/project',branch:'main'};window.repository=repository;
const agents=[{id:'custom',name:'Custom home',provider:'codex'}];
const workspace={repositories:[repository],agents,tasks:[]};
const session={key:'session-key',sessionId:'native-session',title:'Terminal task',cwd:'/project',updatedAt:'2026-10-01T10:00:00Z',model:'gpt-6-sol'};
const request=async(path,input)=>{window.calls.push({path,input});
if(path.endsWith('/list'))return{sessions:[session]};
if(path.endsWith('/preview'))return{session:{...session,...(window.existing?{taskId:'existing-thread'}:{})},revision:'preview-revision',status:window.activeSession?'active':window.existing?'owned':'available',notice:window.activeSession?'Exit Codex before importing.':'History is saved without running Codex.',olderMessages:0,messages:[{id:'u',role:'user',text:'Historical prompt'},{id:'a',role:'assistant',text:'Historical answer'}]};
if(path.endsWith('/import')){if(window.holdImport)await new Promise(resolve=>window.finishImport=resolve);return{id:'imported-thread',existing:false}}throw Error(path)};
window.store={workspace,connected:true,activeRuntimeId:'computer',request};
const profile={id:'computer',name:'Computer',connection:{address:'http://computer.local',token:'paired-device'}};const snapshot={workspace};
window.runtime={profile,profiles:[profile],activeId:'computer',snapshot,connected:true,overviews:[{profile,snapshot,connected:true}],call:request};
const task={id:'draft',repositoryId:'repo',status:'draft',messages:[]};
const app=createRoot(document.getElementById('app'));
window.show=mode=>{window.calls=[];window.navigation=null;window.settingsDismissals=0;app.render(mode==='none'?null:mode==='desktop-startup'?<TaskEmptyState task={task}/>:mode==='mobile-startup'?<FolderPicker repositories={[repository]} value='repo' prominent onChange={()=>{}}/>:mode==='desktop'?<ProjectSettings key='desktop' repository={repository} onNavigate={()=>window.settingsDismissals++}/>:<RepositoryCheckouts key='mobile' repository={repository}/>)};
window.show('desktop');`,
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  alias: {
    react: `${root}/packages/studio-ui/node_modules/react`,
    'react-dom': `${root}/packages/studio-ui/node_modules/react-dom`,
    '@dovo/protocol': `${root}/packages/protocol/src/index.ts`,
  },
  nodePaths: [`${root}/node_modules`, `${root}/packages/studio-ui/node_modules`],
  plugins: [
    {
      name: 'picker-fixtures',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, ({ path }) =>
          mocks[path] ? { path, namespace: 'mock' } : undefined,
        )
        builder.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({
          contents: mocks[path],
          loader: 'tsx',
          resolveDir: root,
        }))
      },
    },
  ],
})
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 900 } })
  const errors = []
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.error(error.message)
  })
  page.setDefaultTimeout(10000)
  await page.setContent(
    '<style>body{font:16px system-ui}button,select{min-height:44px;margin:6px}section[role=dialog]{padding:20px;border:1px solid #888}pre{white-space:pre-wrap}</style><div id="app"></div>',
  )
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  for (const mode of ['desktop-startup', 'mobile-startup']) {
    await page.evaluate((mode) => window.show(mode), mode)
    assert.equal(
      await page
        .getByRole('button', { name: 'Import Codex terminal session', exact: true })
        .count(),
      0,
    )
    assert.deepEqual(await page.evaluate(() => window.calls), [])
  }
  for (const mode of ['desktop', 'mobile']) {
    await page.evaluate((mode) => {
      window.repository.kind = 'scratch'
      window.show(mode)
    }, mode)
    assert.equal(
      await page
        .getByRole('button', { name: 'Import Codex terminal session', exact: true })
        .count(),
      0,
    )
    await page.evaluate(() => {
      delete window.repository.kind
      window.show('none')
    })
    console.log(`Checking ${mode} Codex import flow`)
    await page.setViewportSize(
      mode === 'desktop' ? { width: 800, height: 900 } : { width: 390, height: 844 },
    )
    await page.evaluate((mode) => {
      window.existing = false
      window.activeSession = true
      window.show(mode)
    }, mode)
    await page.getByRole('button', { name: 'Import Codex terminal session', exact: true }).click()
    await page.getByLabel('Codex configuration').selectOption('custom')
    await page.getByRole('button', { name: /Terminal task/ }).click()
    await page.getByText('Historical answer', { exact: true }).waitFor()
    assert.equal(
      await page.getByRole('button', { name: 'Import session', exact: true }).isDisabled(),
      true,
    )
    assert.equal(
      await page.evaluate(
        () => window.calls.filter((call) => call.path.endsWith('/import')).length,
      ),
      0,
    )
    await page.evaluate(() => {
      window.activeSession = false
    })
    await page.getByRole('button', { name: 'Refresh sessions', exact: true }).click()
    await page.getByText('History is saved without running Codex.', { exact: true }).waitFor()
    assert.equal(
      await page.evaluate(
        () => window.calls.filter((call) => call.path.endsWith('/import')).length,
      ),
      0,
    )
    await page.getByRole('button', { name: 'Import session', exact: true }).click()
    await page.waitForFunction(() => window.navigation)
    const imported = await page.evaluate(() =>
      window.calls.filter((call) => call.path.endsWith('/import')),
    )
    assert.deepEqual(
      imported.map((call) => call.input),
      [
        {
          repositoryId: 'repo',
          agentId: 'custom',
          key: 'session-key',
          revision: 'preview-revision',
        },
      ],
    )
    assert.equal(
      await page.evaluate(() => window.navigation.entityId || window.navigation.params.taskId),
      'imported-thread',
    )
    assert.equal(
      await page.evaluate(() => window.settingsDismissals),
      1,
      'Close project settings before opening the imported thread',
    )
    // Existing ownership navigates without creating another thread.
    await page.evaluate(() => {
      window.existing = true
    })
    await page.getByRole('button', { name: 'Import Codex terminal session', exact: true }).click()
    await page.getByRole('button', { name: /Terminal task/ }).click()
    await page.getByRole('button', { name: 'Open existing thread', exact: true }).click()
    await page.waitForFunction(
      () => (window.navigation.entityId || window.navigation.params.taskId) === 'existing-thread',
    )
    assert.equal(
      await page.evaluate(
        () => window.calls.filter((call) => call.path.endsWith('/import')).length,
      ),
      1,
    )
    // A completed import still exists on the runtime, but must not redirect a user who left.
    await page.evaluate(() => {
      window.existing = false
      window.holdImport = true
    })
    await page.getByRole('button', { name: 'Import Codex terminal session', exact: true }).click()
    await page.getByRole('button', { name: /Terminal task/ }).click()
    await page.getByRole('button', { name: 'Import session', exact: true }).click()
    await page.waitForFunction(() => typeof window.finishImport === 'function')
    await page.evaluate(() => window.show('none'))
    await page
      .getByRole('button', { name: 'Importing…', exact: true })
      .waitFor({ state: 'detached' })
    await page.evaluate(async () => {
      window.finishImport()
      await new Promise((resolve) => setTimeout(resolve, 0))
      window.holdImport = false
      delete window.finishImport
    })
    assert.equal(await page.evaluate(() => window.navigation), null)
  }
  assert.deepEqual(errors, [])
  console.log(
    'Desktop and mobile Codex picker preview, activity blocking, explicit import, existing-thread and late-navigation checks passed.',
  )
} finally {
  await browser.close()
}
