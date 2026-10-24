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
export const Pressable=({children,style,onPress,disabled,accessibilityLabel,accessibilityRole,accessibilityState})=><button aria-checked={accessibilityState?.checked} aria-expanded={accessibilityState?.expanded} aria-pressed={accessibilityState?.selected} aria-label={accessibilityLabel} role={accessibilityRole} disabled={disabled} onClick={onPress} style={{...base,padding:0,border:0,background:'transparent',font:'inherit',...css(typeof style==='function'?style({pressed:false}):style)}}>{children}</button>;
export const Text=({children,style,accessibilityRole})=>{const v=css(style);return <span role={accessibilityRole==='header'?'heading':accessibilityRole} style={{display:'block',...v,fontSize:(v.fontSize??14)*window.fontScale,lineHeight:v.lineHeight?v.lineHeight*window.fontScale+'px':undefined}}>{children}</span>};
export const Switch=({accessibilityLabel,value,onValueChange,disabled})=><button role="switch" aria-label={accessibilityLabel} aria-checked={value} disabled={disabled} onClick={()=>onValueChange(!value)} style={{width:51,height:31,flexShrink:0}}>●</button>;
export const Modal=({visible,children})=>visible?<div role="dialog">{children}</div>:null;
export const TextInput=()=>null;
export const Platform={get OS(){return window.os}};export const Keyboard={dismiss:()=>window.events.push('keyboard-dismiss')};
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
import {backToCollection} from './src/shell/source-route';window.goBackToTasks=()=>backToCollection('/');
import {ScreenHeader,ScreenBackContext,InlineScreenHeaderContext} from './src/ui/layout/screen-header';
import {MobileFileReview} from './src/scm/review/file-review';
const root=createRoot(document.getElementById('app'));
window.events=[];
window.renderHeader=options=>flushSync(()=>root.render(<InlineScreenHeaderContext.Provider value={!!options.inline}><ScreenBackContext.Provider value={options.context?()=>window.events.push('context'):null}><ScreenHeader title="Start a task" onBack={options.explicit?()=>window.events.push('explicit'):undefined} leading={options.leading?<button>Custom leading</button>:undefined} hidden={options.hidden} buttons={window.headerButtons} collapsedMenuGroups={['Project','Advanced']}/></ScreenBackContext.Provider></InlineScreenHeaderContext.Provider>));
const files=[{path:'first.ts',viewed:false},{path:'second.ts',viewed:true},{path:'last.ts',viewed:false}];
function Review(){const [selected,setSelected]=useState('second.ts'),[wrap,setWrap]=useState(false);return <MobileFileReview files={files} groups={[]} selected={selected} onSelect={path=>{window.events.push(path);setSelected(path)}} related={false} onRelatedChange={()=>{}} onViewed={value=>window.events.push(value)} navigationDisabled={window.navigationDisabled} wrapLines={wrap} onWrapLinesChange={setWrap} onRetry={()=>{}}/>}
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
      contents: `import {Pressable} from 'react-native';export const router={canGoBack:()=>window.canGoBack,back:()=>window.events.push('router-back'),replace:path=>window.events.push('replace:'+path)};export const Stack={Screen:({options})=>{window.stackOptions=options;return null},Toolbar:({children})=><div>{children}</div>};Stack.Toolbar.Button=({accessibilityLabel,onPress})=><Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress}/>;Stack.Toolbar.Menu=({children,title,accessibilityLabel,inline})=><div role="group" aria-label={title??accessibilityLabel} data-inline={String(!!inline)}>{children}</div>;Stack.Toolbar.MenuAction=({children,onPress,disabled,isOn,destructive})=><button disabled={disabled} aria-pressed={isOn} data-destructive={String(!!destructive)} onClick={onPress}>{children}</button>;`,
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
      contents: `import {useImperativeHandle} from 'react';export const useInsideSheet=()=>window.inSheet;export const Sheet=({children,ref,onClose})=>{useImperativeHandle(ref,()=>({dismiss:after=>{onClose?.();queueMicrotask(()=>after?.())}}));return children};`,
    },
    {
      path: '../../ui/controls/icon',
      importer: mobile,
      contents:
        'export const Icon=({size=20})=><span style={{width:size,height:size,flexShrink:0}}/>;',
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
  assert.equal(await page.evaluate(() => window.stackOptions.headerBackVisible), false)
  await back.click()
  assert.equal(await page.evaluate(() => window.events.at(-1)), 'context')
  assert.equal(await page.evaluate(() => window.stackOptions.gestureEnabled), true)
  await page.evaluate(() => {
    window.stackOptions = { sentinel: true }
    window.renderHeader({ inline: true, explicit: true })
  })
  await page.getByTestId('Screen header').waitFor()
  assert.deepEqual(
    await page.evaluate(() => window.stackOptions),
    { sentinel: true },
    'Sidebar header must not change the detail navigator toolbar',
  )
  await back.click()
  assert.equal(await page.evaluate(() => window.events.at(-1)), 'explicit')

  await page.evaluate(() => window.renderHeader({}))
  assert.equal(await page.evaluate(() => window.stackOptions.headerBackVisible), true)
  assert.equal(
    await back.count(),
    0,
    'Routes without a custom action retain native back navigation',
  )
  for (const canGoBack of [true, false]) {
    await page.evaluate((canGoBack) => {
      window.canGoBack = canGoBack
      window.events = []
      window.goBackToTasks()
    }, canGoBack)
    assert.deepEqual(await page.evaluate(() => window.events), [
      'keyboard-dismiss',
      canGoBack ? 'router-back' : 'replace:/',
    ])
  }

  // Both menu renderers preserve groups, selection, guards and callbacks.
  await page.evaluate(() => {
    window.os = 'android'
    window.headerButtons = [
      {
        label: 'Devices',
        icon: 'device',
        group: 'Tools',
        overflow: true,
        onPress: () => window.events.push('devices'),
      },
      {
        label: 'Chat',
        icon: 'chat',
        group: 'Navigate',
        selected: true,
        overflow: true,
        onPress: () => window.events.push('chat'),
      },
      {
        label: 'Rename thread',
        icon: 'edit',
        group: 'Thread',
        overflow: true,
        onPress: () => window.events.push('rename'),
      },
      {
        label: 'Pin thread',
        icon: 'pin',
        group: 'Thread',
        overflow: true,
        disabled: true,
        onPress: () => window.events.push('pin'),
      },
      {
        label: 'Linked projects',
        icon: 'projects',
        group: 'Project',
        overflow: true,
        onPress: () => window.events.push('links'),
      },
      {
        label: 'Compact agent context',
        icon: 'collapse',
        group: 'Advanced',
        overflow: true,
        onPress: () => window.events.push('compact'),
      },
      {
        label: 'Delete thread…',
        icon: 'trash',
        group: 'Delete',
        overflow: true,
        destructive: true,
        onPress: () => window.events.push('delete'),
      },
    ]
    window.renderHeader({})
  })
  await page.getByRole('button', { name: 'More actions', exact: true }).click()
  assert.deepEqual(await page.getByRole('heading').allTextContents(), [
    'Start a task',
    'Tools',
    'Navigate',
    'Thread',
    'Delete',
  ])
  await page.getByRole('button', { name: 'Devices', exact: true }).click()
  assert.equal(await page.evaluate(() => window.events.at(-1)), 'devices')
  await page.getByRole('button', { name: 'More actions', exact: true }).click()
  assert.equal(
    await page.getByRole('button', { name: 'Chat', exact: true }).getAttribute('aria-pressed'),
    'true',
  )
  assert.ok(await page.getByRole('button', { name: 'Pin thread', exact: true }).isDisabled())
  assert.equal(await page.getByRole('button', { name: 'Linked projects', exact: true }).count(), 0)
  await page.getByRole('button', { name: 'Project', exact: true }).click()
  assert.equal(
    await page.getByRole('button', { name: 'Project', exact: true }).getAttribute('aria-expanded'),
    'true',
  )
  await page.getByRole('button', { name: 'Linked projects', exact: true }).click()
  assert.equal(await page.evaluate(() => window.events.at(-1)), 'links')
  assert.equal(await page.getByRole('button', { name: 'Rename thread', exact: true }).count(), 0)
  await page.getByRole('button', { name: 'More actions', exact: true }).click()
  assert.equal(
    await page.getByRole('button', { name: 'Project', exact: true }).getAttribute('aria-expanded'),
    'false',
  )
  await page.getByRole('button', { name: 'Advanced', exact: true }).click()
  await page.getByRole('button', { name: 'Compact agent context', exact: true }).click()
  assert.equal(await page.evaluate(() => window.events.at(-1)), 'compact')
  await page.evaluate(() => {
    window.os = 'ios'
    window.renderHeader({})
  })
  const menu = page.getByRole('group', { name: 'More actions', exact: true })
  assert.deepEqual(
    await menu.getByRole('group').evaluateAll((nodes) =>
      nodes.map((node) => ({
        name: node.getAttribute('aria-label'),
        inline: node.dataset.inline,
      })),
    ),
    [
      { name: 'Tools', inline: 'true' },
      { name: 'Navigate', inline: 'true' },
      { name: 'Thread', inline: 'true' },
      { name: 'Project', inline: 'false' },
      { name: 'Advanced', inline: 'false' },
      { name: 'Delete', inline: 'true' },
    ],
  )
  assert.equal(
    await menu
      .getByRole('button', { name: 'Delete thread…', exact: true })
      .getAttribute('data-destructive'),
    'true',
  )
  assert.ok(await menu.getByRole('button', { name: 'Pin thread', exact: true }).isDisabled())
  await menu.getByRole('button', { name: 'Chat', exact: true }).click()
  assert.equal(await page.evaluate(() => window.events.at(-1)), 'chat')
  await page.evaluate(() => {
    window.headerButtons = undefined
    window.os = 'android'
    window.renderHeader({})
  })

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
      const viewed = await page.getByRole('checkbox', { name: 'File viewed' }).boundingBox()
      const wrap = await page.getByRole('switch', { name: 'Wrap diff lines' }).boundingBox()
      assert.ok(wrap.x + wrap.width <= width - 16 + 1)
      assert.ok(wrap.height >= 44 && viewed.height >= 44)
      if (scale === 1)
        assert.equal(viewed.y, wrap.y, 'Viewed, navigation and wrapping share one toolbar')
    }
  }
  await page.getByRole('checkbox', { name: 'File viewed' }).click()
  assert.equal(await page.evaluate(() => window.events.at(-1)), false)
  await page.getByRole('switch', { name: 'Wrap diff lines' }).click()
  assert.equal(
    await page.getByRole('switch', { name: 'Wrap diff lines' }).getAttribute('aria-checked'),
    'true',
  )
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
    'Mobile audit navigation: explicit/context iOS and Android Back, direct-entry fallback, precedence, leading/hidden/sheet guards, iOS toolbar contract; review bounds at 320/390px and 1/2/3x text, file navigation and disabled state passed. Native geometry remains unverified.',
  )
} finally {
  await browser.close()
}
