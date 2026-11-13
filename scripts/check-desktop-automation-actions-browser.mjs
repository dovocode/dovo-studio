import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
// realDialogs: the real portaled Radix dialog and the real Studio UI tool handler.
const bundle = (realDialogs) =>
  bundleBrowser(
    {
      stdin: {
        resolveDir: root,
        loader: 'tsx',
        contents: `
import {useState} from 'react';import {createRoot} from 'react-dom/client';
import {decode,RuntimeRequestError,taskHarnessSchema,threadActionSchema,threadActionResultSchema,automationActionSendSchema,threadActionReviewSchema} from '@dovo/protocol';
import {ThreadActionCard} from './packages/extension-tasks/src/chat/thread/thread-action-card';
import {executeStudioUI} from './packages/studio-shell/src/studio-tools-ui';
window.studioUI=command=>{try{return executeStudioUI(document,command)}catch(error){return {error:error.message}}};
const stamp='2026-11-12T00:00:00Z';
const node=(id,kind,label,data={})=>({id,type:'automation',position:{x:0,y:0},data:{kind,label,trigger:'manual',schedule:'',timezone:'Europe/Amsterdam',objective:'',agentId:'agent-1',repositoryId:'project',harness:{provider:'codex',env:{API_TOKEN:'SECRET-HARNESS-VALUE'}},...data}});
const workflow=(objective,enabled=true)=>({id:'nightly',name:'Nightly review',enabled,nodes:[node('start','trigger','Start',{trigger:'schedule',schedule:'0 9 * * 1-5'}),node('triage','task','Triage issues',{objective,botId:'bot-1',execution:'worktree'}),node('fix','task','Fix failures',{objective:'Fix the failing checks.',execution:'worktree'})],edges:[{id:'e1',source:'start',target:'triage'},{id:'e2',source:'triage',target:'fix'}]});
const resources=[{nodeId:'triage',label:'Triage issues',botId:'bot-1',botName:'Release Bot',execution:'main',repositoryId:'project',repositoryName:'Project',projects:[{id:'project',name:'Project',path:'/project'},{id:'docs',name:'Docs',path:'/docs'}],agent:{name:'Reviewer',provider:'claude',model:'claude-opus-5-5',reasoning:'high',permission:'read-only'}},{nodeId:'fix',label:'Fix failures',execution:'worktree',repositoryId:'project',repositoryName:'Project',projects:[{id:'project',name:'Project',path:'/project'}],agent:{provider:'codex',model:'gpt-5',permission:'workspace-write',approvalPolicy:'on-request',sandboxMode:'workspace-write'}}];
const automation=(revision,objective,enabled)=>({automationId:'nightly',revision,workflow:workflow(objective,enabled),resources});
const action=(id,extra={})=>decode(threadActionSchema,{id,key:id,title:'Run nightly review',prompt:'Agent suggested context',runId:'run-1',state:'prepared',createdAt:stamp,updatedAt:stamp,automation:automation('rev-1','Triage open issues.'),...extra});
window.calls=[];window.routes=[];window.mode={};
const reply=(base,extra)=>({action:{...base,...extra},revision:2,runtimeInstanceId:'owner-instance'});
const runtime=(id)=>({connected:true,activeRuntimeId:id,connection:{address:'http://'+id+'.lan',token:'paired-'+id},runtimeRegistry:{profiles:[]},snapshot:{runtimeId:id,threadActionsSupported:true,permissionPolicySupported:true},workspace:{agents:[],repositories:[{id:'project',name:'Project',path:'/project'}],automations:[]},refreshRuntimes:async()=>{},request:async(path,input,schema)=>{
  window.calls.push({runtime:id,path,input:JSON.parse(JSON.stringify(input))});
  const base=window.actions.find(item=>item.id===input.actionId);
  if(path==='/api/thread-actions/review'){decode(threadActionReviewSchema,input);return decode(schema,reply(base,{automation:automation('rev-2','Triage open issues and label them.'),updatedAt:'2026-11-12T00:02:00Z'}))}
  if(path==='/api/thread-actions/dismiss')return decode(schema,reply(base,{state:'dismissed'}));
  if(path!=='/api/thread-actions/send')throw Error(path);
  decode(automationActionSendSchema,input);
  if(window.mode.hold)await new Promise(resolve=>window.releases.push(resolve));
  if(window.mode.lost){window.mode.lost=false;throw new RuntimeRequestError({kind:'connection',message:'Start reply lost'})}
  if(window.mode.stale){window.mode.stale=false;throw new RuntimeRequestError({kind:'response',status:409,mutationRejected:true,message:'The automation changed. Review it again.'})}
  return decode(schema,reply(base,{state:'sent',updatedAt:'2026-11-12T00:03:00Z',automationSent:{runId:'job-run-'+input.actionId,sentAt:stamp}}));
}});
window.releases=[];window.runtimeFor=runtime;window.cardStore=runtime('owner');
window.actions=[action('first'),action('second'),action('paused',{automation:automation('rev-p','Paused work.',false)}),action('legacy',{automation:undefined,title:'Legacy new thread'})];window.reviewed=window.actions;
function App(){const[show,setShow]=useState('first');const[,render]=useState(0);window.show=setShow;window.rerender=()=>render(value=>value+1);
const source={id:'source-thread',title:'Coordinator',repositoryId:'project',agentId:'',harness:decode(taskHarnessSchema,{provider:'codex',model:'m',permission:'read-only',instructions:'',endpoint:''}),execution:'main',messages:[]};
const item=window.actions.find(entry=>entry.id===show);
// Same card instance across runtime switches: busy, errors and replies must follow their own scope.
return <><button>Outside control</button>{item?<ThreadActionCard key={item.id} task={source} action={item}/>:null}</>}
createRoot(document.getElementById('app')).render(<App/>);
`,
      },
      bundle: true,
      write: false,
      format: 'iife',
      platform: 'browser',
      jsx: 'automatic',
      nodePaths: [root + 'packages/studio-ui/node_modules', root + 'packages/web-ui/node_modules'],
      alias: {
        react: root + 'packages/studio-ui/node_modules/react',
        'react-dom': root + 'packages/studio-ui/node_modules/react-dom',
        '@dovo/protocol': root + 'packages/protocol/src/index.ts',
      },
      define: { 'process.env.NODE_ENV': '"development"' },
    },
    [
      {
        path: '@dovo/studio-core/state',
        contents: `export {useState as useApplicationState} from 'react';`,
      },
      {
        path: '@dovo/studio-core',
        contents: `export * from '@dovo/protocol';export const sameWorkspaceFields=()=>true;export const useWorkspaceSelector=selector=>selector(window.cardStore);export {createTask} from './packages/studio-core/src/workspace/actions';export const useStudioHost=()=>({navigate:route=>window.routes.push(route)});export const useWorkspace=()=>window.cardStore;`,
      },
      {
        path: '@dovo/studio-ui',
        contents: `
import {useId,cloneElement,isValidElement} from 'react';
const Box=({children})=><div>{children}</div>;
export {permissionPolicyUIIssue} from './packages/studio-ui/src/permission-policy-fields';
export const HarnessFields=()=>null;
export const Button=({children,variant,size,...props})=><button {...props}>{children}</button>;
export const Textarea=props=><textarea {...props}/>;
export const FormField=({label,children})=>{const id=useId();return <div><label htmlFor={id}>{label}</label>{isValidElement(children)?cloneElement(children,{id}):children}</div>};
${
  realDialogs
    ? "export {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from './packages/web-ui/src/dialog';"
    : 'export const Dialog=({children,open})=>open?<section role="dialog">{children}</section>:null;export const DialogContent=Box,DialogHeader=Box,DialogTitle=Box,DialogDescription=Box;'
}
`,
      },
    ],
  )
