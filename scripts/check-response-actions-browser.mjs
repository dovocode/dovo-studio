import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const mobile = root + 'apps/mobile/src/'
const controls = `
export const Sheet=({title,children,footer})=><section role="dialog" aria-label={title}>{children}{footer}</section>;
export const useSheetNavigation=()=>work=>work();
export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;
export const Field=({label,value,onChangeText,editable})=><label>{label}<textarea aria-label={label.replace(/ \\*$/,'')} value={value} disabled={editable===false} onChange={event=>onChangeText(event.target.value)}/></label>;
export const Choice=({label,value,items,onChange,disabled})=><label>{label}<select aria-label={label} value={value} disabled={disabled} onChange={event=>onChange(event.target.value)}>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>;
export const useTheme=()=>({styles:{},colors:{}});
`
const browser = await chromium.launch()
try {
  for (const platform of ['desktop', 'mobile']) {
    const built = await bundleBrowser(
      {
        stdin: {
          resolveDir: root,
          loader: 'tsx',
          contents: `
import {executeStudioUI} from './packages/studio-shell/src/studio-tools-ui';
window.studioUI=command=>{try{return executeStudioUI(document,command)}catch(error){return {error:error.message}}};
import {useState} from 'react';import {createRoot} from 'react-dom/client';import {Effect} from 'effect';
import {decode,threadActionSchema,threadActionReviewSchema,responseActionSendSchema,RuntimeRequestError,resolveResponseAction} from '@dovo/protocol';
import {ResponseActionCard} from './${platform === 'desktop' ? 'packages/extension-tasks/src/chat/thread' : 'apps/mobile/src/tasks/conversation/components'}/response-action-card';
const stamp='2026-11-13T00:00:00Z';
const card=(id,response)=>decode(threadActionSchema,{id,key:id,title:id,prompt:'Suggested action',runId:'run',state:'prepared',createdAt:stamp,updatedAt:stamp,response});
window.cards=[card('prompt',{kind:'prompt',prompt:'Continue here'}),card('command',{kind:'command',command:'pnpm build'}),card('tool',{kind:'mcp',server:'release',tool:'publish',arguments:{name:'beta'}}),card('form',{kind:'form',description:'Release options',fields:[{id:'name',label:'Release name',type:'text',required:true},{id:'target',label:'Target',type:'choice',value:'beta',options:[{value:'beta',label:'Beta'},{value:'stable',label:'Stable'}]}],actions:[{id:'plan',title:'Plan release',action:{kind:'prompt',prompt:'Plan {{name}} for {{target}}'}},{id:'publish',title:'Publish',action:{kind:'mcp',server:'release',tool:'publish',arguments:{name:'{{name}}',target:'{{target}}'}}}]})];
window.calls=[];window.mode={};window.receipts={};window.terminals=[];
const request=async(path,input,schema)=>{
  window.calls.push({runtime:window.runtimeName,path,input:JSON.parse(JSON.stringify(input))});
  let action=window.receipts[input.actionId]??window.cards.find(item=>item.id===input.actionId);
  if(path==='/api/thread-actions/review'){
    decode(threadActionReviewSchema,input);
    if(action.state==='prepared')action={...action,updatedAt:'2026-11-13T01:00:00Z',responseReview:{revision:'rev-'+JSON.stringify(input.dispatch??{}),directory:'/project',description:'Exact reviewed action',resolved:resolveResponseAction(action.response,input.dispatch),...(input.dispatch?{dispatch:input.dispatch}:{})}};
    window.receipts[input.actionId]=action;
  }else if(path==='/api/thread-actions/send'){
    decode(responseActionSendSchema,input);
    if(window.mode.hold)await new Promise(resolve=>window.release=resolve);
    if(window.mode.lost){window.mode.lost=false;throw new RuntimeRequestError({kind:'connection',message:'Response lost'})}
    if(window.mode.stale){window.mode.stale=false;throw new RuntimeRequestError({kind:'response',status:409,mutationRejected:true,message:'Settings changed. Refresh review.'})}
    const resolved=action.responseReview.resolved;
    action={...action,state:'sent',updatedAt:'2026-11-13T02:00:00Z',...(resolved.kind==='prompt'?{sent:{taskId:'source',messageId:input.messageId,sentAt:stamp}}:{responseResult:{status:resolved.kind==='command'?'started':'completed',output:'Action accepted',...(resolved.kind==='command'?{terminalId:'term-1'}:{})}})};
    window.receipts[input.actionId]=action;
  }else if(path==='/api/thread-actions/dismiss'){action={...action,state:'dismissed'};window.receipts[input.actionId]=action}
  else throw Error(path);
  return decode(schema,{action,revision:2,runtimeInstanceId:'instance'});
};
window.runtimeName='owner';window.store={activeRuntimeId:'owner',connected:true,connection:{address:'http://owner.lan',token:'test-token'},snapshot:{runtimeId:'owner',responseActionsSupported:true},runtimeRegistry:{profiles:[]},request,refreshRuntimes:async()=>{}};
window.runtime={profile:{connection:window.store.connection},connected:true,snapshot:window.store.snapshot,callEffect:(...args)=>Effect.tryPromise({try:()=>request(...args),catch:error=>error})};
function App(){const[which,setWhich]=useState('prompt');const[show,setShow]=useState(true);const[,render]=useState(0);window.show=setWhich;window.render=()=>render(value=>value+1);window.remount=()=>{setShow(false);setTimeout(()=>setShow(true),10)};const action=window.cards.find(item=>item.id===which);return show?<ResponseActionCard task={{id:'source',messages:[]}} action={action} onTerminal={id=>window.terminals.push(id)}/>:null}
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
          '@dovo/client-runtime': root + 'packages/client-runtime/src/index.ts',
        },
        define: { 'process.env.NODE_ENV': '"development"' },
      },
      platform === 'desktop'
        ? [
            {
              path: '@dovo/studio-core',
              contents:
                'export * from "@dovo/protocol";export const sameWorkspaceFields=()=>true;export const useWorkspaceSelector=selector=>selector(window.store);export const useWorkspace=()=>window.store;',
            },
            {
              path: '@dovo/studio-ui',
              contents: `export {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from './packages/web-ui/src/dialog';export const Button=({children,size,variant,...props})=><button {...props}>{children}</button>;export const FormField=({label,children})=><label>{label}{children}</label>;export const Textarea=props=><textarea {...props}/>;`,
            },
          ]
        : [
            {
              path: 'react-native',
              contents: `export const Platform={OS:'web'};export const StyleSheet={flatten:style=>style};export const useWindowDimensions=()=>({fontScale:1,width:390,height:844});export const Alert={alert(){}};export const View=({children})=><div>{children}</div>;export const Text=({children,accessibilityRole,...props})=><span role={accessibilityRole} aria-label={props.accessibilityLabel}>{children}</span>;`,
            },
            {
              path: 'expo-crypto',
              contents:
                'let id=0;export const randomUUID=()=>`00000000-0000-4000-8000-${String(++id).padStart(12,"0")}`;',
            },
            {
              path: '../../../runtime/connection/provider',
              importer: mobile + 'tasks/conversation/',
              contents: 'export const useRuntime=()=>window.runtime;',
            },
            {
              path: '../../runtime/state/application-state',
              importer: mobile + 'ui/',
              contents: 'export {useState as useApplicationState} from "react";',
            },
            ...[
              '../../../ui/controls/action',
              '../../../ui/controls/field',
              '../../../ui/controls/choice',
              '../../../ui/layout/sheet',
              '../../../ui/theme',
            ].map((path) => ({
              path,
              importer: mobile + 'tasks/conversation/',
              contents: controls,
            })),
          ],
    )
    const page = await browser.newPage({
      viewport: { width: platform === 'desktop' ? 1000 : 390, height: 850 },
    })
    page.setDefaultTimeout(10000)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setContent('<main id="app"></main>')
    await page.addScriptTag({ content: built.outputFiles[0].text })
    const button = (name) => page.getByRole('button', { name, exact: true })
    const sends = () =>
      page.evaluate(() => window.calls.filter((item) => item.path.endsWith('/send')))
    await button('Review prompt').click()
    assert.equal((await sends()).length, 0)
    await page
      .getByLabel(platform === 'desktop' ? 'Response prompt' : 'Prompt', { exact: true })
      .fill('Edited follow-up')
    await page.evaluate(() => {
      window.mode.lost = true
    })
    await button('Send to thread').click()
    try {
      await page.getByRole('alert').filter({ hasText: 'Response lost' }).waitFor()
    } catch (error) {
      console.error(
        await page.locator('body').innerText(),
        await page.evaluate(() => window.calls),
        errors,
      )
      throw error
    }
    await page.evaluate(() => window.remount())
    await button('Review prompt').click()
    const frozen = await sends()
    await button('Retry').click()
    await page.getByText('Sent to this thread', { exact: true }).waitFor()
    const retried = await sends()
    assert.deepEqual(retried.at(-1).input, frozen.at(-1).input)
    assert.equal(retried.at(-1).input.text, 'Edited follow-up')
    // A direct action shows exact details and opens its own terminal receipt.
    await page.evaluate(() => window.show('command'))
    await button('Review action').click()
    await page.getByRole('dialog').getByText('pnpm build', { exact: true }).waitFor()
    assert.equal((await sends()).length, 2)
    await button('Run action').click()
    await button('Open terminal').click()
    assert.deepEqual(await page.evaluate(() => window.terminals), ['term-1'])
    // Custom dialogs dispatch form values only after a separate native action review.
    await page.evaluate(() => window.show('form'))
    await button('Open form').click()
    assert.equal(await page.getByRole('dialog').count(), 1)
    await page.getByLabel('Release name', { exact: true }).fill('November')
    await page.getByLabel('Target', { exact: true }).selectOption('stable')
    const before = (await sends()).length
    if (platform === 'desktop') {
      const denied = await page.evaluate(() =>
        window.studioUI({
          action: 'input',
          selector: '[aria-label="Release name"]',
          text: 'Injected',
        }),
      )
      assert.match(denied.error, /requires human review/)
    }
    await button('Review Publish').click()
    await page.getByLabel('Exact action', { exact: true }).filter({ hasText: 'November' }).waitFor()
    assert.equal((await sends()).length, before)
    await page.getByLabel('Release name', { exact: true }).fill('December')
    assert.equal(await button('Run action').isDisabled(), true)
    await button('Review Publish').click()
    await page.getByLabel('Exact action', { exact: true }).filter({ hasText: 'December' }).waitFor()
    await page.evaluate(() => {
      window.mode.hold = true
    })
    await button('Run action').evaluate((element) => {
      element.click()
      element.click()
    })
    await page.waitForFunction(
      (count) => window.calls.filter((item) => item.path.endsWith('/send')).length === count,
      before + 1,
    )
    assert.equal(await button('Sending…').isDisabled(), true)
    await page.evaluate(() => {
      window.mode.hold = false
      window.release()
    })
    await page.getByText('Action accepted', { exact: true }).waitFor()
    const last = (await sends()).at(-1).input
    assert.match(last.revision, /December/)
    assert.equal(last.command, undefined)
    if (platform === 'desktop') {
      assert.equal(
        await page.locator('[data-thread-action="form"][data-studio-human-only="true"]').count(),
        1,
      )
    }
    assert.deepEqual(errors, [])
    console.log(
      `${platform} response actions: prompt retry, command receipt, native form review and duplicate taps pass`,
    )
    await page.close()
  }
} finally {
  await browser.close()
}
