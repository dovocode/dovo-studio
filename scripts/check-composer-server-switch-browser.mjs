import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const resolveDir = new URL('../packages/studio-ui/', import.meta.url).pathname
const mocks = {
  'react-native': 'export const View=({children})=><div>{children}</div>;',
  '../../runtime/connection/provider': 'export const useRuntime=()=>window.runtime;',
  '../../shell/navigation':
    'export const useNavigation=()=>({navigate:(...args)=>window.events.push(["navigate",...args])});',
  '../draft/use-draft':
    'export const saveRuntimeDraft=async(...args)=>window.events.push(["save-draft",...args]);',
  './folder-picker':
    'export const FolderPicker=({onChange,disabled})=><button disabled={disabled} onClick={()=>onChange("destination",window.target,"b").then(()=>window.done=true,error=>window.failure=error.message)}>Switch mobile server</button>;',
}
const built = await build({
  stdin: {
    resolveDir,
    loader: 'tsx',
    contents: `
      import {createRoot} from 'react-dom/client';
      import {flushSync} from 'react-dom';
      import {decode,taskSchema} from '@dovo/protocol';
      import {moveTaskDraft} from '../extension-tasks/src/chat/composer/task-machine-selector';
      import {TaskMachineSelector} from '../../apps/mobile/src/tasks/creation/task-machine-selector';
      const origin={id:'a',name:'Origin',connection:{address:'http://origin',token:'origin-token'}};
      const destination={id:'b',name:'Destination',connection:{address:'http://destination',token:'destination-token'}};
      const repository={id:'origin',name:'Project',path:'/origin',branch:'main',gitIdentity:'host/team/project'};
      window.target={...repository,id:'destination',path:'/destination'};
      const task={id:'task',title:'Draft',repositoryId:'origin',agentId:'',status:'draft',createdAt:'2026-10-08T00:00:00Z',messages:[],files:[],draft:'Keep this draft',example:false};
      const root=createRoot(document.getElementById('app'));
      window.setup=options=>{
        window.events=[];window.failure='';window.done=false;window.fleetRefreshes=0;
        window.releaseReceive=window.releaseArchive=window.releaseDestination=window.releaseSource=null;
        const readRuntime=async(profile,path,input,schema)=>{
          window.events.push([profile.id,path]);
          if(path==='/api/tasks/draft-receive'){
            if(options.holdReceive)await new Promise(resolve=>window.releaseReceive=resolve);
            if(options.failReceive)throw Error('Receive failed');
            return decode(schema,input.task);
          }
          if(options.holdArchive)await new Promise(resolve=>window.releaseArchive=resolve);
          if(options.failArchive)throw Error('Archive failed');
          return decode(schema,{ok:true});
        };
        const refreshRuntime=async profile=>{
          window.events.push(['refresh',profile.id]);
          if(profile.id==='a')await new Promise(resolve=>window.releaseSource=resolve);
          else{
            if(options.holdDestination)await new Promise(resolve=>window.releaseDestination=resolve);
            if(options.failDestination)throw Error('Destination refresh failed');
          }
        };
        const workspace={version:1,runtimeAddress:'',tasks:[task],repositories:[repository],agents:[],automations:[]};
        const store={workspace,activeRuntimeId:'a',runtimeRegistry:{profiles:[origin,destination]},flush:async()=>window.events.push(['flush']),readRuntime,refreshRuntime,
          refreshRuntimes:async()=>{window.fleetRefreshes++;await new Promise(()=>{})},
          switchRuntime:async id=>window.events.push(['switch',id])};
        window.runDesktop=()=>moveTaskDraft(store,{navigate:value=>window.events.push(['navigate',value])},task,{runtimeId:'b',online:!options.offline,snapshot:null,workspace},window.target).then(()=>window.done=true,error=>window.failure=error.message);
        window.runtime={activeId:'a',profile:origin,snapshot:{workspace},overviews:[{profile:origin,connected:true,snapshot:{workspace}},{profile:destination,connected:!options.offline,snapshot:{workspace}}],readRuntime,refreshRuntime};
        flushSync(()=>root.render(<TaskMachineSelector task={task} text={task.draft} disabled={false} onMoving={()=>{}} onProjectChange={async()=>{}}/>));
      };
      window.setup({});
    `,
  },
  plugins: [
    {
      name: 'server-switch-environment',
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
  page.setDefaultTimeout(5000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  for (const mobile of [false, true]) {
    const start = async (options) => {
      await page.evaluate((options) => window.setup(options), options)
      if (mobile) await page.getByRole('button', { name: 'Switch mobile server' }).click()
      else
        await page.evaluate(() => {
          void window.runDesktop()
        })
    }
    await start({ holdReceive: true, holdArchive: true, holdDestination: true })
    await page.waitForFunction(() => !!window.releaseReceive)
    assert.equal(
      await page.evaluate(() =>
        window.events.some((event) => event[1] === '/api/tasks/draft-moved'),
      ),
      false,
    )
    await page.evaluate(() => window.releaseReceive())
    await page.waitForFunction(() => !!window.releaseArchive)
    assert.equal(
      await page.evaluate(() => window.events.some((event) => event[0] === 'refresh')),
      false,
    )
    await page.evaluate(() => window.releaseArchive())
    await page.waitForFunction(() => !!window.releaseDestination)
    assert.equal(await page.evaluate(() => window.done), false)
    assert.equal(
      await page.evaluate(() => window.events.some((event) => event[0] === 'navigate')),
      false,
    )
    await page.evaluate(() => window.releaseDestination())
    await page.waitForFunction(() => window.done && !!window.releaseSource)
    assert.equal(await page.evaluate(() => window.failure), '')
    assert.equal(await page.evaluate(() => window.fleetRefreshes), 0)
    const events = await page.evaluate(() => window.events)
    assert.deepEqual(
      events.filter((event) => event[0] === 'refresh'),
      [
        ['refresh', 'b'],
        ['refresh', 'a'],
      ],
    )
    assert.ok(
      events.findIndex((event) => event[0] === 'navigate') <
        events.findIndex((event) => event[0] === 'refresh' && event[1] === 'a'),
    )
    if (mobile)
      assert.deepEqual(
        events.find((event) => event[0] === 'save-draft'),
        ['save-draft', 'b', 'task', 'Keep this draft'],
      )
    else
      assert.deepEqual(
        events.find((event) => event[0] === 'navigate'),
        ['navigate', { viewId: 'tasks', entityId: 'task' }],
      )
    // Source refresh remains pending, yet the move and navigation have already completed.
    await page.evaluate(() => window.releaseSource())
    for (const [option, message, allowed] of [
      ['failReceive', 'Receive failed', '/api/tasks/draft-receive'],
      ['failArchive', 'Archive failed', '/api/tasks/draft-moved'],
      ['failDestination', 'Destination refresh failed', '/api/tasks/draft-moved'],
      [
        'offline',
        mobile ? 'This machine or project is unavailable.' : 'This machine is offline.',
        null,
      ],
    ]) {
      await start({ [option]: true })
      await page.waitForFunction((message) => window.failure === message, message)
      const calls = await page.evaluate(() => window.events)
      assert.equal(
        calls.some((event) => event[0] === 'navigate' || event[0] === 'switch'),
        false,
      )
      if (allowed === '/api/tasks/draft-receive')
        assert.equal(
          calls.some((event) => event[1] === '/api/tasks/draft-moved'),
          false,
        )
      if (!allowed) assert.equal(calls.length, 0)
    }
  }
  assert.deepEqual(errors, [])
  console.log(
    'Desktop/mobile server switches preserve transfer ordering, refresh only the destination before navigation, finish while the source is stalled, and retain actionable failures.',
  )
} finally {
  await browser.close()
}