const built = await bundle(false)
const gateBuilt = await bundle(true)
const enabled = (page, name) =>
  page.waitForFunction(
    (name) =>
      [...document.querySelectorAll('button')].some(
        (item) => (item.getAttribute('aria-label') ?? item.textContent) === name && !item.disabled,
      ),
    name,
  )
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.error(error.stack)
  })
  await page.setContent('<main id="app"></main>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const calls = () => page.evaluate(() => window.calls)
  const context = page.getByLabel('Automation run context', { exact: true })
  const start = (name = 'Start') => page.getByRole('button', { name, exact: true })

  // Preparation and review start no work. The review shows the exact saved workflow.
  await page.getByText('Automation · Nightly review', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Review and Start', exact: true }).click()
  assert.deepEqual(await calls(), [])
  const dialog = page.getByRole('dialog')
  for (const text of [
    'Schedule 0 9 * * 1-5 (Europe/Amsterdam)',
    'Triage open issues.',
    'Fix the failing checks.',
    'Release Bot',
    'Reviewer · claude · claude-opus-5-5 · high',
    'read-only',
    'workspace-write · approval on-request · sandbox workspace-write',
    'New worktree',
    'Start → Triage issues',
    'Triage issues → Fix failures',
  ])
    await dialog.getByText(text, { exact: true }).waitFor()
  await dialog.getByText('Docs', { exact: false }).first().waitFor()
  // Saved node harness, agent and checkout fields never reach the review.
  assert.equal(await page.getByText('SECRET-HARNESS-VALUE').count(), 0)
  assert.equal(
    await page.evaluate(() => JSON.stringify(window.reviewed).includes('SECRET-HARNESS-VALUE')),
    false,
  )
  // Bot steps show the Bot's effective execution, not the dormant saved node setting.
  const triage = dialog.getByLabel('Step 2: Triage issues', { exact: true })
  await triage.getByText('Main checkout', { exact: true }).waitFor()
  assert.equal(await triage.getByText('New worktree', { exact: true }).count(), 0)
  await triage.getByText('Message to Bot', { exact: true }).waitFor()
  await triage
    .getByRole('note')
    .getByText(/Bot’s own current settings and resources/)
    .waitFor()
  const fix = dialog.getByLabel('Step 3: Fix failures', { exact: true })
  await fix.getByText('New worktree', { exact: true }).waitFor()
  assert.equal(await fix.getByRole('note').count(), 0)
  assert.equal(await page.getByRole('link').count(), 0, 'No link can start the automation')

  // Pending project selectors describe a choice at start; explicit harnesses stay concrete.
  for (const [mode, label] of [
    ['auto', 'Tune · Model chosen at start'],
    ['smart', 'Maestro · Model chosen at start'],
    ['inherit', 'Inherit · Project model applied at start'],
  ]) {
    await page.evaluate((mode) => {
      window.actions = window.actions.map((action) =>
        action.id === 'first'
          ? {
              ...action,
              automation: {
                ...action.automation,
                resources: action.automation.resources.map((resource) =>
                  resource.nodeId === 'fix'
                    ? { ...resource, agent: { ...resource.agent, modelSelection: mode } }
                    : resource,
                ),
              },
            }
          : action,
      )
      window.rerender()
    }, mode)
    await fix.getByText(label, { exact: true }).waitFor()
    assert.equal(await fix.getByText('codex · gpt-5', { exact: true }).count(), 0)
    await fix
      .getByText('workspace-write · approval on-request · sandbox workspace-write', { exact: true })
      .waitFor()
    await triage.getByText('Reviewer · claude · claude-opus-5-5 · high', { exact: true }).waitFor()
  }
  await page.evaluate(() => {
    window.actions = window.actions.map((action) =>
      action.id === 'first'
        ? {
            ...action,
            automation: {
              ...action.automation,
              resources: action.automation.resources.map((resource) =>
                resource.nodeId === 'fix'
                  ? { ...resource, agent: { ...resource.agent, modelSelection: undefined } }
                  : resource,
              ),
            },
          }
        : action,
    )
    window.rerender()
  })
  await fix.getByText('codex · gpt-5', { exact: true }).waitFor()

  // Run-only context is editable and survives close and remount.
  await context.fill('Human context: only the release branch')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.evaluate(() => window.show(''))
  await page.evaluate(() => window.show('first'))
  await page.getByRole('button', { name: 'Review and Start', exact: true }).click()
  assert.equal(await context.inputValue(), 'Human context: only the release branch')

  // An uncertain reply freezes the exact payload until Retry resolves it.
  await page.evaluate(() => (window.mode.lost = true))
  await start().evaluate((button) => {
    button.click()
    button.click()
  })
  await dialog.getByText('Start reply lost', { exact: true }).waitFor()
  assert.equal((await calls()).length, 1, 'Double click sends once')
  assert.equal(await context.isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: 'Refresh review', exact: true }).count(), 0)
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.evaluate(() => window.show(''))
  await page.evaluate(() => window.show('first'))
  await page.getByRole('button', { name: 'Review and Start', exact: true }).click()
  assert.equal(await context.isDisabled(), true, 'Frozen payload survives remount')
  await start('Retry Start').click()
  await page.getByRole('button', { name: 'Open automation run', exact: true }).waitFor()
  let sends = (await calls()).filter((call) => call.path.endsWith('/send'))
  assert.equal(sends.length, 2)
  assert.deepEqual(sends[0].input, sends[1].input)
  assert.deepEqual(sends[0].input, {
    sourceTaskId: 'source-thread',
    actionId: 'first',
    revision: 'rev-1',
    text: 'Human context: only the release branch',
  })
  await page.getByRole('button', { name: 'Open automation run', exact: true }).click()
  assert.deepEqual(await page.evaluate(() => window.routes.at(-1)), {
    viewId: 'jobs',
    entityId: 'job-run-first',
    automationTarget: { runtimeId: 'owner', automationId: 'nightly', runId: 'job-run-first' },
  })

  // A definite stale rejection keeps the edited context and requires a review refresh.
  await page.evaluate(() => window.show('second'))
  await page.getByRole('button', { name: 'Review and Start', exact: true }).click()
  await context.fill('Second context')
  await page.evaluate(() => (window.mode.stale = true))
  await start().click()
  await dialog.getByText('The automation changed. Review it again.', { exact: true }).waitFor()
  assert.equal(await context.isDisabled(), false)
  assert.equal(await context.inputValue(), 'Second context')
  assert.equal(await start().isDisabled(), true, 'Stale review cannot start')
  await page.getByRole('button', { name: 'Refresh review', exact: true }).click()
  await dialog.getByText('Triage open issues and label them.', { exact: true }).waitFor()
  assert.equal(await context.inputValue(), 'Second context')
  await context.fill('Second context, edited after refresh')
  await start().click()
  await page.getByRole('button', { name: 'Open automation run', exact: true }).waitFor()
  sends = (await calls()).filter(
    (call) => call.input.actionId === 'second' && call.path.endsWith('/send'),
  )
  assert.deepEqual(
    sends.map((call) => [call.input.revision, call.input.text]),
    [
      ['rev-1', 'Second context'],
      ['rev-2', 'Second context, edited after refresh'],
    ],
  )

  // A runtime switch while a start is pending: the new scope is usable at once, the late reply
  // changes neither its draft nor its busy state, and the old scope recovers its own receipt.
  const review = page.getByRole('button', { name: 'Review and Start', exact: true })
  const switchTo = (id) =>
    page.evaluate((id) => {
      window.cardStore = window.runtimeFor(id)
      window.rerender()
    }, id)
  await page.evaluate(() => {
    window.actions[1] = { ...window.actions[1], id: 'late', key: 'late' }
    window.show('late')
  })
  await review.click()
  await context.fill('Owner context')
  await page.evaluate(() => (window.mode.hold = true))
  await start().click()
  await page.waitForFunction(() => window.releases.length === 1)
  await start('Starting…').waitFor()
  await switchTo('other')
  await enabled(page, 'Review and Start') // Pending owner start does not lock other runtime
  await review.click()
  assert.equal(await context.inputValue(), 'Agent suggested context', 'Drafts stay per runtime')
  await context.fill('Other runtime draft')
  await start().click()
  await page.waitForFunction(() => window.releases.length === 2)
  await page.evaluate(() => {
    window.mode.hold = false
    window.releases[0]()
  })
  await page.waitForTimeout(100)
  assert.equal(
    await context.inputValue(),
    'Other runtime draft',
    'Late reply keeps the newer draft',
  )
  await start('Starting…').waitFor()
  assert.equal(
    await page.getByRole('button', { name: 'Open automation run', exact: true }).count(),
    0,
  )
  await page.evaluate(() => window.releases[1]())
  await page.getByRole('button', { name: 'Open automation run', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Open automation run', exact: true }).click()
  assert.equal(
    (await page.evaluate(() => window.routes.at(-1))).automationTarget.runtimeId,
    'other',
  )
  assert.deepEqual(
    (await calls())
      .filter((call) => call.input.actionId === 'late')
      .map((call) => [call.runtime, call.input.text]),
    [
      ['owner', 'Owner context'],
      ['other', 'Other runtime draft'],
    ],
  )
  await switchTo('owner')
  await page.getByRole('button', { name: 'Open automation run', exact: true }).click()
  assert.equal(
    (await page.evaluate(() => window.routes.at(-1))).automationTarget.runtimeId,
    'owner',
  )
  // A third runtime starts clean: not busy, no receipt, no error, no foreign draft.
  await switchTo('third')
  await enabled(page, 'Review and Start')
  assert.equal(await page.getByRole('alert').count(), 0)
  await review.click()
  assert.equal(await context.inputValue(), 'Agent suggested context')
  assert.equal(await start().isDisabled(), false)
  await page.getByRole('button', { name: 'Close', exact: true }).click()

  // A paused automation shows its state and cannot start.
  await page.evaluate(() => window.show('paused'))
  await page.getByRole('button', { name: 'Review and Start', exact: true }).click()
  await dialog
    .getByText('This automation is paused. Resume it in Automations, then refresh the review.', {
      exact: true,
    })
    .waitFor()
  assert.equal(await start().isDisabled(), true)
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click()
  await page.locator('[data-thread-action]').waitFor({ state: 'detached' })

  // Cards without an automation snapshot keep the editable new-thread flow.
  await page.evaluate(() => window.show('legacy'))
  await page.getByRole('button', { name: 'Review and Send', exact: true }).click()
  await page.getByLabel('New thread prompt', { exact: true }).waitFor()
  assert.equal(await page.getByLabel('New thread project', { exact: true }).inputValue(), 'project')
  // Paired human consent: the real Studio UI handler cannot press Send/Start or type in the
  // cards or their real portaled dialogs.
  const gate = await browser.newPage()
  gate.setDefaultTimeout(10000)
  gate.on('pageerror', (error) => errors.push(error.message))
  await gate.setContent('<main id="app"></main>')
  await gate.addScriptTag({ content: gateBuilt.outputFiles[0].text })
  await gate.evaluate(() => {
    window.calls = []
    window.show('legacy')
  })
  const tool = (command) => gate.evaluate((command) => window.studioUI(command), command)
  const control = async (label) => {
    const snapshot = await tool({ action: 'snapshot' })
    const found = snapshot.controls.filter((item) => item.label.trim() === label)
    assert.equal(found.length, 1, `One ${label} control`)
    return found[0]
  }
  const denied = async (label, command) => {
    const item = await control(label)
    assert.equal(item.humanOnly, true, `${label} is human-only`)
    assert.deepEqual(await tool({ ...command, selector: item.selector }), {
      error: 'This control requires human review',
    })
  }
  const outside = await control('Outside control')
  assert.equal(outside.humanOnly, false)
  assert.deepEqual(await tool({ action: 'click', selector: outside.selector }), { ok: true })
  await denied('Review and Send', { action: 'click' })
  await denied('Dismiss', { action: 'click' })
  await gate.getByRole('button', { name: 'Review and Send', exact: true }).click()
  const portal = gate.locator('[role="dialog"][data-studio-human-only]')
  await portal.waitFor()
  assert.equal(
    await portal.evaluate((element) => !!element.closest('[data-thread-action]')),
    false,
    'The dialog is portaled outside the card',
  )
  await denied('Send', { action: 'click' })
  await denied('New thread prompt', { action: 'type', text: 'Agent text' })
  await gate.getByRole('button', { name: 'Send', exact: true }).focus()
  assert.deepEqual(await tool({ action: 'key', key: 'Enter' }), {
    error: 'This control requires human review',
  })
  await gate.keyboard.press('Escape')
  await portal.waitFor({ state: 'detached' })
  await gate.evaluate(() => window.show('first'))
  await gate.getByRole('button', { name: 'Review and Start', exact: true }).waitFor()
  await denied('Review and Start', { action: 'click' })
  await gate.getByRole('button', { name: 'Review and Start', exact: true }).click()
  await portal.waitFor()
  await denied('Start', { action: 'click' })
  await denied('Refresh review', { action: 'click' })
  await denied('Automation run context', { action: 'type', text: 'Agent text' })
  assert.equal(
    await gate.getByLabel('Automation run context', { exact: true }).inputValue(),
    'Agent suggested context',
  )
  assert.deepEqual(
    await gate.evaluate(() => window.calls),
    [],
    'No tool action reached the runtime',
  )
  assert.deepEqual(errors, [])
  console.log(
    'Desktop automation action cards: no work on review, exact workflow/agents/projects/access, run-only context drafts, frozen retry, stale refresh with retained context, late-reply isolation, owner-runtime navigation, paused gate, legacy new-thread routing and human-only Studio UI denial in real portaled dialogs pass. Transport and UI primitives are fixtures.',
  )
} finally {
  await browser.close()
}
