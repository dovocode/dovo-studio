import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from './browser/harness.mjs'

const screenshotDirectory = '/tmp/dovo-mobile-settings'
await mkdir(screenshotDirectory, { recursive: true })
const navigationOnly = process.argv.includes('--navigation-only')
const root = fileURLToPath(new URL('../', import.meta.url))
// Model RN's column layout, zero default shrink and explicit font scaling. These checks
// exercise real settings components; UIKit/SwiftUI measurement still needs a device.
const native = `
  import {Children,useLayoutEffect,useRef,useImperativeHandle,useSyncExternalStore} from 'react';
  const flat=style=>Array.isArray(style)?Object.assign({},...style.map(flat)):style||{};
  const css=styles=>{const style=flat(styles);return Object.fromEntries(Object.entries({...style,
    ...(style.paddingHorizontal!=null?{paddingLeft:style.paddingLeft??style.paddingHorizontal,paddingRight:style.paddingRight??style.paddingHorizontal}:{}),
    ...(style.paddingVertical!=null?{paddingTop:style.paddingTop??style.paddingVertical,paddingBottom:style.paddingBottom??style.paddingVertical}:{}),
    ...(style.marginHorizontal!=null?{marginLeft:style.marginLeft??style.marginHorizontal,marginRight:style.marginRight??style.marginHorizontal}:{}),
    ...(style.marginVertical!=null?{marginTop:style.marginTop??style.marginVertical,marginBottom:style.marginBottom??style.marginVertical}:{})}).filter(([,value])=>value!=null));};
  export const StyleSheet={create:style=>style,flatten:flat,hairlineWidth:1};
  export const Platform={OS:window.platform};
  const base={display:'flex',flexDirection:'column',alignItems:'stretch',flexShrink:0,minHeight:0,position:'relative',boxSizing:'border-box'};
  export const View=({children,style,testID,accessibilityLabel,onLayout,ref:forwarded})=>{
    const ref=useRef();useImperativeHandle(forwarded,()=>{const node=ref.current;node.measureLayout=(parent,done)=>{const a=node.getBoundingClientRect(),b=parent.getBoundingClientRect();done(a.x-b.x,a.y-b.y)};return node;});useLayoutEffect(()=>{if(!onLayout)return;const observer=new ResizeObserver(()=>{const {width,height}=ref.current.getBoundingClientRect();onLayout({nativeEvent:{layout:{width,height}}})});observer.observe(ref.current);return ()=>observer.disconnect()},[onLayout]);
    return <div ref={ref} data-testid={testID} aria-label={accessibilityLabel} style={{...base,...css(style)}}>{children}</div>;
  };
  export const ScrollView=({children,style,contentContainerStyle,stickyHeaderIndices,ref:forwarded,onContentSizeChange})=>{const outer=useRef(),inner=useRef();useImperativeHandle(forwarded,()=>({getInnerViewNode:()=>inner.current,scrollTo:({y})=>{outer.current.scrollTop=y}}));useLayoutEffect(()=>{if(!onContentSizeChange)return;const observer=new ResizeObserver(()=>{const {width,height}=inner.current.getBoundingClientRect();onContentSizeChange(width,height)});observer.observe(inner.current);return()=>observer.disconnect()},[onContentSizeChange]);return <div ref={outer} style={{...base,overflowY:'auto',flex:1,...css(style)}}><div ref={inner} style={{...base,...css(contentContainerStyle)}}>{Children.toArray(children).map((child,index)=>stickyHeaderIndices?.includes(index)?<View key={index} style={{position:'sticky',top:0,zIndex:1}}>{child}</View>:child)}</div></div>};
  export const Pressable=({children,style,onPress,testID,accessibilityLabel,accessibilityRole,accessibilityState,accessibilityValue,disabled})=><button data-testid={testID} aria-label={accessibilityLabel} role={accessibilityRole} aria-pressed={accessibilityState?.selected} aria-expanded={accessibilityState?.expanded} data-value={accessibilityValue?.text} disabled={disabled} onClick={onPress} style={{...base,backgroundColor:'transparent',border:0,margin:0,padding:0,font:'inherit',textAlign:'left',...css(typeof style==='function'?style({pressed:false}):style)}}>{children}</button>;
  export const Text=({children,style,numberOfLines,testID,accessibilityRole})=>{
    const textStyle=css(style),scale=window.fontScale;
    return <span data-testid={testID} role={accessibilityRole} data-text style={{flexShrink:0,boxSizing:'border-box',overflowWrap:'anywhere',...textStyle,fontSize:(textStyle.fontSize||14)*scale,lineHeight:textStyle.lineHeight?textStyle.lineHeight*scale+'px':undefined,...(numberOfLines===1?{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}:{display:'block'})}}>{children}</span>;
  };
  export const TextInput=({style,multiline,accessibilityLabel,value,onChangeText,editable,ref,placeholder,placeholderTextColor})=>{
    const Component=multiline?'textarea':'input';const inputStyle=css(style);
    return <Component ref={ref} aria-label={accessibilityLabel} placeholder={placeholder} value={value} disabled={editable===false} onChange={e=>onChangeText?.(e.target.value)} style={{boxSizing:'border-box',background:'transparent',border:0,outline:0,'--placeholder-color':placeholderTextColor,minWidth:0,flexShrink:0,...inputStyle,fontSize:(inputStyle.fontSize||14)*window.fontScale,resize:'none'}}/>;
  };
  export const Switch=({accessibilityLabel,value,onValueChange,disabled})=><button role="switch" aria-label={accessibilityLabel} aria-checked={value} disabled={disabled} onClick={()=>onValueChange(!value)} style={{width:51,height:31,border:0,borderRadius:16,padding:3,opacity:disabled?0.4:1,background:value?'#34c759':'#767680',flexShrink:0,alignSelf:'flex-start'}}><span style={{display:'block',width:25,height:25,borderRadius:13,background:'white',marginLeft:value?20:0}}/></button>;
  const listeners=new Set();window.setFontScale=scale=>{window.fontScale=scale;listeners.forEach(listener=>listener())};
  export const useWindowDimensions=()=>{useSyncExternalStore(listener=>{listeners.add(listener);window.addEventListener('resize',listener);return ()=>{listeners.delete(listener);window.removeEventListener('resize',listener)}},()=>innerWidth+':'+window.fontScale);return {width:innerWidth,height:innerHeight,fontScale:window.fontScale}};
  export const Alert={alert(){}};
  export const Appearance={setColorScheme(){}};
  export const useColorScheme=()=>window.systemMode||'dark';
  export const AccessibilityInfo={isReduceMotionEnabled:async()=>false,addEventListener:(_event,callback)=>{window.setSystemMotion=callback;return {remove(){}}}};
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
  export const Menu=({label,children,modifiers,testID})=>{const [open,setOpen]=useState(false);return <View><button data-testid={testID} aria-label={modifiers.find(item=>item.name==='accessibilityLabel')?.value} disabled={modifiers.find(item=>item.name==='disabled')?.value} onClick={()=>setOpen(!open)} style={{padding:0,border:0,background:'transparent',color:'inherit',width:'100%',textAlign:'left'}}>{label}</button>{open&&<div role="menu" onClick={()=>setOpen(false)}>{children}</div>}</View>};
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
  '../../screens/remote-desktop': 'export const MobileRemoteDesktop=()=>null;',
  'react-native': native,
  '@expo/ui/swift-ui': swift,
  '@expo/ui/swift-ui/modifiers': modifiers,
  './native-icon': `export const NativeIcon=({name,size,color})=><span data-icon={name} aria-hidden style={{width:size,height:size,flexShrink:0,color}}>⌄</span>;export const NativeIconLabel=({title,icon})=><><span aria-hidden data-icon={icon}/>{title}</>;`,
  './icon': `import {iconAssets} from './src/ui/controls/icon-assets';export const Icon=({name,size=20,color})=>{const asset=iconAssets[name];const url=typeof asset==='string'?asset:asset?.default;return <span data-icon={name} aria-hidden style={{display:'block',width:size,height:size,flexShrink:0,color,backgroundColor:color||'currentColor',maskImage:'url('+url+')',maskSize:'contain',maskRepeat:'no-repeat'}}/>};`,
  '../../runtime/preferences/app-preferences': `export const useCarMode=()=>false;export const carZoom=1.4;`,
  'expo-router': `export const usePreventRemove=()=>{};export const router={push:path=>window.navigate(path),dismissTo:path=>window.navigate(path),canGoBack:()=>window.routeHistory.length>1,back:()=>window.goBack()};export const useLocalSearchParams=()=>({section:window.section,runtimeId:window.requestedRuntimeId,setting:window.requestedSetting});`,
  expo: `export const requireOptionalNativeModule=()=>({getSupportedLocales:async()=>({locales:['en-US','de-DE']})});`,
  'expo-speech': `export const getAvailableVoicesAsync=async()=>[{identifier:'siri',name:'Siri',language:'en-US',quality:'Enhanced'}];`,
  'expo-constants': `export default {expoConfig:{version:'test'}};`,
  '@react-native-async-storage/async-storage': `export default {getItem:async()=>null,setItem:async(key,value)=>{window.savedPreferences=JSON.parse(value)}};`,
  '../tasks/list/task-list-view': `export const useTaskListView=()=>({setView:update=>{window.taskView=update(window.taskView||{})}});`,
  '../notifications/provider': `import {useState} from 'react';export const usePushNotifications=()=>{const [enabled,setEnabled]=useState(true);const [servers,setServers]=useState({});return {supported:window.notificationsSupported!==false,busy:Boolean(window.notificationsBusy),enabled,setEnabled,error:window.notificationError||'',serverEnabled:id=>servers[id]!==false,setServerEnabled:(id,value)=>setServers({...servers,[id]:value})}};`,
  '../live-activities/provider': `import {useState} from 'react';export const useLiveActivities=()=>{const [enabled,setEnabled]=useState(true);return {supported:window.activitiesSupported??(window.platform==='ios'),enabled,setEnabled,error:window.activityError||''}};`,
  '../runtime/diagnostics/crash-log': `export const readLastCrash=async()=>null;export const clearLastCrash=async()=>{};`,
  '../ui/content/open-link': `export const useOpenAppLink=()=>async()=>{};`,
  '../../../shell/workbench': `export const WorkbenchDetailRoute=({children})=>children;`,
  './action': `export const Action=()=>null;`,
}
for (const screen of [
  'task-defaults',
  'usage',
  'appearance',
  'agents',
  'devices',
  'device-host-settings',
  'resources',
]) {
  mocks['../../../screens/' + screen] =
    `export default function Screen(){return <div>${screen}</div>}`
}
mocks['../../../scm/connections/connections'] =
  `export default function Screen(){return <div>source-control</div>}`
const built = await build({
  stdin: {
    resolveDir: root + 'apps/mobile',
    loader: 'tsx',
    contents: `
      import {useState} from 'react';import {createRoot} from 'react-dom/client';
      import {ScrollView,View,Text as RNText} from 'react-native';
      import {createMobileTheme,MobileThemeContext,useTheme} from './src/ui/theme';
      import {SettingsPage,SettingsSheet} from './src/screens/settings-theme';
      import {SettingsScrollView,SettingsAnchor,SettingsSearchContext} from './src/screens/settings-search';
      import {SettingsGroup,SettingsRow,SettingsSwitchRow} from './src/screens/settings-group';
      import {SettingsChoice,SettingsField,SettingsAction} from './src/screens/settings-controls';
      import {SettingsTargetProvider,ScopedSettings} from './src/runtime/preferences/settings-target';
      import {SettingSource} from './src/runtime/preferences/setting-source';
      import {HarnessUpdates} from './src/agents/harness-updates';
      import {Effect} from 'effect';import {decode,runtimePreferencesSchema} from '@dovo/protocol';
      import SettingsScreen from './src/screens/settings';
      import AppearanceScreen from './src/screens/appearance';
      import {MobileAppearance} from './src/ui/appearance';
      function MotionProbe(){return <output aria-label="Reduced motion">{String(useTheme().reduceMotion)}</output>;}
      import SettingsSection from './src/app/(more)/settings/[section]';
      const computer='Dominic’s development computer with a long name';
      window.runtime={activeId:'computer',connected:true,overviews:[{profile:{id:'computer',name:computer,connection:{address:'http://computer',token:'test'}},connected:true,snapshot:{defaults:{scopedSettings:{environment:{taskDefaults:{setupCommand:'pnpm install && pnpm build'}},shared:[]}},workspace:{repositories:[],tasks:[]}}}]};
      window.runtime.overviews.push({...window.runtime.overviews[0],profile:{...window.runtime.overviews[0].profile,id:'other',name:'Build server'},snapshot:{...window.runtime.overviews[0].snapshot,defaults:{scopedSettings:{environment:{},shared:[]}}}});
      window.computerPreferences={};window.computerReads=[];window.computerSaves=[];
      for(const entry of window.runtime.overviews){
        const id=entry.profile.id;window.computerPreferences[id]=decode(runtimePreferencesSchema,{});entry.call=async(path)=>path==='/api/runtime/preferences/read'?structuredClone(window.computerPreferences[id]):({value:{},inherited:{}});
        entry.readEffect=(path)=>Effect.sync(()=>{window.computerReads.push({id,path});if(path==='/api/memory/projects/read')return {projects:[]};return structuredClone(window.computerPreferences[id])});
        entry.callEffect=(path,changes)=>Effect.sync(()=>{window.computerSaves.push({id,path,changes});const preferences=window.computerPreferences[id];if(path==='/api/memory/settings/save'){if(changes.scope==='system')preferences.memory.systemEnabled=changes.enabled;return structuredClone(preferences.memory)}Object.assign(preferences,changes);return structuredClone(preferences)});
      }
      Object.assign(window.runtime,window.runtime.overviews[0]);
      window.runtime.snapshot=window.runtime.overviews[0].snapshot;window.runtime.profiles=window.runtime.overviews.map(entry=>entry.profile);
      function Controls(){const [modelMode,setModelMode]=useState('auto');window.modelMode=modelMode;const [selected,setSelected]=useState('long');window.selected=selected;const [enabled,setEnabled]=useState(true);window.enabled=enabled;
        return <><SettingsChoice label="Other computer refresh" value={selected} items={[{id:'long',name:'When I refresh the other development computer'},{id:'short',name:'Every 30 seconds'}]} onChange={setSelected}/>
          <SettingsChoice label="Model mode" value={modelMode} items={[{id:'auto',name:'Tune',icon:'tune'},{id:'smart',name:'Maestro',icon:'maestro'}]} onChange={setModelMode}/>
          <SettingsChoice label="Voice" value="0" items={Array.from({length:14},(_,index)=>({id:String(index),name:'Siri voice '+index+' · English · Enhanced quality'}))} onChange={value=>window.voice=value}/>
          <SettingsSwitchRow first label="Keep this computer awake while running development tasks" value={enabled} onValueChange={setEnabled}/>
          <SettingsField label="Shell arguments (one per line)" multiline value={'--login\\n--interactive'} onChangeText={()=>{}}/>
          <SettingsAction secondary label="Reset all later worktree setup overrides" onPress={()=>{}}/>
        </>;
      }
      function App(){const [probe,setProbe]=useState(false);window.showSearchProbe=setProbe;const [probeTarget,setProbeTarget]=useState('Probe setting');window.setProbeTarget=setProbeTarget;const [probeRevision,setProbeRevision]=useState(0);window.remountProbe=()=>setProbeRevision(value=>value+1);const [probeHeaderHeight,setProbeHeaderHeight]=useState(0);const [accessibility,setAccessibility]=useState(false);window.showAccessibility=(value=true)=>setAccessibility(value);const [navigation,setNavigation]=useState(false);const [path,setPath]=useState('/settings');const [revision,setRevision]=useState(0);window.refreshSettings=()=>setRevision(revision+1);window.showNavigation=()=>setNavigation(true);window.routeHistory??=['/settings'];window.navigate=target=>{const path=typeof target==='string'?target:target.pathname;window.requestedSetting=typeof target==='string'?undefined:target.params?.setting;window.requestedRuntimeId=typeof target==='string'?undefined:target.params?.runtimeId;window.routeHistory.push(path);window.section=path.split('/')[2];setPath(path)};window.goBack=()=>{window.routeHistory.pop();const path=window.routeHistory.at(-1);window.section=path.split('/')[2];setPath(path)};const [mode,setMode]=useState('dark');const [sheet,setSheet]=useState(false);const [scopeOnly,setScopeOnly]=useState(false);window.showScoped=setScopeOnly;window.setMode=setMode;window.showSheet=setSheet;
        if(accessibility)return <MobileAppearance><AppearanceScreen/><MotionProbe/></MobileAppearance>;
        return <MobileThemeContext.Provider value={createMobileTheme('dovo',mode)}><SettingsPage>{probe?<SettingsSearchContext.Provider value={probeTarget}><SettingsScrollView searchHeaderHeight={probeHeaderHeight} stickyHeaderIndices={[0]} style={{flex:1}}><View accessibilityLabel='Probe scope header' onLayout={event=>setProbeHeaderHeight(event.nativeEvent.layout.height)} style={{height:84*window.fontScale,backgroundColor:'#333'}}><RNText>Scope header</RNText></View><View style={{height:800}}/><SettingsAnchor key={probeRevision} label='Probe setting'><View accessibilityLabel='Probe destination' style={{height:100}}><RNText>Probe setting</RNText></View></SettingsAnchor><View style={{height:1000}}/></SettingsScrollView></SettingsSearchContext.Provider>:navigation?<SettingsTargetProvider>{path==='/settings'?<SettingsScreen/>:<SettingsSection key={path}/>}</SettingsTargetProvider>:scopeOnly?<SettingsTargetProvider><ScopedSettings scrollable>{()=> <View style={{height:1800}}><RNText>Settings content</RNText></View>}</ScopedSettings></SettingsTargetProvider>:<ScrollView contentContainerStyle={{padding:16,gap:24}}>
          <SettingsGroup title="Computers"><SettingsRow title="Settings scope" subtitle="All projects on this computer" value={computer} icon="device" tint="#087f5b" mark={{icon:'stack',label:'Computer settings'}} onPress={()=>{}}/></SettingsGroup>
          <SettingsGroup title="Preferences"><Controls/></SettingsGroup>
          <SettingsTargetProvider><ScopedSettings>{()=> <SettingSource source="global" overridden={false} label="Worktree setup" setting={{field:{group:'taskDefaults',key:'setupCommand'},scope:'global',value:undefined,inheritedValue:undefined}}/>}</ScopedSettings></SettingsTargetProvider>
          <HarnessUpdates/>
        </ScrollView>}{sheet&&<SettingsSheet title="Edit computer" onClose={()=>setSheet(false)}><Controls/></SettingsSheet>}</SettingsPage></MobileThemeContext.Provider>;
      }
      createRoot(document.getElementById('app')).render(<App/>);
    `,
  },
  plugins: [
    {
      name: 'native-boundaries',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, ({ path, importer }) => {
          if (importer.endsWith('/ui/controls/icon-assets.ts') && path.endsWith('.png'))
            return {
              path:
                root +
                'apps/mobile/assets/icons/' +
                path.split('/').at(-1).replace('.png', '@3x.png'),
            }
          if (/ui\/layout\/sheet$|^\.\.\/layout\/sheet$/.test(path))
            return { path: 'sheet', namespace: 'mock' }
          if (/layout\/screen-header$/.test(path)) return { path: 'header', namespace: 'mock' }
          if (/state\/application-state$/.test(path)) return { path: 'state', namespace: 'mock' }
          if (
            /connection\/provider$/.test(path) ||
            (path === './provider' &&
              importer.endsWith('/runtime/connection/runtime-preferences.tsx'))
          )
            return { path: 'runtime', namespace: 'mock' }
          if (/controls\/icon$/.test(path)) return { path: './icon', namespace: 'mock' }
          if (/controls\/action$/.test(path)) return { path: './action', namespace: 'mock' }
          if (path === 'lucide-react-native') return { path: 'a11y-icons', namespace: 'mock' }
          if (path === './code-theme' && importer.endsWith('/screens/appearance.tsx'))
            return { path: 'code-theme', namespace: 'mock' }
          if (Object.hasOwn(mocks, path)) return { path, namespace: 'mock' }
        })
        builder.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({
          contents:
            path === 'a11y-icons'
              ? `const Icon=({size,color})=><span aria-hidden style={{width:size,height:size,color}}>●</span>;export const CircleCheck=Icon,CircleX=Icon,TriangleAlert=Icon;`
              : path === 'code-theme'
                ? `export const CodeThemeSettings=()=>null;`
                : path === 'header'
                  ? `import {createContext,useContext} from 'react';import {View,Text,Pressable} from 'react-native';import {useTheme} from './src/ui/theme';export const ScreenBackContext=createContext(null);export const ScreenHeader=({title})=>{const back=useContext(ScreenBackContext);const {styles}=useTheme();return <View style={{padding:16,flexDirection:'row',alignItems:'center',gap:16}}>{back&&<Pressable accessibilityLabel="Back" onPress={back}><Text style={styles.text}>Back</Text></Pressable>}<Text numberOfLines={1} style={[styles.text,{fontWeight:'600',flex:1,minWidth:0}]} accessibilityRole="heading">{title}</Text></View>};`
                  : path === 'state'
                    ? `export {useState as useApplicationState} from 'react';`
                    : path === 'runtime'
                      ? `import {createContext,useContext} from 'react';const Context=createContext(null);export const useRuntime=()=>useContext(Context)||window.runtime;export const RuntimeScope=({runtimeId,children})=>{const runtime=useRuntime();const entry=runtime.overviews.find(item=>item.profile.id===runtimeId);return entry?<Context.Provider value={{...runtime,...entry,activeId:runtimeId}}>{children}</Context.Provider>:null};`
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
  loader: { '.png': 'dataurl' },
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false' },
})

const browser = await chromium.launch({ headless: true })
try {
  for (const platform of ['android', 'ios']) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    page.setDefaultTimeout(10000)
    const errors = []
    page.on('pageerror', (error) => {
      errors.push(error.message)
      console.error(error.message)
    })
    await page.setContent(
      '<style>body{margin:0;font-family:system-ui}#app{display:flex;height:100vh}#app>div{min-width:0}button,input,textarea{font:inherit}input::placeholder{color:var(--placeholder-color)}</style><div id="app"></div>',
    )
    await page.evaluate((platform) => {
      window.platform = platform
      window.fontScale = 1
    }, platform)
    await page.addScriptTag({ content: built.outputFiles[0].text })
    if (!navigationOnly) {
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

      await page
        .getByRole('button', { name: 'View inheritance for worktree setup', exact: true })
        .click()
      await page
        .getByRole('button', {
          name: '1 override keeps its own value for worktree setup',
          exact: true,
        })
        .click()
      const sourceName = page.getByText(
        'Dominic’s development computer with a long name · editing',
        {
          exact: true,
        },
      )
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
          assert.deepEqual(
            overflow,
            [],
            platform + ' settings overflow at ' + width + ' / ' + scale,
          )
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
      const modeChoice = page.getByTestId('Model mode')
      assert.equal(await modeChoice.locator('[data-icon=tune]').count(), 1)
      await modeChoice.click()
      const tune = page.getByTestId('Choose Tune')
      assert.equal(await tune.locator('[data-icon=tune]').count(), 1)
      assert.equal(await tune.locator('[data-icon=check]').count(), 1)
      const maestro = page.getByTestId('Choose Maestro')
      assert.equal(await maestro.locator('[data-icon=maestro]').count(), 1)
      await maestro.click()
      await page.waitForFunction(() => window.modelMode === 'smart')
      assert.equal(await modeChoice.locator('[data-icon=maestro]').count(), 1)
      if (platform === 'ios') await modeChoice.click()
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
      await page.evaluate(() => window.showScoped(true))
      const sticky = page.getByLabel('Settings target', { exact: true })
      await sticky.getByText('All projects on all machines', { exact: true }).waitFor()
      const storage = page.getByText('Shared across paired machines', { exact: true })
      const description = page.getByText(
        'Defaults for all projects on all machines. More-specific overrides keep their own values.',
        { exact: true },
      )
      for (const mode of ['dark', 'light']) {
        await page.evaluate((mode) => window.setMode(mode), mode)
        await page.waitForFunction(
          (mode) =>
            document.querySelector('#app>div').style.backgroundColor ===
            (mode === 'dark' ? 'rgb(0, 0, 0)' : 'rgb(242, 242, 247)'),
          mode,
        )
        assert.equal(await storage.count(), 0)
        assert.equal(await description.count(), 0)
        await sticky
          .getByRole('button', { name: 'Settings inheritance details', exact: true })
          .waitFor()
        await page.getByLabel('Project', { exact: true }).waitFor()
        await page.getByLabel('Computer', { exact: true }).waitFor()
        assert.equal(
          await page.getByRole('button', { name: 'Change scope', exact: true }).count(),
          0,
          'Machine and project choices remain available with multiple computers',
        )
        assert.equal(
          await sticky.getByText('Shared across paired machines', { exact: true }).count(),
          0,
          'Storage details must not enlarge the sticky header',
        )
        await page.screenshot({
          path: `${screenshotDirectory}/${platform}-${mode}-scope-expanded.png`,
        })
      }
      const before = await sticky.boundingBox()
      const scroll = () =>
        sticky.evaluate((element) => {
          let parent = element.parentElement
          while (parent && getComputedStyle(parent).overflowY !== 'auto')
            parent = parent.parentElement
          if (!parent) throw Error('No scoped settings scroller')
          parent.scrollTop = 700
          return parent.getBoundingClientRect().top
        })
      const scrollTop = await scroll()
      await page.waitForFunction(() =>
        [...document.querySelectorAll('div')].some((e) => e.scrollTop === 700),
      )
      assert.ok(
        Math.abs((await sticky.boundingBox()).y - scrollTop) <= 1,
        'Only the compact scope summary must stick',
      )
      const choices = page.getByLabel('Settings choices', { exact: true })
      assert.ok((await choices.boundingBox()).y < before.y, 'Expanded choices must scroll away')
      await page.screenshot({ path: '/tmp/dovo-inheritance-mobile-' + platform + '.png' })
      for (const mode of ['dark', 'light']) {
        await page.evaluate((mode) => window.setMode(mode), mode)
        await page.waitForFunction(
          (mode) =>
            document.querySelector('#app>div').style.backgroundColor ===
            (mode === 'dark' ? 'rgb(0, 0, 0)' : 'rgb(242, 242, 247)'),
          mode,
        )
        await page.screenshot({
          path: `${screenshotDirectory}/${platform}-${mode}-scope-sticky.png`,
        })
      }
    }
    // Exercise the actual settings index, section route and moved controls.
    await page.evaluate(() => window.showNavigation())
    for (const category of [
      'App preferences',
      'Agents & tools',
      'Tasks & projects',
      'Computers',
      'History',
    ])
      await page.getByText(category, { exact: true }).waitFor()
    // Pages are immediately available; existing category deep links still work.
    const search = page.getByLabel('Search settings', { exact: true })
    const row = (name) => page.getByRole('button', { name, exact: true })
    const categories = [
      ['App preferences', 'app-preferences'],
      ['Agents & tools', 'agent-settings'],
      ['Tasks & projects', 'task-settings'],
      ['Computers', 'computer-settings'],
      ['History', 'history-settings'],
    ]
    for (const name of [
      'General',
      'Conversation',
      'Agents',
      'Task defaults',
      'Manage computers',
      'Archived tasks',
    ])
      assert.equal(await row(name).isVisible(), true, `${name} is available on the settings index`)
    for (const [name, route] of categories) {
      assert.equal(await row(name).count(), 0, 'Categories are static headings')
      await page.evaluate((route) => window.navigate('/settings/' + route), route)
      await page.getByRole('heading', { name, exact: true }).waitFor()
      await page.getByRole('button', { name: 'Back', exact: true }).click()
    }
    await search.fill('Time format')
    await row('Time format').click()
    await page
      .getByTestId('Settings search highlight')
      .getByLabel('Time format', { exact: true })
      .waitFor()
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await search.fill('')
    await row('Conversation').click()
    await page.getByRole('heading', { name: 'Conversation', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor()
    await row('Conversation').waitFor()
    await search.fill('general memory')
    await row('Memory').waitFor()
    await page.getByText('Agents & tools', { exact: true }).waitFor()
    assert.equal(await row('Tasks & projects').count(), 0, 'Memory lives with agent tools')
    await page.getByRole('button', { name: 'Clear search', exact: true }).click()
    assert.equal(await row('Memory').count(), 1, 'Clearing search keeps every submenu expanded')
    for (const [query, destination, section] of [
      ['24-hour', 'General', 'general'],
      ['siri voice', 'Speech & driving', 'speech'],
      ['dictation language', 'Speech & driving', 'speech'],
      ['speaking speed', 'Speech & driving', 'speech'],
      ['tool details', 'Conversation', 'conversation'],
      ['expanded inputs', 'Conversation', 'conversation'],
      ['keep screen awake', 'Conversation', 'conversation'],
      ['merge squash', 'Task & PR preferences', 'task-preferences'],
      ['confirm archive', 'Task & PR preferences', 'task-preferences'],
      ['push alerts', 'Notifications', 'notifications'],
      ['standalone relay', 'Notifications', 'notifications'],
      ['live activities', 'Notifications', 'notifications'],
      ['widgets refresh', 'Battery & background', 'battery'],
      ['maximum child agents', 'Running tasks', 'task-behavior'],
      ['interrupted restart', 'Running tasks', 'task-behavior'],
      ['tune maestro', 'Running tasks', 'task-behavior'],
      ['scope model', 'Running tasks', 'task-behavior'],
      ['supervised web requests', 'Running tasks', 'task-behavior'],
      ['code reviews', 'Running tasks', 'task-behavior'],
      ['smart pr linking', 'Pull requests & pipelines', 'pull-requests'],
      ['feedback watcher', 'Pull requests & pipelines', 'pull-requests'],
      ['last thread', 'Worktrees', 'worktrees'],
      ['branch prefix', 'Worktrees', 'worktrees'],
      ['artifact versions', 'Artifacts', 'artifacts'],
      ['artifact forever', 'Artifacts', 'artifacts'],
      ['general memory', 'Memory', 'memory'],
      ['studio tools', 'Runtime tools', 'runtime-tools'],
      ['linked projects tool', 'Runtime tools', 'runtime-tools'],
      ['preferred retrieval computer', 'Runtime tools', 'runtime-tools'],
      ['remote desktop', 'Runtime tools', 'runtime-tools'],
      ['keep history forever', 'Activity retention', 'activity-retention'],
    ]) {
      await search.fill(query)
      await page.getByRole('button', { name: destination, exact: true }).click()
      assert.equal(await page.evaluate(() => window.section), section, query)
      await page.getByRole('heading', { name: destination, exact: true }).first().waitFor()
      await page.getByRole('button', { name: 'Back', exact: true }).click()
    }
    await search.fill('no-such-setting')
    await page.getByText('No settings match “no-such-setting”.', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Clear search', exact: true }).click()
    assert.equal(await search.inputValue(), '')

    const choose = async (label, option) => {
      const control = page.getByTestId(label)
      await control.click()
      await page.getByTestId('Choose ' + option).click()
      if (platform === 'ios') await control.click()
    }
    await search.fill('24-hour')
    await page.getByRole('button', { name: 'General', exact: true }).click()
    await page.getByRole('heading', { name: 'General', exact: true }).waitFor()
    // General must retain links to every moved group for existing deep links.
    for (const title of [
      'Conversation',
      'Speech & driving',
      'Task & PR preferences',
      'Notifications',
      'Battery & background',
    ])
      await page.getByRole('button', { name: title, exact: true }).waitFor()
    await page.getByRole('button', { name: 'Battery & background', exact: true }).click()
    await choose('Other computer refresh', 'When I refresh')
    await page.waitForFunction(() => window.savedPreferences?.computerRefresh === 'manual')
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await page.getByRole('button', { name: 'Conversation', exact: true }).click()
    await page.getByRole('switch', { name: 'Show tool call details', exact: true }).click()
    await page.waitForFunction(() => window.savedPreferences?.showToolDetails === true)
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await page.getByRole('heading', { name: 'General', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await search.fill('merge squash')
    await page.getByRole('button', { name: 'Task & PR preferences', exact: true }).click()
    await choose('Merge method', 'Squash')
    await page.waitForFunction(() => window.savedPreferences?.mergeMethod === 'squash')
    await page.getByRole('switch', { name: 'Confirm before archiving a task', exact: true }).click()
    await page.waitForFunction(() => window.savedPreferences?.confirmArchive === true)
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await search.fill('siri voice')
    await page.getByRole('button', { name: 'Speech & driving', exact: true }).click()
    await choose('Voice', 'Siri · Siri · en-US · Enhanced')
    await page.waitForFunction(() => window.savedPreferences?.speechVoice === 'siri')
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await search.fill('app updates')
    await page.getByRole('button', { name: 'App & updates', exact: true }).click()
    await page.getByRole('heading', { name: 'App & updates', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Notifications', exact: true }).click()
    const computerSwitch = page.getByRole('switch', {
      name: 'Dominic’s development computer with a long name',
      exact: true,
    })
    await computerSwitch.click()
    assert.equal(await computerSwitch.getAttribute('aria-checked'), 'false')
    await page.getByRole('switch', { name: 'Task notifications', exact: true }).click()
    assert.equal(await computerSwitch.isDisabled(), true)
    const activities = page.getByRole('switch', { name: 'Show task Live Activities', exact: true })
    assert.equal(await activities.isDisabled(), platform !== 'ios')
    if (platform === 'ios') {
      await activities.click()
      assert.equal(await activities.getAttribute('aria-checked'), 'false')
    }
    await page.evaluate(() => {
      window.notificationsSupported = false
      window.notificationError = 'Notification permission denied'
      window.refreshSettings()
    })
    await page
      .getByText('Push notifications require a new native app build.', { exact: true })
      .waitFor()
    await page.getByText('Notification permission denied', { exact: true }).waitFor()
    assert.equal(
      await page.getByRole('switch', { name: 'Task notifications', exact: true }).isDisabled(),
      true,
    )
    await page.evaluate(() => {
      window.activitiesSupported = false
      window.activityError = 'Live Activities could not be started'
      window.refreshSettings()
    })
    await page
      .getByText(
        'Live Activities require the new native iOS build, not Expo Go or a JavaScript reload.',
        { exact: true },
      )
      .waitFor()
    await page.getByText('Live Activities could not be started', { exact: true }).waitFor()
    await page.getByText('Notification permission denied', { exact: true }).waitFor()
    assert.equal(await activities.isDisabled(), true)
    assert.equal(await activities.getAttribute('aria-checked'), 'false')
    await page.evaluate(() => {
      window.notificationsSupported = true
      window.notificationsBusy = true
      window.notificationError = ''
      window.refreshSettings()
    })
    assert.equal(
      await page.getByRole('switch', { name: 'Task notifications', exact: true }).isDisabled(),
      true,
    )
    assert.equal(await computerSwitch.isDisabled(), true)
    await page.evaluate(() => {
      window.notificationsBusy = false
      window.refreshSettings()
    })
    assert.equal(
      await page.getByRole('switch', { name: 'Task notifications', exact: true }).isDisabled(),
      false,
    )

    await page.evaluate(() => {
      window.computerReads = []
      window.navigate('/settings')
    })
    await search.fill('task behavior')
    await page.getByRole('button', { name: 'Running tasks', exact: true }).click()
    await page.getByText('Running tasks', { exact: true }).waitFor()
    assert.equal(await page.getByText('Memory', { exact: true }).count(), 0)
    assert.equal(await page.getByText('Pull requests & pipelines', { exact: true }).count(), 0)
    assert.equal(
      await page.evaluate(() =>
        window.computerReads.some((item) => item.path === '/api/memory/projects/read'),
      ),
      false,
    )
    const resume = page.getByRole('switch', {
      name: 'Continue interrupted turns after runtime restart',
      exact: true,
    })
    await page.evaluate(() => {
      window.runtime.activeId = 'other'
      window.refreshSettings()
    })
    await resume.click()
    await page.waitForFunction(
      () => window.computerPreferences.computer.autoContinueAfterRestart === true,
    )
    await choose('Computer', 'Build server')
    await page
      .getByText('Saved on Build server. Changes are shared with its paired devices.', {
        exact: true,
      })
      .waitFor()
    assert.equal(await resume.getAttribute('aria-checked'), 'false')
    await resume.click()
    await page.waitForFunction(() =>
      window.computerSaves.some(
        (item) => item.id === 'other' && item.changes.autoContinueAfterRestart === true,
      ),
    )
    await page.getByRole('button', { name: 'Open scoped task lifecycle', exact: true }).click()
    await page.getByText('Build server defaults', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.requestedRuntimeId), 'other')
    await page
      .getByRole('button', { name: 'Open computer running-task defaults', exact: true })
      .click()
    await page
      .getByText('Saved on Build server. Changes are shared with its paired devices.', {
        exact: true,
      })
      .waitFor()
    assert.equal(await page.evaluate(() => window.requestedRuntimeId), 'other')
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await page.evaluate(() => {
      window.runtime.activeId = 'computer'
    })
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await search.fill('general memory')
    await page.getByRole('button', { name: 'Memory', exact: true }).click()
    await page.getByRole('switch', { name: 'System-wide memory', exact: true }).click()
    await page.waitForFunction(
      () => window.computerPreferences.computer.memory.systemEnabled === true,
    )
    assert.equal(
      await page.evaluate(() => window.computerPreferences.other.memory.systemEnabled),
      false,
    )
    await page.evaluate(() => {
      window.runtime.overviews[0].connected = false
      window.navigate('/settings/task-behavior')
    })
    await page
      .getByText('This computer is offline. Reconnect to load and change its preferences.', {
        exact: true,
      })
      .waitFor()
    assert.equal(await resume.count(), 0)
    await page.evaluate(() => {
      window.runtime.overviews[0].connected = true
      window.navigate({ pathname: '/settings/artifacts', params: { runtimeId: 'missing' } })
    })
    await page
      .getByText('This computer is unavailable. Choose another computer above.', { exact: true })
      .waitFor()
    assert.equal(
      await page.getByRole('switch', { name: 'Enable Dovo Artifacts', exact: true }).count(),
      0,
    )
    await page.evaluate(() => {
      window.requestedRuntimeId = undefined
    })

    // A direct section link has a Settings fallback even without navigation history.
    await page.evaluate(() => {
      window.navigate('/settings/conversation')
      window.routeHistory = ['/settings/conversation']
    })
    await page.getByRole('heading', { name: 'Conversation', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await search.waitFor()
    // Unknown sections must keep the fallback, including names on Object.prototype.
    await page.evaluate(() => window.navigate('/settings/constructor'))
    await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor()
    for (const section of [
      '',
      'app-preferences',
      'agent-settings',
      'task-settings',
      'computer-settings',
      'history-settings',
      'general',
      'conversation',
      'speech',
      'task-preferences',
      'notifications',
      'battery',
      'task-behavior',
      'pull-requests',
      'runtime-tools',
      'artifacts',
      'memory',
      'worktrees',
      'activity-retention',
    ]) {
      await page.evaluate(
        (section) => window.navigate('/settings' + (section ? '/' + section : '')),
        section,
      )
      for (const [width, scale] of [
        [320, 1],
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
          [...document.querySelectorAll('[data-text],input,button,[data-icon]')]
            .filter((element) => {
              const rect = element.getBoundingClientRect()
              return rect.width > 0 && (rect.left < -1 || rect.right > innerWidth + 1)
            })
            .map((element) => element.textContent),
        )
        assert.deepEqual(
          overflow,
          [],
          platform + ' settings ' + section + ' overflow at ' + width + ' / ' + scale,
        )
      }
    }
    await page.setViewportSize({ width: 390, height: 844 })
    await page.evaluate(() => {
      window.navigate('/settings')
      window.setFontScale(1)
    })
    // These are phone-sized browser captures of real settings components, with native boundaries mocked.
    await page.evaluate(() => {
      window.runtime.overviews[0].profile.name = 'Dominic’s MacBook'
    })
    for (const mode of ['light', 'dark']) {
      await page.evaluate((mode) => {
        window.setMode(mode)
        window.notificationsSupported = true
        window.notificationError = ''
        window.activitiesSupported = undefined
        window.activityError = ''
        window.notificationsBusy = false
      }, mode)
      await page.evaluate(() => window.navigate('/settings'))
      await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor()
      await page.screenshot({
        path: screenshotDirectory + '/' + platform + '-' + mode + '-settings.png',
      })
      for (const [category, route] of categories) {
        await page.evaluate((route) => window.navigate('/settings/' + route), route)
        await page.getByRole('heading', { name: category, exact: true }).waitFor()
        await page.screenshot({
          path: `${screenshotDirectory}/${platform}-${mode}-${category.toLowerCase().replaceAll(/[^a-z]+/g, '-')}.png`,
        })
        await page.getByRole('button', { name: 'Back', exact: true }).click()
      }
      for (const section of [
        'general',
        'conversation',
        'speech',
        'battery',
        'notifications',
        'task-behavior',
        'pull-requests',
        'artifacts',
        'task-preferences',
        'memory',
        'worktrees',
        'runtime-tools',
        'activity-retention',
      ]) {
        await page.evaluate((section) => window.navigate('/settings/' + section), section)
        await page.getByRole('heading').waitFor()
        if (
          [
            'task-behavior',
            'pull-requests',
            'artifacts',
            'memory',
            'worktrees',
            'runtime-tools',
            'activity-retention',
          ].includes(section)
        )
          await page
            .getByText('Loading computer preferences…', { exact: true })
            .waitFor({ state: 'hidden' })
        await page.screenshot({
          path: screenshotDirectory + '/' + platform + '-' + mode + '-' + section + '.png',
        })
      }
    }
    await page.evaluate(() => window.navigate('/settings'))
    await page.evaluate(() => {
      window.setFontScale(1)
      window.runtime = { ...window.runtime, profiles: [], overviews: [] }
      window.refreshSettings()
    })
    await page.getByText('Connect a computer', { exact: true }).waitFor()
    assert.equal(await page.getByTestId('Devices & runtime').isDisabled(), false)
    for (const name of [
      'General',
      'Appearance',
      'Notifications',
      'App & updates',
      'Battery & background',
      'Conversation',
      'Speech & driving',
    ])
      assert.equal(
        await page.getByRole('button', { name, exact: true }).isDisabled(),
        false,
        name + ' works without a computer',
      )
    assert.equal(await row('Task & PR preferences').isDisabled(), false)
    assert.equal(await row('Task defaults').isDisabled(), true)
    assert.equal(await row('Agents').isDisabled(), true)
    await page.screenshot({ path: '/tmp/dovo-settings-organized-mobile-' + platform + '.png' })
    await page.evaluate(() => {
      window.setFontScale(1)
      window.showAccessibility()
    })
    await page.getByRole('switch', { name: 'Higher contrast', exact: true }).waitFor()
    const chooseAppearance = async (label, value) => {
      await page.getByRole('button', { name: label, exact: true }).click()
      await page
        .getByRole(platform === 'ios' ? 'menuitem' : 'button', { name: value, exact: true })
        .click()
    }
    await chooseAppearance('Status colors', 'GitHub colorblind')
    await page.waitForFunction(() => window.savedPreferences?.colorVision === 'blue-orange')
    assert.equal(
      await page
        .getByText('Finished', { exact: true })
        .evaluate((el) => getComputedStyle(el).color),
      'rgb(88, 166, 255)',
    )
    await page.getByRole('switch', { name: 'Higher contrast', exact: true }).click()
    await page.waitForFunction(() => window.savedPreferences?.highContrast === true)
    assert.equal(
      await page
        .getByText('Finished', { exact: true })
        .evaluate((el) => getComputedStyle(el).color),
      'rgb(173, 220, 255)',
    )
    await chooseAppearance('Color scheme', 'Light')
    assert.equal(
      await page
        .getByText('Finished', { exact: true })
        .evaluate((el) => getComputedStyle(el).color),
      'rgb(2, 59, 149)',
    )
    await page.getByRole('switch', { name: 'Higher contrast', exact: true }).click()
    await page.waitForFunction(() => window.savedPreferences?.highContrast === false)
    assert.equal(
      await page
        .getByText('Finished', { exact: true })
        .evaluate((el) => getComputedStyle(el).color),
      'rgb(5, 80, 174)',
    )
    await chooseAppearance('Status colors', 'Normal')
    await page.waitForFunction(() => window.savedPreferences?.colorVision === 'default')
    assert.equal(
      await page
        .getByText('Finished', { exact: true })
        .evaluate((el) => getComputedStyle(el).color),
      'rgb(8, 115, 79)',
    )
    await page.getByLabel('Reduced motion', { exact: true }).filter({ hasText: 'false' }).waitFor()
    await chooseAppearance('Animations', 'Reduce')
    await page.getByLabel('Reduced motion', { exact: true }).filter({ hasText: 'true' }).waitFor()
    await chooseAppearance('Animations', 'System')
    await page.getByLabel('Reduced motion', { exact: true }).filter({ hasText: 'false' }).waitFor()
    await page.evaluate(() => window.setSystemMotion(true))
    await page.getByLabel('Reduced motion', { exact: true }).filter({ hasText: 'true' }).waitFor()
    await page.evaluate(() => window.setFontScale(2))
    await page.screenshot({
      path: screenshotDirectory + '/' + platform + '-accessibility-large-text.png',
    })
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
      'Accessibility settings must fit with large system text',
    )
    assert.deepEqual(errors, [])
    await page.evaluate(() => {
      window.setFontScale(1.8)
      window.showAccessibility(false)
      window.showSearchProbe(true)
    })
    const probe = page.getByLabel('Probe destination', { exact: true })
    await probe.waitFor()
    await page.waitForFunction(() => {
      const target = document
        .querySelector('[aria-label="Probe destination"]')
        .getBoundingClientRect()
      const header = document
        .querySelector('[aria-label="Probe scope header"]')
        .getBoundingClientRect()
      return target.top >= header.bottom && target.top <= header.bottom + 20
    })
    await page.evaluate(() => window.setProbeTarget('Unavailable setting'))
    await page
      .getByRole('alert')
      .filter({ hasText: 'is not available for this settings target' })
      .waitFor()
    await page.evaluate(() => {
      window.setProbeTarget('Probe setting')
      window.remountProbe()
    })
    await page.waitForFunction(() => {
      const target = document
        .querySelector('[aria-label="Probe destination"]')
        .getBoundingClientRect()
      const header = document
        .querySelector('[aria-label="Probe scope header"]')
        .getBoundingClientRect()
      return target.top >= header.bottom && target.top <= header.bottom + 20
    })
    assert.equal(
      await page
        .getByRole('alert')
        .filter({ hasText: 'is not available for this settings target' })
        .count(),
      0,
    )
    await page.close()
  }
  console.log(
    'Phone browser screenshots: ' + screenshotDirectory + '/{android,ios}-{light,dark}-*.png',
  )
  console.log(
    'Mobile settings: narrow and large-text layouts, dark/light details, status tints, section navigation, local and computer preference saves, offline/missing computer handling, notification controls and unpaired access passed (native boundaries mocked).',
  )
} finally {
  await browser.close()
}
