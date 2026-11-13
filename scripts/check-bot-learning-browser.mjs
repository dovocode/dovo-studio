import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url)),
  mobile = root + 'apps/mobile/src/'
const controls = `import {useId,cloneElement} from 'react';
export const View=({children})=><div>{children}</div>;
export const Text=({children,accessibilityRole})=><span role={accessibilityRole}>{children}</span>;
export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;
export const Button=({children,size,variant,...props})=><button {...props}>{children}</button>;
export const Input=props=><input {...props}/>;
export const FormField=({label,children})=>{const id=useId();return <label htmlFor={id}>{label}{cloneElement(children,{id})}</label>};
export const SettingsField=({label,value,onChangeText,editable,placeholder})=><label>{label}<input aria-label={label} value={value} placeholder={placeholder} disabled={editable===false} onChange={e=>onChangeText(e.target.value)}/></label>;
export const SettingsAction=Action;
export const useTheme=()=>({styles:{muted:{},error:{}}});`
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
import {createRoot} from 'react-dom/client';import {useState} from 'react';import {Effect} from 'effect';
import {BotMemoryLearning as DesktopMemory} from './packages/extension-tasks/src/bots/bot-memory-learning';
import {BotMemoryLearning as MobileMemory} from './apps/mobile/src/bots/bot-memory-learning';
import {BotSkillProposals as DesktopSkills} from './packages/extension-tasks/src/bots/bot-skill-proposals';
import {BotSkillProposals as MobileSkills} from './apps/mobile/src/bots/bot-skill-proposals';
import {RoutineOptions as DesktopOptions} from './packages/extension-jobs/src/routine-options';
import {RoutineOptions as MobileOptions} from './apps/mobile/src/jobs/routine-options';
window.calls=[];window.memoryState={enabled:true,revision:'revision-a',running:false};window.changes=0;window.fail=false;
window.task={id:'bot-a',title:'Assistant',bot:{revision:'revision-a',updatedAt:'2026-11-13T00:00:00Z',skillProposals:[{id:'proposal-a',skill:{name:'review',description:'Review builds',content:'Check status'},patch:'+Check status',status:'pending'}]}};
const request=async(path,input)=>{window.calls.push({path,input});if(window.fail){window.fail=false;throw Error('Connection lost; retry safely')}if(path.endsWith('/read'))return window.memoryState;if(path.endsWith('/save'))return window.memoryState={...window.memoryState,enabled:input.enabled,revision:'revision-b'};if(path.endsWith('/run'))return window.memoryState={...window.memoryState,lastReviewedAt:'2026-11-13T01:00:00Z'};if(path.endsWith('/clear'))return window.memoryState={...window.memoryState,revision:'revision-c'};if(path.endsWith('/decide'))return {id:window.task.id,bot:{...window.task.bot,updatedAt:'2026-11-13T01:00:00Z',revision:'revision-b',skillProposals:window.task.bot.skillProposals.map(p=>({...p,status:input.accept?'applied':'rejected'}))}};throw Error(path)};
window.store={request,connected:true,snapshot:{botMemoryReviewSupported:true}};window.runtime={...window.store,callEffect:(path,input)=>Effect.tryPromise(()=>request(path,input))};
function App(){const [mode,setMode]=useState('desktop-memory');window.mode=setMode;const props={taskId:'bot-a',onChanged:()=>window.changes++};return <main key={mode}>{mode==='desktop-memory'?<DesktopMemory {...props}/>:mode==='mobile-memory'?<MobileMemory {...props}/>:mode==='desktop-skills'?<DesktopSkills task={window.task}/>:mode==='mobile-skills'?<MobileSkills task={window.task}/>:mode==='desktop-options'?<DesktopOptions flow={{id:'routine'}} disabled={false} onSave={value=>window.saved=value}/>:<MobileOptions flow={{id:'routine'}} disabled={false} onSave={value=>window.saved=value}/>}</main>}
createRoot(document.getElementById('app')).render(<App/>);`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    alias: {
      react: root + 'packages/studio-ui/node_modules/react',
      'react-dom': root + 'packages/studio-ui/node_modules/react-dom',
      '@dovo/protocol': root + 'packages/protocol/src/index.ts',
    },
    nodePaths: [root + 'packages/studio-ui/node_modules'],
    define: { 'process.env.NODE_ENV': '"production"' },
  },
  [
    {
      path: '@dovo/studio-core',
      contents:
        'export const useWorkspace=()=>window.store;export const useConfirmation=()=>async()=>true;',
    },
    { path: '@dovo/studio-ui', contents: controls },
    { path: 'react-native', contents: controls },
    {
      path: '../runtime/connection/provider',
      importer: mobile + 'bots/',
      contents: 'export const useRuntime=()=>window.runtime;',
    },
    { path: '../ui/content/text', importer: mobile, contents: controls },
    { path: '../ui/controls/action', importer: mobile + 'bots/', contents: controls },
    { path: '../ui/theme', importer: mobile, contents: controls },
    {
      path: '../../runtime/state/application-state',
      importer: mobile + 'ui/',
      contents: "export {useState as useApplicationState} from 'react';",
    },
    { path: '../screens/settings-controls', importer: mobile + 'jobs/', contents: controls },
  ],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }),
    errors = []
  page.setDefaultTimeout(10000)
  page.on('pageerror', (e) => errors.push(e.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  for (const platform of ['desktop', 'mobile']) {
    console.log(platform + ' memory')
    await page.evaluate((mode) => window.mode(mode), platform + '-memory')
    await page.getByRole('button', { name: 'Pause learning', exact: true }).click()
    await page.getByRole('button', { name: 'Enable learning', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Enable learning', exact: true }).click()
    await page.getByRole('button', { name: 'Review now', exact: true }).click()
    await page.waitForFunction(() => window.calls.some((c) => c.path.endsWith('/run')))
    await page.getByRole('button', { name: 'Clear memory', exact: true }).click()
    if (platform === 'mobile')
      await page.getByRole('button', { name: 'Confirm clear memory', exact: true }).click()
    await page.waitForFunction(() => window.calls.some((c) => c.path.endsWith('/clear')))
    await page.evaluate(() => (window.calls = []))
    console.log(platform + ' skills')
    await page.evaluate((mode) => window.mode(mode), platform + '-skills')
    assert.equal(await page.getByRole('button', { name: 'Apply skill', exact: true }).count(), 0)
    await page.getByRole('button', { name: 'Review skill diff', exact: true }).click()
    await page.getByText('+Check status', { exact: true }).waitFor()
    if (platform === 'desktop')
      assert.equal(await page.locator('[data-studio-human-only="true"]').count(), 1)
    await page.getByRole('button', { name: 'Apply skill', exact: true }).click()
    await page.waitForFunction(() => window.calls.some((c) => c.path.endsWith('/decide')))
    assert.equal(
      (await page.evaluate(() => window.calls.find((c) => c.path.endsWith('/decide')).input))
        .accept,
      true,
    )
    console.log(platform + ' options')
    await page.evaluate((mode) => window.mode(mode), platform + '-options')
    if (platform === 'desktop')
      await page.getByText('Monitoring and limits', { exact: true }).click()
    await page.getByLabel('Monitor source URL', { exact: true }).fill('http://computer.lan/status')
    await page.getByLabel('Estimated cost limit (USD)', { exact: true }).fill('0.25')
    await page.getByLabel('Quiet hours start', { exact: true }).fill('22:00')
    await page.getByLabel('Quiet hours end', { exact: true }).fill('07:00')
    await page.getByLabel('Quiet hours time zone', { exact: true }).fill('Europe/Amsterdam')
    await page.getByRole('button', { name: 'Save monitoring and limits', exact: true }).click()
    await page.waitForFunction(() => window.saved?.policy?.costUsd === 0.25)
    assert.equal(await page.evaluate(() => window.saved.monitor.url), 'http://computer.lan/status')
    await page.getByLabel('Token limit', { exact: true }).fill('-1')
    await page.getByRole('button', { name: 'Save monitoring and limits', exact: true }).click()
    await page.getByRole('alert').waitFor()
    await page.evaluate(() => {
      window.calls = []
      window.saved = null
    })
  }
  assert.deepEqual(errors, [])
  console.log(
    'Bot learning: web and mobile memory controls, human-reviewed skill diffs, HTTP monitoring and routine limits pass. Native controls and transport are fixtures.',
  )
} finally {
  await browser.close()
}
