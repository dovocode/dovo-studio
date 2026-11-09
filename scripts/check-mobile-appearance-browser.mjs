import { installThemeCatalogRoutes, exerciseThemeBrowser } from './browser/theme-catalog.mjs'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { studioThemeIds, studioThemes } from '../packages/studio-core/src/themes.ts'

const root = fileURLToPath(new URL('../', import.meta.url))
// Exercise native input identity and imperative updates; RN Web replacements are covered by Storybook.
const mocks = {
  'react-native-reanimated': `import {View} from 'react-native';const transition={duration:()=>transition,easing:()=>transition,reduceMotion:()=>transition};export const Easing={bezier:()=>undefined},LinearTransition=transition,ReduceMotion={Always:'always',System:'system'};export default {View};`,
  'expo-glass-effect': `import {useLayoutEffect} from 'react';import {StyleSheet} from 'react-native';export const isGlassEffectAPIAvailable=()=>window.nativeGlassAvailable!==false,isLiquidGlassAvailable=()=>window.nativeGlassAvailable!==false;export const GlassView=({children,glassEffectStyle,style})=>{useLayoutEffect(()=>{window.glassMounts.push(glassEffectStyle)},[]);return <div data-testid="Native glass" data-glass-effect={glassEffectStyle} style={StyleSheet.flatten(style)}>{children}</div>};`,
  'expo-document-picker': `export const getDocumentAsync=async()=>window.themeFile?{canceled:false,assets:[{uri:'theme.jsonc',name:'native.jsonc'}]}:{canceled:true};`,
  'expo-file-system': `export class File{get size(){return window.themeFile.length}async text(){return window.themeFile}}`,
  'react-native': `
    export const Text=({children,style})=><span style={style}>{children}</span>;export const ActivityIndicator=()=> <span role="progressbar"/>;
    import {useSyncExternalStore} from 'react';
    const flat=style=>Array.isArray(style)?Object.assign({},...style.map(flat)):style||{};
    const nativeStyle=style=>{const result={...flat(style)};for(const [key,axes] of Object.entries({paddingHorizontal:['paddingLeft','paddingRight'],paddingVertical:['paddingTop','paddingBottom'],marginHorizontal:['marginLeft','marginRight'],marginVertical:['marginTop','marginBottom']})){if(result[key]!==undefined){for(const axis of axes)result[axis]=result[key];delete result[key]}}return result};
    export const StyleSheet={create:styles=>styles,flatten:flat,hairlineWidth:1};
    export const Platform={OS:'ios'};
    export const Linking={openURL:async()=>{}};
    export const AppState={currentState:'active',addEventListener:()=>({remove(){}})};
    const transparencyListeners=new Set(),contrastListeners=new Set();window.setReduceTransparency=value=>transparencyListeners.forEach(listener=>listener(value));window.setSystemContrast=value=>contrastListeners.forEach(listener=>listener(value));export const AccessibilityInfo={isReduceMotionEnabled:async()=>false,isReduceTransparencyEnabled:()=>{window.transparencyReads++;return window.delaySystemReads?new Promise(resolve=>window.resolveTransparency=resolve):Promise.resolve(false)},isDarkerSystemColorsEnabled:()=>window.delaySystemReads?new Promise(resolve=>window.resolveContrast=resolve):Promise.resolve(false),addEventListener:(event,listener)=>{const listeners=event==='reduceTransparencyChanged'?transparencyListeners:event==='darkerSystemColorsChanged'?contrastListeners:new Set();listeners.add(listener);return {remove(){listeners.delete(listener)}}}};
    export const View=({children,style,testID})=><div data-testid={testID} style={{display:"flex",flexDirection:"column",flexShrink:0,...nativeStyle(style)}}>{children}</div>;
    export const ScrollView=({children,contentContainerStyle})=><div style={{display:"flex",flexDirection:"column",...nativeStyle(contentContainerStyle)}}>{children}</div>;
    export const Pressable=({children,style,onPress,disabled,accessibilityLabel,accessibilityState,accessibilityRole})=><button disabled={disabled} role={accessibilityRole} aria-label={accessibilityLabel} aria-checked={accessibilityState?.checked} aria-selected={accessibilityRole==='tab'?accessibilityState?.selected:undefined} style={{display:'flex',flexDirection:'column',flexShrink:0,border:0,background:'transparent',textAlign:'left',...nativeStyle(typeof style==='function'?style({pressed:false}):style)}} onClick={onPress}>{children}</button>;
    let system='light',override='unspecified';const listeners=new Set();
    const publish=()=>listeners.forEach(listener=>listener());
    const subscribe=listener=>{listeners.add(listener);return ()=>listeners.delete(listener)};
    export const Appearance={setColorScheme:mode=>{override=mode;publish()}};
    export const useColorScheme=()=>useSyncExternalStore(subscribe,()=>override==='unspecified'?system:override);
    window.setSystemScheme=mode=>{system=mode;publish()};
    export const useWindowDimensions=()=>({width:innerWidth,height:innerHeight,fontScale:1});
  `,
  '@react-native-async-storage/async-storage': `export default {getItem:async key=>localStorage.getItem(key),setItem:async(key,value)=>localStorage.setItem(key,value),removeItem:async key=>localStorage.removeItem(key)};`,
  '../../runtime/state/application-state': `export {useState as useApplicationState} from 'react';`,
  '../../runtime/connection/provider': `export const useRuntime=()=>({activeId:'computer',legacyDraftRuntimeId:null});`,
  '../ui/content/text': `import {StyleSheet} from 'react-native';export const Text=({children,style,accessibilityRole})=>{const value=StyleSheet.flatten(style);return <span role={accessibilityRole} style={{whiteSpace:'pre-wrap',...value,...(typeof value.lineHeight==='number'?{lineHeight:value.lineHeight+'px'}:{})}}>{children}</span>};`,
  '../ui/controls/choice': `export const Choice=({label,value,items,onChange,hideLabel})=><label>{!hideLabel&&label}<select aria-label={label} value={value} onChange={e=>onChange(e.target.value)}>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>;`,
  '../ui/controls/icon': `export const Icon=({color})=><span style={{color}}>✓</span>;`,
  '../ui/layout/screen-header': `export const ScreenHeader=({title})=><h1>{title}</h1>;`,
  '../ui/layout/sheet': `export const Sheet=({title,children,onClose})=><div role='dialog' aria-label={title} style={{position:'fixed',inset:0,zIndex:10,background:'#f2f2f7',overflowY:'auto',padding:16,display:'flex',flexDirection:'column',gap:12}}><div style={{display:'flex',justifyContent:'space-between'}}><h2 style={{fontSize:17,color:'#222',margin:0,alignSelf:'center'}}>{title}</h2><button aria-label='Close' onClick={onClose} style={{width:44,height:44,border:0,borderRadius:22,background:'#e2e2e7',fontSize:22}}>×</button></div>{children}</div>;export const useInsideSheet=()=>false;`,
  '../ui/controls/field': `export const Field=()=>null;export const SearchField=({label,value,placeholder,onChangeText})=><input aria-label={label} value={value} placeholder={placeholder} onChange={e=>onChangeText(e.target.value)} style={{font:'inherit',minHeight:44,border:'1px solid #ccc',borderRadius:12,padding:'0 12px'}}/>;`,
  './icon-button': `export const IconButton=({label,onPress,disabled})=><button aria-label={label} disabled={disabled} onClick={onPress} style={{alignSelf:'flex-start',flexShrink:0,width:44,height:44,border:0,borderRadius:22,background:'#e2e2e7',fontSize:22}}>←</button>;`,
  'lucide-react-native': `const Icon=({color})=><span aria-hidden style={{color}}>●</span>;export const CircleCheck=Icon,CircleX=Icon,TriangleAlert=Icon;`,
  './settings-group': `export const SettingsGroup=({title,footer,children})=><section><h2>{title}</h2>{children}<p>{footer}</p></section>;export const SettingsSwitchRow=({label,value,onValueChange})=><label>{label}<input type="checkbox" role="switch" aria-label={label} checked={value} onChange={e=>onValueChange(e.target.checked)}/></label>;`,
  '../../ui/controls/field': `
    import {useRef,useEffect,useImperativeHandle} from 'react';
    import {StyleSheet} from 'react-native';
    export function Field({defaultValue,inputRef,onChangeText,onSelectionChange,label,editable,style}){
      const input=useRef();useEffect(()=>{window.fieldMounts++},[]);
      useImperativeHandle(inputRef,()=>({clear:()=>input.current.value='',setNativeProps:props=>input.current.value=props.text}),[]);
      return <textarea ref={input} aria-label={label} defaultValue={defaultValue} disabled={!editable} style={StyleSheet.flatten(style)} onChange={e=>onChangeText(e.target.value)} onSelect={e=>onSelectionChange?.({nativeEvent:{selection:{start:e.target.selectionStart,end:e.target.selectionEnd}}})}/>;
    }
  `,
}
mocks['../content/text'] = mocks['../ui/content/text']
mocks['./icon'] = mocks['../ui/controls/icon']
const built = await build({
  stdin: {
    contents: `
      import {useState,useEffect} from 'react';
      import {createRoot} from 'react-dom/client';
      import {MobileAppearance} from './src/ui/appearance';
      import {useTheme} from './src/ui/theme';
      import {Glass} from './src/ui/layout/glass';
      import {Pill} from './src/ui/controls/pill';
      import {PullTabs} from './src/scm/pulls/detail/pull-tabs.tsx';
      import AppearanceScreen from './src/screens/appearance';
      import {ComposerField} from './src/tasks/composer/composer-field';
      import {useDraft} from './src/tasks/draft/use-draft';
      import {useMobilePreferences,updateMobilePreferences} from './src/runtime/preferences/app-preferences';
      window.fieldMounts=0;window.draftMounts=0;window.glassMounts=[];window.transparencyReads=0;
      function LaterGlass(){const [visible,setVisible]=useState(false);window.mountLaterGlass=setVisible;return visible?<Glass><span>Later control</span></Glass>:null;}
      function Draft(){
        const {colors,mode,palette,code,highContrast,reduceTransparency}=useTheme();
        const preferences=useMobilePreferences();const draft=useDraft('task','');
        const [sending,setSending]=useState(false);const [tab,setTab]=useState('overview');
        useEffect(()=>{window.draftMounts++},[]);
        window.currentTheme={colors,mode,palette,code,highContrast,reduceTransparency};window.preferences=preferences;
        window.configure=updateMobilePreferences;window.setSending=setSending;
        return <div id="draft" style={{background:colors.background,color:colors.text}}>
          <ComposerField value={sending?'':draft.text} revision={JSON.stringify([draft.revision,sending])} onChangeText={text=>draft.update(text,'keyboard')} onSelectionChange={()=>{}} editable={draft.ready&&!sending} showOptions trailingControlCount={0}/>
          <div id="status-pill"><Pill label="Review changes" onPress={()=>window.pillPresses=(window.pillPresses||0)+1} onDismiss={()=>window.pillDismissed=true}/></div><PullTabs value={tab} items={[{id:"overview",name:"Overview"},{id:"files",name:"Files"}]} onChange={setTab}/><span id="error" style={{color:colors.error}}>Send failed</span>
        </div>;
      }
      createRoot(document.getElementById('app')).render(<MobileAppearance><Glass testID="Draft glass" style={{borderRadius:26,backgroundColor:'transparent',shadowOpacity:0.18}}><Draft/></Glass><LaterGlass/><AppearanceScreen/></MobileAppearance>);
    `,
    resolveDir: root + 'apps/mobile/',
    loader: 'tsx',
  },
  plugins: [
    {
      name: 'native-controls',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, ({ path }) =>
          Object.hasOwn(mocks, path) ? { path, namespace: 'native-control' } : undefined,
        )
        builder.onLoad({ filter: /.*/, namespace: 'native-control' }, ({ path }) => ({
          contents: mocks[path],
          loader: 'tsx',
          resolveDir: root + 'apps/mobile/',
        }))
      },
    },
  ],
  alias: { react: root + 'apps/mobile/node_modules/react' },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
})
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  page.setDefaultTimeout(10000)
  const catalog = await installThemeCatalogRoutes(page)
  await page.addInitScript(() => {
    window.catalogRequests = []
    const original = window.fetch
    window.fetch = (...args) => {
      const url = new URL(
        args[0] instanceof Request ? args[0].url : args[0].toString(),
        location.href,
      )
      if (url.origin === 'https://open-vsx.org' && url.pathname === '/api/-/search')
        window.catalogRequests.push(url.searchParams.get('query'))
      return original(...args)
    }
  })
  const errors = []
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.error('Native fixture:', error.message)
  })
  await page.route('http://mobile-theme.test/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<style>body{margin:0;font:14px system-ui}button{font:inherit}select{font:inherit;max-width:100%}textarea{box-sizing:border-box}section{display:flex;flex-direction:column;gap:8px}h2{font-size:13px;font-weight:600;color:#777;margin:16px 16px 0}p{margin:4px 16px 12px;font-size:12px;color:#777}h1{font-size:24px}</style><div id="app"></div>',
    }),
  )
  await page.goto('http://mobile-theme.test')
  await page.evaluate(() =>
    localStorage.setItem(
      'dovo.mobile-preferences.v1',
      JSON.stringify({ confirmArchive: true, themePalette: 'retired', timeFormat: '24h' }),
    ),
  )
  const load = async (nativeGlassAvailable = true, delaySystemReads = false) => {
    await page.reload()
    await page.evaluate(
      ({ nativeGlassAvailable, delaySystemReads }) => {
        window.nativeGlassAvailable = nativeGlassAvailable
        window.delaySystemReads = delaySystemReads
      },
      { nativeGlassAvailable, delaySystemReads },
    )
    await page.addScriptTag({ content: built.outputFiles[0].text })
    await page.waitForFunction(() => window.preferences?.ready)
    await page.getByLabel('Message').waitFor()
  }
  await load()
  assert.equal(await page.getByLabel('Thread density').inputValue(), 'compact')
  await page.getByLabel('Thread density').selectOption('comfortable')
  await page.waitForFunction(
    () =>
      JSON.parse(localStorage.getItem('dovo.mobile-preferences.v1')).threadDensity ===
      'comfortable',
  )
  await load()
  assert.equal(await page.getByLabel('Thread density').inputValue(), 'comfortable')
  await page.getByLabel('Thread density').selectOption('compact')
  await page.waitForFunction(
    () =>
      JSON.parse(localStorage.getItem('dovo.mobile-preferences.v1')).threadDensity === 'compact',
  )
  await load()
  assert.equal(await page.getByLabel('Thread density').inputValue(), 'compact')
  assert.equal(await page.evaluate(() => window.currentTheme.palette), 'dovo')
  assert.equal(await page.evaluate(() => window.preferences.confirmArchive), true)
  assert.equal(await page.evaluate(() => window.preferences.timeFormat), '24h')
  assert.equal(await page.getByRole('radio').count(), studioThemeIds.length)
  const input = page.getByLabel('Message')
  await input.fill('Draft survives theme changes')
  await input.evaluate((element) => {
    window.originalInput = element
    element.setSelectionRange(6, 6)
  })
  for (const mode of ['light', 'dark']) {
    await page.getByLabel('Color scheme').selectOption(mode)
    for (const palette of studioThemeIds) {
      await page.getByRole('radio', { name: studioThemes[palette].name, exact: true }).click()
      await page.waitForFunction((palette) => window.currentTheme.palette === palette, palette)
      const state = await page.evaluate(() => window.currentTheme)
      assert.equal(state.mode, mode)
      assert.equal(state.colors.background, studioThemes[palette][mode].background)
      assert.equal(state.colors.text, studioThemes[palette][mode].foreground)
      assert.equal(state.colors.action, studioThemes[palette][mode].action)
      assert.equal(await input.inputValue(), 'Draft survives theme changes')
      assert.equal(await input.evaluate((element) => element === window.originalInput), true)
    }
  }
  await input.focus()
  await input.evaluate((element) => element.setSelectionRange(6, 6))
  await page.evaluate(() => window.configure({ themePalette: 'iris', theme: 'light' }))
  await page.waitForFunction(() => window.currentTheme.palette === 'iris')
  assert.equal(
    await input.evaluate(
      (element) => document.activeElement === element && element.selectionStart === 6,
    ),
    true,
  )
  const glass = page.getByTestId('Native glass').first()
  const pill = page.getByRole('button', { name: 'Review changes', exact: true })
  await pill.evaluate((node) => {
    window.originalPill = node
  })
  await page.waitForFunction(
    () => document.querySelector('[data-testid="Native glass"]').dataset.glassEffect === 'regular',
  )
  for (const highContrast of [true, false]) {
    await page.evaluate((highContrast) => window.configure({ highContrast }), highContrast)
    await page.waitForFunction(
      (highContrast) =>
        document.querySelector('[data-testid="Native glass"]').dataset.glassEffect ===
        (highContrast ? 'none' : 'regular'),
      highContrast,
    )
    assert.equal(
      await input.evaluate(
        (element) =>
          element === window.originalInput &&
          document.activeElement === element &&
          element.selectionStart === 6,
      ),
      true,
      'Changing native glass preserves the input, focus and caret',
    )
    assert.equal(
      await glass.evaluate((node) => node.style.backgroundColor),
      highContrast
        ? await page.evaluate(() => {
            const probe = document.createElement('div')
            probe.style.backgroundColor = window.currentTheme.colors.surface
            return probe.style.backgroundColor
          })
        : 'transparent',
      'High contrast overrides a transparent caller fill',
    )
    if (highContrast) assert.equal(await glass.evaluate((node) => node.style.shadowOpacity), '0')
  }
  for (const reduced of [true, false]) {
    await page.evaluate((reduced) => window.setReduceTransparency(reduced), reduced)
    await page.waitForFunction(
      (reduced) =>
        document.querySelector('[data-testid="Native glass"]').dataset.glassEffect ===
        (reduced ? 'none' : 'regular'),
      reduced,
    )
    assert.equal(
      await pill.evaluate((node) => node === window.originalPill),
      true,
      'Transparency changes preserve the status action',
    )
    assert.equal(
      await page.locator('#status-pill [data-glass-effect]').getAttribute('data-glass-effect'),
      reduced ? 'none' : 'regular',
    )
    assert.equal(
      await input.evaluate((element) => element === window.originalInput),
      true,
      'Transparency changes preserve the draft input',
    )
    if (reduced) {
      assert.notEqual(await glass.evaluate((node) => node.style.backgroundColor), 'transparent')
      assert.equal(await glass.evaluate((node) => node.style.shadowOpacity), '0')
    }
  }
  assert.equal(await glass.getAttribute('data-glass-effect'), 'regular')
  await page.evaluate(() => window.mountLaterGlass(true))
  await page.getByText('Later control', { exact: true }).waitFor()
  assert.equal(
    await page.evaluate(() => window.glassMounts.at(-1)),
    'regular',
    'New controls use the resolved preference on their first commit',
  )
  assert.equal(
    await page.evaluate(() => window.transparencyReads),
    1,
    'Glass controls share one system preference read',
  )
  for (const highContrast of [true, false]) {
    await page.evaluate((value) => window.setSystemContrast(value), highContrast)
    await page.waitForFunction(
      (value) =>
        document.querySelector('[data-testid="Native glass"]').dataset.glassEffect ===
        (value ? 'none' : 'regular'),
      highContrast,
    )
    assert.equal(
      await input.evaluate((node) => node === window.originalInput),
      true,
      'System Increase Contrast preserves the draft input',
    )
  }
  assert.ok((await pill.boundingBox()).height >= 44)
  const filesTab = page.getByRole('tab', { name: 'Files', exact: true })
  await filesTab.click()
  assert.equal(await filesTab.getAttribute('aria-selected'), 'true')
  assert.ok((await filesTab.boundingBox()).height >= 44)
  await pill.click()
  assert.equal(await page.evaluate(() => window.pillPresses), 1)
  await page.getByRole('button', { name: 'Dismiss Review changes', exact: true }).click()
  assert.equal(await page.evaluate(() => window.pillDismissed), true)
  await page.evaluate(() => window.setSending(true))
  await page.waitForFunction(() => window.originalInput.disabled)
  await page.evaluate(() => window.configure({ themePalette: 'claude', theme: 'dark' }))
  await page.waitForFunction(() => window.currentTheme.palette === 'claude')
  await page.evaluate(() => window.setSending(false))
  await page.waitForFunction(() => window.originalInput.value === 'Draft survives theme changes')
  assert.deepEqual(await page.evaluate(() => [window.fieldMounts, window.draftMounts]), [1, 1])
  await page.getByLabel('Color scheme').selectOption('system')
  await page.evaluate(() => window.setSystemScheme('light'))
  await page.waitForFunction(() => window.currentTheme.mode === 'light')
  await page.evaluate(() => window.setSystemScheme('dark'))
  await page.waitForFunction(() => window.currentTheme.mode === 'dark')
  await page.getByLabel('Terminal font', { exact: true }).selectOption('JetBrains Mono Nerd Font')
  await page.getByLabel('Terminal font size').selectOption('18')
  await page.getByLabel('Color scheme').selectOption('light')
  await page.evaluate(() => window.setSystemScheme('dark'))
  assert.equal(await page.evaluate(() => window.currentTheme.mode), 'light')
  await page.waitForFunction(
    () => JSON.parse(localStorage.getItem('dovo.mobile-preferences.v1')).theme === 'light',
  )
  await load()
  assert.equal(await page.evaluate(() => window.currentTheme.mode), 'light')
  assert.equal(await page.evaluate(() => window.currentTheme.palette), 'claude')
  assert.equal(await input.inputValue(), 'Draft survives theme changes')
  assert.equal(await page.evaluate(() => window.preferences.confirmArchive), true)
  assert.equal(
    await page.getByLabel('Terminal font', { exact: true }).inputValue(),
    'JetBrains Mono Nerd Font',
  )
  assert.equal(await page.getByLabel('Terminal font size').inputValue(), '18')
  await page.getByLabel('Code theme', { exact: true }).selectOption('dracula')
  await page.waitForFunction(
    () => window.preferences.codeTheme === 'dracula' && window.currentTheme.code.custom,
  )
  assert.equal(await input.inputValue(), 'Draft survives theme changes')
  await page.evaluate(
    () =>
      (window.themeFile =
        '// imported native theme\n' +
        JSON.stringify({
          name: 'Native Proof',
          type: 'light',
          colors: { 'editor.background': '#fefdfa', 'editor.foreground': '#123456' },
          tokenColors: [{ scope: 'keyword', settings: { foreground: '#c02d69' } }],
        })),
  )
  await page.getByRole('button', { name: 'Import VS Code theme', exact: true }).click()
  await page.waitForFunction(() => window.currentTheme.code.colors.keyword === '#c02d69')
  assert.equal(
    await page.evaluate(() => window.currentTheme.colors.background),
    studioThemes.claude.light.background,
  )
  assert.equal(await input.inputValue(), 'Draft survives theme changes')
  await page.waitForFunction(() =>
    JSON.parse(localStorage.getItem('dovo.mobile-preferences.v1')).codeTheme.startsWith(
      'dovo-import-',
    ),
  )
  if (process.env.DOVO_CODE_THEME_SCREENSHOT) {
    await page.getByLabel('Code theme', { exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: process.env.DOVO_CODE_THEME_SCREENSHOT })
  }
  await load()
  await page.waitForFunction(() => window.currentTheme.code.colors.background === '#fefdfa')
  assert.equal(await input.inputValue(), 'Draft survives theme changes')
  await page.getByRole('button', { name: 'Remove theme', exact: true }).click()
  await page.waitForFunction(
    () => window.preferences.codeTheme === 'app' && !window.currentTheme.code.custom,
  )
  await exerciseThemeBrowser(page, catalog, { mobile: true })
  await load()
  await page.waitForFunction(() => window.currentTheme.code.colors.background === '#18202d')
  await load(true, true)
  await page.evaluate(() => {
    window.setReduceTransparency(true)
    window.setSystemContrast(true)
    window.resolveTransparency(false)
    window.resolveContrast(false)
  })
  await page.waitForFunction(
    () => window.currentTheme.highContrast && window.currentTheme.reduceTransparency,
  )
  assert.equal(
    await page.getByTestId('Native glass').first().getAttribute('data-glass-effect'),
    'none',
    'A delayed preference read cannot replace a newer accessibility event',
  )
  await page.evaluate(() => window.setReduceTransparency(false))
  assert.equal(
    await page.getByTestId('Native glass').first().getAttribute('data-glass-effect'),
    'none',
    'System contrast remains active after transparency changes',
  )
  await load(false)
  assert.equal(await page.getByTestId('Native glass').count(), 0)
  const fallback = page.getByTestId('Draft glass')
  assert.notEqual(await fallback.evaluate((node) => node.style.backgroundColor), 'transparent')
  assert.equal(await fallback.evaluate((node) => node.style.shadowOpacity), '0')
  assert.equal(await page.getByLabel('Message').inputValue(), 'Draft survives theme changes')
  assert.deepEqual(errors, [])
  console.log(
    'Mobile Appearance: all shared palettes in light/dark, live system changes, explicit override, migration and persistence; theme changes keep draft, editor, focus, caret and pending-send restoration mounted.',
  )
} finally {
  await browser.close()
}
