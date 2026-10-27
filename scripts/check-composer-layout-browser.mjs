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
    const preferences={sendWith:'enter',themePalette:'dovo',codeTheme:'app',importedCodeThemes:[],markdownComposerPreview:false,followUp:'queue',confirmStop:false};
    window.setFollowUp=value=>{preferences.followUp=value};
    export const useAppPreferences=()=>preferences;
    export const readAppPreferences=()=>preferences;
  `,
  '@dovo/studio-core/state': `export {useState as useApplicationState} from 'react';`,
  '@dovo/extension-scm/project-transfer': 'export const ProjectTransferDialog=()=>null;',
  '@dovo/extension-scm/repository-dialog': `export const RepositoryDialog=()=>null;`,
  './use-attachments': `export const useAttachments=()=>({files:[],previews:[],uploading:[],busy:false,error:'',upload:async()=>{},remove:()=>{}});`,
  './task-activity': `import {useState} from 'react';const tools=[];export const useTaskActivity=()=>{const [error,setError]=useState('');window.setActivityError=setError;return {tools,error}};export {TaskActivity} from '../extension-tasks/src/chat/thread/task-activity';`,
}
// Keep the production conversation/composer shell; unrelated review surfaces are boundaries.
mocks['../chat/thread-sharing'] =
  'export const ThreadSharing=()=>null;export const InlineThreadSuggestions=()=>null;'
mocks['../chat/thread/use-task-viewed'] = 'export const useTaskViewed=()=>({error:null});'
for (const [path, name] of [
  ['../chat/thread/task-questions', 'TaskQuestions'],
  ['../chat/actions/run-controls', 'RunControls'],
  ['../chat/thread/preparation-progress', 'PreparationProgress'],
  ['../chat/thread/review-comments-tray', 'ReviewCommentsTray'],
  ['../chat/thread/plan-approval', 'PlanApproval'],
  ['../chat/thread/review-findings', 'ReviewFindings'],
  ['../review/code-review-card', 'CodeReviewCard'],
  ['../dialogs/task-pull-link-dialog', 'TaskPullLinkDialog'],
])
  mocks[path] = `export const ${name}=()=>null;`
const built = await build({
  stdin: {
    contents: `
      import {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {Context,defaultTaskHarness} from '@dovo/studio-core';
      import {TooltipProvider,TaskDefaultSettings} from '@dovo/studio-ui';
      import {StartupDraft} from '../extension-tasks/src/task-creation/startup-draft';
      import {TaskConversation} from '../extension-tasks/src/detail/task-conversation';
      import {ComposerActivity} from '../extension-tasks/src/chat/composer/composer-activity';
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
        const [activity,setActivity]=useState(false);window.setActivity=setActivity;const [activityPaused,setActivityPaused]=useState(true);window.setActivityPaused=setActivityPaused;
        const [settings,setSettings]=useState(false);window.showSettings=()=>setSettings(true);window.hideSettings=()=>setSettings(false);
        const task=workspace.tasks.find(task=>task.id===id);
        window.task=task;window.reset=()=>{setId(null);setPending(null);setWorkspace({repositories,agents:[],tasks:[],automations:[]})};
        window.setTask=update=>setWorkspace(w=>({...w,tasks:w.tasks.map(t=>t.id===id?{...t,...update}:t)}));
        const request=async(path,input)=>{
          window.requests.push({path,input});
          if(path==='/api/agents/settings/read')return {value:{taskDefaults:{defaultServerId:'linux'}},inherited:{taskDefaults:{}},projectKey:'project:github.com/dovo/studio'};
          if(path==='/api/agents/models/cached')return null;
          if(path==='/api/agents/models')return {models:[{id:'gpt-6.1-sol',name:'GPT-6.1-Sol',isDefault:true,defaultReasoning:'xhigh',reasoning:[{id:'xhigh',name:'Extra High'}]}],reasoning:[]};
          if(path==='/api/agents/availability')return [{id:'harness:codex',available:true}];
          if(path==='/api/scm/branches')return {current:'main',branches:[{name:'main',ref:'refs/heads/main'}]};
          if(path==='/api/tasks/title')return {title:'Unify the composers'};
          if(path==='/api/tasks/message'||path==='/api/tasks/steer'){
            setWorkspace(w=>({...w,tasks:w.tasks.map(t=>t.id===input.id?{...t,status:'running',messages:[{id:input.messageId,role:'user',text:input.text,createdAt:new Date().toISOString()}]}:t)}));
            return {ok:true};
          }
          throw Error('Unexpected request '+path);
        };
        const value={workspace,setWorkspace,snapshot:{workspace,defaults,questions:[],acpInstallations:[]},connected:true,activeRuntimeId:'mac',connection:profile.connection,runtimeRegistry:{profiles:multiple?[profile,remoteProfile]:[profile]},runtimes:[{profile,snapshot:{workspace,defaults,acpInstallations:[],runtimeHost:'MacBook'},connected:true},...(multiple?[{profile:remoteProfile,snapshot:{workspace:{...workspace,repositories:[{id:'remote-scratch',kind:'scratch',name:'Thread folder',path:'/private/remote',branch:''},{id:'remote-git',name:'dovo-studio',path:'/home/dominic/projects/dovo-studio',branch:'main',gitIdentity:'github.com/dovo/studio'},{id:'remote-notes',kind:'folder',name:'Project notes',path:'/home/dominic/notes',branch:''}]},defaults,acpInstallations:[],runtimeHost:'Linux workstation'},connected:true}]:[])],request,flush:async()=>{}};
        const renderThread=(task,workspaceControls,temporary)=><TaskConversation task={task} workspaceControls={workspaceControls} temporary={temporary} visible onReview={()=>{}}/>;
        return <Context.Provider value={value}>{activity?<ComposerActivity task={{id:'activity',title:'Activity preview',repositoryId:'git',agentId:'agent',status:activityPaused?'review':'running',messages:[],queuePaused:activityPaused,queue:[{id:'preview',role:'user',text:'Follow up'}],nativeTodos:[{text:'Verify work',status:'in-progress'}]}}/>:settings?<section className="mx-auto max-w-3xl space-y-6 px-6 py-8"><h1 className="text-xl font-semibold">Task defaults</h1><p className="text-sm text-muted-foreground">Project: dovo-studio · All computers</p><TaskDefaultSettings inline repository={repositories[1]} scope="project"/></section>:<main style={{height:'100dvh'}} className="flex min-h-0 flex-col bg-background text-foreground"><header className="flex h-12 shrink-0 items-center border-b px-4 text-sm">{task?.title??'New task'}</header><section className="flex min-h-0 flex-1 flex-col" data-saved={!!task}>{task?renderThread(task):<StartupDraft renderThread={renderThread} onProject={()=>{}} onCommit={task=>setId(task.id)}/>}</section></main>}</Context.Provider>
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
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.error(error)
  })
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
    { name: 'short-window', width: 900, height: 520 },
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
      if (screenshots && device.name === 'desktop' && project === 'No project')
        await page.screenshot({ path: screenshots + '/desktop-empty.png' })
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
      if (device.name === 'desktop') {
        const bar = await page
          .getByRole('group', { name: 'Project and checkout', exact: true })
          .boundingBox()
        assert.ok(bar && bar.height <= 44, JSON.stringify(bar))
      }
      for (const key of ['heroX', 'heroY', 'composerY', 'composerHeight'])
        assert(
          Math.abs(before[key] - after[key]) < 2,
          project + ' ' + device.name + ' moved ' + key + ': ' + JSON.stringify({ before, after }),
        )
      assert.equal(after.subtitleSize, '14px')
      assert.equal(after.overflow, false)
      assert(after.heroY > 48)
      assert(after.composerY > after.heroY)
      assert(after.composerY + after.composerHeight < device.height - 40)
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
  // The queue mirrors the inset project strip, with compaction outside both surfaces.
  await page.evaluate(() =>
    window.setTask({
      repositoryId: 'git',
      status: 'running',
      draft: 'Continue the review',
      contextUsage: { used: 190000, limit: 200000, updatedAt: new Date().toISOString() },
      queue: [
        {
          id: 'queued-layout',
          role: 'user',
          text:
            'Review the remaining files and verify the changes. '.repeat(8) +
            '\nCheck the second paragraph too',
          turnSettings: { model: 'review-model' },
          createdAt: new Date().toISOString(),
        },
      ],
    }),
  )
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    const compact = await page
      .getByRole('button', { name: 'Compact context', exact: true })
      .boundingBox()
    if (await page.getByRole('button', { name: 'Collapse composer activity', exact: true }).count())
      await page.getByRole('button', { name: 'Collapse composer activity', exact: true }).click()
    const queue = await page
      .getByRole('button', { name: 'Expand composer activity', exact: true })
      .boundingBox()
    const queueStrip = await page
      .getByRole('region', { name: 'Composer activity', exact: true })
      .boundingBox()
    const composer = await page.locator('.studio-composer').boundingBox()
    const project = await page
      .getByRole('group', { name: 'Project and checkout', exact: true })
      .boundingBox()
    assert.ok(compact.y + compact.height <= queue.y)
    assert.ok(queue.height <= 32, JSON.stringify(queue))
    assert.ok(
      Math.abs(queueStrip.x - project.x) < 1 && Math.abs(queueStrip.width - project.width) < 1,
    )
    assert.ok(
      Math.abs(queueStrip.y + queueStrip.height - 12 - composer.y) < 2,
      JSON.stringify({ queue, composer }),
    )
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    )
    await page.getByRole('button', { name: 'Expand composer activity', exact: true }).click()
    const queuedRow = page.locator('[aria-label="Queued follow-ups"] li').first()
    const rowBounds = await queuedRow.boundingBox()
    assert.ok(rowBounds.height <= 36, JSON.stringify(rowBounds))
    const preview = queuedRow.locator('span[title]').first()
    assert.equal(
      await preview.evaluate((element) => getComputedStyle(element).whiteSpace),
      'nowrap',
    )
    assert.ok(await preview.evaluate((element) => element.scrollWidth > element.clientWidth))
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    )
    if (screenshots) await page.screenshot({ path: screenshots + '/queue-row-' + width + '.png' })
    await page.getByRole('button', { name: 'Collapse composer activity', exact: true }).click()
    assert.equal(await page.getByRole('button', { name: 'Fork', exact: true }).count(), 0)
    assert.equal(await page.getByRole('button', { name: 'Steer agent', exact: true }).count(), 0)
    await page.getByRole('button', { name: 'More message actions', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Steer agent' }).waitFor()
    await page.getByRole('menuitem', { name: 'Fork', exact: true }).waitFor()
    if (screenshots) await page.screenshot({ path: screenshots + '/queue-split-' + width + '.png' })
    await page.keyboard.press('Escape')
  }
  await page.evaluate(() => {
    window.setFollowUp('steer')
    window.setTask({})
  })
  await page.getByRole('button', { name: 'Steer agent', exact: true }).waitFor()
  await page.getByRole('button', { name: 'More message actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Queue follow-up' }).waitFor()
  assert.equal(await page.getByRole('menuitem', { name: 'Steer agent' }).count(), 0)
  await page.keyboard.press('Escape')
  // Alt previews and submits the alternative for either saved default, without
  // changing the preference or inverting Alt+Enter a second time.
  const followUpInput = page.getByRole('textbox', { name: 'Message task', exact: true })
  for (const defaultMode of ['queue', 'steer']) {
    await page.evaluate((mode) => {
      window.setFollowUp(mode)
      window.setTask({ status: 'running', activeRunId: 'alt-follow-up-run' })
    }, defaultMode)
    await followUpInput.fill('Keep this draft while choosing an action')
    const defaultLabel = defaultMode === 'steer' ? 'Steer agent' : 'Queue follow-up'
    const alternateLabel = defaultMode === 'steer' ? 'Queue follow-up' : 'Steer agent'
    await page.getByRole('button', { name: defaultLabel, exact: true }).waitFor()
    await page.keyboard.down('Alt')
    const alternateButton = page.getByRole('button', { name: alternateLabel, exact: true })
    await alternateButton.waitFor()
    assert.match(await alternateButton.getAttribute('title'), /Alt\+Enter/)
    assert.equal(await followUpInput.inputValue(), 'Keep this draft while choosing an action')
    await page.keyboard.up('Alt')
    await page.getByRole('button', { name: defaultLabel, exact: true }).waitFor()
    // Losing focus without receiving keyup must not leave the alternate action stuck.
    await page.keyboard.down('Alt')
    await alternateButton.waitFor()
    await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    await page.getByRole('button', { name: defaultLabel, exact: true }).waitFor()
    await page.keyboard.up('Alt')
    // Ctrl+Alt (including AltGr) retains the default action.
    await page.keyboard.down('Control')
    await page.keyboard.down('Alt')
    await page.getByRole('button', { name: defaultLabel, exact: true }).waitFor()
    await page.keyboard.up('Alt')
    await page.keyboard.up('Control')
    for (const activation of ['click', 'enter']) {
      await followUpInput.fill(`Alternate ${defaultMode} via ${activation}`)
      const before = await page.evaluate(() => window.requests.length)
      await page.keyboard.down('Alt')
      await alternateButton.waitFor()
      if (activation === 'click') await alternateButton.click()
      else await followUpInput.press('Enter')
      await page.keyboard.up('Alt')
      await page.waitForFunction(
        (before) =>
          window.requests
            .slice(before)
            .some((request) => /\/tasks\/(message|steer)$/.test(request.path)),
        before,
      )
      const sent = await page.evaluate(
        (before) =>
          window.requests
            .slice(before)
            .filter((request) => /\/tasks\/(message|steer)$/.test(request.path)),
        before,
      )
      assert.equal(sent.length, 1, 'One submission per action')
      assert.equal(
        sent[0].path,
        defaultMode === 'steer' ? '/api/tasks/message' : '/api/tasks/steer',
      )
      assert.equal(sent[0].input.runId, defaultMode === 'queue' ? 'alt-follow-up-run' : undefined)
      await page.waitForFunction(() => document.querySelector('textarea')?.value === '')
    }
    await followUpInput.fill('Default restored')
    await page.getByRole('button', { name: defaultLabel, exact: true }).waitFor()
    await page.keyboard.down('Alt')
    await alternateButton.waitFor()
    await page.evaluate(() => window.setTask({ status: 'review', activeRunId: undefined }))
    await page.getByRole('button', { name: 'Send to agent', exact: true }).waitFor()
    await page.keyboard.up('Alt')
  }
  await page.evaluate(() => {
    window.setFollowUp('queue')
    window.setTask({ queue: [], contextUsage: undefined })
  })
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
        await page.getByRole('button', { name: 'General', exact: true }).isVisible(),
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
    await page.getByRole('button', { name: 'Preferred computer', exact: true }).waitFor()
    await page.waitForFunction(() =>
      document
        .querySelector('[aria-label="Preferred computer"]')
        ?.textContent.includes('Linux workstation'),
    )
    await page.screenshot({ path: screenshots + '/desktop-project-default-server.png' })
  }
  // Keep counts, status indicators and collapse reachable in the narrow header.
  await page.evaluate(() => window.setActivity(true))
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    for (const fontSize of [16, 20]) {
      await page.evaluate((size) => {
        document.documentElement.style.fontSize = size + 'px'
      }, fontSize)
      const queue = page.getByRole('tab', { name: 'Queue · 1 · Paused', exact: true })
      const checklist = page.getByRole('tab', { name: 'Checklist · 0/1 · Unfinished', exact: true })
      const collapse = page.getByRole('button', { name: 'Collapse composer activity', exact: true })
      await queue.waitFor()
      for (const control of [queue, checklist, collapse]) {
        const box = await control.boundingBox()
        assert.ok(
          box.width > 0 && box.x >= 0 && box.x + box.width <= width,
          JSON.stringify({ width, fontSize, box }),
        )
      }
      const header = page
        .getByLabel('Composer activity', { exact: true })
        .locator(':scope > div')
        .first()
      const geometry = () =>
        header.locator('button').evaluateAll((nodes) =>
          nodes.map((node) => {
            const { x, y, width, height } = node.getBoundingClientRect()
            return { x, y, width, height }
          }),
        )
      const pausedGeometry = await geometry()
      await page.evaluate(() => window.setActivityPaused(false))
      await page.getByRole('tab', { name: 'Queue · 1', exact: true }).waitFor()
      assert.deepEqual(
        await geometry(),
        pausedGeometry,
        'Pause and unfinished indicators do not shift the activity header',
      )
      await page.evaluate(() => window.setActivityPaused(true))
      await queue.waitFor()
      assert.deepEqual(await geometry(), pausedGeometry)
      await collapse.click()
      const progress = page.getByRole('progressbar', { name: 'Checklist completion', exact: true })
      await progress.waitFor()
      assert.equal(await progress.getAttribute('aria-valuenow'), '0')
      if (screenshots)
        await page.screenshot({
          path: screenshots + '/activity-' + width + '-' + fontSize + '.png',
        })
      await checklist.click()
      await collapse.waitFor()
    }
  }
  // Light mode, draft-only starters, and errors in an otherwise empty saved draft.
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.evaluate(() => {
    window.setActivity(false)
    window.hideSettings()
    window.reset()
    document.documentElement.style.fontSize = '16px'
    document.documentElement.classList.remove('dark')
    document.documentElement.dataset.theme = 'light'
  })
  await page.getByRole('button', { name: 'Build something', exact: true }).waitFor()
  if (screenshots) await page.screenshot({ path: screenshots + '/desktop-empty-light.png' })
  const sentBefore = await page.evaluate(
    () => window.requests.filter((r) => r.path === '/api/tasks/message').length,
  )
  await page.getByRole('button', { name: 'Build something', exact: true }).click()
  const draftInput = page.getByRole('textbox', { name: 'Message task', exact: true })
  assert.equal(await draftInput.inputValue(), 'Help me build ')
  assert(await draftInput.evaluate((node) => document.activeElement === node))
  assert.equal(
    await page.evaluate(
      () => window.requests.filter((r) => r.path === '/api/tasks/message').length,
    ),
    sentBefore,
  )
  await page.evaluate(() => window.setActivityError('Activity fixture unavailable'))
  await page.getByRole('alert').filter({ hasText: 'Activity fixture unavailable' }).waitFor()
  assert.equal(await page.locator('[data-thread-start]').count(), 0)
  assert.deepEqual(errors, [])
  console.log(
    'Composer layout: project/no-project/folder drafts stay centered on commit at desktop, phone and 320px; send, checkout locking, history and overflow checks passed.',
  )
} finally {
  await browser.close()
}
