import { fileURLToPath } from 'node:url'
import { readFile, readdir } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from '../packages/runtime/node_modules/playwright/index.mjs'

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const state = `export {useState as useApplicationState} from 'react';`
const controls = `import {useState,createContext,useContext} from 'react';
export const View=({children})=><div>{children}</div>;export const ScrollView=View;export const Pressable=({children,onPress,disabled,accessibilityLabel})=><button disabled={disabled} aria-label={accessibilityLabel} onClick={onPress}>{children}</button>;
export const Text=({children})=><p>{children}</p>;
export const Linking={openURL:async()=>{}};
export const Alert={alert:(title,message,buttons)=>{if(window.confirm(message))buttons.at(-1).onPress()}};
export const Platform={OS:'ios'};export const StyleSheet={create:value=>value,hairlineWidth:1};export const useWindowDimensions=()=>({width:390,height:844,fontScale:1});export const SearchField=props=><input aria-label={props.label} value={props.value} onChange={e=>props.onChangeText?.(e.target.value)}/>;export const styles={};export const MobileThemeContext=createContext({styles,colors:{},mode:'dark'});export const useTheme=()=>useContext(MobileThemeContext);
export const Field=({label,value,onChangeText,editable})=><label>{label}<input aria-label={label} value={value} disabled={editable===false} onChange={e=>onChangeText(e.target.value)}/></label>;
export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;
export const Switch=({value,onValueChange,disabled,accessibilityLabel})=><input aria-label={accessibilityLabel} type="checkbox" checked={value} disabled={disabled} onChange={e=>onValueChange(e.target.checked)}/>;`
const core = `export {commandFields,commandSettingsResponse,cuaCheckResponse} from '${root}/packages/protocol/src/shared/commands.ts';export const useWorkspace=()=>({request:window.request,connected:true});`
const ui = `export {Button} from '${root}/packages/studio-ui/src/components/ui/button.tsx';export {Input} from '${root}/packages/studio-ui/src/components/ui/input.tsx';export {Textarea} from '${root}/packages/studio-ui/src/components/ui/textarea.tsx';export {FormField} from '${root}/packages/studio-ui/src/components/form-field.tsx';export {Toggle,SettingRow,SettingsGroup} from '${root}/packages/studio-ui/src/settings-layout.tsx';`
const runtime = `import {Effect} from 'effect';export const useRuntime=()=>({connected:true,read:window.request,readEffect:(path,input)=>Effect.tryPromise({try:()=>window.request(path,input),catch:error=>error}),callEffect:(path,input)=>Effect.tryPromise({try:()=>window.request(path,input),catch:error=>error})});`
const browser = await chromium.launch()
try {
  for (const mobile of [false, true]) {
    const mocks = {
      '@dovo/studio-core': core,
      '@dovo/studio-core/state': state,
      '@dovo/studio-ui': ui,
      '../state/application-state': state,
      '../connection/provider': runtime,
      'react-native': controls,
      '../../ui/controls/field': controls,
      '../../ui/controls/action': controls,
      '../../ui/controls/switch': controls,
      '../../ui/content/text': controls,
      '../../ui/theme': controls,
      '../ui/theme': controls,
      '../ui/layout/sheet':
        'export const Sheet=({children})=>children;export const useInsideSheet=()=>false;',
      '../ui/controls/field': controls,
      '../ui/controls/action': controls,
      '../ui/controls/choice':
        'export const Choice=({label,value,items,onChange})=><select aria-label={label} value={value} onChange={e=>onChange(e.target.value)}>{items.map(i=><option key={i.id} value={i.id}>{i.name}</option>)}</select>;',
      '../ui/content/text': controls,
    }
    const built = await build({
      stdin: {
        contents: `import {useState,createContext,useContext} from 'react';import {createRoot} from 'react-dom/client';
import {decode,commandsSchema} from '@dovo/protocol';
import {CommandSettings} from '${root}/${mobile ? 'apps/mobile/src/runtime/preferences' : 'packages/extension-runtime/src'}/command-settings.tsx';
window.commands=decode(commandsSchema,{git:'/custom/git',shellArgs:['-l',''],cuaEnabled:false});
window.calls=[];window.fail=false;
window.check={path:'/driver/cua-driver',available:false,version:null,daemon:null,permissions:null,detail:'Missing driver',platform:'darwin',history:null,historyState:null,skills:null};
window.request=async(path,input)=>{
  window.calls.push({path,input});
  if(path==='/api/commands/read')return {settings:window.commands,defaultShell:'/bin/zsh'};
  if(path==='/api/commands/save'){window.commands=input.after;return {settings:window.commands,defaultShell:'/bin/zsh'}}
  if(path.endsWith('/check'))return window.check;
  if(path.endsWith('/action')){
    if(window.fail)throw Error('Driver action failed');
    const action=input.action;
    if(action==='history-enable')window.check={...window.check,historyState:{...window.check.historyState,enabled:true,admitted:true,health:'ok'}};
    if(action==='history-pause')window.check={...window.check,historyState:{...window.check.historyState,paused:true}};
    return {output:action==='history-list'?'Event 1: session started':'Command completed',check:window.check};
  }
  throw Error(path);
};
function App(){const [computerUse,setComputerUse]=useState(true);return <main style={{maxWidth:740,margin:'auto',padding:16}}><button onClick={()=>setComputerUse(!computerUse)}>Switch settings page</button><CommandSettings key={String(computerUse)} computerUse={computerUse}/></main>}
createRoot(document.getElementById('app')).render(<App/>);`,
        loader: 'tsx',
        resolveDir: root,
      },
      bundle: true,
      write: false,
      jsx: 'automatic',
      format: 'iife',
      platform: 'browser',
      alias: {
        react: root + '/packages/studio-ui/node_modules/react',
        '@dovo/protocol': root + '/packages/protocol/src/index.ts',
        '@dovo/client-runtime': root + '/packages/client-runtime/src/index.ts',
      },
      nodePaths: [root + '/packages/studio-ui/node_modules', root + '/node_modules'],
      plugins: [
        {
          name: 'mocks',
          setup(b) {
            b.onResolve({ filter: /.*/ }, ({ path }) =>
              mocks[path] ? { path, namespace: 'mock' } : undefined,
            )
            b.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({
              contents: mocks[path],
              loader: 'tsx',
              resolveDir: root + '/apps/mobile',
            }))
          },
        },
      ],
    })
    const page = await browser.newPage({ viewport: { width: mobile ? 390 : 1024, height: 900 } })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setContent('<div id="app"></div>')
    await page.addScriptTag({ content: built.outputFiles[0].text })
    await page.getByText('1. Install on this computer', { exact: true }).waitFor()
    assert.equal(await page.getByLabel('Git executable').count(), 0)
    assert.equal(
      await page.getByRole('button', { name: 'Enable Computer History', exact: true }).count(),
      0,
    )
    await page.evaluate(() => {
      window.check = {
        ...window.check,
        available: true,
        version: 'cua-driver 0.33.2',
        detail: 'Executable responds',
        skills: 'Not installed',
        history: 'status',
        historyState: {
          admitted: false,
          enabled: false,
          encrypted: true,
          health: 'not_admitted',
          paused: false,
          supported: true,
        },
      }
    })
    await page
      .getByRole('button', {
        name: mobile ? 'Detect / check Cua Driver' : 'Check Cua Driver',
        exact: true,
      })
      .click()
    const enable = page.getByRole('button', { name: 'Enable Computer History', exact: true })
    await enable.waitFor()
    assert.equal(
      await page.getByRole('button', { name: 'Pause history', exact: true }).isDisabled(),
      true,
    )
    await enable.click()
    await page.getByText('Recording · Encrypted · ok', { exact: true }).waitFor()
    assert.equal(await enable.isDisabled(), true)
    await page.getByRole('button', { name: 'Pause history', exact: true }).click()
    await page.getByText('Paused · Encrypted · ok', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'View recent history', exact: true }).click()
    await page.getByText('Event 1: session started', { exact: true }).waitFor()
    if (process.env.DOVO_CUA_SCREENSHOT && !mobile) {
      const assets = root + '/apps/web/dist/client/assets'
      const css = (await readdir(assets)).find((name) => name.endsWith('.css'))
      assert.ok(css)
      await page.addStyleTag({ content: await readFile(assets + '/' + css, 'utf8') })
      await page.screenshot({ path: process.env.DOVO_CUA_SCREENSHOT, fullPage: true })
      await page.setViewportSize({ width: 390, height: 900 })
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      )
      await page.screenshot({
        path: process.env.DOVO_CUA_SCREENSHOT.replace('.png', '-narrow.png'),
        fullPage: true,
      })
    }
    page.once('dialog', (dialog) => dialog.dismiss())
    await page.getByRole('button', { name: 'Delete recorded history', exact: true }).click()
    assert.equal(
      await page.evaluate(() =>
        window.calls.some((call) => call.input?.action === 'history-delete'),
      ),
      false,
    )
    await page.evaluate(() => {
      window.fail = true
    })
    await page.getByRole('button', { name: 'Run diagnostics', exact: true }).click()
    await page.getByText(/Driver action failed/).waitFor()
    assert.equal(
      await page.evaluate(
        () => window.calls.filter((call) => call.input?.action === 'doctor').length,
      ),
      1,
    )
    assert.equal(
      await page.getByRole('button', { name: 'Run diagnostics', exact: true }).isEnabled(),
      true,
    )
    await page.evaluate(() => {
      window.fail = false
    })
    if (mobile)
      await page
        .getByRole('checkbox', { name: 'Enable agent computer use on this computer', exact: true })
        .check()
    await page.getByRole('button', { name: 'Save computer-use settings', exact: true }).click()
    await page
      .getByText('Computer-use settings saved. Applies to new turns.', { exact: true })
      .waitFor()
    assert.deepEqual(
      await page.evaluate(() => ({ git: window.commands.git, args: window.commands.shellArgs })),
      { git: '/custom/git', args: ['-l', ''] },
    )
    await page.getByRole('button', { name: 'Switch settings page', exact: true }).click()
    await page.getByLabel('Git executable').waitFor()
    assert.equal(
      await page.getByRole('button', { name: 'Enable Computer History', exact: true }).count(),
      0,
    )
    assert.deepEqual(errors, [])
    await page.close()
  }
  console.log('Computer use browser checks passed for web and mobile')
} finally {
  await browser.close()
}
