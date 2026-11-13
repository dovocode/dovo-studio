import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
import {useState} from 'react';import {createRoot} from 'react-dom/client';
import {decode,resourceSettingsSchema,botResourcesSchema,taskHarnessSchema,threadActionSendSchema} from '@dovo/protocol';
import {ThreadActionCard} from './packages/extension-tasks/src/chat/thread/thread-action-card';
import {ThreadActionEditor} from './packages/extension-tasks/src/chat/thread/thread-action-editor';
import {BotResourceEditor} from './packages/extension-tasks/src/bots/bot-resource-editor';
window.saves=[];window.failSave=false;window.dispatchCalls=[];window.cardRoute=null;
const inherited=decode(resourceSettingsSchema,{mcpServers:[{name:'shared',transport:'stdio',command:'shared-command',enabled:true}],skills:[{name:'shared-skill',description:'Shared instructions',content:'Shared body',enabled:true}]});
const initial=decode(botResourcesSchema,{mcpServers:[{name:'existing',transport:'stdio',command:'node',enabled:true,envValues:{API_TOKEN:'dovo-stored-secret:opaque'}}],hooks:[{name:'keep',event:'after-turn',command:'check',enabled:true,timeoutSeconds:120}]});
function App(){const [value,setValue]=useState(initial);const [action,setAction]=useState(false);const [card,setCard]=useState(false);window.showCard=setCard;window.editAction=setAction;window.resources=value;
const source={id:'source-bot',title:'Coordinator',repositoryId:'project',agentId:'',harness:decode(taskHarnessSchema,{provider:'codex',model:'source-model',permission:'workspace-write',instructions:'',endpoint:''}),execution:'main',bot:{resources:value}};
const prepared={id:'prepared-action',key:'release',title:'Review release',prompt:'Check the release',runId:'turn',state:'prepared',createdAt:'2026-11-12T00:00:00Z',updatedAt:'2026-11-12T00:00:00Z'};
window.cardStore={connected:true,activeRuntimeId:'owner',connection:{address:'http://owner.lan',token:'paired'},runtimeRegistry:{profiles:[]},snapshot:{runtimeId:'owner',threadActionsSupported:window.actionSupported===false?undefined:true,permissionPolicySupported:true},workspace:{agents:[],repositories:[{id:'project',name:'Project',path:'/project'},{id:'other-project',name:'Other project',path:'/other'},{id:'dovo:scratch',kind:'scratch',name:'No project',path:'/scratch'}]},refreshRuntimes:async()=>{},request:async(path,input)=>{
 window.dispatchCalls.push({path,input:JSON.parse(JSON.stringify(input))});
 if(path.endsWith('/send')){decode(threadActionSendSchema,input);if(window.failDispatch){window.failDispatch=false;throw Error('Dispatch reply lost')}return {action:{...prepared,state:'sent',sent:{taskId:input.createTask.id,messageId:input.messageId,sentAt:'2026-11-12T00:00:00Z'}},revision:1,runtimeInstanceId:'owner'}}
 return {action:{...prepared,state:'dismissed'},revision:1,runtimeInstanceId:'owner'};
}};
return card?<ThreadActionCard task={source} action={prepared}/>:action?<ThreadActionEditor draftKey='owner:action' initial={{repositoryId:'project',prompt:'Suggested work',harness:decode(taskHarnessSchema,{provider:'codex',model:'initial',permission:'workspace-write',instructions:'',endpoint:''})}} onClose={()=>setAction(false)} onSend={async input=>{window.actionSends??=[];window.actionSends.push(input);if(window.delayAction)await new Promise(resolve=>window.resolveAction=resolve);if(window.failAction)throw Error('Send response lost')}}/>:<BotResourceEditor value={value} inherited={inherited} disabled={false} onChange={async next=>{if(window.failSave)throw Error('Resource conflict');window.saves.push(next);setValue(next)}}/>}
createRoot(document.getElementById('app')).render(<App/>);
`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    nodePaths: [root + 'packages/studio-ui/node_modules'],
    alias: {
      react: root + 'packages/studio-ui/node_modules/react',
      'react-dom': root + 'packages/studio-ui/node_modules/react-dom',
      '@dovo/protocol': root + 'packages/protocol/src/index.ts',
      '@dovo/studio-ui/resource-editors': root + 'packages/studio-ui/src/resource-editors.ts',
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
      contents: `export * from '@dovo/protocol';export const sameWorkspaceFields=()=>true;export const useWorkspaceSelector=selector=>selector(window.cardStore);export {createTask} from './packages/studio-core/src/workspace/actions';export const useStudioHost=()=>({navigate:route=>window.cardRoute=route});export const useWorkspace=()=>window.cardStore??({connected:true,snapshot:{permissionPolicySupported:true},request:async()=>({})});`,
    },
    {
      path: '@dovo/studio-ui',
      contents: `
