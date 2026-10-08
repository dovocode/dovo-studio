import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('../', import.meta.url))
const screenshots = process.env.DOVO_COMPOSER_SCREENSHOTS
if (screenshots) mkdirSync(screenshots, { recursive: true })
const css = readdirSync(root + 'apps/desktop/dist/assets')
  .filter((file) => file.endsWith('.css'))
  .map((file) => readFileSync(root + 'apps/desktop/dist/assets/' + file, 'utf8'))
  .join('\n')
const mocks = {
  '@dovo/studio-core': `
    export * from '../studio-core/src/index';
    export {WorkspaceContext as Context,useWorkspace} from '../studio-core/src/workspace/context';
    export const useStudioHost=()=>({navigate:()=>{}});
    export const useResolvedTheme=()=> 'dark';
    const preferences={sendWith:'enter',themePalette:'dovo',markdownComposerPreview:false,followUp:'queue',confirmStop:false};
    export const useAppPreferences=()=>preferences;
    export const readAppPreferences=()=>preferences;
  `,
  '@dovo/studio-core/state': `export {useState as useApplicationState} from 'react';`,
  '@dovo/extension-scm/repository-dialog': `export const RepositoryDialog=()=>null;`,
  './use-attachments': `export const useAttachments=()=>({files:[],previews:[],uploading:[],busy:false,error:'',upload:async()=>{},remove:()=>{}});`,
  './task-activity': `const tools=[];export const useTaskActivity=()=>({tools,error:''});export const TaskActivity=()=>null;`,
}
const built = await build({
  stdin: {
    contents: `
      import {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {Context,defaultTaskHarness} from '@dovo/studio-core';
      import {TooltipProvider,TaskDefaultSettings} from '@dovo/studio-ui';
      import {StartupDraft} from '../extension-tasks/src/task-creation/startup-draft';
      import {ChatThread} from '../extension-tasks/src/chat/thread/chat-thread';
      import {Composer} from '../extension-tasks/src/chat/composer/composer';
      const repositories=[
        {id:'scratch',kind:'scratch',name:'Thread folder',path:'/private/thread',branch:''},
        {id:'git',name:'dovo-studio',path:'/repo',branch:'main',gitIdentity:'github.com/dovo/studio'},
        {id:'folder',kind:'folder',name:'Design notes',path:'/notes',branch:''}
      ];
      const harness={...defaultTaskHarness('codex'),model:'gpt-6.1-sol',reasoning:'xhigh',permission:'full-access'};
      const defaults={scopedSettings:{environment:{taskDefaults:{harness}},shared:[{key:'project:github.com/dovo/studio',updatedAt:1,changeId:'fixture',value:{taskDefaults:{defaultServerId:'linux'}}}]},harness};
      const profile={id:'mac',name:'MacBook',nameIsCustom:true,connection:{address:'http://runtime.test',token:'fixture-token'}};
      const remoteProfile={...profile,id:'linux',name:'Linux workstation'};
      window.requests=[];
      function App(){
        const [workspace,setWorkspace]=useState({repositories,agents:[],tasks:[],automations:[]});
        const [id,setId]=useState(null);
        const [pending,setPending]=useState(null);
        const [multiple,setMultiple]=useState(false);window.setMultiple=setMultiple;
        const [settings,setSettings]=useState(false);window.showSettings=()=>setSettings(true);
        const task=workspace.tasks.find(task=>task.id===id);
        window.task=task;window.reset=()=>{setId(null);setPending(null);setWorkspace({repositories,agents:[],tasks:[],automations:[]})};
        window.setTask=update=>setWorkspace(w=>({...w,tasks:w.tasks.map(t=>t.id===id?{...t,...update}:t)}));
        const request=async(path,input)=>{
          window.requests.push({path,input});
          if(path==='/api/agents/settings/read')return {value:{taskDefaults:{defaultServerId:'linux'}},inherited:{taskDefaults:{}},projectKey:'project:github.com/dovo/studio'};
          if(path==='/api/agents/models')return {models:[{id:'gpt-6.1-sol',name:'GPT-6.1-Sol',isDefault:true,defaultReasoning:'xhigh',reasoning:[{id:'xhigh',name:'Extra High'}]}],reasoning:[]};
          if(path==='/api/agents/availability')return [{id:'harness:codex',available:true}];
          if(path==='/api/scm/branches')return {current:'main',branches:[{name:'main',ref:'refs/heads/main'}]};
          if(path==='/api/tasks/title')return {title:'Unify the composers'};
          if(path==='/api/tasks/message'){
            setWorkspace(w=>({...w,tasks:w.tasks.map(t=>t.id===input.id?{...t,status:'running',messages:[{id:input.messageId,role:'user',text:input.text,createdAt:new Date().toISOString()}]}:t)}));
            return {ok:true};
          }
          throw Error('Unexpected request '+path);
        };
        const value={workspace,setWorkspace,snapshot:{workspace,defaults,questions:[]},connected:true,activeRuntimeId:'mac',connection:profile.connection,runtimeRegistry:{profiles:multiple?[profile,remoteProfile]:[profile]},runtimes:[{profile,snapshot:{workspace,defaults,runtimeHost:'MacBook'},connected:true},...(multiple?[{profile:remoteProfile,snapshot:{workspace:{...workspace,repositories:[{id:'remote-scratch',kind:'scratch',name:'Thread folder',path:'/private/remote',branch:''},{id:'remote-git',name:'dovo-studio',path:'/home/dominic/projects/dovo-studio',branch:'main',gitIdentity:'github.com/dovo/studio'},{id:'remote-notes',kind:'folder',name:'Project notes',path:'/home/dominic/notes',branch:''}]},defaults,runtimeHost:'Linux workstation'},connected:true}]:[])],request,flush:async()=>{}};
        const displayed=task&&{...task,messages:pending?.destination==='thread'&&!task.messages.some(m=>m.id===pending.message.id)?[...task.messages,pending.message]:task.messages};
        return <Context.Provider value={value}>{settings?<section className="mx-auto max-w-3xl space-y-6 px-6 py-8"><h1 className="text-xl font-semibold">Task defaults</h1><p className="text-sm text-muted-foreground">Project: dovo-studio · All computers</p><TaskDefaultSettings inline repository={repositories[1]} scope="project"/></section>:<main style={{height:'100dvh'}} className="flex min-h-0 flex-col bg-background text-foreground"><header className="flex h-12 shrink-0 items-center border-b px-4 text-sm">{task?.title??'New task'}</header><section className="flex min-h-0 flex-1 flex-col" data-saved={!!task}>{task?<><ChatThread task={displayed} pending={pending}/><Composer key={task.id} task={task} onPending={setPending}/></>:<StartupDraft onProject={()=>{}} onCommit={task=>setId(task.id)}/>}</section></main>}</Context.Provider>
      }
      createRoot(document.getElementById('app')).render(<TooltipProvider><App/></TooltipProvider>);
    `,
    resolveDir: root + 'packages/studio-ui/',
    loader: 'tsx',
  },
  plugins: [
    {
      name: 'layout-environment',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, ({ path }) =>
          Object.hasOwn(mocks, path) ? { path, namespace: 'layout-environment' } : undefined,
        )
        builder.onLoad({ filter: /.*/, namespace: 'layout-environment' }, ({ path }) => ({
          contents: mocks[path],
          resolveDir: root + 'packages/studio-ui/',
          loader: 'tsx',
        }))
      },
    },
  ],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  loader: { '.css': 'empty' },
  define: { 'process.env.NODE_ENV': '"production"' },
})
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ deviceScaleFactor: 2 })
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('http://layout.test/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html class="dark" data-chat-width="focused"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="app"></div></body></html>',
    }),
  )
  await page.goto('http://layout.test/')
  await page.addStyleTag({ content: css })
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const geometry = () =>
    page.evaluate(() => {
      const hero = document.querySelector('h2').getBoundingClientRect()
      const composer = document.querySelector('.studio-composer').getBoundingClientRect()
      return {
        heroX: hero.x + hero.width / 2,
        heroY: hero.y + hero.height / 2,
        composerY: composer.y,
        composerHeight: composer.height,
        subtitleSize: getComputedStyle(document.querySelector('h2+p')).fontSize,
        overflow: document.documentElement.scrollWidth > innerWidth,
      }
    })
  for (const device of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile', width: 390, height: 844 },
    { name: 'small-mobile', width: 320, height: 700 },
  ]) {
    await page.setViewportSize(device)
    for (const project of ['No project', 'dovo-studio', 'Design notes']) {
      await page.evaluate(() => window.reset())
      await page.locator('[data-saved="false"]').waitFor()
      if (project !== 'No project') {
        await page.getByRole('button', { name: 'Task project', exact: true }).click()
        await page.getByRole('button', { name: project, exact: true }).click()
      }
      await page.waitForFunction(() =>
        document
          .querySelector('[aria-label="Choose agent and model"]')
          .textContent.includes('GPT-6.1-Sol'),
      )
      const before = await geometry()
      const input = page.getByRole('textbox', { name: 'Message task' })
      if (device.name === 'desktop' && project === 'No project') {
        await input.focus()
        await input.pressSequentially('Make both composers uniform using this styling.', {
          delay: 1,
        })
      } else await input.fill('Make both composers uniform using this styling.')
      await page.locator('[data-saved="true"]').waitFor()
      await page.getByRole('heading', { name: 'What would you like to work on?' }).waitFor()
      const after = await geometry()
      for (const key of ['heroX', 'heroY', 'composerY', 'composerHeight'])
        assert(
          Math.abs(before[key] - after[key]) < 2,
          project + ' ' + device.name + ' moved ' + key + ': ' + JSON.stringify({ before, after }),
        )
      assert.equal(after.subtitleSize, '14px')
      assert.equal(after.overflow, false)
      assert(after.heroY > device.height / 4)
      assert(after.composerY + after.composerHeight > device.height - 120)
      assert.equal(await input.inputValue(), 'Make both composers uniform using this styling.')
      assert(await input.evaluate((element) => document.activeElement === element))
      assert.equal(
        await page.getByRole('button', { name: 'Working directory', exact: true }).count(),
        project === 'dovo-studio' ? 1 : 0,
      )
      if (screenshots && project === 'dovo-studio' && device.name !== 'small-mobile')
        await page.screenshot({ path: screenshots + '/' + device.name + '-before-task.png' })
      await page.locator('.studio-composer button[type="submit"]').click()
      await page
        .waitForFunction(() => window.task?.status === 'running')
        .catch(async (cause) => {
          throw new Error(
            JSON.stringify({
              errors,
              state: await page.evaluate(() => ({
                task: window.task,
                requests: window.requests,
                text: document.body.textContent,
              })),
            }) +
              '\n' +
              cause.message,
          )
        })
      await page.getByRole('button', { name: 'Stop', exact: true }).waitFor()
      assert.equal(
        await page.getByRole('heading', { name: 'What would you like to work on?' }).count(),
        0,
      )
      assert(await page.getByRole('button', { name: 'Task project', exact: true }).isDisabled())
      assert.equal(await input.inputValue(), '')
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      )
      if (screenshots && project === 'dovo-studio' && device.name !== 'small-mobile')
        await page.screenshot({ path: screenshots + '/' + device.name + '-task-started.png' })
    }
  }
  // A transcript with unloaded history must keep its loading/error path, not show a new-task hero.
  await page.evaluate(() =>
    window.setTask({ status: 'draft', messages: [], historyBefore: 'earlier' }),
  )
  assert.equal(
    await page.getByRole('heading', { name: 'What would you like to work on?' }).count(),
    0,
  )
  if (screenshots) {
    for (const device of [
      { name: 'desktop', width: 1440, height: 900 },
      { name: 'mobile', width: 390, height: 844 },
    ]) {
      await page.setViewportSize(device)
      await page.evaluate(() => {
        window.reset()
        window.setMultiple(false)
      })
      await page.locator('[data-saved="false"]').waitFor()
      await page.getByRole('button', { name: 'Task project', exact: true }).click()
      await page.getByRole('textbox', { name: 'Search projects' }).waitFor()
      assert.equal(await page.getByRole('button', { name: 'Task server', exact: true }).count(), 0)
      await page.screenshot({
        path: screenshots + '/' + device.name + '-single-server-projects.png',
      })
      await page.keyboard.press('Escape')
      await page.evaluate(() => window.setMultiple(true))
      await page.getByRole('button', { name: 'Task project', exact: true }).click()
      await page.getByRole('button', { name: 'Project notes', exact: true }).waitFor()
      await page.screenshot({
        path: screenshots + '/' + device.name + '-all-projects.png',
      })
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      )
      await page.getByRole('textbox', { name: 'Search projects' }).fill('notes')
      assert.equal(
        await page.getByRole('button', { name: 'No project', exact: true }).isVisible(),
        true,
      )
      await page.screenshot({ path: screenshots + '/' + device.name + '-searched-projects.png' })
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: 'Task server', exact: true }).click()
      await page.getByRole('dialog', { name: 'Choose a server' }).waitFor()
      await page.screenshot({ path: screenshots + '/' + device.name + '-server-choice.png' })
      await page.keyboard.press('Escape')
    }
  }
  if (screenshots) {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.evaluate(() => window.showSettings())
    await page.getByRole('button', { name: 'Default server', exact: true }).waitFor()
    await page.waitForFunction(() =>
      document
        .querySelector('[aria-label="Default server"]')
        ?.textContent.includes('Linux workstation'),
    )
    await page.screenshot({ path: screenshots + '/desktop-project-default-server.png' })
  }
  assert.deepEqual(errors, [])
  console.log(
    'Composer layout: project/no-project/folder drafts stay centered on commit at desktop, phone and 320px; send, checkout locking, history and overflow checks passed.',
  )
} finally {
  await browser.close()
}
