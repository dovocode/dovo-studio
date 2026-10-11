import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { readFile, readdir } from 'node:fs/promises'
import { chromium } from './browser/harness.mjs'
const root = new URL('../', import.meta.url).pathname.replace(/\/$/, '')
const native = `
import {createPortal} from 'react-dom';
const flat=s=>Array.isArray(s)?Object.assign({},...s.map(flat)):s||{};
const css=s=>{const v=flat(s);return {...v,paddingLeft:v.paddingLeft??v.paddingHorizontal,paddingRight:v.paddingRight??v.paddingHorizontal,paddingTop:v.paddingTop??v.paddingVertical,paddingBottom:v.paddingBottom??v.paddingVertical}};
const base={display:'flex',flexDirection:'column',boxSizing:'border-box',flexShrink:0,minHeight:0};
export const View=({children,style})=><div style={{...base,...css(style)}}>{children}</div>;
export const Text=({children,style,accessibilityRole})=><span role={accessibilityRole} style={{display:'block',overflowWrap:'anywhere',...css(style)}}>{children}</span>;
export const Pressable=({children,style,onPress,disabled,accessibilityLabel,accessibilityRole,accessibilityState})=><button disabled={disabled} aria-label={accessibilityLabel} role={accessibilityRole} aria-pressed={accessibilityState?.selected} onClick={onPress} style={{...base,padding:0,border:0,textAlign:'left',font:'inherit',...css(typeof style==='function'?style({pressed:false}):style)}}>{children}</button>;
export const Switch=({value,onValueChange,accessibilityLabel,disabled})=><button role="switch" aria-label={accessibilityLabel} aria-checked={value} disabled={disabled} onClick={()=>onValueChange(!value)} style={{width:51,height:31,flexShrink:0}}>●</button>;
export const TextInput=({value,onChangeText,accessibilityLabel,placeholder,style})=><input aria-label={accessibilityLabel} placeholder={placeholder} value={value} onChange={e=>onChangeText(e.target.value)} style={{boxSizing:'border-box',...css(style)}}/>;
export const Modal=({visible,children})=>visible?createPortal(<div role="dialog" style={{position:'fixed',inset:0,zIndex:200,display:'flex'}}>{children}</div>,document.body):null;
export const SectionList=({sections,renderSectionHeader,renderItem,keyExtractor,ListEmptyComponent})=><div style={{flex:1,overflowY:'auto'}}>{sections.length?sections.map(section=><div key={section.title}>{renderSectionHeader({section})}{section.data.map(item=><div key={keyExtractor(item)}>{renderItem({item})}</div>)}</div>):ListEmptyComponent}</div>;
const listeners=new Set();export const AppState={currentState:'active',addEventListener(_,fn){listeners.add(fn);return {remove(){listeners.delete(fn)}}}};window.mobileForeground=()=>listeners.forEach(fn=>fn('active'));
`
const store = `
import {useSyncExternalStore} from 'react';import {changedFileFingerprint} from '@dovo/protocol';
let files=[{path:'types.ts',before:'export type Props = {}',after:'export type Props = {name:string}',viewed:false},{path:'src/view.tsx',before:'old',after:'new',viewed:false},{path:'src/view.test.ts',before:'old test',after:'new test',viewed:false}];
let revision=0;const listeners=new Set(),marks=new Map();
export const useFiles=()=>{useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>revision);return files};
window.changeFile=()=>{files=files.map(file=>file.path==='types.ts'?{...file,after:file.after+' '} : file);revision++;listeners.forEach(fn=>fn())};
export const request=async(path,input)=>{
 const current=files.map(file=>{const fingerprint=changedFileFingerprint(file);let row=marks.get(file.path);if(!row||row.fingerprint!==fingerprint){row={path:file.path,fingerprint,viewed:false,version:(row?.version??0)+1};marks.set(file.path,row)}return row});
 if(path.endsWith('/set')){const row=marks.get(input.path);if(!row||row.fingerprint!==input.fingerprint||row.version!==input.version)throw new Error('This file changed. Refresh before marking it again.');marks.set(input.path,{...row,viewed:input.viewed,version:row.version+1})}
 return {files:files.map(file=>marks.get(file.path)),groups:[{label:'types.ts',paths:['types.ts','src/view.tsx','src/view.test.ts'],basis:'ast'}]};
};
export const workspace={connected:true,activeRuntimeId:'host',request};export const runtime={connected:true,profile:{id:'host'},read:request,call:(path,...args)=>{if(path.endsWith('/read'))throw new Error('Review reads must not refresh workspace snapshots or persist offline caches');return request(path,...args)}};
`
const mocks = {
  'react-native': native,
  'test-store': store,
  '../../shell/navigation': 'export const useNavigation=()=>({focused:true});',
  'react-native-safe-area-context': 'export const useSafeAreaInsets=()=>({top:0,bottom:0});',
  '../workspace/context':
    "import {workspace} from 'test-store';export const useWorkspace=()=>workspace;",
  '../../runtime/connection/provider':
    "import {runtime} from 'test-store';export const useRuntime=()=>runtime;",
  '../../ui/theme': `export const useTheme=()=>({colors:{background:'#171717',surface:'#262626',text:'#eee',muted:'#aaa',border:'#555',success:'#8ad5b0',error:'#ff7e97'},styles:{row:{flexDirection:'row',alignItems:'center',flexWrap:'wrap',gap:6},muted:{color:'#aaa',fontSize:13},error:{color:'#ff7e97'},input:{border:'1px solid #555',borderRadius:10}}});`,
  '../../ui/content/text': "export {Text} from 'react-native';",
  '../../ui/controls/action': `import {Pressable,Text} from 'react-native';export const Action=({label,onPress,disabled,icon})=><Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} disabled={disabled} style={{minHeight:44,minWidth:44,justifyContent:'center',maxWidth:'100%'}}><Text style={{fontSize:14,color:'#8ad5b0'}}>{icon==='back'?'←':icon==='next'?'→':label}</Text></Pressable>;`,
}
const bundle = await build({
  stdin: {
    contents: `import {createRoot} from 'react-dom/client';import {useMemo,useState} from 'react';import {useFiles} from 'test-store';import {changedFileFingerprint,reviewFileState,orderReviewFiles} from '@dovo/protocol';import {useFileReview as useDesktopReview} from '${root}/packages/studio-core/src/review/use-file-review.ts';import {useFileReview as useMobileReview} from '${root}/apps/mobile/src/scm/review/use-file-review.ts';import {ReviewFiles,FileReviewControls} from '${root}/packages/studio-ui/src/review/file-review.tsx';import {MobileFileReview} from '${root}/apps/mobile/src/scm/review/file-review.tsx';
function Review({mobile=false}){const source=useFiles(),fingerprints=useMemo(()=>new Map(source.map(file=>[file.path,changedFileFingerprint(file)])),[source]);const useReview=mobile?useMobileReview:useDesktopReview;const review=useReview({kind:'task',taskId:'task',source:'working'},JSON.stringify([...fingerprints]));const [related,setRelated]=useState(true),[selected,setSelected]=useState('types.ts'),[editing,setEditing]=useState(false);const files=orderReviewFiles(source.map(file=>({...file,viewed:reviewFileState(review.progress,file.path,fingerprints.get(file.path))?.viewed??false})),review.progress?.groups??[],related);const file=files.find(file=>file.path===selected)||files[0];const props={files,groups:review.progress?.groups??[],selected:file.path,onSelect:setSelected,related,onRelatedChange:setRelated,onViewed:viewed=>review.setViewed(file.path,fingerprints.get(file.path),viewed),disabled:!review.ready||!reviewFileState(review.progress,file.path,fingerprints.get(file.path)),busy:review.busy,navigationDisabled:editing,error:review.error,onRetry:review.reload};return <section data-client={mobile?'mobile':'desktop'} style={{width:mobile?320:650,minWidth:0,border:'1px solid #555',padding:8}}><button onClick={()=>setEditing(v=>!v)}>{editing?'Cancel edit':'Edit draft'}</button>{mobile?<MobileFileReview {...props}/>:<><FileReviewControls {...props}/><div style={{display:'flex',height:400}}><aside style={{display:'flex',flexDirection:'column',width:300,minHeight:0}}><ReviewFiles {...props} disabled={editing}/></aside><pre data-diff>{file.path}</pre></div></>}</section>}
function App(){const [desktop,setDesktop]=useState(true);return <div className="studio dark" style={{display:'flex',gap:12,alignItems:'flex-start'}}><button onClick={()=>setDesktop(v=>!v)}>Reopen desktop</button>{desktop&&<Review/>}<Review mobile/></div>}createRoot(document.getElementById('app')).render(<App/>);`,
    resolveDir: root + '/packages/studio-ui',
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  alias: {
    react: root + '/packages/studio-ui/node_modules/react',
    '@dovo/protocol': root + '/packages/protocol/src/index.ts',
  },
  nodePaths: [root + '/packages/studio-ui/node_modules', root + '/node_modules'],
  plugins: [
    {
      name: 'boundaries',
      setup(b) {
        b.onResolve({ filter: /.*/ }, ({ path }) =>
          Object.hasOwn(mocks, path) ? { path, namespace: 'mock' } : undefined,
        )
        b.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({
          contents: mocks[path],
          loader: 'tsx',
          resolveDir: root + '/packages/studio-ui',
        }))
      },
    },
  ],
})
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } }),
    errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent(
    '<style>body{margin:0;background:#171717;color:#eee}button{cursor:pointer}</style><div id="app"></div>',
  )
  for (const name of (await readdir(root + '/apps/desktop/dist/assets')).filter((name) =>
    name.endsWith('.css'),
  ))
    await page.addStyleTag({
      content: await readFile(root + '/apps/desktop/dist/assets/' + name, 'utf8'),
    })
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  const desktop = page.locator('[data-client="desktop"]'),
    mobile = page.locator('[data-client="mobile"]')
  await desktop.getByRole('checkbox', { name: 'File viewed', exact: true }).check()
  await page.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange'))
    window.mobileForeground()
  })
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-client="mobile"] [role="switch"][aria-label="File viewed"]')
        .getAttribute('aria-checked') === 'true',
  )
  await desktop.getByRole('button', { name: 'Next unviewed', exact: true }).click()
  assert.equal(await desktop.locator('[data-diff]').textContent(), 'src/view.tsx')
  await desktop.getByRole('checkbox', { name: 'File viewed', exact: true }).check()
  await page.getByRole('button', { name: 'Reopen desktop' }).click()
  await page.getByRole('button', { name: 'Reopen desktop' }).click()
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-client="desktop"] button[role="checkbox"][aria-label="File viewed"]')
        .getAttribute('aria-checked') === 'true',
  )
  await page.evaluate(() => window.changeFile())
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-client="desktop"] button[role="checkbox"][aria-label="File viewed"]')
        .getAttribute('aria-checked') === 'false',
  )
  await desktop.getByRole('button', { name: 'Next file', exact: true }).click()
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-client="desktop"] button[role="checkbox"][aria-label="File viewed"]')
        .getAttribute('aria-checked') === 'true',
  )
  await desktop.getByRole('button', { name: 'Edit draft' }).click()
  assert.equal(
    await desktop.getByRole('button', { name: 'Next file', exact: true }).isDisabled(),
    true,
  )
  await desktop.getByRole('button', { name: 'Cancel edit' }).click()
  await desktop.getByRole('searchbox', { name: 'Search changed files' }).fill('test')
  await page.waitForFunction(
    () => document.querySelectorAll('[data-client="desktop"] nav button').length === 1,
  )
  assert.equal(await desktop.getByRole('navigation').getByRole('button').count(), 1)
  await mobile.getByRole('button', { name: 'Browse changed files' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox', { name: 'Search changed files' }).fill('test')
  await dialog.getByRole('button', { name: 'src/view.test.ts, unviewed', exact: true }).click()
  assert.equal(
    await mobile
      .getByRole('button', { name: 'Browse changed files' })
      .innerText()
      .then((text) => text.includes('view.test.ts')),
    true,
  )
  assert.equal(await mobile.evaluate((el) => el.scrollWidth <= el.clientWidth), true)
  await mobile.getByRole('button', { name: 'Browse changed files' }).click()
  await dialog.getByRole('textbox', { name: 'Search changed files' }).fill('')
  await dialog.getByRole('switch', { name: 'Unviewed only' }).click()
  assert.equal(
    await dialog.getByRole('button', { name: 'src/view.tsx, viewed', exact: true }).count(),
    0,
  )
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  assert.deepEqual(errors, [])
  console.log(
    'Review controls: paired progress, reopen, per-file reset, AST order, search, unviewed filter, draft guard and narrow mobile layout passed',
  )
} finally {
  await browser.close()
}
