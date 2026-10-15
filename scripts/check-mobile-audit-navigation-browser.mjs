import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const mobile = root + 'apps/mobile/'
// Actual header/review/actions with browser adapters at native boundaries. CSS models RN's
// column layout, zero default shrink and text scaling; native measurement needs a device.
const native = `
const flat=s=>Array.isArray(s)?Object.assign({},...s.map(flat)):s??{};
const css=s=>{const v=flat(s);return {...v,paddingLeft:v.paddingLeft??v.paddingHorizontal,paddingRight:v.paddingRight??v.paddingHorizontal,paddingTop:v.paddingTop??v.paddingVertical,paddingBottom:v.paddingBottom??v.paddingVertical}};
const base={display:'flex',flexDirection:'column',boxSizing:'border-box',flexShrink:0,minHeight:0};
export const View=({children,style,testID})=><div data-testid={testID} style={{...base,...css(style)}}>{children}</div>;
export const Pressable=({children,style,onPress,disabled,accessibilityLabel,accessibilityRole})=><button aria-label={accessibilityLabel} role={accessibilityRole} disabled={disabled} onClick={onPress} style={{...base,padding:0,border:0,background:'transparent',font:'inherit',...css(typeof style==='function'?style({pressed:false}):style)}}>{children}</button>;
export const Text=({children,style})=>{const v=css(style);return <span style={{display:'block',...v,fontSize:(v.fontSize??14)*window.fontScale,lineHeight:v.lineHeight?v.lineHeight*window.fontScale+'px':undefined}}>{children}</span>};
export const Switch=({accessibilityLabel,value,onValueChange,disabled})=><button role="switch" aria-label={accessibilityLabel} aria-checked={value} disabled={disabled} onClick={()=>onValueChange(!value)} style={{width:51,height:31,flexShrink:0}}>●</button>;
export const Modal=({visible,children})=>visible?<div role="dialog">{children}</div>:null;
export const TextInput=()=>null;
export const Platform={get OS(){return window.os}};
`
const theme = `export const useTheme=()=>({colors:{text:'#111',muted:'#666',border:'#ddd',accent:'#005cc5'},styles:{row:{flexDirection:'row',alignItems:'center',flexWrap:'wrap',gap:6}}});`
const icons = `import {Pressable} from 'react-native';export const IconButton=({label,onPress,disabled,size=44})=><Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} disabled={disabled} style={{width:size,height:size,flexShrink:0}}/>;`
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: mobile,
      loader: 'tsx',
      contents: `
import {useState} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {ScreenHeader,ScreenBackContext} from './src/ui/layout/screen-header';
import {MobileFileReview} from './src/scm/review/file-review';
const root=createRoot(document.getElementById('app'));
window.events=[];
window.renderHeader=options=>flushSync(()=>root.render(<ScreenBackContext.Provider value={options.context?()=>window.events.push('context'):null}><ScreenHeader title="Start a task" onBack={options.explicit?()=>window.events.push('explicit'):undefined} leading={options.leading?<button>Custom leading</button>:undefined} hidden={options.hidden}/></ScreenBackContext.Provider>));
const files=[{path:'first.ts',viewed:false},{path:'second.ts',viewed:true},{path:'last.ts',viewed:false}];
function Review(){const [selected,setSelected]=useState('second.ts');return <MobileFileReview files={files} groups={[]} selected={selected} onSelect={path=>{window.events.push(path);setSelected(path)}} related={false} onRelatedChange={()=>{}} onViewed={value=>window.events.push(value)} navigationDisabled={window.navigationDisabled} onRetry={()=>{}}/>}
window.renderReview=()=>flushSync(()=>root.render(<Review/>));
`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    alias: { react: mobile + 'node_modules/react' },
    nodePaths: [mobile + 'node_modules', root + 'node_modules'],
  },
  [
    { path: 'react-native', contents: native },
    {
      path: 'expo-router',
      contents: `import {Pressable} from 'react-native';export const Stack={Screen:({options})=>{window.stackOptions=options;return null},Toolbar:({children})=><div>{children}</div>};Stack.Toolbar.Button=({accessibilityLabel,onPress})=><Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress}/>;`,
    },
    {
      path: '../../runtime/preferences/app-build',
      importer: mobile,
      contents: `export const appChannel='';`,
    },
    {
      path: '../../runtime/state/application-state',
      importer: mobile,
      contents: `export {useState as useApplicationState} from 'react';`,
    },
    {
      path: '../../shell/navigation',
      importer: mobile,
      contents: `import {createContext} from 'react';export const NavigationContext=createContext(null);`,
    },
    {
      path: './sheet',
      importer: mobile + 'src/ui/layout/',
      contents: `export const useInsideSheet=()=>window.inSheet;export const Sheet=({children})=>children;`,
    },
    { path: '../../ui/theme', importer: mobile, contents: theme },
    { path: '../theme', importer: mobile + 'src/ui/', contents: theme },
    {
      path: '../controls/icon-assets',
      importer: mobile + 'src/ui/layout/',
      contents: `export const iconAssets={back:'back'};`,
    },
    {
      path: '../controls/icon',
      importer: mobile + 'src/ui/layout/',
      contents: `export const Icon=()=>null;`,
    },
    { path: '../controls/icon-button', importer: mobile + 'src/ui/layout/', contents: icons },
    { path: './icon-button', importer: mobile + 'src/ui/controls/', contents: icons },
    {
      path: '../content/text',
      importer: mobile + 'src/ui/',
      contents: `export {Text} from 'react-native';`,
    },
    {
      path: '../../ui/content/text',
      importer: mobile,
      contents: `export {Text} from 'react-native';`,
    },
    {
      path: '../../ui/content/file-tree',
      importer: mobile,
      contents: `export const MobileFileTree=()=>null;export const MobileFileTypeIcon=()=>null;`,
    },
    {
      path: 'react-native-safe-area-context',
      contents: `export const useSafeAreaInsets=()=>({top:0,bottom:0});`,
    },
  ],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 320, height: 740 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent(
    '<style>body{margin:0;font-family:system-ui}#app{padding:16px}</style><div id="app"></div>',
  )
  await page.evaluate(() => {
    window.os = 'android'
    window.fontScale = 1
    window.inSheet = false
  })
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const back = page.getByRole('button', { name: 'Back', exact: true })
  for (const options of [
    { explicit: true },
    { context: true },
    { explicit: true, context: true },
  ]) {
    await page.evaluate((options) => window.renderHeader(options), options)
    await back.click()
    assert.equal(
      await page.evaluate(() => window.events.at(-1)),
      options.explicit ? 'explicit' : 'context',
    )
  }
  for (const options of [{}, { explicit: true, leading: true }, { explicit: true, hidden: true }]) {
    await page.evaluate((options) => window.renderHeader(options), options)
    assert.equal(await back.count(), 0)
  }
  await page.evaluate(() => {
    window.inSheet = true
    window.renderHeader({ explicit: true, context: true })
  })
  assert.equal(await back.count(), 0, 'Sheet keeps its own close control')
  await page.evaluate(() => {
    window.inSheet = false
    window.os = 'ios'
    window.renderHeader({ explicit: true })
  })
  assert.equal(await page.evaluate(() => window.stackOptions.headerBackVisible), false)
  await back.click()
  assert.equal(await page.evaluate(() => window.events.at(-1)), 'explicit')
  await page.evaluate(() => window.renderHeader({ context: true }))
  assert.equal(await page.evaluate(() => window.stackOptions.headerBackVisible), true)
  assert.equal(await back.count(), 0, 'iOS keeps native context back navigation')

  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 740 })
    for (const scale of [1, 2, 3]) {
      await page.evaluate((scale) => {
        window.fontScale = scale
        window.renderReview()
      }, scale)
      for (const label of ['Previous file', 'Next file', 'Next unviewed']) {
        const geometry = await page.getByRole('button', { name: label, exact: true }).boundingBox()
        assert.ok(
          geometry.x >= 16 && geometry.x + geometry.width <= width - 16 + 1,
          `${label} escapes ${width}px at ${scale}x text`,
        )
        assert.ok(geometry.height >= 44)
      }
      if (scale >= 2) {
        const previous = await page
          .getByRole('button', { name: 'Previous file', exact: true })
          .boundingBox()
        const unviewed = await page
          .getByRole('button', { name: 'Next unviewed', exact: true })
          .boundingBox()
        assert.ok(unviewed.y >= previous.y + previous.height, 'Text action must wrap below arrows')
      }
    }
  }
  await page.getByRole('button', { name: 'Previous file', exact: true }).click()
  assert.equal(await page.evaluate(() => window.events.at(-1)), 'first.ts')
  await page.getByRole('button', { name: 'Next file', exact: true }).click()
  assert.equal(await page.evaluate(() => window.events.at(-1)), 'second.ts')
  await page.getByRole('button', { name: 'Next unviewed', exact: true }).click()
  assert.equal(await page.evaluate(() => window.events.at(-1)), 'last.ts')
  await page.getByRole('button', { name: 'Next unviewed', exact: true }).click()
  assert.equal(await page.evaluate(() => window.events.at(-1)), 'first.ts')
  await page.evaluate(() => {
    window.navigationDisabled = true
    window.renderReview()
  })
  for (const label of ['Previous file', 'Next file', 'Next unviewed'])
    assert.ok(await page.getByRole('button', { name: label, exact: true }).isDisabled())
  assert.deepEqual(errors, [])
  console.log(
    'Mobile audit navigation: explicit/context Android Back, precedence, leading/hidden/sheet guards, iOS toolbar contract; review bounds at 320/390px and 1/2/3x text, file navigation and disabled state passed. Native geometry remains unverified.',
  )
} finally {
  await browser.close()
}
