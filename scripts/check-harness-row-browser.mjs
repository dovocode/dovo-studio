import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const mobile = root + 'apps/mobile/src/'
const desktop = root + 'packages/studio-ui/src/'
const native = `
export const View=({children,accessibilityLabel})=><div aria-label={accessibilityLabel}>{children}</div>;
export const Text=({children})=><span>{children}</span>;
export const Pressable=({children,onPress,disabled,accessibilityLabel,accessibilityState})=><button aria-label={accessibilityLabel} aria-pressed={accessibilityState?.selected} disabled={disabled} onClick={onPress}>{children}</button>;
export const Choice=({label,items,value,onChange})=><select aria-label={label} value={value} onChange={e=>onChange(e.target.value)}>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>;
export const SearchField=({label,value,onChangeText})=><input aria-label={label} value={value} onChange={e=>onChangeText(e.target.value)}/>;
export const Action=({label,onPress})=><button onClick={onPress}>{label}</button>;
export const Icon=()=>null;export const HarnessIcon=()=>null;export const Switch=()=>null;
export const useTheme=()=>({styles:{},colors:{}});
`
const browser = await chromium.launch()
try {
  for (const platform of ['desktop', 'mobile']) {
    const isMobile = platform === 'mobile'
    const stubs = isMobile
      ? [
          { path: 'react-native', contents: native },
          ...[
            '../ui/controls/action',
            '../ui/controls/choice',
            '../ui/controls/field',
            '../ui/controls/icon',
            '../ui/controls/switch',
            '../ui/content/text',
            '../ui/theme',
            './harness-icon',
          ].map((path) => ({ path, importer: mobile + 'agents/', contents: native })),
          {
            path: '../runtime/connection/provider',
            importer: mobile + 'agents/',
            contents: 'export const useRuntime=()=>window.store;',
          },
          {
            path: './use-model-catalog',
            importer: mobile + 'agents/',
            contents:
              'export const useModelCatalog=agent=>({catalog:window.catalog(agent),modelName:agent.model,canDiscover:true,loading:false,refresh(){}});',
          },
        ]
      : [
          {
            path: '@dovo/studio-core',
            contents: `export * from '@dovo/protocol';export {providers} from '${root}packages/studio-core/src/providers.ts';export const useWorkspace=()=>window.store;`,
          },
          {
            path: '@dovo/studio-core/state',
            contents: "export {useState as useApplicationState} from 'react';",
          },
          {
            path: './use-harness-availability',
            importer: desktop,
            contents:
              'export const useHarnessAvailability=()=>({claudeAutoLimits:new Map(),available:window.available,loading:false,sandboxNotes:[],refresh(){}});',
          },
          {
            path: './harness-catalog',
            importer: desktop,
            contents:
              'export const useHarnessCatalog=agent=>({catalog:window.catalog(agent),loading:false,refresh(){}});',
          },
        ]
    const built = await bundleBrowser(
      {
        stdin: {
          resolveDir: root,
          loader: 'tsx',
          contents: `
import {useState} from 'react';import {createRoot} from 'react-dom/client';
import {defaultTaskHarness} from '@dovo/protocol';
import {taskHarnessChoices,selectedTaskHarness,harnessHandoffSelectionTask} from '${mobile}tasks/creation/harness-choices.ts';
import {${isMobile ? 'HarnessModelPicker' : 'ComposerModelPicker'} as Picker} from '${isMobile ? mobile + 'agents/harness-model-picker.tsx' : desktop + 'composer-model-picker.tsx'}';
${isMobile ? '' : `import {ComposerEffortColumn} from '${desktop}composer-model-options.tsx';`}
window.catalog=agent=>({models:[{id:'model',name:(agent.endpoint==='agy'?'Antigravity':'Registry agent')+' model',isDefault:agent.model==='model'}],reasoning:[{id:'low',name:'Low'},{id:'high',name:'High'}],acp:{modes:[{id:'code',name:'Code'},{id:'plan',name:'Plan'}],commands:[],configOptions:[{id:'agent_mode',name:'Agent mode',category:'mode',currentValue:'code',options:[{id:'code',name:'Code'},{id:'plan',name:'Plan'}]},{id:'model',name:'Model',category:'model',currentValue:agent.model||'old',options:[{id:'model',name:'Model'}]},{id:'thought',name:'Thought',category:'thought_level',currentValue:'low',options:[{id:'low',name:'Low'},{id:'high',name:'High'}]},{id:'toggle',name:'Toggle',currentValue:'true',options:[{id:'true',name:'On'},{id:'false',name:'Off'}]}]}});
const antigravity={...defaultTaskHarness('acp'),id:'dovo:antigravity',name:'Antigravity',endpoint:'agy',args:['acp'],env:{DOVO_PUBLIC_TEST:'kept'},acpConfig:{model:'old',thought:'low',toggle:'true',${isMobile ? '' : "agent_mode:'plan'"}}};
const agents=[antigravity,{...antigravity,id:'missing',name:'Unavailable ACP',endpoint:'missing'}];
const installation={id:'registry-agent',name:'Registry agent',command:'registry',args:['acp'],status:'installed'};
window.available=new Set(['harness:codex','harness:pi','harness:opencode','agent:dovo:antigravity','acp:registry-agent']);
window.store={connected:true,profile:{id:'computer',name:'Computer',connection:{address:'http://computer'}},snapshot:{acpInstallations:[installation]},request:async()=>({})};window.selections=[];
function App(){const[mode,setMode]=useState('empty');window.mode=setMode;const[value,setValue]=useState(defaultTaskHarness('opencode'));const[selection,setSelection]=useState('harness:opencode');
const source={id:'task',title:'Thread',status:mode==='empty'?'draft':'review',agentId:'',harness:defaultTaskHarness('opencode'),providerLock:mode==='switch'?'opencode':undefined,messages:mode==='switch'?[{id:'old',role:'user',text:'Keep history'}]:[],files:[],draft:'Keep draft'};
const task=mode==='switch'?harnessHandoffSelectionTask(source,{...source.harness,id:'task',name:'OpenCode'}):source;
const pick=(id,agent)=>{window.selections.push({id,agent,mode});setSelection(id);setValue(agent);return Promise.resolve(true)};
return ${isMobile ? `<Picker key={mode} task={task} agents={agents} choices={taskHarnessChoices(task,agents,[installation],{},window.available)} selection={selection} agent={{...value,id:'task',name:'Selected'}} disabled={false} onChange={pick}/>` : `<Picker key={mode} value={value} disabled={false} agents={agents} onChange={next=>pick('model',next)} onConfigure={()=>{}} onUseHarness={next=>pick('harness',next)} onSelectAgent={id=>pick(id,agents.find(agent=>agent.id===id))} settings={<ComposerEffortColumn value={value} catalog={window.catalog(value)} automatic={false} onChange={next=>pick('reasoning',next)} disabled={false} loading={false} error=""/>}/>`};};createRoot(document.getElementById('app')).render(<App/>);
`,
        },
        bundle: true,
        write: false,
        format: 'iife',
        jsx: 'automatic',
        platform: 'browser',
        alias: {
          react: root + 'packages/studio-ui/node_modules/react',
          'react-dom': root + 'packages/studio-ui/node_modules/react-dom',
          '@dovo/protocol': root + 'packages/protocol/src/index.ts',
        },
        nodePaths: [root + 'node_modules', root + 'packages/studio-ui/node_modules'],
      },
      stubs,
    )
    const page = await browser.newPage({ viewport: { width: isMobile ? 390 : 1280, height: 844 } })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setContent('<div id="app"></div>')
    await page.addScriptTag({ content: built.outputFiles[0].text })
    for (const mode of ['empty', 'switch']) {
      await page.evaluate((mode) => window.mode(mode), mode)
      if (!isMobile)
        await page.getByRole('button', { name: 'Choose agent and model', exact: true }).click()
      const row = page.getByLabel('Harnesses', { exact: true })
      const labels = await row
        .getByRole('button')
        .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label')))
      assert.deepEqual(
        labels,
        isMobile
          ? ['Codex', 'OpenCode', 'Pi', 'Registry agent · ACP', 'Antigravity · ACP']
          : [
              'Codex models',
              'OpenCode models',
              'Pi models',
              'Antigravity models',
              'Registry agent models',
            ],
      )
      assert.equal(await row.getByRole('button', { name: /Unavailable|Claude/ }).count(), 0)
      await row
        .getByRole('button', {
          name: isMobile ? 'Antigravity · ACP' : 'Antigravity models',
          exact: true,
        })
        .click()
      await page
        .getByRole(isMobile ? 'button' : 'option', { name: 'Antigravity model', exact: true })
        .click()
      if (isMobile) await page.getByLabel('Reasoning level', { exact: true }).selectOption('high')
      else {
        await page.getByRole('radio', { name: 'High', exact: true }).click()
        assert.equal(await page.getByLabel('ACP Model', { exact: true }).count(), 0)
        assert.equal(await page.getByLabel('ACP Thought', { exact: true }).count(), 0)
        assert.equal(await page.getByLabel('ACP Toggle', { exact: true }).count(), 1)
        assert.equal(await page.getByLabel('ACP Agent mode', { exact: true }).count(), 0)
        const mode = page.getByRole('button', { name: 'ACP mode', exact: true })
        assert.equal(await mode.getAttribute('data-value'), 'plan')
        await mode.click()
        await page.getByRole('option', { name: 'Code', exact: true }).click()
        assert.equal(await page.evaluate(() => window.selections.at(-1).agent.acpMode), 'code')
        await mode.click()
        await page.getByRole('option', { name: 'Provider default', exact: true }).click()
        assert.equal(await page.evaluate(() => window.selections.at(-1).agent.acpMode), undefined)
      }
      await page.waitForFunction(
        (mode) =>
          window.selections.some((item) => item.mode === mode && item.agent.endpoint === 'agy'),
        mode,
      )
      const chosen = await page.evaluate(() => window.selections.at(-1).agent)
      assert.equal(chosen.provider, 'acp')
      assert.equal(chosen.endpoint, 'agy')
      assert.equal(chosen.model, 'model')
      assert.equal(chosen.reasoning, 'high')
      assert.deepEqual(chosen.acpConfig, { toggle: 'true' })
      assert.deepEqual(chosen.args, ['acp'])
      assert.deepEqual(chosen.env, { DOVO_PUBLIC_TEST: 'kept' })
      if (!isMobile) await page.keyboard.press('Escape')
    }
    assert.deepEqual(errors, [])
    await page.close()
    console.log(
      platform +
        ': all available harnesses, hidden unavailable choices, Pi and Antigravity selection passed for empty threads and switches.',
    )
  }
} finally {
  await browser.close()
}
