import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { createServer } from 'vite-plus'
import tailwindcss from '@tailwindcss/vite'
import { chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const ui = root + 'packages/studio-ui/src/'
const mobile = root + 'apps/mobile/src/'
const native = `
import {useImperativeHandle,useRef} from 'react';
const flat=s=>Array.isArray(s)?Object.assign({},...s.map(flat)):s??{};
const css=s=>{const result={...flat(s)};for(const[key,axes]of Object.entries({paddingHorizontal:['paddingLeft','paddingRight'],paddingVertical:['paddingTop','paddingBottom']})){for(const axis of axes)if(result[key]!==undefined)result[axis]=result[key];delete result[key]}if(result.fontSize)result.fontSize*=window.fontScale;if(result.lineHeight)result.lineHeight=result.lineHeight*window.fontScale+'px';return result};
const base={display:'flex',flexDirection:'column',boxSizing:'border-box',flexShrink:0,minWidth:0,minHeight:0};
export const View=({children,style})=><div style={{...base,...css(style)}}>{children}</div>;
export const Text=({children,style,numberOfLines,accessibilityRole})=><span role={accessibilityRole} style={{display:'block',overflowWrap:'anywhere',...css(style),...(numberOfLines===1?{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}:{})}}>{children}</span>;
export const ScrollView=({children,style,contentContainerStyle,horizontal,ref,onContentSizeChange})=>{const node=useRef();useImperativeHandle(ref,()=>({scrollToEnd:()=>{if(node.current)node.current.scrollLeft=node.current.scrollWidth}}));return <div ref={node} data-scroll style={{...base,flexShrink:1,overflow:'auto',...css(style)}}><View style={[horizontal?{flexDirection:'row'}:{},contentContainerStyle]}>{children}</View></div>};
export const Pressable=({children,style,disabled,onPress,accessibilityLabel})=><button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress} style={{...base,padding:0,border:0,font:'inherit',color:'inherit',background:'transparent',...css(typeof style==='function'?style({pressed:false}):style)}}>{children}</button>;
export const Icon=()=>null;
export const IconButton=({label,onPress,disabled})=><Pressable accessibilityLabel={label} onPress={onPress} disabled={disabled} style={{width:44,height:44,alignItems:'center',justifyContent:'center'}}>{label}</Pressable>;
export const SettingsField=({label,value,onChangeText,editable,onSubmitEditing})=><input aria-label={label} value={value} disabled={editable===false} onChange={event=>onChangeText(event.target.value)} onKeyDown={event=>{if(event.key==='Enter')onSubmitEditing?.()}} style={{width:'100%',boxSizing:'border-box',height:44,font:'inherit'}}/>;
export const SettingsSearchField=SettingsField;
export const SettingsChoice=({label,value,items,onChange,disabled})=><select aria-label={label} disabled={disabled} value={value} onChange={event=>onChange(event.target.value)} style={{width:'100%',minHeight:44}}>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>;
export const SettingsAction=({label,onPress,disabled})=><Pressable accessibilityLabel={label} onPress={onPress} disabled={disabled} style={{minHeight:44,justifyContent:'center'}}>{label}</Pressable>;
export const useTheme=()=>({colors:{text:'#24292f',muted:'#57606a',border:'#d0d7de',accent:'#0969da',surface:'#f6f8fa'},styles:{row:{flexDirection:'row',alignItems:'center',gap:8},text:{fontSize:15,color:'#24292f'},muted:{fontSize:12,lineHeight:18,color:'#57606a'},error:{fontSize:12,color:'#cf222e'},sheetFooter:{padding:16,gap:8,borderTopWidth:1}}});
`
async function bundle(isMobile) {
  const mocks = {
    '@dovo/studio-core/state': `export {useState as useApplicationState} from 'react';`,
    '@dovo/studio-core': `export {directoryPageSchema} from '@dovo/protocol';export const useWorkspace=()=>window.runtime;`,
    '@dovo/studio-ui': `export {Button} from '${ui}components/ui/button';export {Input} from '${ui}components/ui/input';export {cn} from '${ui}lib/utils';export * as DropdownMenu from '@radix-ui/react-dropdown-menu';`,
    'react-native': native,
    '../../runtime/state/application-state': `export {useState as useApplicationState} from 'react';`,
    '../../runtime/connection/provider': `export const useRuntime=()=>window.runtime;`,
    ...Object.fromEntries(
      [
        '../../ui/content/text',
        '../../screens/settings-controls',
        '../../ui/controls/icon',
        '../../ui/controls/icon-button',
        '../../ui/theme',
      ].map((path) => [path, native]),
    ),
  }
  return build({
    stdin: {
      loader: 'tsx',
      resolveDir: root,
      contents: `import {createRoot} from 'react-dom/client';import {useState} from 'react';import {Effect} from 'effect';import {DirectoryPicker} from '${isMobile ? mobile + 'scm/connections/directory-picker' : root + 'packages/extension-scm/src/connections/directory-picker'}';
window.calls=[];window.pending=[];const request=(path,input)=>new Promise((resolve,reject)=>{window.calls.push(input);window.pending.push({input,resolve,reject})});const profile={id:'mac',name:'Mac Studio',nameIsCustom:true,connection:{address:'http://mac.lan',token:'paired'}};window.runtime={profile,connection:profile.connection,connected:true,snapshot:{runtimeHost:'Mac Studio'},request,read:request,readEffect:(...args)=>Effect.tryPromise({try:()=>request(...args),catch:error=>error})};window.result=(path,offset=0)=>({path,home:'/home',parent:path==='/home'?'/':'/home',breadcrumbs:[{name:'/',path:'/'},{name:'home',path:'/home'},...(path==='/home'?[]:[{name:path.split('/').at(-1),path}])],entries:(offset?['Gamma']:['Alpha','Beta']).map(name=>({name,path:path+'/'+name})),total:3,nextOffset:offset?null:2});window.release=(index,result)=>window.pending[index].resolve(result??window.result(window.pending[index].input.path||'/home',window.pending[index].input.offset));
function App(){const[tick,setTick]=useState(0);window.render=()=>setTick(value=>value+1);return <DirectoryPicker initialPath="/home" onSelect={path=>window.chosen=path} onClose={()=>window.closed=true}/>};createRoot(document.getElementById('app')).render(<App/>);`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    jsx: 'automatic',
    alias: {
      react: ui + '../node_modules/react',
      'react-dom': ui + '../node_modules/react-dom',
      '@dovo/protocol': root + 'packages/protocol/src/index.ts',
      '@dovo/client-runtime': root + 'packages/client-runtime/src/index.ts',
    },
    nodePaths: [root + 'apps/mobile/node_modules', ui + '../node_modules'],
    plugins: [
      {
        name: 'boundaries',
        setup(b) {
          b.onResolve({ filter: /.*/ }, ({ path }) =>
            Object.hasOwn(mocks, path) ? { path, namespace: 'fixture' } : undefined,
          )
          b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
            contents: mocks[path],
            loader: 'tsx',
            resolveDir: root + 'apps/mobile',
          }))
        },
      },
    ],
  })
}
const [desktop, mobileBundle] = await Promise.all([bundle(false), bundle(true)])
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
const browser = await chromium.launch()
try {
  for (const isMobile of [false, true])
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
        '<html><body style="margin:0;font-family:system-ui"><main id="app" style="display:flex;flex-direction:column;max-height:100dvh;height:800px;overflow:hidden"></main></body></html>',
      )
      await page.evaluate((fontScale) => (window.fontScale = fontScale), fontScale)
      if (!isMobile) {
        await page.addStyleTag({ content: css })
        await page.evaluate(
          (scale) => (document.documentElement.style.fontSize = 16 * scale + 'px'),
          fontScale,
        )
      }
      await page.addScriptTag({ content: (isMobile ? mobileBundle : desktop).outputFiles[0].text })
      const filter = page.getByRole('textbox', { name: 'Filter folders', exact: true })
      const choose = page.getByRole('button', { name: 'Choose this folder', exact: true })
      const entries = isMobile
        ? page.getByRole('button', { name: /^Open (Alpha|Beta|Gamma) folder$/ })
        : page.getByRole('option')
      const filterBefore = await filter.boundingBox()
      assert.equal(await choose.isDisabled(), true)
      await page.waitForFunction(() => window.pending.length === 1)
      await page.evaluate(() => window.release(0))
      await entries.first().waitFor()
      assert.deepEqual(
        await filter.boundingBox(),
        filterBefore,
        'Loading breadcrumbs keeps the filter in place',
      )
      const firstEntryBefore = await entries.first().boundingBox()
      if (isMobile) {
        await page.getByRole('button', { name: 'Load more folders', exact: true }).click()
        await page.getByText('Loading more folders…', { exact: true }).waitFor()
        assert.equal(await choose.isDisabled(), true)
        assert.deepEqual(
          await entries.first().boundingBox(),
          firstEntryBefore,
          'Pagination status does not push loaded folders',
        )
        assert.equal(await entries.first().isDisabled(), true)
        await page.waitForFunction(() => window.pending.length === 2)
        await page.evaluate(() => window.release(1))
        await page.getByRole('button', { name: 'Open Gamma folder', exact: true }).waitFor()
        assert.deepEqual(await entries.first().boundingBox(), firstEntryBefore)
      } else {
        await filter.fill('Alpha')
        await page.waitForFunction(() => window.pending.length === 2)
        await page.evaluate(() => window.release(1))
        await choose.waitFor()
        await page.getByRole('button', { name: 'Clear folder filter', exact: true }).click()
        assert.equal(await filter.inputValue(), '')
        assert.equal(
          await filter.evaluate((node) => node === document.activeElement),
          true,
          'Clear preserves search focus',
        )
        assert.equal(await choose.isDisabled(), true, 'Clearing waits for unfiltered results')
        await page.waitForFunction(() => window.pending.length === 3)
        await page.evaluate(() => window.release(2))
        const list = page.getByRole('listbox', { name: 'Directories' })
        await list.focus()
        await list.press('End')
        await page.getByRole('option', { selected: true }).waitFor()
        await list.press('ArrowRight')
        await page.waitForFunction(() => window.pending.length === 4)
        assert.equal(await choose.isDisabled(), true)
        await page.evaluate(() => window.release(3))
      }
      // A slow response must not make an older path selectable during the next debounce.
      const path = page.getByRole('textbox', { name: 'Folder path', exact: true })
      const pending = await page.evaluate(() => window.pending.length)
      await path.fill('/home/first')
      await page.waitForFunction((n) => window.pending.length === n + 1, pending)
      await path.fill('/home/latest')
      await page.evaluate((index) => window.release(index), pending)
      assert.equal(await path.inputValue(), '/home/latest')
      assert.equal(await choose.isDisabled(), true)
      await page.waitForFunction((n) => window.pending.length === n + 2, pending)
      await page.evaluate((index) => window.release(index), pending + 1)
      await choose.click()
      assert.equal(await page.evaluate(() => window.chosen), '/home/latest')
      const failedRequest = await page.evaluate(() => window.pending.length)
      await path.fill('/home/restricted')
      await page.waitForFunction((index) => window.pending.length === index + 1, failedRequest)
      await page.evaluate(
        (index) => window.pending[index].reject(new Error('Permission denied')),
        failedRequest,
      )
      await page.getByText('Permission denied', { exact: true }).waitFor()
      assert.equal(await choose.isDisabled(), true, 'A failed path cannot be selected')
      await page
        .getByRole('button', { name: isMobile ? 'Retry folders' : 'Retry', exact: true })
        .click()
      await page.waitForFunction((index) => window.pending.length === index + 2, failedRequest)
      await page.evaluate((index) => window.release(index), failedRequest + 1)
      await choose.click()
      assert.equal(await page.evaluate(() => window.chosen), '/home/restricted')
      for (const height of fontScale === 1 ? [480, 844] : [844]) {
        await page.setViewportSize({ width, height })
        const footer = await choose.boundingBox()
        assert.ok(
          footer.y >= 0 && footer.y + footer.height <= height,
          `Folder selection remains reachable at ${width}×${height}, ${fontScale}x text: ${JSON.stringify(footer)}`,
        )
      }
      await page.evaluate(() => {
        window.runtime.connected = false
        window.render()
      })
      await page
        .getByText(
          isMobile ? 'Offline' : 'This computer is offline. Reconnect to browse its folders.',
          { exact: true },
        )
        .waitFor()
      assert.equal(await choose.isDisabled(), true)
      assert.equal(await filter.isDisabled(), true)
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
        `Picker fits ${width}px at ${fontScale}x text`,
      )
      assert.deepEqual(errors, [])
      await page.close()
    }
  console.log(
    'Folder pickers: stable breadcrumbs and pagination, clear-search focus, keyboard navigation, slow-response isolation, offline selection and responsive layouts passed.',
  )
} finally {
  await browser.close()
}
