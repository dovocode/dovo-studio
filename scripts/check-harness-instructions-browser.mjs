import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const desktopFile = root + 'packages/extension-agents/src/harness-instructions.tsx'
const mobileFile = root + 'apps/mobile/src/agents/harness-instructions.tsx'
const mobileControls = `export const SettingsAction=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;export const SettingsChoice=({label,items,value,onChange,disabled})=><label>{label}<select aria-label={label} value={value} disabled={disabled} onChange={event=>onChange(event.target.value)}>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>;export const SettingsField=({label,value,onChangeText,editable})=><label>{label}<textarea aria-label={label} value={value} disabled={!editable} onChange={event=>onChangeText(event.target.value)}/></label>`
async function bundle(mobile) {
  const file = mobile ? mobileFile : desktopFile
  const stubs = mobile
    ? [
        {
          path: '../runtime/connection/provider',
          importer: file,
          contents: 'export const useRuntime=()=>window.store;',
        },
        {
          path: '../runtime/preferences/settings-target',
          importer: file,
          contents:
            'export const useSettingsDraft=(dirty,busy)=>{window.dirty=dirty;window.saving=busy};',
        },
        { path: '../screens/settings-controls', importer: file, contents: mobileControls },
        {
          path: '../screens/settings-theme',
          importer: file,
          contents: 'export const useSettingsTheme=()=>({styles:{}});',
        },
        {
          path: '../ui/content/text',
          importer: file,
          contents:
            'export const Text=({children,accessibilityRole})=><span role={accessibilityRole}>{children}</span>;',
        },
        {
          path: 'react-native',
          contents: `export const View=({children})=><div>{children}</div>;export const Alert={alert:(_title,_description,actions)=>{window.confirmations++;actions.find(action=>action.style==='destructive')?.onPress()}};`,
        },
      ]
    : [
        {
          path: '@dovo/studio-core',
          importer: file,
          contents: `export const useWorkspace=()=>window.store;export const useSettingsDraft=(dirty,busy)=>{window.dirty=dirty;window.saving=busy};export const useConfirmation=()=>async()=>{window.confirmations++;return true};`,
        },
        {
          path: '@dovo/studio-core/state',
          contents: `export {useState as useApplicationState} from 'react';`,
        },
        {
          path: '@dovo/studio-ui',
          importer: file,
          contents: [
            ['Button', 'components/ui/button.tsx'],
            ['Textarea', 'components/ui/textarea.tsx'],
            ['ChoicePicker', 'choice-picker.tsx'],
            ['Disclosure', 'disclosure.tsx'],
            ['FormField', 'components/form-field.tsx'],
          ]
            .map(([name, path]) => `export {${name}} from '${root}packages/studio-ui/src/${path}';`)
            .join('\n'),
        },
      ]
  const result = await bundleBrowser(
    {
      stdin: {
        resolveDir: root,
        loader: 'tsx',
        contents: `
import {createRoot} from 'react-dom/client';import {useState,useCallback} from 'react';
import {HarnessInstructions} from '${file}';
window.calls=[];window.confirmations=0;window.blockedReads=[];window.blockedSaves=[];window.releases=[];window.removed=[];
window.docs=Object.fromEntries(['one','two'].map(owner=>[owner,Object.fromEntries(['codex','claude'].map(provider=>[owner+'-'+provider,{text:owner+' '+provider+' instructions\\n',version:'v1',exists:true,resolvedPath:'/'+owner+'/'+provider+'/'+(provider==='codex'?'AGENTS.md':'CLAUDE.md')}]))]));
window.rpc=async(owner,path,input)=>{
 window.calls.push({owner,path,input});
 if(path.endsWith('/list'))return {files:Object.keys(window.docs[owner]).filter(id=>!window.removed.includes(id)).map(id=>({id,provider:id.endsWith('codex')?'codex':'claude',name:id.endsWith('codex')?'AGENTS.md':'CLAUDE.md',path:window.docs[owner][id].resolvedPath,profiles:[owner+' profile'],description:'Native instruction file'})),notices:[]};
 const doc=window.docs[owner][input.id];if(!doc)throw Error('Wrong computer or file');
 if(path.endsWith('/read')){const result={...doc};if(window.blockedReads.includes(input.id))await new Promise(resolve=>window.releases.push(resolve));return result}
 if(doc.version!==input.version)throw Error('Instructions changed on disk. Reload the file before saving. Your draft is kept.');
 if(path.endsWith('/preview'))return {changed:doc.text!==input.text,diff:'--- Original\\n-'+doc.text+'+'+input.text};
 if(path.endsWith('/save')){if(window.blockedSaves.includes(input.id))await new Promise(resolve=>window.releases.push(resolve));doc.text=input.text;doc.version+='-saved';return {version:doc.version}};
 throw Error('Unexpected path '+path);
};
function App(){const[route,setRoute]=useState(false);window.learnRoute=()=>setRoute(true);const[owner,setOwner]=useState('one'),[connected,setConnected]=useState(true),[supported,setSupported]=useState(true);window.setOwner=setOwner;window.setConnected=setConnected;window.setSupported=setSupported;const request=useCallback((...args)=>window.rpc(owner,...args),[owner]);window.store={request,call:request,connected,snapshot:{runtimeId:owner,harnessInstructionsSupported:supported},activeRuntimeId:owner,connection:{address:'http://'+owner+'.lan',token:'paired',...(route?{alternateAddresses:['http://100.64.0.1:8787']}:{} )},profile:{id:owner,connection:{address:'http://'+owner+'.lan',token:'paired',...(route?{alternateAddresses:['http://100.64.0.1:8787']}:{} )}}};return <HarnessInstructions/>};createRoot(document.getElementById('app')).render(<App/>);
`,
      },
      bundle: true,
      write: false,
      format: 'iife',
      platform: 'browser',
      jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"production"' },
      alias: {
        react: root + 'packages/studio-ui/node_modules/react',
        'react-dom': root + 'packages/studio-ui/node_modules/react-dom',
        '@dovo/protocol': root + 'packages/protocol/src/index.ts',
      },
      nodePaths: [root + 'packages/studio-ui/node_modules'],
    },
    stubs,
  )
  return result.outputFiles[0].text
}
const browser = await chromium.launch()
try {
  for (const mobile of [false, true]) {
    const page = await browser.newPage()
    page.setDefaultTimeout(10000)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setContent('<div id="app"></div>')
    await page.addScriptTag({ content: await bundle(mobile) })
    await page.getByText('Harness instruction files', { exact: true }).waitFor()
    assert.equal(
      await page.evaluate(() => window.calls.length),
      0,
      'Opening Agents must not fetch closed instruction editors',
    )
    await (
      mobile
        ? page.getByRole('button', { name: 'Edit harness instruction files', exact: true })
        : page.locator('summary').filter({ hasText: 'Harness instruction files' })
    ).click()
    const text = page.getByRole('textbox', { name: 'Harness instructions', exact: true })
    await page.waitForFunction(
      () => document.querySelector('textarea')?.value === 'one codex instructions\n',
    )
    const choose = async (provider) => {
      if (mobile)
        await page
          .getByRole('combobox', { name: 'Harness instruction file', exact: true })
          .selectOption('one-' + provider)
      else {
        await page.getByRole('button', { name: 'Harness instruction file', exact: true }).click()
        await page
          .getByRole('option', {
            name: new RegExp('^' + (provider === 'codex' ? 'Codex' : 'Claude Code') + ' ·'),
          })
          .click()
      }
    }
    const save = page.getByRole('button', { name: 'Save instruction file', exact: true })
    const review = page.getByRole('button', { name: 'Review diff', exact: true })
    assert.equal(await save.isDisabled(), true)
    await text.fill('Keep my draft\n')
    await page.evaluate(() => window.learnRoute())
    assert.equal(
      await text.inputValue(),
      'Keep my draft\n',
      'Learning another route must keep the current computer draft visible',
    )
    await choose('claude')
    await page.waitForFunction(
      () => document.querySelector('textarea')?.value === 'one claude instructions\n',
    )
    await choose('codex')
    assert.equal(await text.inputValue(), 'Keep my draft\n')
    await review.click()
    await page.waitForFunction(
      () =>
        document.querySelector('pre')?.textContent?.includes('Keep my draft') ||
        [...document.querySelectorAll('span')].some((e) => e.textContent.includes('--- Original')),
    )
    await save.waitFor({ state: 'visible' })
    await text.fill('Final draft\n')
    assert.equal(await save.isDisabled(), true, 'Editing after review must require another review')
    await review.click()
    await page.waitForFunction(
      () =>
        !Array.from(document.querySelectorAll('button')).find(
          (e) => e.textContent === 'Save instruction file',
        )?.disabled,
    )
    await page.evaluate(() => {
      window.docs.one['one-codex'] = {
        ...window.docs.one['one-codex'],
        text: 'External edit\n',
        version: 'external',
      }
    })
    await save.click()
    await page.getByRole('alert').filter({ hasText: 'Instructions changed on disk' }).waitFor()
    assert.equal(await text.inputValue(), 'Final draft\n')
    await page.getByRole('button', { name: 'Reload disk version', exact: true }).click()
    await page
      .getByText('Disk version reloaded. Your draft is kept. Review the diff before saving.', {
        exact: true,
      })
      .waitFor()
    assert.equal(await text.inputValue(), 'Final draft\n')
    assert.equal(await save.isDisabled(), true)
    await review.click()
    await page
      .getByText(/--- Original.*External edit/s)
      .last()
      .waitFor()
    await save.click()
    await page.waitForFunction(() => window.docs.one['one-codex'].text === 'Final draft\n')
    await text.fill('Offline draft\n')
    await page.evaluate(() => window.setConnected(false))
    await page.waitForFunction(() => document.querySelector('textarea')?.disabled === true)
    assert.equal(await text.inputValue(), 'Offline draft\n')
    await page.evaluate(() => window.setConnected(true))
    await page.waitForFunction(() => document.querySelector('textarea')?.disabled === false)
    assert.equal(await text.inputValue(), 'Offline draft\n')
    await page.evaluate(() => {
      window.blockedReads = ['two-codex']
      window.setOwner('two')
    })
    await page.waitForFunction(() => window.releases.length === 1)
    await page.evaluate(() => window.setOwner('one'))
    await page.waitForFunction(
      () =>
        document.querySelector('textarea')?.value === 'Offline draft\n' &&
        !document.querySelector('textarea').disabled,
    )
    await page.evaluate(() => {
      window.blockedReads = []
      window.releases.splice(0).forEach((resolve) => resolve())
    })
    assert.equal(
      await text.inputValue(),
      'Offline draft\n',
      'Late reads must not replace another computer’s draft',
    )
    await review.click()
    await page.evaluate(() => {
      window.blockedSaves = ['one-codex']
    })
    await save.click()
    await page.waitForFunction(() => window.releases.length === 1)
    await page.evaluate(() => window.setOwner('two'))
    await page.waitForFunction(
      () => document.querySelector('textarea')?.value === 'two codex instructions\n',
    )
    await page.evaluate(() => {
      window.blockedSaves = []
      window.releases.splice(0).forEach((resolve) => resolve())
    })
    await page.waitForFunction(() => window.docs.one['one-codex'].text === 'Offline draft\n')
    assert.equal(
      await text.inputValue(),
      'two codex instructions\n',
      'Late saves must stay owned by their source computer',
    )
    await page.evaluate(() => window.setOwner('one'))
    await page.waitForFunction(
      () =>
        document.querySelector('textarea')?.value === 'Offline draft\n' &&
        !document.querySelector('textarea').disabled,
    )
    await text.fill('Draft after profile change\n')
    await page.evaluate(() => {
      window.removed = ['one-codex']
    })
    await page.getByRole('button', { name: 'Reload file list', exact: true }).click()
    await page
      .getByText('This configuration changed. Copy your draft before selecting its replacement.', {
        exact: true,
      })
      .waitFor()
    assert.equal(await text.inputValue(), 'Draft after profile change\n')
    await page.getByRole('button', { name: 'Discard draft', exact: true }).click()
    await page.waitForFunction(() => window.confirmations === 1)
    assert.equal(await text.inputValue(), 'Offline draft\n')
    assert.deepEqual(errors, [])
    await page.close()
    console.log(
      `${mobile ? 'Mobile' : 'Desktop'} harness instructions: lazy loading, file drafts, diff review, conflict recovery, offline drafts, late reads/saves and changed profiles passed.`,
    )
  }
} finally {
  await browser.close()
}
