import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const mobile = root + 'apps/mobile/src/'
// Native controls use DOM adapters. Component state and request identity remain real.
const native = `
const flat=style=>Object.assign({},...[style].flat(Infinity).filter(Boolean));
export const Platform={OS:'web'};
export const View=({children,style,accessibilityLabel})=><div aria-label={accessibilityLabel} style={flat(style)}>{children}</div>;
export const ScrollView=View;
export const Text=({children,style,accessibilityRole})=><span role={accessibilityRole} style={flat(style)}>{children}</span>;
export const TextInput=({value,onChangeText,accessibilityLabel,style})=><input aria-label={accessibilityLabel} value={value} style={flat(style)} onChange={event=>onChangeText(event.target.value)}/>;
export const Pressable=({children,onPress,accessibilityLabel,accessibilityRole,accessibilityState,style})=><button aria-label={accessibilityLabel} aria-expanded={accessibilityState?.expanded} onClick={onPress} style={flat(typeof style==='function'?style({pressed:false}):style)}>{children}</button>;
`
const theme = `export const useTheme=()=>({colors:{border:'#555',surface:'#222',muted:'#aaa'},styles:{card:{},row:{display:'flex'},muted:{color:'#aaa'},input:{}}});`
const text = {
  path: '../../../ui/content/text',
  importer: mobile,
  contents: `export {Text} from 'react-native';`,
}
const browser = await chromium.launch()
async function mount(contents, stubs, width = 1000) {
  const built = await bundleBrowser(
    {
      stdin: { contents, resolveDir: root, loader: 'tsx' },
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
      },
    },
    stubs,
  )
  const page = await browser.newPage({ viewport: { width, height: 850 } })
  page.setDefaultTimeout(8000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  return { page, errors }
}
const react = `import {useState} from 'react';import{createRoot}from'react-dom/client';`
try {
  for (const platform of ['desktop', 'mobile']) {
    const source =
      platform === 'desktop' ? 'packages/extension-tasks/src/detail' : 'apps/mobile/src/tasks/files'
    const stubs = [
      platform === 'desktop'
        ? { path: '@dovo/studio-core', contents: `export const useWorkspace=()=>window.store;` }
        : {
            path: '../../runtime/connection/provider',
            importer: mobile + 'tasks/',
            contents: `export const useRuntime=()=>window.store;`,
          },
      ...(platform === 'desktop'
        ? [
            {
              path: '@dovo/studio-ui',
              contents: `export const Button=({children,onClick})=><button onClick={onClick}>{children}</button>;`,
            },
          ]
        : [
            { path: 'react-native', contents: native },
            text,
            {
              path: '../../ui/content/text',
              importer: mobile + 'tasks/',
              contents: `export {Text} from 'react-native';`,
            },
            { path: '../../ui/theme', importer: mobile + 'tasks/', contents: theme },
            {
              path: '../../ui/controls/action',
              importer: mobile + 'tasks/',
              contents: `export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;`,
            },
            {
              path: '../../ui/controls/choice',
              importer: mobile + 'tasks/',
              contents: `export const Choice=({label,value,items,onChange})=><select aria-label={label} value={value} onChange={event=>onChange(event.target.value)}>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>;`,
            },
          ].filter((stub) => stub !== text)),
    ]
    const { page, errors } = await mount(
      `${react}
import {ProjectSpreadsheet} from './${source}/project-spreadsheet';
window.requests=[];window.hold=false;window.fail=false;window.owner='one';
const request=async(path,input)=>{window.requests.push({owner:window.owner,input});if(window.hold)await new Promise(resolve=>window.release=resolve);if(window.fail)throw Error('Cannot read workbook');return {sheets:['First','Second'],sheet:input.sheet||'First',rows:Array.from({length:30},(_,i)=>[i===0?'<img src=x onerror=alert(1)>':'Row '+i,window.owner]),truncated:false}};
window.store={request,call:request,activeRuntimeId:'one',connection:{address:'http://one',token:'token'}};
function App(){const[,render]=useState(0);window.refresh=()=>render(x=>x+1);return <ProjectSpreadsheet taskId="task" path="book.xlsx" revision={0}/>};createRoot(document.getElementById('app')).render(<App/>);`,
      stubs,
      platform === 'desktop' ? 1000 : 390,
    )
    await page.getByText('<img src=x onerror=alert(1)>', { exact: true }).waitFor()
    assert.equal(await page.locator('img').count(), 0)
    if (platform === 'desktop') {
      await page.getByRole('button', { name: 'Resize column A', exact: true }).press('ArrowRight')
      assert.equal(
        await page
          .locator('col')
          .nth(1)
          .evaluate((node) => node.style.width),
        '176px',
      )
      await page.getByRole('button', { name: 'Resize row 1', exact: true }).press('ArrowDown')
      assert.equal(
        await page
          .locator('tbody tr')
          .first()
          .evaluate((node) => node.style.height),
        '44px',
      )
    } else {
      await page.getByRole('textbox', { name: 'Column width', exact: true }).fill('220')
      await page.waitForFunction(() =>
        [...document.querySelectorAll('span')].some(
          (node) =>
            node.textContent === '<img src=x onerror=alert(1)>' && node.style.width === '220px',
        ),
      )
      await page.getByRole('button', { name: 'Next rows', exact: true }).click()
      await page.getByText('Rows 26–30 of 30', { exact: true }).waitFor()
    }
    await page.getByRole('button', { name: 'Reset sizes', exact: true }).click()
    await page.getByRole('combobox', { name: 'Worksheet', exact: true }).selectOption('Second')
    await page.waitForFunction(() => window.requests.at(-1).input.sheet === 'Second')
    await page.evaluate(() => {
      window.hold = true
      window.store = {
        ...window.store,
        activeRuntimeId: 'two',
        connection: { address: 'http://two', token: 'two' },
      }
      window.refresh()
    })
    await page.getByText('Loading spreadsheet…', { exact: true }).waitFor()
    await page.waitForFunction(() => !!window.release)
    await page.evaluate(() => {
      const release = window.release
      window.hold = false
      window.owner = 'three'
      window.fail = true
      window.store = {
        ...window.store,
        activeRuntimeId: 'three',
        connection: { address: 'http://three', token: 'three' },
      }
      window.refresh()
      release()
    })
    await page.getByRole('alert').filter({ hasText: 'Cannot read workbook' }).waitFor()
    await page.evaluate(() => (window.fail = false))
    await page.getByRole('button', { name: 'Retry', exact: true }).click()
    await page.getByText('<img src=x onerror=alert(1)>', { exact: true }).waitFor()
    assert.deepEqual(errors, [])
    await page.close()
    console.log(
      platform +
        ' spreadsheets: resizing, sheets, literal cell text, pagination, stale replies and retry pass.',
    )
  }
  for (const platform of ['desktop', 'mobile']) {
    const source =
      platform === 'desktop'
        ? 'packages/extension-scm/src/pulls/detail/comments'
        : 'apps/mobile/src/scm/pulls/detail/pull-comments'
    const stubs =
      platform === 'desktop'
        ? [
            {
              path: '@dovo/studio-core',
              contents: `export * from '@dovo/protocol';export const formatDateTime=value=>value;export const forgeLabels={github:'GitHub'};`,
            },
            {
              path: '@dovo/studio-ui',
              contents: `export const MessageResponse=({children})=><p>{children}</p>;`,
            },
            {
              path: './patch',
              importer: root + 'packages/extension-scm/src/pulls/detail/',
              contents: `export const PullPatch=()=>null;`,
            },
            {
              path: '../list/actions',
              importer: root + 'packages/extension-scm/src/pulls/detail/',
              contents: `export const PullCommentActions=({comment})=><button>Reply to {comment.id}</button>;`,
            },
          ]
        : [
            { path: 'react-native', contents: native },
            text,
            { path: '../../../ui/theme', importer: mobile + 'scm/', contents: theme },
            {
              path: '../../../ui/content/markdown',
              importer: mobile + 'scm/',
              contents: `export const Markdown=({text})=><p>{text}</p>;`,
            },
            {
              path: '../../../ui/controls/icon',
              importer: mobile + 'scm/',
              contents: `export const Icon=()=>null;`,
            },
            {
              path: '../../../ui/controls/action',
              importer: mobile + 'scm/',
              contents: `export const Action=({label,onPress})=><button onClick={onPress}>{label}</button>;`,
            },
            {
              path: './pull-status',
              importer: mobile + 'scm/pulls/detail/',
              contents: `export const PullCommentLabel=({comment})=><span>{comment.kind}</span>;`,
            },
          ]
    const { page, errors } = await mount(
      `${react}import{PullComments}from'./${source}';
const comment=(id,more)=>({id,author:'Dominic',kind:'inline',body:'Body '+id,url:'https://github.com/team/project/pull/1#discussion_'+id,path:'src/a.ts',resolved:true,...more});
const comments=[comment('a',{threadId:'thread'}),comment('b',{threadId:'thread',author:'Jane'}),comment('open',{resolved:false}),comment('general',{kind:'comment'})];
function App(){const[fragment,setFragment]=useState('');window.target=setFragment;return <PullComments comments={comments} onOpen={()=>{}} fragment={fragment} onAction={()=>{}} actionContext={{detail:{pull:{provider:'github'}}}}/>};createRoot(document.getElementById('app')).render(<App/>);`,
      stubs,
      platform === 'desktop' ? 1000 : 390,
    )
    await page.getByText('Body open', { exact: true }).waitFor()
    assert.equal(await page.getByText('Body a', { exact: true }).count(), 0)
    await page.getByText('Body general', { exact: true }).waitFor()
    const toggle =
      platform === 'desktop'
        ? page.locator('details[aria-label="Resolved discussion"] > summary')
        : page.getByRole('button', { name: 'Resolved discussion by Dominic, Jane' })
    await toggle.click()
    await page.getByText('Body a', { exact: true }).waitFor()
    await page.getByText('Body b', { exact: true }).waitFor()
    await toggle.click()
    await page.getByText('Body a', { exact: true }).waitFor({ state: 'detached' })
    await page.evaluate((platform) => {
      if (platform === 'desktop') {
        window.location.hash = '#discussion_b'
      } else window.target('#discussion_b')
    }, platform)
    await page.getByText('Body b', { exact: true }).waitFor()
    await toggle.click()
    await page.getByText('Body b', { exact: true }).waitFor({ state: 'detached' })
    assert.deepEqual(errors, [])
    await page.close()
    console.log(
      platform +
        ' discussions: resolved groups collapse, open/general comments stay visible, links reveal full replies and can collapse again.',
    )
  }
  const { page, errors } = await mount(
    `${react}
import{InterfaceLanguageProvider,useInterfaceText,interfaceDirection}from'./packages/studio-core/src/interface-language';
import{interfaceLanguages}from'@dovo/protocol';
function Controls(){const t=useInterfaceText();const[draft,setDraft]=useState('Private draft');return <><button>{t('Settings')}</button><textarea aria-label="Draft" value={draft} onChange={event=>setDraft(event.target.value)}/><p>User supplied Settings</p></>}
function App(){const[language,setLanguage]=useState('en-US');return <InterfaceLanguageProvider language={language}><main dir={interfaceDirection(language)}><select aria-label="Interface language" value={language} onChange={event=>setLanguage(event.target.value)}>{interfaceLanguages.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select><Controls/></main></InterfaceLanguageProvider>};createRoot(document.getElementById('app')).render(<App/>);`,
    [],
  )
  await page.getByRole('textbox', { name: 'Draft' }).fill('Unsent draft')
  for (const [language, label] of [
    ['nl-NL', 'Instellingen'],
    ['de-DE', 'Einstellungen'],
    ['tr-TR', 'Ayarlar'],
    ['fr-CA', 'Paramètres'],
    ['pt-BR', 'Definições'],
    ['ar-AR', 'الإعدادات'],
  ]) {
    await page.getByRole('combobox').selectOption(language)
    await page.getByRole('button', { name: label, exact: true }).waitFor()
    assert.equal(await page.getByRole('textbox', { name: 'Draft' }).inputValue(), 'Unsent draft')
    await page.getByText('User supplied Settings', { exact: true }).waitFor()
  }
  assert.equal(await page.locator('main').getAttribute('dir'), 'rtl')
  assert.deepEqual(errors, [])
  await page.close()
  console.log(
    'Interface languages: live locale changes, regional choices, RTL and draft/user-text preservation pass.',
  )
} finally {
  await browser.close()
}
