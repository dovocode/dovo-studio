import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
// Model RN's column layout, zero default shrink and explicit font scaling. These checks
// exercise real settings components; UIKit/SwiftUI measurement still needs a device.
const native = `
  import {useLayoutEffect,useRef,useSyncExternalStore} from 'react';
  const flat=style=>Array.isArray(style)?Object.assign({},...style.map(flat)):style||{};
  const css=styles=>{const style=flat(styles);return Object.fromEntries(Object.entries({...style,
    ...(style.paddingHorizontal!=null?{paddingLeft:style.paddingLeft??style.paddingHorizontal,paddingRight:style.paddingRight??style.paddingHorizontal}:{}),
    ...(style.paddingVertical!=null?{paddingTop:style.paddingTop??style.paddingVertical,paddingBottom:style.paddingBottom??style.paddingVertical}:{}),
    ...(style.marginHorizontal!=null?{marginLeft:style.marginLeft??style.marginHorizontal,marginRight:style.marginRight??style.marginHorizontal}:{}),
    ...(style.marginVertical!=null?{marginTop:style.marginTop??style.marginVertical,marginBottom:style.marginBottom??style.marginVertical}:{})}).filter(([,value])=>value!=null));};
  export const StyleSheet={create:style=>style,flatten:flat,hairlineWidth:1};
  export const Platform={OS:window.platform};
  const base={display:'flex',flexDirection:'column',alignItems:'stretch',flexShrink:0,minHeight:0,position:'relative',boxSizing:'border-box'};
  export const View=({children,style,testID,accessibilityLabel,onLayout})=>{
    const ref=useRef();useLayoutEffect(()=>{if(!onLayout)return;const observer=new ResizeObserver(()=>{const {width,height}=ref.current.getBoundingClientRect();onLayout({nativeEvent:{layout:{width,height}}})});observer.observe(ref.current);return ()=>observer.disconnect()},[onLayout]);
    return <div ref={ref} data-testid={testID} aria-label={accessibilityLabel} style={{...base,...css(style)}}>{children}</div>;
  };
  export const ScrollView=({children,style,contentContainerStyle})=><View style={[{overflowY:'auto',flex:1},style]}><View style={contentContainerStyle}>{children}</View></View>;
  export const Pressable=({children,style,onPress,testID,accessibilityLabel,accessibilityRole,accessibilityState,accessibilityValue,disabled})=><button data-testid={testID} aria-label={accessibilityLabel} role={accessibilityRole} aria-pressed={accessibilityState?.selected} aria-expanded={accessibilityState?.expanded} data-value={accessibilityValue?.text} disabled={disabled} onClick={onPress} style={{...base,backgroundColor:'transparent',border:0,margin:0,padding:0,font:'inherit',textAlign:'left',...css(typeof style==='function'?style({pressed:false}):style)}}>{children}</button>;
  export const Text=({children,style,numberOfLines,testID,accessibilityRole})=>{
    const textStyle=css(style),scale=window.fontScale;
    return <span data-testid={testID} role={accessibilityRole} data-text style={{flexShrink:0,boxSizing:'border-box',overflowWrap:'anywhere',...textStyle,fontSize:(textStyle.fontSize||14)*scale,lineHeight:textStyle.lineHeight?textStyle.lineHeight*scale+'px':undefined,...(numberOfLines===1?{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}:{display:'block'})}}>{children}</span>;
  };
  export const TextInput=({style,multiline,accessibilityLabel,value,onChangeText,editable,ref})=>{
    const Component=multiline?'textarea':'input';const inputStyle=css(style);
    return <Component ref={ref} aria-label={accessibilityLabel} value={value} disabled={editable===false} onChange={e=>onChangeText?.(e.target.value)} style={{boxSizing:'border-box',minWidth:0,flexShrink:0,...inputStyle,fontSize:(inputStyle.fontSize||14)*window.fontScale,resize:'none'}}/>;
  };
  export const Switch=({accessibilityLabel,value,onValueChange,disabled})=><button role="switch" aria-label={accessibilityLabel} aria-checked={value} disabled={disabled} onClick={()=>onValueChange(!value)} style={{width:51,height:31,flexShrink:0,alignSelf:'flex-start'}}>●</button>;
  const listeners=new Set();window.setFontScale=scale=>{window.fontScale=scale;listeners.forEach(listener=>listener())};
  export const useWindowDimensions=()=>{useSyncExternalStore(listener=>{listeners.add(listener);window.addEventListener('resize',listener);return ()=>{listeners.delete(listener);window.removeEventListener('resize',listener)}},()=>innerWidth+':'+window.fontScale);return {width:innerWidth,height:innerHeight,fontScale:window.fontScale}};
  export const Alert={alert(){}};
`
const swift = `
  import {useState} from 'react';import {View,Text as RNText} from 'react-native';
  const style=modifiers=>Object.assign({},...(modifiers||[]).map(({name,value})=>{
    if(name==='frame')return {width:value.width,height:value.height,minHeight:value.minHeight};
    if(name==='padding')return {paddingLeft:value.horizontal,paddingRight:value.horizontal,paddingTop:value.vertical,paddingBottom:value.vertical};
    if(name==='foregroundStyle')return {color:value};return {};
  }));
  export const Host=({children,style:hostStyle,matchContents})=><View style={hostStyle}><div data-native-host data-matches-height={Boolean(matchContents===true||matchContents?.vertical)}>{children}</div></View>;
  export const HStack=({children,spacing,modifiers})=><View style={{flexDirection:'row',alignItems:'center',gap:spacing,...style(modifiers)}}>{children}</View>;
  export const Spacer=()=> <View style={{flex:1}}/>;
  export const Text=({children,modifiers})=>{
    const font=modifiers.find(item=>item.name==='font')?.value;
    return <RNText numberOfLines={modifiers.find(item=>item.name==='lineLimit')?.value} style={{flexShrink:1,minWidth:0,fontSize:font?.textStyle==='subheadline'?15:17,lineHeight:23,...style(modifiers)}}>{children}</RNText>;
  };
  export const Menu=({label,children,modifiers,testID})=>{const [open,setOpen]=useState(false);return <View><button data-testid={testID} aria-label={modifiers.find(item=>item.name==='accessibilityLabel')?.value} disabled={modifiers.find(item=>item.name==='disabled')?.value} onClick={()=>setOpen(!open)} style={{padding:0,border:0,background:'transparent',color:'inherit',width:'100%',textAlign:'left'}}>{label}</button>{open&&<div role="menu">{children}</div>}</View>};
  export const Button=({label,children,onPress,modifiers,testID})=><button role="menuitem" data-testid={testID} disabled={modifiers?.find(item=>item.name==='disabled')?.value} onClick={onPress}>{label||children}</button>;
`
const modifiers =
  [
    'accessibilityAddTraits',
    'accessibilityLabel',
    'accessibilityValue',
    'buttonStyle',
    'contentShape',
    'disabled',
    'font',
    'foregroundStyle',
    'frame',
    'lineLimit',
    'padding',
  ]
    .map((name) => `export const ${name}=value=>({name:'${name}',value});`)
    .join('\n') + `\nexport const shapes={rectangle:()=>({})};`
