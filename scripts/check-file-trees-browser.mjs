import assert from 'node:assert/strict'
import { mkdir, readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const nativeRoot = `${root}/apps/mobile/src/ui`
const native = `
const flat=style=>Array.isArray(style)?Object.assign({},...style.map(flat)):style||{};
const css=style=>{const value=flat(style);const {fontVariant,...rest}=value;return {...rest,fontVariantNumeric:fontVariant?.includes('tabular-nums')?'tabular-nums':undefined}};
export const View=({children,style})=><div style={{display:'flex',flexDirection:'column',boxSizing:'border-box',minWidth:0,...css(style)}}>{children}</div>;
export const Text=({children,style,numberOfLines,accessibilityRole})=><span role={accessibilityRole} style={{display:'block',...(numberOfLines===1?{overflow:'hidden',whiteSpace:'nowrap',textOverflow:'ellipsis'}:{}),...css(style)}}>{children}</span>;
export const Pressable=({children,style,onPress,disabled,accessibilityLabel,accessibilityRole,accessibilityState})=><button role={accessibilityRole} disabled={disabled} aria-label={accessibilityLabel} aria-expanded={accessibilityState?.expanded} aria-pressed={accessibilityState?.selected} onClick={onPress} style={{display:'flex',boxSizing:'border-box',width:'100%',border:0,textAlign:'left',font:'inherit',cursor:'pointer',...css(style)}}>{children}</button>;
export const SectionList=({sections,renderItem,renderSectionHeader,keyExtractor})=><div style={{flex:1,overflowY:'auto'}}>{sections.map((section,index)=><div key={index}>{renderSectionHeader({section})}{section.data.map(item=><div key={keyExtractor(item)}>{renderItem({item})}</div>)}</div>)}</div>;
`
const bundle = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `import {createRoot} from 'react-dom/client';import {useState} from 'react';import {FileBrowserTree} from '${root}/packages/studio-ui/src/file-tree.tsx';import {ReviewFiles} from '${root}/packages/studio-ui/src/review/file-review.tsx';import {MobileFileTree} from '${nativeRoot}/content/file-tree.tsx';
const files=[
{path:'src/app/layout.tsx',additions:8,deletions:3,viewed:true},
{path:'src/app/page.tsx',additions:24,deletions:9,viewed:false},
{path:'src/components/TaskCard.tsx',additions:42,deletions:18,viewed:false},
{path:'src/components/ui/button.tsx',additions:12,deletions:4,viewed:true},
{path:'src/components/ui/input.tsx',additions:6,deletions:2,viewed:false},
{path:'src/lib/api.ts',additions:31,deletions:7,viewed:true},
{path:'src/lib/utils.ts',additions:5,deletions:1,viewed:false},
{path:'tests/task-card.test.tsx',additions:28,deletions:0,viewed:false},
{path:'assets/brand/mark.svg',label:'Image',viewed:true},
{path:'package.json',additions:2,deletions:1,viewed:true},
{path:'pnpm-lock.yaml',additions:68,deletions:31,viewed:false},
{path:'README.md',additions:10,deletions:2,viewed:true},
{path:'.gitattributes',additions:3,deletions:0,viewed:false},
];
window.setMode=null;window.setSelected=null;window.setSearch=null;
function App(){const [mode,setMode]=useState('desktop'),[selected,setSelected]=useState('src/components/TaskCard.tsx'),[query,setQuery]=useState(''),[related,setRelated]=useState(false),[disabled,setDisabled]=useState(false);window.setMode=setMode;window.setSelected=setSelected;window.setSearch=setQuery;window.setDisabled=setDisabled;const filtered=files.filter(file=>file.path.toLowerCase().includes(query.toLowerCase()));return <main className="studio dark" data-mode={mode} style={{width:mode==='mobile'?390:1000,height:mode==='mobile'?844:760,background:'var(--background)',color:'var(--foreground)',fontFamily:'system-ui',padding:mode==='mobile'?16:28,boxSizing:'border-box'}}><header style={{marginBottom:20}}><div style={{fontSize:12,color:'var(--muted-foreground)',marginBottom:6}}>Dovo Studio</div><h1 style={{fontSize:22,fontWeight:600,margin:0}}>Files</h1><p style={{fontSize:13,color:'var(--muted-foreground)',marginTop:6}}>13 files · 6 viewed</p></header>{mode==='mobile'?<section data-client="mobile" style={{height:640,display:'flex',flexDirection:'column',gap:12}}><input aria-label="Search files" placeholder="Search files…" value={query} onChange={event=>setQuery(event.target.value)} style={{border:'1px solid var(--border)',borderRadius:10,background:'var(--card)',color:'var(--foreground)',padding:12,fontSize:14}}/><MobileFileTree files={filtered} selected={selected} onSelect={setSelected} search={query} disabled={disabled}/></section>:<div style={{display:'flex',gap:24,height:590}}><section data-client="project" style={{width:400,minWidth:0,display:'flex',flexDirection:'column',border:'1px solid var(--border)',borderRadius:12,overflow:'hidden'}}><header className="border-b bg-sidebar px-3 py-3 text-xs font-medium">Project files</header><div className="border-b p-2"><input type="search" aria-label="Search project files" placeholder="Search files…" value={query} onChange={event=>setQuery(event.target.value)} className="h-9 w-full rounded-md border border-border/60 bg-background px-3 text-xs" /></div><div className="min-h-0 flex-1 overflow-auto p-1.5"><FileBrowserTree files={filtered} selected={selected} onSelect={setSelected} search={query} disabled={disabled}/></div></section><section data-client="review" style={{width:420,minWidth:0,display:'flex',flexDirection:'column',border:'1px solid var(--border)',borderRadius:12,overflow:'hidden'}}><header className="border-b bg-sidebar px-3 py-3 text-xs font-medium">Changed files</header><ReviewFiles files={files} groups={[]} related={related} onRelatedChange={setRelated} selected={selected} onSelect={setSelected} disabled={disabled}/></section></div>}<footer data-selection style={{marginTop:16,fontSize:12,color:'var(--muted-foreground)'}}>{selected}</footer></main>};createRoot(document.getElementById('app')).render(<App/>);`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    alias: {
      react: `${root}/packages/studio-ui/node_modules/react`,
      'react-dom': `${root}/packages/studio-ui/node_modules/react-dom`,
      '@dovo/protocol': `${root}/packages/protocol/src/index.ts`,
    },
    nodePaths: [`${root}/packages/studio-ui/node_modules`, `${root}/node_modules`],
  },
  [
    { path: 'react-native', contents: native },
    { path: './text', importer: nativeRoot, contents: "export {Text} from 'react-native';" },
    {
      path: '../theme',
      importer: nativeRoot,
      contents: `export const useTheme=()=>({colors:{text:'#ededed',muted:'#9a9a9a',selection:'#292c31',accent:'#8aa4e6',border:'#343434',warning:'#e7c681',syntaxKeyword:'#9cb3f2',success:'#8ad5b0',error:'#ff7e97'},styles:{muted:{color:'#9a9a9a',fontSize:12}}});`,
    },
    {
      path: '../controls/icon',
      importer: nativeRoot,
      contents: `import {File,FileCode2,FileImage,FileJson,FileText,Folder,Check,ChevronDown,ChevronRight,Settings,SquareTerminal} from 'lucide-react';const icons={file:File,code:FileCode2,fileImage:FileImage,fileJson:FileJson,fileText:FileText,folder:Folder,check:Check,down:ChevronDown,next:ChevronRight,settings:Settings,terminal:SquareTerminal};export const Icon=({name,size,color})=>{const Glyph=icons[name];return <Glyph aria-hidden size={size} color={color} style={{flexShrink:0}}/>};`,
    },
  ],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 760 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent(
    '<style>body{margin:0}button,input{font-family:inherit}</style><div id="app"></div>',
  )
  for (const file of (await readdir(`${root}/apps/desktop/dist/assets`)).filter((file) =>
    file.endsWith('.css'),
  ))
    await page.addStyleTag({
      content: await readFile(`${root}/apps/desktop/dist/assets/${file}`, 'utf8'),
    })
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  const project = page.locator('[data-client="project"]')
  const selected = project.getByRole('button', {
    name: 'src/components/TaskCard.tsx, unviewed',
    exact: true,
  })
  await selected.waitFor()
  for (const client of ['project', 'review']) {
    for (const folder of await page
      .locator(`[data-client="${client}"] button[aria-expanded]`)
      .all()) {
      assert.equal(await folder.locator('[title$=" files"], [title$=" viewed"]').count(), 0)
      assert.doesNotMatch(await folder.innerText(), /\d+\/\d+/)
    }
  }
  assert.equal(await project.locator('[data-file-tree-row][tabindex="0"]').count(), 1)
  await selected.focus()
  await page.keyboard.press('Tab')
  assert.equal(
    await page.evaluate(() => document.activeElement?.hasAttribute('data-file-tree-row')),
    false,
  )
  await selected.focus()
  await page.keyboard.press('ArrowLeft')
  assert.equal(
    await page.evaluate(() => document.activeElement.getAttribute('aria-label')),
    'src/components',
  )
  await page.keyboard.press('ArrowLeft')
  assert.equal(await selected.count(), 0)
  await page.keyboard.press('ArrowRight')
  await selected.waitFor()
  await project.getByRole('searchbox', { name: 'Search project files' }).fill('ui/input')
  await project
    .getByRole('button', { name: 'src/components/ui/input.tsx, unviewed', exact: true })
    .waitFor()
  await project.getByRole('button', { name: 'src/components/ui', exact: true }).click()
  assert.equal(
    await project
      .getByRole('button', { name: 'src/components/ui/input.tsx, unviewed', exact: true })
      .count(),
    0,
  )
  await project.getByRole('searchbox', { name: 'Search project files' }).fill('')
  await selected.waitFor()
  await page.evaluate(() => window.setDisabled(true))
  await page.waitForFunction(
    () => document.querySelector('[data-client="project"] [aria-current="true"]').disabled,
  )
  await page.evaluate(() => window.setDisabled(false))
  const screenshots = process.env.DOVO_SCREENSHOT_DIR
  if (screenshots) {
    await mkdir(screenshots, { recursive: true })
    await page.evaluate(() => document.activeElement?.blur())
    await page.mouse.move(0, 0)
    await page.screenshot({ path: `${screenshots}/file-trees-desktop-dark.png` })
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'))
    await page.evaluate(() => document.activeElement?.blur())
    await page.mouse.move(0, 0)
    await page.screenshot({ path: `${screenshots}/file-trees-desktop-light.png` })
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
  }
  await page.evaluate(() => window.setMode('mobile'))
  await page.setViewportSize({ width: 390, height: 844 })
  const mobile = page.locator('[data-client="mobile"]')
  await mobile
    .getByRole('button', { name: 'src/components/TaskCard.tsx, unviewed', exact: true })
    .waitFor()
  for (const folder of await mobile.locator('button[aria-expanded]').all()) {
    assert.doesNotMatch(await folder.innerText(), /\d/)
  }
  await mobile.getByRole('button', { name: 'src/components', exact: true }).click()
  assert.equal(
    await mobile
      .getByRole('button', { name: 'src/components/TaskCard.tsx, unviewed', exact: true })
      .count(),
    0,
  )
  await page.getByRole('textbox', { name: 'Search files' }).fill('ui/input')
  await mobile
    .getByRole('button', { name: 'src/components/ui/input.tsx, unviewed', exact: true })
    .click()
  await page.getByRole('textbox', { name: 'Search files' }).fill('')
  await mobile
    .getByRole('button', { name: 'src/components/ui/input.tsx, unviewed', exact: true })
    .waitFor()
  assert.equal(
    await page.locator('main').evaluate((element) => element.scrollWidth <= element.clientWidth),
    true,
  )
  if (screenshots) {
    await page.evaluate(() => document.activeElement?.blur())
    await page.mouse.move(0, 0)
    await page.screenshot({ path: `${screenshots}/file-trees-mobile-preview.png` })
  }
  assert.deepEqual(errors, [])
  console.log(
    'Shared file trees: nested folders, compressed paths, keyboard navigation, selected-file reveal, search expansion/collapse, edit guard, and mobile layout passed.',
  )
} finally {
  await browser.close()
}
