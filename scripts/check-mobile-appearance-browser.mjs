import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { studioThemeIds, studioThemes } from '../packages/studio-core/src/themes.ts'

const root = fileURLToPath(new URL('../', import.meta.url))
const mocks = {
  'react-native': `
    import {useSyncExternalStore} from 'react';
    const flat=style=>Array.isArray(style)?Object.assign({},...style.map(flat)):style||{};
    export const StyleSheet={create:styles=>styles,flatten:flat,hairlineWidth:1};
    export const Platform={OS:'web'};
    export const AppState={currentState:'active',addEventListener:()=>({remove(){}})};
    export const View=({children,style,testID})=><div data-testid={testID} style={flat(style)}>{children}</div>;
    export const ScrollView=({children,contentContainerStyle})=><div style={flat(contentContainerStyle)}>{children}</div>;
    export const Pressable=({children,style,onPress,accessibilityLabel,accessibilityState,accessibilityRole})=><button role={accessibilityRole} aria-label={accessibilityLabel} aria-checked={accessibilityState?.checked} style={flat(typeof style==='function'?style({pressed:false}):style)} onClick={onPress}>{children}</button>;
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
  '../ui/content/text': `import {StyleSheet} from 'react-native';export const Text=({children,style})=><span style={StyleSheet.flatten(style)}>{children}</span>;`,
  '../ui/controls/choice': `export const Choice=({label,value,items,onChange})=><label>{label}<select aria-label={label} value={value} onChange={e=>onChange(e.target.value)}>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>;`,
  '../ui/controls/icon': `export const Icon=({color})=><span style={{color}}>✓</span>;`,
  '../ui/layout/screen-header': `export const ScreenHeader=({title})=><h1>{title}</h1>;`,
  './settings-group': `export const SettingsGroup=({title,footer,children})=><section><h2>{title}</h2>{children}<p>{footer}</p></section>;`,
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
const built = await build({
  stdin: {
    contents: `
      import {useState,useEffect} from 'react';
      import {createRoot} from 'react-dom/client';
      import {MobileAppearance} from './src/ui/appearance';
      import {useTheme} from './src/ui/theme';
      import AppearanceScreen from './src/screens/appearance';
      import {ComposerField} from './src/tasks/composer/composer-field';
      import {useDraft} from './src/tasks/draft/use-draft';
      import {useMobilePreferences,updateMobilePreferences} from './src/runtime/preferences/app-preferences';
      window.fieldMounts=0;window.draftMounts=0;
      function Draft(){
        const {colors,mode,palette}=useTheme();
        const preferences=useMobilePreferences();const draft=useDraft('task','');
        const [sending,setSending]=useState(false);
        useEffect(()=>{window.draftMounts++},[]);
        window.currentTheme={colors,mode,palette};window.preferences=preferences;
        window.configure=updateMobilePreferences;window.setSending=setSending;
        return <div id="draft" style={{background:colors.background,color:colors.text}}>
          <ComposerField value={sending?'':draft.text} revision={JSON.stringify([draft.revision,sending])} onChangeText={text=>draft.update(text,'keyboard')} onSelectionChange={()=>{}} editable={draft.ready&&!sending} showOptions/>
          <span id="error" style={{color:colors.error}}>Send failed</span>
        </div>;
      }
      createRoot(document.getElementById('app')).render(<MobileAppearance><Draft/><AppearanceScreen/></MobileAppearance>);
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
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('http://mobile-theme.test/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<style>body{margin:0}button{font:inherit}</style><div id="app"></div>',
    }),
  )
  await page.goto('http://mobile-theme.test')
  await page.evaluate(() =>
    localStorage.setItem(
      'dovo.mobile-preferences.v1',
      JSON.stringify({ confirmArchive: true, themePalette: 'retired', timeFormat: '24h' }),
    ),
  )
  const load = async () => {
    await page.reload()
    await page.addScriptTag({ content: built.outputFiles[0].text })
    await page.waitForFunction(() => window.preferences?.ready)
    await page.getByLabel('Message').waitFor()
  }
  await load()
  assert.equal(await page.evaluate(() => window.currentTheme.palette), 'dovo')
  assert.equal(await page.evaluate(() => window.preferences.confirmArchive), true)
  assert.equal(await page.evaluate(() => window.preferences.timeFormat), '24h')
  assert.equal(await page.getByRole('radio').count(), 14)
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
  assert.deepEqual(errors, [])
  console.log(
    'Mobile Appearance: all 14 shared palettes in light/dark, live system changes, explicit override, migration and persistence; theme changes keep draft, editor, focus, caret and pending-send restoration mounted.',
  )
} finally {
  await browser.close()
}