import {useId,cloneElement,isValidElement} from 'react';
const Box=({children})=><div>{children}</div>;
export {permissionPolicyUIIssue} from './packages/studio-ui/src/permission-policy-fields';
export const HarnessFields=({value,onChange})=><div><label>Action harness<select aria-label="Action harness" value={value.provider} onChange={event=>onChange({...value,provider:event.target.value})}><option value='codex'>Codex</option><option value='claude'>Claude</option></select></label><label>Action model<input aria-label="Action model" value={value.model} onChange={event=>onChange({...value,model:event.target.value})}/></label></div>;
export const Button=({children,variant,size,...props})=><button {...props}>{children}</button>;
export const Input=props=><input {...props}/>;export const Textarea=props=><textarea {...props}/>;
export const Switch=({checked,onCheckedChange,...props})=><input {...props} type="checkbox" checked={checked} onChange={event=>onCheckedChange(event.target.checked)}/>;
export const FormField=({label,children})=>{const id=useId();return <div><label htmlFor={id}>{label}</label>{isValidElement(children)?cloneElement(children,{id}):children}</div>};
export const Dialog=({children,open})=>open?<section role="dialog">{children}</section>:null;
export const DialogContent=Box,DialogHeader=Box,DialogTitle=Box,DialogDescription=Box,Disclosure=Box;
export const Select=Box,SelectContent=Box,SelectItem=Box,SelectTrigger=Box,SelectValue=Box;
`,
    },
  ],
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
  await page.getByRole('button', { name: 'Edit MCP existing', exact: true }).click()
  await page.getByText('Configured · value hidden', { exact: true }).waitFor()
  assert.equal(await page.getByLabel('Value for API_TOKEN', { exact: true }).count(), 0)
  await page.getByLabel('Command', { exact: true }).fill('new-command')
  await page.getByRole('button', { name: 'Save server', exact: true }).click()
  await page.waitForFunction(() => window.resources.mcpServers[0].command === 'new-command')
  assert.equal(
    await page.evaluate(() => window.resources.mcpServers[0].envValues.API_TOKEN),
    'dovo-stored-secret:opaque',
  )
  await page.getByLabel('Enable Bot MCP shared', { exact: true }).uncheck()
  await page.waitForFunction(() => window.resources.disabledMcpServers.includes('shared'))
  await page.getByLabel('Enable Bot MCP shared', { exact: true }).check()
  await page.waitForFunction(() => !window.resources.disabledMcpServers.includes('shared'))
  await page.getByRole('button', { name: 'Add Bot skill', exact: true }).click()
  await page.getByLabel('Name', { exact: true }).fill('release')
  await page.getByLabel('When to use', { exact: true }).fill('Release instructions')
  await page.getByLabel('Instructions', { exact: true }).fill('Run release checks')
  await page.evaluate(() => (window.failSave = true))
  await page.getByRole('button', { name: 'Save skill', exact: true }).click()
  await page.getByRole('dialog').getByText('Resource conflict', { exact: true }).waitFor()
  assert.equal(
    await page.getByLabel('Instructions', { exact: true }).inputValue(),
    'Run release checks',
  )
  await page.evaluate(() => (window.failSave = false))
  await page.getByRole('button', { name: 'Save skill', exact: true }).click()
  await page.waitForFunction(() =>
    window.resources.skills.some((skill) => skill.name === 'release'),
  )
  await page.getByLabel('Enable Bot skill shared-skill', { exact: true }).uncheck()
  await page.waitForFunction(() => window.resources.disabledSkills.includes('shared-skill'))
  assert.equal(await page.evaluate(() => Object.hasOwn(window.resources, 'hooks')), false)
  await page.evaluate(() => window.editAction(true))
  assert.equal(
    await page.evaluate(() => window.actionSends?.length ?? 0),
    0,
    'Preparing and opening starts no work',
  )
  await page.getByLabel('New thread project', { exact: true }).selectOption('dovo:scratch')
  await page.getByLabel('New thread prompt', { exact: true }).fill('Human edited work')
  await page.getByLabel('Action harness', { exact: true }).selectOption('claude')
  await page.getByLabel('Action model', { exact: true }).fill('human-model')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.evaluate(() => window.editAction(true))
  assert.equal(
    await page.getByLabel('New thread prompt', { exact: true }).inputValue(),
    'Human edited work',
  )
  await page.evaluate(() => (window.failAction = true))
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await page.getByText('Send response lost', { exact: true }).waitFor()
  assert.equal(await page.getByLabel('New thread prompt', { exact: true }).isDisabled(), true)
  await page.evaluate(() => (window.failAction = false))
  await page.getByRole('button', { name: 'Retry Send', exact: true }).click()
  await page.waitForFunction(() => window.actionSends.length === 2)
  const sends = await page.evaluate(() => window.actionSends)
  assert.deepEqual(sends[0], sends[1])
  assert.equal(sends[0].repositoryId, 'dovo:scratch')
  assert.equal(sends[0].harness.provider, 'claude')
  assert.equal(sends[0].harness.model, 'human-model')
  await page.evaluate(() => {
    window.delayAction = true
    window.editAction(true)
  })
  await page.getByLabel('New thread prompt', { exact: true }).fill('Delayed old editor')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await page.waitForFunction(() => !!window.resolveAction)
  await page.evaluate(() => window.editAction(false))
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await page.evaluate(() => window.editAction(true))
  await page.getByRole('dialog').waitFor()
  await page.evaluate(() => {
    window.delayAction = false
    window.resolveAction()
  })
  assert.equal(
    await page.getByRole('dialog').count(),
    1,
    'Late completion cannot close a reopened editor',
  )
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.evaluate(() => window.showCard(true))
  await page.getByRole('button', { name: 'Review and Send', exact: true }).click()
  assert.equal(await page.evaluate(() => window.dispatchCalls.length), 0)
  assert.equal(
    await page.getByLabel('New thread project', { exact: true }).inputValue(),
    'project',
    'Default destination is the source backing project',
  )
  await page.getByLabel('New thread prompt', { exact: true }).fill('Human-approved release work')
  await page.getByLabel('New thread project', { exact: true }).selectOption('other-project')
  await page.getByLabel('Action model', { exact: true }).fill('chosen-model')
  await page.evaluate(() => (window.failDispatch = true))
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await page.getByText('Dispatch reply lost', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Retry Send', exact: true }).click()
  await page.getByText('Sent', { exact: true }).waitFor()
  const dispatch = await page.evaluate(() => window.dispatchCalls)
  assert.equal(dispatch.length, 2)
  assert.deepEqual(dispatch[0].input, dispatch[1].input)
  assert.equal(dispatch[0].input.createTask.repositoryId, 'other-project')
  assert.equal(dispatch[0].input.createTask.harness.model, 'chosen-model')
  assert.equal(dispatch[0].input.text, 'Human-approved release work')
  assert.equal(
    Object.hasOwn(dispatch[0].input.createTask, 'bot'),
    false,
    'Ordinary worker does not inherit Bot memory/resources',
  )
  assert.equal(Object.hasOwn(dispatch[0].input.createTask, 'threadActions'), false)
  await page.getByRole('button', { name: 'Open sent thread', exact: true }).click()
  assert.equal(
    await page.evaluate(() => window.cardRoute.entityId),
    dispatch[0].input.createTask.id,
  )
  await page.evaluate(() => {
    window.showCard(false)
    window.actionSupported = false
  })
  await page.locator('[data-thread-action]').waitFor({ state: 'hidden' })
  await page.evaluate(() => window.showCard(true))
  await page.locator('[data-thread-action]').waitFor({ state: 'hidden' })
  assert.equal(
    await page.locator('[data-thread-action]').count(),
    0,
    'Old runtimes hide action controls',
  )
  await page.evaluate(() => {
    window.showCard(false)
    window.actionSupported = true
  })
  await page.locator('[data-thread-action]').waitFor({ state: 'hidden' })
  await page.evaluate(() => window.showCard(true))
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click()
  await page.waitForFunction(() =>
    window.dispatchCalls.some((call) => call.path.endsWith('/dismiss')),
  )
  assert.equal(await page.locator('[data-thread-action]').count(), 0)
  assert.deepEqual(errors, [])
  console.log(
    'Desktop Bot resources: actual MCP/skill/credential editors, stored-secret preservation, inherited disable/reset, own skill save, conflict draft retention, human-reviewed new-thread dispatch, exact payload replay and sent-thread navigation passed. Transport and UI primitives are fixtures.',
  )
} finally {
  await browser.close()
}
