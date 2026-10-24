import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { mkdir } from 'node:fs/promises'
import { createServer } from 'vite-plus'
import tailwindcss from '@tailwindcss/vite'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const mobile = root + 'apps/mobile/src/'
const ui = root + 'packages/studio-ui/src/'
const native = `
const flat=s=>Array.isArray(s)?Object.assign({},...s.map(flat)):s??{};
const css=s=>{const v=flat(s);return {...v,paddingLeft:v.paddingHorizontal,paddingRight:v.paddingRight??v.paddingHorizontal,paddingTop:v.paddingVertical,paddingBottom:v.paddingVertical,fontSize:v.fontSize?v.fontSize*window.fontScale:undefined,lineHeight:v.lineHeight?v.lineHeight*window.fontScale+'px':undefined}};
export const View=({children,style})=><div style={{display:'flex',flexDirection:'column',boxSizing:'border-box',...css(style)}}>{children}</div>;
export const Text=({children,style,accessibilityRole})=><span role={accessibilityRole==='header'?'heading':undefined} style={css(style)}>{children}</span>;
export const Pressable=({children,style,onPress,disabled,accessibilityLabel,accessibilityState})=><button aria-label={accessibilityLabel} aria-pressed={accessibilityState?.selected} disabled={disabled} onClick={onPress} style={{display:'flex',padding:0,border:0,font:'inherit',...css(typeof style==='function'?style({pressed:false}):style)}}>{children}</button>;
export const TextInput=({ref,value,onChangeText,accessibilityLabel,style,editable})=><input ref={ref} aria-label={accessibilityLabel} value={value} onChange={event=>onChangeText?.(event.target.value)} disabled={editable===false} style={{boxSizing:'border-box',border:0,outline:0,background:'transparent',...css(style)}}/>;
export const Platform={OS:'android'};
export const Icon=({name,size})=><span aria-hidden="true" data-icon={name} style={{width:size,height:size,flexShrink:0}}/>;
export const useTheme=()=>({colors:{text:'#24292f',muted:'#57606a',surface:'#f6f8fa',border:'#d0d7de',selection:'#ddf4ff',action:'#24292f',accent:'#0969da',onAccent:'#fff'},styles:{muted:{color:'#57606a',fontSize:13,lineHeight:18},empty:{padding:24,alignItems:'center'}}});
`
const desktop = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `import {createRoot} from 'react-dom/client';import {useState} from 'react';import {TooltipProvider} from '@radix-ui/react-tooltip';import {studioThemes} from '${root}packages/studio-core/src/themes';Object.entries(studioThemes.dovo.light).forEach(([key,value])=>document.documentElement.style.setProperty('--'+key,value));import {SearchField} from '${ui}search-field';import {IconButton} from '${ui}components/icon-button';import {EmptyState} from '${ui}components/empty-state';import {Button} from '${ui}components/ui/button';
function App(){const [value,setValue]=useState('a search'),[selected,setSelected]=useState(false);return <TooltipProvider><main className="flex flex-col gap-4 p-4"><SearchField aria-label="Find threads" value={value} onValueChange={setValue}/><SearchField aria-label="Read only" value="Read only" readOnly onValueChange={()=>{}}/><SearchField aria-label="Disabled" value="Disabled" disabled onValueChange={()=>{}}/><IconButton label="Toggle view" aria-pressed={selected} onClick={()=>setSelected(v=>!v)}>V</IconButton><EmptyState title="No matching threads" description="Try another search or clear your filters." action={<Button onClick={()=>setValue('')}>Clear filters</Button>}/></main></TooltipProvider>}createRoot(document.getElementById('app')).render(<App/>);`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    jsx: 'automatic',
    alias: { react: ui + '../node_modules/react', 'react-dom': ui + '../node_modules/react-dom' },
    nodePaths: [ui + '../node_modules'],
  },
  [],
)
const mobileBundle = await bundleBrowser(
  {
    stdin: {
      resolveDir: root + 'apps/mobile',
      loader: 'tsx',
      contents: `import {createRoot} from 'react-dom/client';import {useState} from 'react';import {SearchField} from '${mobile}ui/controls/field';import {EmptyState} from '${mobile}ui/content/empty-state';import {IconButton} from '${mobile}ui/controls/icon-button';import {Action} from '${mobile}ui/controls/action';
function App(){const [value,setValue]=useState('a search'),[selected,setSelected]=useState(false);return <main style={{display:'flex',flexDirection:'column',gap:16,padding:16}}><SearchField label="Find threads" value={value} onChangeText={setValue}/><SearchField label="Read only" value="Read only"/><SearchField label="Disabled" value="Disabled" editable={false} onChangeText={()=>{}}/><IconButton label="Toggle view" icon="filters" selected={selected} onPress={()=>setSelected(v=>!v)}/><EmptyState icon="tasks" title="No matching threads" description="Try another search or clear your filters." action={<Action label="Clear filters" onPress={()=>setValue('')}/>}/></main>}createRoot(document.getElementById('app')).render(<App/>);`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    jsx: 'automatic',
    alias: {
      react: root + 'apps/mobile/node_modules/react',
      'react-dom': root + 'apps/mobile/node_modules/react-dom',
    },
  },
  [
    { path: 'react-native', contents: native },
    ...['../theme', './text', '../content/text', './icon', '../controls/icon'].map((path) => ({
      path,
      importer: mobile + 'ui/',
      contents: native,
    })),
    {
      path: './native-icon',
      importer: mobile + 'ui/controls/',
      contents: 'export const NativeIcon=()=>null;',
    },
    {
      path: '@expo/ui/swift-ui',
      contents: 'export const Button=()=>null;export const Host=()=>null;',
    },
    {
      path: '@expo/ui/swift-ui/modifiers',
      contents:
        'export const accessibilityAddTraits=()=>{},accessibilityLabel=()=>{},background=()=>{},buttonBorderShape=()=>{},buttonStyle=()=>{},contentShape=()=>{},controlSize=()=>{},disabled=()=>{},frame=()=>{},tint=()=>{},shapes={circle:()=>{}};',
    },
    {
      path: 'expo-glass-effect',
      contents:
        'export const isGlassEffectAPIAvailable=()=>false,isLiquidGlassAvailable=()=>false;',
    },
  ],
)
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
await mkdir('/tmp/dovo-ui-refinement', { recursive: true })
const browser = await chromium.launch()
try {
  for (const nativeUI of [false, true])
    for (const [width, fontScale] of [
      [320, 1],
      [390, 1],
      [840, 1],
      [320, 2],
    ]) {
      const page = await browser.newPage({
        viewport: { width, height: 1000 },
        hasTouch: width === 390,
      })
      page.setDefaultTimeout(5000)
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.setContent(
        '<html lang="en"><body style="margin:0;font-family:system-ui"><div id="app"></div></body></html>',
      )
      await page.evaluate((scale) => (window.fontScale = scale), fontScale)
      if (!nativeUI)
        await page.addStyleTag({ content: css + `html{font-size:${16 * fontScale}px}` })
      await page.addScriptTag({ content: (nativeUI ? mobileBundle : desktop).outputFiles[0].text })
      const input = page.getByRole('textbox', { name: 'Find threads', exact: true })
      const clear = page.getByRole('button', {
        name: nativeUI ? 'Clear find threads' : 'Clear search',
        exact: true,
      })
      const searchGeometry = () =>
        input.evaluate((node) => {
          const { x, y, width, height } = node.getBoundingClientRect(),
            css = getComputedStyle(node)
          return {
            x,
            y,
            width,
            height,
            paddingLeft: css.paddingLeft,
            paddingRight: css.paddingRight,
          }
        })
      const populated = await searchGeometry()
      await input.fill('Different search')
      await clear.click()
      assert.deepEqual(
        await searchGeometry(),
        populated,
        'Clearing preserves the input and usable text width',
      )
      assert.equal(await input.inputValue(), '')
      assert.equal(
        await input.evaluate((el) => el === document.activeElement),
        true,
        'Clearing keeps keyboard focus',
      )
      assert.equal(await clear.count(), 0)
      await input.fill('Search again')
      await clear.waitFor()
      assert.deepEqual(
        await searchGeometry(),
        populated,
        'Typing does not resize the input when clear appears',
      )
      const bounds = await clear.boundingBox()
      if (nativeUI || width === 390)
        assert.ok(
          bounds.width >= 44 && bounds.height >= 44,
          'Touch clear targets are at least 44px',
        )
      assert.equal(
        await page.getByRole('textbox', { name: 'Read only', exact: true }).inputValue(),
        'Read only',
      )
      assert.equal(
        await page.getByRole('textbox', { name: 'Disabled', exact: true }).isDisabled(),
        true,
      )
      assert.equal(
        await page.getByRole('button', { name: /^Clear/ }).count(),
        2,
        'Read only and disabled fields have no clear action',
      )
      const toggle = page.getByRole('button', { name: 'Toggle view', exact: true })
      const before = await toggle.evaluate((el) => getComputedStyle(el).backgroundColor)
      await toggle.click()
      await page.waitForFunction(
        () =>
          document.querySelector('[aria-label="Toggle view"]')?.getAttribute('aria-pressed') ===
          'true',
      )
      await page.waitForFunction(
        (before) =>
          getComputedStyle(document.querySelector('[aria-label="Toggle view"]')).backgroundColor !==
          before,
        before,
      )
      const after = await toggle.evaluate((el) => getComputedStyle(el).backgroundColor)
      assert.notEqual(before, after, 'Selection changes the button background')
      await page.getByRole('button', { name: 'Clear filters', exact: true }).click()
      assert.equal(await input.inputValue(), '')
      await page.getByRole('heading', { name: 'No matching threads', exact: true }).waitFor()
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
        `No overflow at ${width}px and ${fontScale}x text`,
      )
      if (width === 390)
        await page.screenshot({
          path: `/tmp/dovo-ui-refinement/${nativeUI ? 'mobile' : 'desktop'}.png`,
          fullPage: true,
        })
      assert.deepEqual(errors, [])
      await page.close()
    }
  console.log(
    'Desktop/mobile search: clearing, retained focus, read-only/disabled fields, touch targets, selected controls and empty-state recovery passed at phone/tablet widths and 2x text (native boundaries adapted).',
  )
} finally {
  await browser.close()
}