const mocks = {
  'react-native': native,
  '@expo/ui/swift-ui': swift,
  '@expo/ui/swift-ui/modifiers': modifiers,
  './native-icon': `export const NativeIcon=({name,size,color})=><span aria-hidden style={{width:size,height:size,flexShrink:0,color}}>⌄</span>;export const NativeIconLabel=({title})=>title;`,
  './icon': `export const Icon=({name,size=20,color})=><span data-icon={name} aria-hidden style={{display:'block',width:size,height:size,flexShrink:0,color}}>◇</span>;`,
  '../../runtime/preferences/app-preferences': `export const useCarMode=()=>false;export const carZoom=1.4;`,
  './action': `export const Action=()=>null;`,
}
const built = await build({
  stdin: {
    resolveDir: root + 'apps/mobile',
    loader: 'tsx',
    contents: `
      import {useState} from 'react';import {createRoot} from 'react-dom/client';
      import {ScrollView,View} from 'react-native';
      import {createMobileTheme,MobileThemeContext} from './src/ui/theme';
      import {SettingsPage,SettingsSheet} from './src/screens/settings-theme';
      import {SettingsGroup,SettingsRow,SettingsSwitchRow} from './src/screens/settings-group';
      import {SettingsChoice,SettingsField,SettingsAction} from './src/screens/settings-controls';
      import {SettingsTargetProvider,ScopedSettings} from './src/runtime/preferences/settings-target';
      import {SettingSource} from './src/runtime/preferences/setting-source';
      import {HarnessUpdates} from './src/agents/harness-updates';
      const computer='Dominic’s development computer with a long name';
      window.runtime={activeId:'computer',connected:true,overviews:[{profile:{id:'computer',name:computer,connection:{address:'http://computer',token:'test'}},connected:true,snapshot:{defaults:{scopedSettings:{environment:{taskDefaults:{setupCommand:'pnpm install && pnpm build'}},shared:[]}},workspace:{repositories:[]}}}]};
      window.runtime.snapshot=window.runtime.overviews[0].snapshot;
      function Controls(){const [selected,setSelected]=useState('long');window.selected=selected;const [enabled,setEnabled]=useState(true);window.enabled=enabled;
        return <><SettingsChoice label="Other computer refresh" value={selected} items={[{id:'long',name:'When I refresh the other development computer'},{id:'short',name:'Every 30 seconds'}]} onChange={setSelected}/>
          <SettingsChoice label="Voice" value="0" items={Array.from({length:14},(_,index)=>({id:String(index),name:'Siri voice '+index+' · English · Enhanced quality'}))} onChange={value=>window.voice=value}/>
          <SettingsSwitchRow first label="Keep this computer awake while running development tasks" value={enabled} onValueChange={setEnabled}/>
          <SettingsField label="Shell arguments (one per line)" multiline value={'--login\\n--interactive'} onChangeText={()=>{}}/>
          <SettingsAction secondary label="Reset all later worktree setup overrides" onPress={()=>{}}/>
        </>;
      }
      function App(){const [mode,setMode]=useState('dark');const [sheet,setSheet]=useState(false);window.setMode=setMode;window.showSheet=setSheet;
        return <MobileThemeContext.Provider value={createMobileTheme('dovo',mode)}><SettingsPage><ScrollView contentContainerStyle={{padding:16,gap:24}}>
          <SettingsGroup title="Computers"><SettingsRow title="Settings scope" subtitle="All projects on this computer" value={computer} icon="device" tint="#087f5b" mark={{icon:'stack',label:'Computer settings'}} onPress={()=>{}}/></SettingsGroup>
          <SettingsGroup title="Preferences"><Controls/></SettingsGroup>
          <SettingsTargetProvider><ScopedSettings>{()=> <SettingSource source="global" overridden={false} label="Worktree setup" setting={{field:{group:'taskDefaults',key:'setupCommand'},scope:'global',value:undefined}}/>}</ScopedSettings></SettingsTargetProvider>
          <HarnessUpdates/>
        </ScrollView>{sheet&&<SettingsSheet title="Edit computer" onClose={()=>setSheet(false)}><Controls/></SettingsSheet>}</SettingsPage></MobileThemeContext.Provider>;
      }
      createRoot(document.getElementById('app')).render(<App/>);
    `,
  },
  plugins: [
    {
      name: 'native-boundaries',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, ({ path }) => {
          if (/ui\/layout\/sheet$|^\.\.\/layout\/sheet$/.test(path))
            return { path: 'sheet', namespace: 'mock' }
          if (/state\/application-state$/.test(path)) return { path: 'state', namespace: 'mock' }
          if (/connection\/provider$/.test(path)) return { path: 'runtime', namespace: 'mock' }
          if (/controls\/icon$/.test(path)) return { path: './icon', namespace: 'mock' }
          if (/controls\/action$/.test(path)) return { path: './action', namespace: 'mock' }
          if (Object.hasOwn(mocks, path)) return { path, namespace: 'mock' }
        })
        builder.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({
          contents:
            path === 'state'
              ? `export {useState as useApplicationState} from 'react';`
              : path === 'runtime'
                ? `export const useRuntime=()=>window.runtime;export const RuntimeScope=({children})=>children;`
                : path === 'sheet'
                  ? `import {createContext,useContext} from 'react';import {View} from 'react-native';const Context=createContext(false);export const useInsideSheet=()=>useContext(Context);export const Sheet=({children,title})=><Context.Provider value><View accessibilityLabel={title} style={{position:'fixed',inset:0,background:'#f2f2f7',zIndex:1}}>{children}</View></Context.Provider>;`
                  : mocks[path],
          loader: 'tsx',
          resolveDir: root + 'apps/mobile',
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
  for (const platform of ['android', 'ios']) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    page.setDefaultTimeout(10000)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setContent(
      '<style>body{margin:0;font-family:system-ui}#app{display:flex;height:100vh}#app>div{min-width:0}button,input,textarea{font:inherit}</style><div id="app"></div>',
    )
    await page.evaluate((platform) => {
      window.platform = platform
      window.fontScale = 1
    }, platform)
    await page.addScriptTag({ content: built.outputFiles[0].text })
    await page.getByTestId('Settings scope').waitFor()
    const argumentsField = page.getByLabel('Shell arguments (one per line)', { exact: true })
    assert.equal(
      await argumentsField.evaluate((element) => element.scrollHeight <= element.clientHeight),
      true,
      'Both lines of shell arguments must fit in the default multiline editor',
    )
    assert.equal(
      await page
        .locator('[data-icon="device"]')
        .evaluate((element) => getComputedStyle(element).color),
      'rgb(8, 127, 91)',
      'Computer status tint must be visible',
    )

    await page.getByRole('button', { name: 'Change scope', exact: true }).click()
    await page.getByRole('button', { name: 'Sources for worktree setup', exact: true }).click()
    await page
      .getByRole('button', { name: 'Worktree setup: overridden at 1 later level', exact: true })
      .click()
    const sourceName = page.getByText('Dominic’s development computer with a long name · editing', {
      exact: true,
    })
    const sourceValue = page.getByText('pnpm install && pnpm build', { exact: true })
    for (const mode of ['dark', 'light']) {
      await page.evaluate((mode) => window.setMode(mode), mode)
      await page.waitForFunction(
        (mode) =>
          document.querySelector('#app>div').style.backgroundColor ===
          (mode === 'dark' ? 'rgb(0, 0, 0)' : 'rgb(242, 242, 247)'),
        mode,
      )
      for (const locator of [
        sourceName,
        sourceValue,
        page.getByText('Harness updates', { exact: true }),
      ]) {
        const color = await locator.evaluate((element) => getComputedStyle(element).color)
        assert.equal(
          color,
          await page
            .getByTestId('Settings scope')
            .locator('[data-text]')
            .first()
            .evaluate((element) => getComputedStyle(element).color),
          'Settings details must use the theme text color',
        )
      }
      for (const [width, scale] of [
        [320, 1],
        [390, 1],
        [390, 1.5],
        [320, 2],
      ]) {
        await page.setViewportSize({ width, height: 844 })
        await page.evaluate((scale) => window.setFontScale(scale), scale)
        await page.evaluate(
          () =>
            new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        )
        const overflow = await page.evaluate(() =>
          [...document.querySelectorAll('[data-text],input,textarea,button,[data-icon]')]
            .filter((element) => {
              const rect = element.getBoundingClientRect()
              return rect.width > 0 && (rect.left < -1 || rect.right > innerWidth + 1)
            })
            .map((element) => ({
              text: element.textContent,
              left: element.getBoundingClientRect().left,
              right: element.getBoundingClientRect().right,
            })),
        )
        assert.deepEqual(overflow, [], platform + ' settings overflow at ' + width + ' / ' + scale)
        const value = page.getByText('When I refresh the other development computer', {
          exact: true,
        })
        assert.equal(
          await value.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
          true,
          'Expanded choice values must stay readable',
        )
        if (width / scale < 360) {
          const computer = page
            .getByTestId('Settings scope')
            .getByText('Dominic’s development computer with a long name', { exact: true })
          assert.equal(
            await computer.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
            true,
            'Narrow settings rows must show the computer value',
          )
        }
      }
    }
    if (platform === 'ios') {
      assert.equal(
        await page.locator('[data-native-host][data-matches-height="false"]').count(),
        0,
        'Native choices must measure their own content height',
      )
    }
    await page.setViewportSize({ width: 390, height: 844 })
    await page.evaluate(() => window.setFontScale(1))
    const choice = page.getByTestId('Other computer refresh')
    await choice.click()
    await page.getByTestId('Choose Every 30 seconds').click()
    await page.waitForFunction(() => window.selected === 'short')
    if (platform === 'ios') await choice.click()
    await page
      .getByRole('switch', {
        name: 'Keep this computer awake while running development tasks',
        exact: true,
      })
      .click()
    await page.waitForFunction(() => window.enabled === false)
    await page.evaluate(() => window.showSheet(true))
    const editor = page.getByLabel('Edit computer', { exact: true })
    await editor.getByLabel('Voice', { exact: true }).click()
    await editor.getByLabel('Search voice', { exact: true }).fill('voice 13')
    await editor.getByTestId('Choose Siri voice 13 · English · Enhanced quality').click()
    await page.waitForFunction(() => window.voice === '13')
    await page.evaluate(() => window.showSheet(false))
    assert.deepEqual(errors, [])
    await page.close()
  }
  console.log(
    'Mobile settings: narrow and large-text layouts, dark/light details, status tints, native choice sizing, switches and searchable sheet choices passed (native boundaries mocked).',
  )
} finally {
  await browser.close()
}
