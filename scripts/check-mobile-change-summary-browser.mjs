import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const mobile = `${root}/apps/mobile/src`
const native = `
const flat=style=>{const value=Array.isArray(style)?Object.assign({},...style.flat(Infinity).filter(Boolean)):{...style};for(const [key,axes] of Object.entries({paddingHorizontal:['paddingLeft','paddingRight'],paddingVertical:['paddingTop','paddingBottom'],marginHorizontal:['marginLeft','marginRight'],marginVertical:['marginTop','marginBottom']})){if(key in value){for(const axis of axes)value[axis]=value[key];delete value[key]}}if(value.borderWidth)value.borderStyle='solid';return value};
export const View=({children,style,accessibilityLabel,accessibilityRole,pointerEvents,accessibilityHint})=><div aria-description={accessibilityHint} role={accessibilityRole==='image'?'img':undefined} aria-label={accessibilityLabel} style={{display:'flex',flexDirection:'column',position:'relative',flexShrink:0,boxSizing:'border-box',...flat(style),...(pointerEvents==='none'?{pointerEvents:'none'}:{})}}>{children}</div>;
export const Pressable=({children,style,onPress,disabled,accessibilityLabel,accessibilityState,accessibilityHint})=><button aria-description={accessibilityHint} aria-label={accessibilityLabel} aria-expanded={accessibilityState?.expanded} aria-pressed={accessibilityState?.selected} disabled={disabled} onClick={onPress} style={{display:'flex',flexDirection:'column',position:'relative',boxSizing:'border-box',border:0,padding:0,textAlign:'left',background:'transparent',font:'inherit',...flat(typeof style==='function'?style({pressed:false}):style)}}>{children}</button>;
export const SectionList=()=>null;
`
const theme = `export const useTheme=()=>({mode:'dark',colors:{background:'#0b0b0f',surface:'#141419',border:'#30303a',text:'#ededf3',muted:'#a0a0b0',accent:'#a78bfa',selection:'#29203e',success:'#34d399',error:'#fb7185',warning:'#fbbf24',syntaxKeyword:'#38bdf8'},styles:{muted:{color:'#a0a0b0'}}});`
const bundle = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `import {createRoot} from 'react-dom/client';import {useState} from 'react';
import {ChangeSummary} from '${mobile}/ui/content/change-summary.tsx';import {MobileFileTree} from '${mobile}/ui/content/file-tree.tsx';import {pullFileKind} from '@dovo/protocol';
const files=[{path:'src/app.ts',additions:12,deletions:4},{path:'src/app.test.ts',additions:6,deletions:2},{path:'mocks/api.ts',additions:3,deletions:0},{path:'docs/readme.md',additions:1,deletions:1},{path:'generated/client.ts',additions:null,deletions:null,attributes:{generated:true}}];
function App(){const [expanded,setExpanded]=useState(false),[kind,setKind]=useState();const filtered=files.filter(file=>!kind||pullFileKind(file)===kind);return <main><ChangeSummary files={files} expanded={expanded} onExpandedChange={setExpanded} value={kind} onChange={setKind}><MobileFileTree files={filtered.map(file=>({...file,additions:file.additions??undefined,deletions:file.deletions??undefined,changeKind:pullFileKind(file)}))} onSelect={()=>{}} scrollable={false} defaultExpandedDepth={0} showChangeBars/></ChangeSummary></main>};createRoot(document.getElementById('app')).render(<App/>);`,
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
      'lucide-react': `${root}/packages/studio-ui/node_modules/lucide-react`,
    },
  },
  [
    { path: 'react-native', contents: native },
    {
      path: 'lucide-react-native',
      contents: `export {Box,CodeXml,FileText,FlaskConical,Settings} from 'lucide-react';`,
    },
    { path: '../theme', importer: `${mobile}/ui/content`, contents: theme },
    {
      path: './text',
      importer: `${mobile}/ui/content`,
      contents: `export const Text=({children,style,numberOfLines})=><span style={{...((Array.isArray(style)?Object.assign({},...style):style)||{}),...(numberOfLines===1?{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}:{})}}>{children}</span>;`,
    },
    {
      path: '../controls/icon',
      importer: `${mobile}/ui/content`,
      contents: `import {ChevronDown,ChevronRight,FileText,Folder,CodeXml,File,Settings,FileImage,FileJson,SquareTerminal} from 'lucide-react';const icons={down:ChevronDown,next:ChevronRight,fileText:FileText,folder:Folder,code:CodeXml,file:File,settings:Settings,fileImage:FileImage,fileJson:FileJson,terminal:SquareTerminal};export const Icon=({name,...props})=>{const Component=icons[name]??File;return <Component {...props}/>};`,
    },
  ],
)
const screenshotDir = process.env.DOVO_SCREENSHOT_DIR ?? '/tmp/dovo-mobile-change-summary'
await mkdir(screenshotDir, { recursive: true })
const browser = await chromium.launch()
try {
  for (const width of [320, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 800 }, deviceScaleFactor: 1 })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setContent(
      `<style>*{box-sizing:border-box}body{margin:0;background:#0b0b0f;color:#ededf3;font:13px system-ui}main{padding:12px}button{color:inherit}svg{flex-shrink:0}</style><div id="app"></div>`,
    )
    await page.addScriptTag({ content: bundle.outputFiles[0].text })
    const toggle = page.getByRole('button', { name: '5 files changed', exact: true })
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false')
    assert.match(await toggle.innerText(), /\+22.*−7.*available stats/)
    assert.equal(
      await toggle.getAttribute('aria-description'),
      '22 additions, 7 deletions, Available line counts only',
    )
    assert.match(
      await page.getByLabel('Generated, 1 files').getAttribute('aria-description'),
      /Additions unknown, Deletions unknown/,
    )
    assert.equal(await page.getByRole('button', { name: /Filter Code:/ }).count(), 0)
    await page.screenshot({ path: `${screenshotDir}/mobile-summary-${width}-collapsed.png` })
    await toggle.click()
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true')
    const code = page.getByRole('button', { name: 'Filter Code: 1 files', exact: true })
    const generated = page.getByRole('button', { name: 'Filter Generated: 1 files', exact: true })
    assert.equal(await code.getAttribute('aria-description'), '12 additions, 4 deletions')
    assert.match(
      await generated.getAttribute('aria-description'),
      /Additions unknown, Deletions unknown/,
    )
    for (const tile of await page.getByRole('button', { name: /^Filter / }).all())
      assert.ok((await tile.boundingBox()).height >= 44, 'Category tile needs a 44px target')
    assert.doesNotMatch(await generated.innerText(), /[+−]\d/, 'Unknown statistics remain unknown')
    assert.match(
      await page
        .getByRole('img', { name: /Available changed line distribution/ })
        .getAttribute('aria-label'),
      /Generated 0 lines/,
    )
    await code.click()
    assert.equal(await code.getAttribute('aria-pressed'), 'true')
    assert.equal(await page.getByRole('button', { name: 'docs', exact: true }).count(), 0)
    assert.equal(await page.getByRole('button', { name: 'src', exact: true }).count(), 1)
    await code.click()
    assert.equal(await code.getAttribute('aria-pressed'), 'false')
    await generated.click()
    assert.equal(await page.getByRole('button', { name: 'generated', exact: true }).count(), 1)
    await generated.click()
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      'Summary must fit the viewport',
    )
    await page.screenshot({
      path: `${screenshotDir}/mobile-summary-${width}-expanded.png`,
      fullPage: true,
    })
    await toggle.click()
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false')
    assert.deepEqual(errors, [])
    await page.close()
  }
  console.log(
    `Mobile change summary: collapse, category toggles, unknown statistics, and 320/390px layouts passed. Dark browser-adapter screenshots: ${screenshotDir}`,
  )
} finally {
  await browser.close()
}
