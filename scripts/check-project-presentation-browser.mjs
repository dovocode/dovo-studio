import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { mkdir } from 'node:fs/promises'
import { build } from 'esbuild'
import { createServer } from 'vite-plus'
import tailwindcss from '@tailwindcss/vite'
import { chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const native = `
import {useState} from 'react';
const style=value=>{const result=Object.assign({},...[value].flat(Infinity).filter(Boolean));for(const [key,axes] of Object.entries({paddingHorizontal:['paddingLeft','paddingRight'],paddingVertical:['paddingTop','paddingBottom']})){if(key in result){for(const axis of axes)result[axis]=result[key];delete result[key]}}return result};
export const View=({children,style:css})=><div style={{display:'flex',flexDirection:'column',minWidth:0,...style(css)}}>{children}</div>;
export const Image=({source,style:css})=><img alt="" src={source.uri} style={style(css)}/>;
export const Text=({children,style:css,accessibilityRole})=><span role={accessibilityRole} style={{overflowWrap:'anywhere',...style(css)}}>{children}</span>;
export const Pressable=({children,accessibilityLabel,onPress,disabled})=><button aria-label={accessibilityLabel} onClick={onPress} disabled={disabled}>{children}</button>;
export const Field=({label,value,onChangeText,editable,maxLength})=><label>{label}<input aria-label={label} value={value} maxLength={maxLength} disabled={editable===false} onChange={event=>onChangeText(event.target.value)} style={{width:'100%',boxSizing:'border-box',padding:8}}/></label>;
export const SettingsAction=({label,onPress,disabled})=><button onClick={onPress} disabled={disabled}>{label}</button>;
export const Sheet=({children})=>children;
export const useTheme=()=>({styles:{text:{fontSize:14},muted:{fontSize:12,color:'#aaa'},row:{display:'flex',flexDirection:'row',flexWrap:'wrap',gap:8},error:{color:'red'}}});
export function useAction(){const [busy,setBusy]=useState(false),[error,setError]=useState('');return {busy,error,act:run=>{setBusy(true);setError('');run().catch(error=>setError(error.message)).finally(()=>setBusy(false))}}}
`
async function bundle(mobile) {
  const mocks = {
    '@dovo/studio-core/state': `export {useState as useApplicationState} from 'react'`,
    '@dovo/studio-core': `export const useWorkspace=()=>window.connection;`,
    '@dovo/studio-ui': `export {Button} from '${root}packages/studio-ui/src/components/ui/button.tsx';export {Input} from '${root}packages/studio-ui/src/components/ui/input.tsx';export {ProjectIcon} from '${root}packages/studio-ui/src/project-icon.tsx';export * as Popover from '@radix-ui/react-popover';`,
    'react-native': native,
    '../../runtime/connection/provider': `export const useRuntime=()=>window.connection;`,
    '../../ui/controls/use-action': native,
    '../../ui/controls/field': native,
    '../../screens/settings-controls': native,
    '../../ui/content/text': native,
    '../../ui/theme': native,
    '../../ui/layout/sheet': native,
    'expo-document-picker': `export const getDocumentAsync=async()=>({canceled:true});`,
    'expo-file-system': `export class File{}`,
  }
  return build({
    stdin: {
      contents: `
import {useState} from 'react';import {createRoot} from 'react-dom/client';
import {ProjectIconSettings} from '${root}${mobile ? 'apps/mobile/src/scm/connections' : 'packages/extension-scm/src/connections'}/project-icon-settings.tsx';
import {ProjectIcon} from '${root}${mobile ? 'apps/mobile/src/scm/connections/project-icon' : 'packages/studio-ui/src/project-icon'}.tsx';
import {projectIconChoices} from '@dovo/protocol';
const icon=projectIconChoices[0].data;
window.value={taskDefaults:{setupCommand:'pnpm install'}};window.writes=[];
let update;
const refresh=async()=>update(repo=>({...repo,name:window.value.projectName??'local-clone',sharedName:window.value.projectName??undefined,iconOverride:window.customIcon}));
const request=async(path,input)=>{
  if(window.rejectRequest)throw new Error('The project remote changed. Reload before saving.');
  if(path.endsWith('/read'))return {value:structuredClone(window.value),inherited:{},projectKey:'project:github.com/team/app'};
  window.writes.push({path,input});
  if(path.endsWith('/save')){window.value=input.after;return {value:input.after,inherited:{}}}
  window.customIcon=input.data?'data:image/png;base64,'+input.data:undefined;
  return {ok:true};
};
window.connection={request,call:request,refresh,refreshRuntime:refresh,connected:true,activeRuntimeId:'mac',runtimes:[{profile:{id:'mac'}}]};
function App(){const [repo,setRepo]=useState({id:'one',name:'local-clone',localName:'local-clone',path:'/one',branch:'main',gitIdentity:'github.com/team/app',discoveredIcon:icon});update=setRepo;return <><div data-project-icons><ProjectIcon repository={repo}/><ProjectIcon repository={{...repo,id:'other-device',path:'/other'}}/></div><ProjectIconSettings repository={repo}/></>};
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
      react: root + 'packages/studio-ui/node_modules/react',
      '@dovo/protocol': root + 'packages/protocol/src/index.ts',
    },
    nodePaths: [root + 'packages/studio-ui/node_modules', root + 'apps/mobile/node_modules'],
    plugins: [
      {
        name: 'fixture-boundaries',
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, ({ path }) =>
            Object.hasOwn(mocks, path) ? { path, namespace: 'fixture' } : undefined,
          )
          builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
            contents: mocks[path],
            loader: 'tsx',
            resolveDir: root + 'packages/studio-ui',
          }))
        },
      },
    ],
  })
}
const server = await createServer({
  configFile: false,
  root,
  plugins: [tailwindcss()],
  server: { middlewareMode: true },
  logLevel: 'error',
})
let css
try {
  css = (await server.transformRequest('/packages/studio-ui/src/styles.css?direct')).code
} finally {
  await server.close()
}
const browser = await chromium.launch()
await mkdir('/tmp/dovo-project-presentation', { recursive: true })
try {
  for (const mobile of [false, true]) {
    const built = await bundle(mobile)
    for (const width of [320, 390, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } })
      page.setDefaultTimeout(5000)
      const errors = []
      page.on('pageerror', (error) => {
        errors.push(error.message)
        console.error(error.message)
      })
      await page.setContent(
        '<html class="dark"><body style="margin:0;background:#101010;color:#eee;font-family:system-ui"><main id="app" style="padding:12px"></main></body></html>',
      )
      if (!mobile) await page.addStyleTag({ content: css })
      await page.addScriptTag({ content: built.outputFiles[0].text })
      const name = page.getByRole('textbox', { name: 'Shared project name' })
      await name.fill('Customer Portal')
      await page.getByRole('button', { name: 'Save name', exact: true }).click()
      await page.getByRole('button', { name: 'Use local name', exact: true }).waitFor()
      assert.equal(await name.inputValue(), 'Customer Portal')
      assert.deepEqual(await page.evaluate(() => window.value.taskDefaults), {
        setupCommand: 'pnpm install',
      })
      assert.equal(
        await page.evaluate(() => window.writes[0].input.projectKey),
        'project:github.com/team/app',
      )
      await page.getByRole('button', { name: 'Share detected icon', exact: true }).click()
      await page
        .getByRole('button', { name: mobile ? 'Reset to detected' : 'Reset', exact: true })
        .waitFor()
      assert.equal(
        await page.evaluate(() => window.writes.at(-1).input.expectedGitIdentity),
        'github.com/team/app',
      )
      const icons = await page
        .locator('[data-project-icons] img')
        .evaluateAll((images) => images.map((image) => image.src))
      assert.equal(icons.length, 2)
      assert.equal(icons[0], icons[1])
      await page.evaluate(() => (window.rejectRequest = true))
      await name.fill('Unsaved name')
      await page.getByRole('button', { name: 'Save name', exact: true }).click()
      await page.getByRole('alert').first().waitFor()
      assert.equal(await name.inputValue(), 'Unsaved name')
      await page.evaluate(() => (window.rejectRequest = false))
      await page.getByRole('button', { name: 'Use local name', exact: true }).click()
      await page.waitForFunction(() => document.querySelector('input').value === 'local-clone')
      assert.equal(await page.evaluate(() => window.value.projectName), null)
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `${mobile ? 'mobile' : 'desktop'} overflow at ${width}`,
      )
      if (!mobile)
        assert.ok(
          await page
            .getByText('Project icon', { exact: true })
            .evaluate((element) => element.parentElement.getBoundingClientRect().width > 180),
          'Icon description must retain readable width',
        )
      assert.deepEqual(errors, [])
      await page.screenshot({
        path: `/tmp/dovo-project-presentation/${mobile ? 'mobile' : 'desktop'}-${width}.png`,
        fullPage: true,
      })
      await page.close()
    }
  }
  console.log(
    'Desktop/mobile project presentation: shared names, retained defaults, icon adoption/identity guards, error drafts, resets and 320/390/1280px layouts passed.',
  )
} finally {
  await browser.close()
}
