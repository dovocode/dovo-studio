import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const mobile = root + 'apps/mobile/src/'
// Exercise the actual Sheet and validation context. Model RN layout and keyboard
// viewport changes; UIKit keyboard animation still requires a native device.
const native = `
import {useEffect} from 'react';
const flat=s=>Array.isArray(s)?Object.assign({},...s.map(flat)):s??{};
const css=s=>{const v=flat(s),result={...v};for(const [key,axes] of Object.entries({paddingHorizontal:['paddingLeft','paddingRight'],paddingVertical:['paddingTop','paddingBottom']})){for(const axis of axes)if(v[key]!==undefined&&v[axis]===undefined)result[axis]=v[key];delete result[key]}return result};
const base={display:'flex',flexDirection:'column',boxSizing:'border-box',flexShrink:0,minHeight:0,position:'relative'};
export const View=({children,style,role,accessibilityLabel})=><div role={role} aria-label={accessibilityLabel} style={{...base,...css(style)}}>{children}</div>;
export const Text=({children,style,accessibilityRole})=>{const v=css(style);return <span role={accessibilityRole==='header'?'heading':undefined} style={{display:'block',overflowWrap:'anywhere',...v,fontSize:(v.fontSize??14)*window.fontScale,lineHeight:v.lineHeight?v.lineHeight*window.fontScale+'px':undefined}}>{children}</span>};
export const Pressable=({children,onPress,disabled,style,accessibilityLabel})=><button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress} style={{...base,padding:0,border:0,background:'transparent',font:'inherit',...css(typeof style==='function'?style({pressed:false}):style)}}>{children}</button>;
export const ScrollView=({children,style,contentContainerStyle})=><div data-scroll style={{...base,overflowY:'auto',flexGrow:1,flexShrink:1,...css(style)}}><View style={contentContainerStyle}>{children}</View></div>;
export const KeyboardAvoidingView=({children,style,behavior})=><div data-keyboard-avoidance={behavior} style={{...base,...css(style)}}>{children}</div>;
export const Platform={get OS(){return window.platform}};
const listeners=window.sheetKeyboardListeners??=new Map();
export const Keyboard={dismiss(){window.keyboardDismissals++;window.emitKeyboard(false)},addListener:(event,callback)=>{const callbacks=listeners.get(event)??new Set();callbacks.add(callback);listeners.set(event,callbacks);return {remove:()=>callbacks.delete(callback)}}};
window.emitKeyboard=visible=>listeners.get(visible?'keyboardDidShow':'keyboardDidHide')?.forEach(callback=>callback());
export const SafeModal=({visible,children,onDismiss,onRequestClose})=>{useEffect(()=>{if(!visible)onDismiss?.()},[visible]);window.requestModalClose=onRequestClose;return visible?<div data-modal style={{...base,position:'fixed',inset:0,background:'white'}}>{children}</div>:null};
export const useTheme=()=>({mode:'light',colors:{elevated:'#fff',border:'#d0d7de',text:'#24292f',accent:'#0969da'},styles:{screen:{flex:1},content:{padding:16},title:{fontSize:20,fontWeight:'600',color:'#24292f'}}});
export const IconButton=({label,onPress,disabled,size=44,icon})=><Pressable accessibilityLabel={label} disabled={disabled} onPress={onPress} style={{width:size,height:size,flexShrink:0,borderRadius:size/2,alignItems:'center',justifyContent:'center'}}><span aria-hidden data-icon={icon}>{icon==='close'?'×':icon==='keyboard'?'⌨':'+'}</span></Pressable>;
`
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root + 'apps/mobile',
      loader: 'tsx',
      contents: `
import {createRoot} from 'react-dom/client';import {useState} from 'react';import {Sheet} from '${mobile}ui/layout/sheet';
function App(){const [open,setOpen]=useState(true),[busy,setBusy]=useState(false),[title,setTitle]=useState('Computer connection settings');window.setBusy=setBusy;window.setTitle=setTitle;return open?<Sheet title={title} presentation={window.presentation} busy={busy} onClose={()=>{window.sheetCloses++;setOpen(false)}} headerAction={{label:'Add connection',icon:'plus',onPress:()=>window.added++}} footer={<button style={{minHeight:44}} onClick={()=>window.saved++}>Save connection</button>}><label>Connection address<input aria-label="Connection address" defaultValue="http://mac-studio.local:8787"/></label>{Array.from({length:24},(_,i)=><p key={i}>Connection setting {i}</p>)}</Sheet>:<p>Closed</p>};createRoot(document.getElementById('app')).render(<App/>);`,
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
    {
      path: '../../runtime/state/application-state',
      importer: mobile + 'ui/layout',
      contents: "export {useState as useApplicationState} from 'react';",
    },
    ...['./safe-modal', '../controls/icon-button', '../content/text', '../theme'].map((path) => ({
      path,
      importer: mobile + 'ui/layout',
      contents: native,
    })),
    {
      path: '../controls/native-icon',
      importer: mobile + 'ui/layout',
      contents: 'export const NativeIcon=()=>null;export const NativeMenuButton=()=>null;',
    },
    {
      path: '@expo/ui/swift-ui',
      contents:
        'const Wrap=({children})=>children;export const BottomSheet=Wrap,Button=Wrap,Group=Wrap,Host=Wrap,NavigationStack=Wrap,RNHostView=Wrap;export const Toolbar=Object.assign(Wrap,{Content:Wrap});',
    },
    {
      path: '@expo/ui/swift-ui/modifiers',
      contents: [
        'accessibilityLabel',
        'disabled',
        'interactiveDismissDisabled',
        'labelStyle',
        'navigationTitle',
        'navigationBarTitleDisplayMode',
        'presentationDetents',
        'presentationDragIndicator',
      ]
        .map((name) => `export const ${name}=()=>null;`)
        .join(''),
    },
  ],
)
const browser = await chromium.launch()
try {
  for (const [platform, presentation] of [
    ['android', 'sheet'],
    ['android', 'dialog'],
    ['ios', 'dialog'],
  ]) {
    for (const [width, fontScale] of [
      [320, 1],
      [390, 1],
      [1024, 1],
      [390, 2],
    ]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } })
      page.setDefaultTimeout(5000)
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.setContent(
        '<html><body style="margin:0;font-family:system-ui"><div id="app"></div></body></html>',
      )
      await page.evaluate(
        ({ platform, presentation, fontScale }) => {
          Object.assign(window, {
            platform,
            presentation,
            fontScale,
            sheetCloses: 0,
            added: 0,
            saved: 0,
            keyboardDismissals: 0,
          })
        },
        { platform, presentation, fontScale },
      )
      await page.addScriptTag({ content: built.outputFiles[0].text })
      const close = page.getByRole('button', { name: 'Close', exact: true }),
        heading = page.getByRole('heading'),
        add = page.getByRole('button', { name: 'Add connection', exact: true })
      await close.waitFor()
      await page.waitForFunction(
        () => window.sheetKeyboardListeners?.get('keyboardDidShow')?.size > 0,
      )
      assert.deepEqual(await close.locator('[data-icon]').getAttribute('data-icon'), 'close')
      const bounds = await close.boundingBox()
      assert.equal(bounds.width, 44)
      assert.equal(bounds.height, 44)
      const headingBounds = await heading.boundingBox()
      assert.ok(headingBounds.x + headingBounds.width <= bounds.x, 'Title leaves room for close')
      assert.ok(bounds.x + bounds.width <= width, 'Close stays within the screen')
      const geometry = async () => ({
        heading: await heading.boundingBox(),
        close: await close.boundingBox(),
        add: await add.boundingBox(),
      })
      const before = await geometry()
      // Showing/hiding the dismiss action must not change header geometry.
      await page.evaluate(() => window.emitKeyboard(true))
      if (presentation === 'sheet') {
        const dismiss = page.getByRole('button', { name: 'Dismiss keyboard', exact: true })
        await dismiss.waitFor()
        assert.deepEqual(await geometry(), before, 'Keyboard action keeps header positions')
        const dismissals = await page.evaluate(() => window.keyboardDismissals)
        await dismiss.click()
        await dismiss.waitFor({ state: 'detached' })
        assert.equal(await page.evaluate(() => window.keyboardDismissals), dismissals + 1)
        assert.deepEqual(
          await geometry(),
          before,
          'Hiding the keyboard action keeps header positions',
        )
      }
      await page.setViewportSize({ width, height: 480 })
      const keyboardClose = await close.boundingBox(),
        save = await page
          .getByRole('button', { name: 'Save connection', exact: true })
          .boundingBox()
      assert.ok(
        keyboardClose.y >= 0 && keyboardClose.y + keyboardClose.height <= 480,
        'Close remains visible in the keyboard viewport',
      )
      assert.ok(
        save.y >= 0 && save.y + save.height <= 480,
        'Fixed footer remains visible in the keyboard viewport',
      )
      if (presentation === 'dialog')
        assert.equal(
          await page.locator('[data-keyboard-avoidance]').getAttribute('data-keyboard-avoidance'),
          platform === 'ios' ? 'padding' : 'height',
        )
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
        'Sheet fits without horizontal scrolling',
      )
      if (width === 390 && fontScale === 1)
        await page.screenshot({
          path: `/tmp/dovo-sheet-refinement-${platform}-${presentation}.png`,
        })
      await page.evaluate(() => window.setBusy(true))
      await page.waitForFunction(() => document.querySelector('[aria-label="Close"]').disabled)
      assert.equal(await add.isDisabled(), true)
      await page.evaluate(() => window.requestModalClose())
      assert.equal(
        await page.evaluate(() => window.sheetCloses),
        0,
        'Busy sheets preserve the close guard',
      )
      await page.evaluate(() => window.setBusy(false))
      await close.click()
      await page.getByText('Closed', { exact: true }).waitFor()
      assert.equal(await page.evaluate(() => window.sheetCloses), 1)
      assert.deepEqual(errors, [])
      await page.close()
    }
  }
  console.log(
    'Mobile sheets: stable keyboard actions, 44pt icon close controls, readable titles, fixed footers and busy guards pass on phone/tablet widths and larger text (native boundaries adapted).',
  )
} finally {
  await browser.close()
}
