import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const resolveDir = new URL('../packages/studio-ui/', import.meta.url).pathname
const built = await build({
  stdin: {
    resolveDir,
    loader: 'tsx',
    contents: `
      import {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {createTask} from '@dovo/studio-core';
      import {ComposerProject} from '../extension-tasks/src/chat/composer/composer-project';
      const repo=(id,name,gitIdentity)=>({id,name,path:'/'+id,branch:'main',gitIdentity});
      const scratch=id=>({...repo(id,'Private folder'),kind:'scratch'});
      const inventory={
        local:[scratch('scratch'),repo('local','Shared project','github.com/team/project'),repo('other','Other project'),{...repo('invalid','Invalid project'),gitIdentityError:'Invalid identity'}],
        remote:[scratch('remote-scratch'),repo('remote','Shared project','github.com/team/project'),repo('notes','Remote notes')],
        offline:[scratch('offline-scratch'),repo('offline-project','Offline project')],
        empty:[scratch('empty-scratch')],
      };
      const profiles=['local','remote','offline','empty'].map(id=>({id,name:id+' machine',connection:{address:'http://'+id,token:'token'}}));
      const task={...createTask({title:'Draft',objective:'',agentId:'',repositoryId:'local'}),draft:'Keep my draft'};
      window.selected=[];window.moving=[];window.fail=false;
      function App(){
        const [workspace,setWorkspace]=useState({tasks:[task],repositories:inventory.local,agents:[]});
        const [multiple,setMultiple]=useState(false),[disabled,setDisabled]=useState(false),[online,setOnline]=useState(true),[active,setActive]=useState('local'),[remoteOnline,setRemoteOnline]=useState(true),[defaultServer,setDefaultServer]=useState(),[revision,setRevision]=useState(0);
        const defaults={scopedSettings:{environment:{},shared:[{key:'project:github.com/team/project',updatedAt:1,changeId:'one',value:{taskDefaults:{defaultServerId:defaultServer}}}]}};
        const runtimes=multiple?profiles.map(profile=>({profile,connected:profile.id==='local'?online:profile.id==='remote'?remoteOnline:profile.id!=='offline',snapshot:{defaults,workspace:{repositories:inventory[profile.id],tasks:[],agents:[]}}})):[];
        window.configure=changes=>{if('multiple' in changes)setMultiple(changes.multiple);if('disabled' in changes)setDisabled(changes.disabled);if('online' in changes)setOnline(changes.online);if('remoteOnline' in changes)setRemoteOnline(changes.remoteOnline);if('defaultServer' in changes)setDefaultServer(changes.defaultServer);setRevision(value=>value+1)};
        window.store={workspace,setWorkspace,activeRuntimeId:active,connected:active==='local'?online:remoteOnline,runtimes,snapshot:{defaults},runtimeRegistry:{profiles},connection:{address:'http://'+active}};
        window.workspace=workspace;window.active=active;
        return <div data-revision={revision}><ComposerProject task={workspace.tasks[0]} disabled={disabled}
          onMoving={value=>window.moving.push(value)}
          onSelectRemote={(source,target)=>new Promise((resolve,reject)=>{
            window.selected.push({runtimeId:source.runtimeId,repositoryId:target.id});
            window.finish=()=>{
              if(window.fail){reject(new Error('Could not move draft'));return}
              setWorkspace(current=>({...current,repositories:inventory[source.runtimeId],tasks:[{...current.tasks[0],repositoryId:target.id}]}));
              setActive(source.runtimeId);resolve();
            };
          })}/><button type="button">Outside</button></div>;
      }
      createRoot(document.getElementById('app')).render(<App/>);
    `,
  },
  plugins: [
    {
      name: 'project-picker-environment',
      setup(builder) {
        const mocks = {
          '@dovo/studio-core': `export * from '../protocol/src/index';export {createTask,updateTask} from '../studio-core/src/workspace/actions';export const useWorkspace=()=>window.store;export const useStudioHost=()=>({});export const WorkspaceScope=({profile,children})=><div data-runtime-scope={profile.id}>{children}</div>;`,
          '@dovo/studio-ui': `export {Button} from '../studio-ui/src/components/ui/button';export {Input} from '../studio-ui/src/components/ui/input';export * as Popover from '@radix-ui/react-popover';`,
          '@dovo/extension-scm/repository-dialog': `export const RepositoryDialog=({onClose})=><div role="dialog" aria-label="Add project"><button onClick={onClose}>Cancel adding</button></div>;`,
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
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  page.setDefaultTimeout(5000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app" style="margin-top:400px"></div>')
  await page.addStyleTag({
    content:
      'svg{width:16px;height:16px}button{font:14px system-ui} [role=dialog]{max-width:calc(100vw - 24px)}',
  })
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const trigger = page.getByRole('button', { name: 'Task project', exact: true })
  const search = page.getByRole('textbox', { name: 'Search projects', exact: true })
  const server = page.getByRole('button', { name: 'Task server', exact: true })
  const panel = page.getByRole('dialog', { name: 'Choose a project', exact: true })
  const serverPanel = page.getByRole('dialog', { name: 'Choose a server', exact: true })

  // One server goes directly to projects; No project stays first even during search.
  await trigger.click()
  await search.waitFor()
  assert.equal(await search.evaluate((input) => input === document.activeElement), true)
  assert.equal(await server.count(), 0)
  assert.equal(
    await page
      .getByRole('group', { name: 'Projects' })
      .getByRole('button')
      .first()
      .getAttribute('aria-label'),
    'No project',
  )
  assert.equal(
    await page.getByRole('button', { name: 'Invalid project', exact: true }).isDisabled(),
    true,
  )
  await search.fill('Other')
  assert.equal(
    await page.getByRole('button', { name: 'No project', exact: true }).isVisible(),
    true,
  )
  await search.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await panel.waitFor({ state: 'hidden' })
  assert.equal(await page.evaluate(() => window.workspace.tasks[0].repositoryId), 'other')
  assert.equal(await page.evaluate(() => window.workspace.tasks[0].draft), 'Keep my draft')

  // All projects are visible without choosing a server; matching copies appear once.
  await page.evaluate(() => window.configure({ multiple: true }))
  await trigger.click()
  assert.equal(await page.getByRole('button', { name: 'Shared project', exact: true }).count(), 1)
  assert.equal(
    await page.getByRole('button', { name: 'Remote notes', exact: true }).isVisible(),
    true,
  )
  assert.equal(
    await page.getByRole('button', { name: 'Offline project', exact: true }).isDisabled(),
    true,
  )
  await search.fill('Remote')
  await page.getByRole('button', { name: 'Remote notes', exact: true }).hover()
  await search.click()
  assert.equal(await page.evaluate(() => window.active), 'local')
  assert.equal(await page.evaluate(() => window.selected.length), 0)
  await page.keyboard.press('Escape')
  await panel.waitFor({ state: 'hidden' })
  await trigger.click()
  assert.equal(await search.inputValue(), '')
  await search.fill('Missing')
  assert.equal(await page.getByRole('status').textContent(), 'No matching projects.')
  assert.equal(
    await page.getByRole('button', { name: 'No project', exact: true }).isVisible(),
    true,
  )
  await search.fill('')
  await page.getByRole('button', { name: 'Add project on local machine', exact: true }).click()
  await panel.waitFor({ state: 'hidden' })
  await page.getByRole('dialog', { name: 'Add project', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Cancel adding' }).click()

  // A remote project moves only on click, keeps failures retryable, and preserves the draft.
  await trigger.click()
  await page.evaluate(() => {
    window.fail = true
  })
  await page.getByRole('button', { name: 'Remote notes', exact: true }).click()
  assert.equal(await search.isDisabled(), true)
  await page.keyboard.press('Escape')
  assert.equal(await panel.isVisible(), true)
  await page.evaluate(() => window.finish())
  await page.getByRole('alert').waitFor()
  assert.equal(await page.getByRole('alert').textContent(), 'Could not move draft')
  assert.equal(await search.isDisabled(), false)
  await page.evaluate(() => {
    window.fail = false
  })
  await page.getByRole('button', { name: 'Remote notes', exact: true }).click()
  await page.evaluate(() => window.finish())
  await panel.waitFor({ state: 'hidden' })
  await page.waitForFunction(() => window.active === 'remote')
  assert.equal(await page.evaluate(() => window.workspace.tasks[0].repositoryId), 'notes')
  assert.equal(await page.evaluate(() => window.workspace.tasks[0].draft), 'Keep my draft')
  await server.click()
  assert.equal(await page.getByRole('button', { name: 'local machine', exact: true }).count(), 0)
  await page.keyboard.press('Escape')

  // Selecting a project uses its saved default; explicit server changes keep that project.
  await page.evaluate(() => window.configure({ defaultServer: 'local' }))
  await trigger.click()
  await page.getByRole('button', { name: 'Shared project', exact: true }).click()
  await page.evaluate(() => window.finish())
  await panel.waitFor({ state: 'hidden' })
  await page.waitForFunction(() => window.active === 'local')
  assert.equal(await page.evaluate(() => window.workspace.tasks[0].repositoryId), 'local')
  await server.click()
  assert.equal(await serverPanel.getByRole('button').count(), 2)
  await page.getByRole('button', { name: 'remote machine', exact: true }).click()
  await page.evaluate(() => window.finish())
  await serverPanel.waitFor({ state: 'hidden' })
  await page.waitForFunction(() => window.active === 'remote')
  assert.equal(await page.evaluate(() => window.workspace.tasks[0].repositoryId), 'remote')

  // An offline default automatically falls back to another online copy.
  await page.evaluate(() => window.configure({ defaultServer: 'remote', remoteOnline: false }))
  await trigger.click()
  await page.getByRole('button', { name: 'Shared project', exact: true }).click()
  await page.evaluate(() => window.finish())
  await panel.waitFor({ state: 'hidden' })
  await page.waitForFunction(() => window.active === 'local')
  assert.equal(await page.evaluate(() => window.workspace.tasks[0].repositoryId), 'local')
  await trigger.click()
  await search.fill('Nothing matches')
  await page.getByRole('button', { name: 'No project', exact: true }).click()
  await panel.waitFor({ state: 'hidden' })
  assert.equal(await page.evaluate(() => window.workspace.tasks[0].repositoryId), 'scratch')
  assert.equal(await page.evaluate(() => window.workspace.tasks[0].draft), 'Keep my draft')

  await page.evaluate(() => window.configure({ multiple: false, online: false }))
  await trigger.click()
  assert.equal(
    await page.getByRole('button', { name: 'Other project', exact: true }).isDisabled(),
    true,
  )
  assert.equal(
    await page.getByRole('button', { name: 'Add project', exact: true }).isDisabled(),
    true,
  )
  await page.keyboard.press('Escape')
  await page.evaluate(() => window.configure({ disabled: true }))
  await page.waitForFunction(() => document.querySelector('[aria-label="Task project"]').disabled)
  assert.equal(await trigger.isDisabled(), true)
  assert.deepEqual(errors, [])
  console.log(
    'Composer projects: all servers, grouped copies, pinned No project during search, keyboard navigation, explicit server changes, saved defaults, offline fallback, draft preservation and move failure/retry passed.',
  )
} finally {
  await browser.close()
}
