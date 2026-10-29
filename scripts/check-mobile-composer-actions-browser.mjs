import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'
import { bundleBrowser, chromium } from './browser/harness.mjs'

// Real composer and queue; native controls and the conversation/runtime boundary are adapters.
const root = fileURLToPath(new URL('../', import.meta.url))
const mobile = root + 'apps/mobile/'
const screenshots = process.env.DOVO_COMPOSER_SCREENSHOTS
if (screenshots) mkdirSync(screenshots, { recursive: true })
const controls = `
import {useImperativeHandle,useLayoutEffect,useRef,useState} from 'react';import {createPortal} from 'react-dom';
const flat=style=>{const s=Object.assign({},...(Array.isArray(style)?style.flat(Infinity):[style]));if(typeof s.lineHeight==='number')s.lineHeight=s.lineHeight+'px';if(Array.isArray(s.transform))s.transform=s.transform.map(t=>t.rotate?'rotate('+t.rotate+')':'translateY('+t.translateY+'px)').join(' ');return s};
const useLayout=(ref,callback)=>{const current=useRef(callback);current.current=callback;const report=()=>{if(!ref.current||!current.current)return;const r=ref.current.getBoundingClientRect(),p=ref.current.parentElement.getBoundingClientRect();current.current({nativeEvent:{layout:{x:ref.current.offsetLeft-ref.current.parentElement.offsetLeft,y:ref.current.offsetTop-ref.current.parentElement.offsetTop,width:r.width,height:r.height}}})};useLayoutEffect(report);useLayoutEffect(()=>{const observer=new ResizeObserver(report);observer.observe(ref.current);return()=>observer.disconnect()},[])};
export const View=({children,style,testID,accessibilityRole,accessibilityLabel,onLayout,ref:forwardedRef})=>{const ref=useRef(null);useLayout(ref,onLayout);useImperativeHandle(forwardedRef,()=>({measureInWindow:callback=>{const r=ref.current.getBoundingClientRect();callback(r.x,r.y,r.width,r.height)}}));return <div ref={ref} role={accessibilityRole} aria-label={accessibilityLabel} data-testid={testID} style={{display:'flex',boxSizing:'border-box',flexDirection:'column',borderStyle:'solid',borderWidth:0,...flat(style)}}>{children}</div>};
export const ScrollView=({children,style,contentContainerStyle,accessibilityLabel,ref,onLayout,onScroll,onContentSizeChange,scrollEnabled,horizontal,keyboardShouldPersistTaps})=>{const element=useRef(null),content=useRef(null);useLayout(element,onLayout);useLayout(content,e=>onContentSizeChange?.(e.nativeEvent.layout.width,e.nativeEvent.layout.height));useImperativeHandle(ref,()=>({scrollTo:({y})=>element.current.scrollTo(0,y)}));return <div onMouseDown={keyboardShouldPersistTaps==='always'?event=>event.preventDefault():undefined} ref={element} aria-label={accessibilityLabel} onScroll={event=>onScroll?.({nativeEvent:{contentOffset:{y:event.currentTarget.scrollTop}}})} style={{minHeight:0,minWidth:0,overflowX:horizontal?'auto':undefined,overflowY:horizontal||scrollEnabled===false?'hidden':'auto',...flat(style)}}><div ref={content} style={{display:'flex',flexDirection:horizontal?'row':'column',width:horizontal?'max-content':undefined,...flat(contentContainerStyle)}}>{children}</div></div>};
export const Text=({children,style,numberOfLines,accessibilityRole,accessibilityLabel,accessibilityLiveRegion})=><span role={accessibilityRole} aria-label={accessibilityLabel} aria-live={accessibilityLiveRegion} style={{...flat(style),...(numberOfLines===1?{overflow:'hidden',whiteSpace:'nowrap',textOverflow:'ellipsis'}:{})}}>{children}</span>;
export const TextInput=({value,onChangeText,accessibilityLabel})=><textarea aria-label={accessibilityLabel} value={value} onChange={event=>{onChangeText(event.target.value);onSelectionChange?.({start:event.target.value.length,end:event.target.value.length})}}/>;
export const Pressable=({children,style,onPress,onPressIn,onPressOut,onLongPress,disabled,accessibilityLabel,accessibilityState,accessibilityValue,testID,accessibilityRole,accessibilityActions,onAccessibilityAction,accessibilityHint})=>{const press=useRef({});return <button aria-description={accessibilityHint} data-actions={JSON.stringify(accessibilityActions)} onPointerDown={event=>{event.preventDefault();press.current.held=false;onPressIn?.();if(onLongPress)press.current.timer=setTimeout(()=>{press.current.held=true;onLongPress()},500)}} onPointerUp={()=>{clearTimeout(press.current.timer);onPressOut?.({nativeEvent:{touches:[]}})}} onPointerCancel={()=>{clearTimeout(press.current.timer);onPressOut?.({nativeEvent:{touches:[{}]}})}} onKeyDown={event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();onAccessibilityAction?.({nativeEvent:{actionName:event.key==='ArrowDown'?'increment':'decrement'}})}}} role={accessibilityRole} aria-valuetext={accessibilityValue?.text} aria-selected={accessibilityState?.selected} aria-expanded={accessibilityState?.expanded} data-testid={testID} aria-label={accessibilityLabel} disabled={disabled} onClick={()=>{if(!press.current.held)onPress?.()}} style={{display:'flex',border:0,padding:0,backgroundColor:'transparent',color:'inherit',...flat(typeof style==='function'?style({pressed:false}):style)}}>{children}</button>};
export const SafeModal=({visible,children})=>visible?<div role="dialog">{children}</div>:null;
export const Modal=({children,onRequestClose,visible=true,onDismiss})=>{const shown=useRef(visible);useLayoutEffect(()=>{if(shown.current&&!visible)queueMicrotask(()=>onDismiss?.());shown.current=visible},[visible,onDismiss]);return visible?createPortal(<div onKeyDown={event=>{if(event.key==='Escape')onRequestClose()}} style={{position:'fixed',inset:0,display:'flex',zIndex:1000}}>{children}</div>,document.body):null};
export const Platform={OS:'android'};
export const useWindowDimensions=()=>{const[viewport,setViewport]=useState({width:innerWidth,height:innerHeight});useLayoutEffect(()=>{const resize=()=>setViewport({width:innerWidth,height:innerHeight});addEventListener('resize',resize);return()=>removeEventListener('resize',resize)},[]);return viewport};
export const ActivityIndicator=()=>null;
export const Alert={alert:(...args)=>window.alerts.push(args)};
export const Keyboard={dismiss(){window.keyboardDismissals=(window.keyboardDismissals??0)+1;document.activeElement?.blur()},addListener(name,callback){(window.keyboardListeners??={})[name]??=new Set();window.keyboardListeners[name].add(callback);return {remove(){window.keyboardListeners[name].delete(callback)}}},metrics(){return window.keyboardMetrics}};export const Linking={openSettings:async()=>{}};
export const Icon=()=>null;
export const IconButton=({label,onPress,onLongPress,disabled})=>{const press=useRef({});return <button aria-label={label} disabled={disabled} onPointerDown={()=>{press.current.held=false;press.current.timer=setTimeout(()=>{press.current.held=true;onLongPress?.()},500)}} onPointerUp={()=>clearTimeout(press.current.timer)} onPointerCancel={()=>clearTimeout(press.current.timer)} onClick={()=>{if(!press.current.held)onPress()}} style={{width:44,height:44,padding:0,flexShrink:0}}/>};
export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress} style={{minWidth:44,minHeight:44}}>{label}</button>;
export const Image=({source,style})=><img src={source?.uri} style={style}/>;
export const Glass=View;
export const Choice=({label,value,items,onChange,disabled})=><select aria-label={label} value={value} disabled={disabled} onChange={e=>onChange(e.target.value)}>{items.map(i=><option key={i.id} value={i.id}>{i.name}</option>)}</select>;
export const SearchField=({label,value,onChangeText})=><input aria-label={label} value={value} onChange={e=>onChangeText(e.target.value)}/>;
export const Field=({label,value,onChangeText,editable})=><input aria-label={label} value={value} disabled={editable===false} onChange={e=>onChangeText(e.target.value)}/>;
export const Sheet=({title,children,onClose,ref})=>{useImperativeHandle(ref,()=>({dismiss:callback=>{onClose();queueMicrotask(()=>callback?.())}}));return createPortal(<div role="dialog" aria-label={title} style={{position:"fixed",inset:0,zIndex:1000,overflowY:"auto",background:"#202020",padding:12}}>{children}<button onClick={onClose}>Close</button></div>,document.body)};
export const useTheme=()=>({colors:{surface:'#202020',border:'#404040',muted:'#999',text:'#eee',accent:'#76a1ff'},styles:{content:{},muted:{color:'#999'}}});
`
const stubs = [
  {
    path: '@expo/ui/swift-ui',
    contents: `export const Host=({children})=>children;export const Menu=()=>null;export const Button=({children,testID,onPress,modifiers})=><button aria-label={testID} disabled={modifiers.some(value=>value?.disabled)} onClick={onPress} style={{width:44,height:44,padding:0,flexShrink:0}}>{children}</button>;`,
  },
  {
    path: '@expo/ui/swift-ui/modifiers',
    contents: `export const accessibilityAddTraits=()=>null,accessibilityLabel=()=>null,background=()=>null,buttonBorderShape=()=>null,buttonStyle=()=>null,contentShape=()=>null,controlSize=()=>null,disabled=value=>({disabled:value}),frame=()=>null,shapes={circle:()=>null},tint=()=>null;`,
  },
  {
    path: 'expo-glass-effect',
    contents: `export const isGlassEffectAPIAvailable=()=>false,isLiquidGlassAvailable=()=>false;`,
  },
  {
    path: './native-icon',
    importer: mobile + 'src/ui/controls/icon-button.tsx',
    contents: 'export const NativeIcon=()=>null;export const NativeMenuButton=()=>null;',
  },

  {
    path: 'expo-router',
    contents: 'export const router={push:target=>window.navigations.push(target)};',
  },
  {
    path: '../../../runtime/connection/provider',
    importer: mobile,
    contents:
      'export const useRuntime=()=>window.runtime;export const RuntimeScope=({children})=>children;',
  },
  {
    path: '../../../ui/layout/sheet',
    importer: mobile,
    contents: 'export const useSheetNavigation=()=>navigate=>navigate();',
  },
  { path: 'expo-file-system', contents: 'export class File{};export const Paths={cache:"/tmp"};' },
  { path: '../../ui/layout/safe-modal', importer: mobile, contents: controls },
  {
    path: '../../../ui/content/open-link',
    importer: mobile,
    contents: 'export const openAppLink=async()=>{};',
  },
  {
    path: '../../../ui/content/link-origin',
    importer: mobile,
    contents: 'export const useLinkOrigin=()=>({});',
  },
  { path: 'react-native', contents: controls },
  {
    path: 'react-native-screens',
    contents: `import {createPortal} from 'react-dom';export const FullWindowOverlay=({children})=>createPortal(<div data-native-overlay style={{position:'fixed',inset:0,zIndex:1000}}>{children}</div>,document.body);`,
  },
  {
    path: 'react-native-reanimated',
    contents: `import {View} from 'react-native';const transition={duration:()=>transition,delay:()=>transition,easing:()=>transition,reduceMotion:()=>transition};export const Easing={bezier:()=>undefined},FadeIn=transition,FadeOut=transition,LinearTransition=transition,ReduceMotion={Always:'always',System:'system'};export default {View};`,
  },
  {
    path: '../../agents/harness-icon',
    importer: mobile,
    contents: 'export const HarnessIcon=()=>null;',
  },
  ...['./icon', '../content/text', '../theme'].map((path) => ({
    path,
    importer: mobile + 'src/ui/controls/',
    contents: controls,
  })),
  {
    path: '../../scm/connections/project-transfer',
    importer: mobile,
    contents: 'export const ProjectTransferDialog=()=>null;',
  },
  {
    path: '../../screens/repositories',
    importer: mobile,
    contents: 'export const AddProject=()=>null;',
  },
  {
    path: '../../ui/content/runtime-icon',
    importer: mobile,
    contents: 'export const RuntimeIcon=()=>null;',
  },
  {
    path: '@react-native-async-storage/async-storage',
    contents: `const data=new Map();export default {getAllKeys:async()=>[...data.keys()],getItem:async key=>data.get(key)??null,setItem:async(key,value)=>{data.set(key,value)},removeItem:async key=>{data.delete(key)}};`,
  },
  {
    path: 'react-native-gesture-handler',
    contents: `
import {useRef} from 'react';export {Pressable} from 'react-native';
export const Gesture={Pan:()=>{const gesture={callbacks:{},enabled(value){this.active=value;return this},activateAfterLongPress(value){this.delay=value;return this},runOnJS(){return this},onStart(fn){this.callbacks.start=fn;return this},onUpdate(fn){this.callbacks.update=fn;return this},onEnd(fn){this.callbacks.end=fn;return this},onFinalize(fn){this.callbacks.finalize=fn;return this}};return gesture}};
export const GestureDetector=({gesture,children})=>{const state=useRef(null);return <div style={{display:'flex',flex:1,minWidth:0}} onPointerDown={event=>{if(!gesture.active)return;const target=event.currentTarget;const current={y:event.clientY,dragging:false};state.current=current;current.timer=setTimeout(()=>{current.dragging=true;target.setPointerCapture(event.pointerId);gesture.callbacks.start()},gesture.delay)}} onPointerMove={event=>{const current=state.current;if(!current)return;if(current.dragging)gesture.callbacks.update({translationY:event.clientY-current.y});else if(Math.abs(event.clientY-current.y)>10){clearTimeout(current.timer);state.current=null}}} onPointerUp={()=>{const current=state.current;if(!current)return;clearTimeout(current.timer);if(current.dragging){gesture.callbacks.end();gesture.callbacks.finalize({},true)}}} onPointerCancel={()=>{clearTimeout(state.current?.timer);gesture.callbacks.finalize({},false);state.current=null}} onClickCapture={event=>{if(state.current?.dragging){event.preventDefault();event.stopPropagation()}state.current=null}}>{children}</div>};
`,
  },
  ...[
    '../../../ui/content/text',
    '../../../ui/controls/icon',
    '../../../ui/theme',
    '../../ui/content/text',
    '../../ui/controls/icon',
    '../../ui/controls/action',
    '../../ui/controls/choice',
    '../../ui/controls/field',
    '../../ui/layout/glass',
    '../../ui/layout/sheet',
    '../../ui/theme',
    '../ui/theme',
    '../ui/content/text',
    '../ui/controls/action',
    '../ui/controls/field',
    '../ui/controls/icon',
  ].map((path) => ({ path, importer: mobile, contents: controls })),
  {
    path: '../../runtime/state/application-state',
    importer: mobile,
    contents: "export {useState as useApplicationState} from 'react';",
  },
  {
    path: '../conversation/state/provider',
    importer: mobile,
    contents: 'export const useTaskConversation=()=>window.conversation;',
  },
  {
    path: '../../runtime/connection/provider',
    importer: mobile,
    contents:
      'export const useRuntime=()=>window.runtime;export const RuntimeScope=({children})=>children;',
  },
  {
    path: '../../shell/navigation',
    importer: mobile,
    contents:
      'export const useNavigation=()=>({navigate:(...args)=>window.navigations.push(args)});',
  },
  {
    path: '../../runtime/preferences/app-preferences',
    importer: mobile,
    contents:
      'export const useCarMode=()=>false;export const useMobilePreferences=()=>({showContextUsage:window.showContextUsage!==false,minimalComposer:window.minimalComposer!==false});',
  },
  { path: './harness-icon', importer: mobile, contents: 'export const HarnessIcon=()=>null;' },
  {
    path: '../../agents/use-model-catalog',
    importer: mobile,
    contents:
      'export const useCachedModelCatalog=()=>({modelName:"Model"});export const useModelCatalog=()=>({modelName:"GPT",catalog:{models:[{id:"large-model",name:"Large model"},{id:"fast-model",name:"Fast model"}],reasoning:[{id:"high",name:"High"},{id:"low",name:"Low"}]}});',
  },
  {
    path: 'react-native-safe-area-context',
    contents: 'export const useSafeAreaInsets=()=>({top:0,right:0,bottom:0,left:0});',
  },
  {
    path: 'expo-crypto',
    contents:
      'let id=0;export const randomUUID=()=> "fork-"+(++id);export const CryptoDigestAlgorithm={SHA256:"SHA256"};export const digestStringAsync=async(_algorithm,text)=>text;',
  },
  {
    path: './file-drop-target',
    importer: mobile,
    contents: `export {View as FileDropTarget} from 'react-native';`,
  },
  {
    path: './composer-field',
    importer: mobile,
    contents: `import {useRef,useEffect} from 'react';export const ComposerField=({value,onChangeText,onFocus,onBlur,editable,focusKey,onSelectionChange,showOptions,placeholder})=>{const ref=useRef(null);useEffect(()=>{if(focusKey)ref.current?.focus()},[focusKey]);return <textarea ref={ref} style={{width:"100%",minWidth:0,minHeight:showOptions?64:44,height:showOptions?64:44,margin:0,resize:"none",boxSizing:"border-box"}} placeholder={placeholder} aria-label="Message" value={value} disabled={!editable} onFocus={onFocus} onBlur={onBlur} onChange={event=>{onChangeText(event.target.value);onSelectionChange?.({start:event.target.value.length,end:event.target.value.length})}}/>};`,
  },
  {
    path: '../creation/task-machine-selector',
    importer: mobile,
    contents: `import {FolderPicker} from './src/tasks/creation/folder-picker';export const TaskMachineSelector=props=>{window.machineSelector=props;const runtime=window.runtime;return <FolderPicker stacked prominent={props.prominent} renderControls={props.renderControls} repositories={runtime.snapshot.workspace.repositories} value={props.task.repositoryId} autoProject={props.task.autoProject} onAuto={runtime.snapshot.autoProjectSelectionEnabled?props.onAuto:undefined} disabled={props.disabled} onMoving={props.onMoving} onChange={(_id,target)=>props.onProjectChange(target)}/>;}`,
  },
  ...[
    ['../creation/checkout-choice', 'CheckoutChoice'],
    ['../creation/worktree-base-picker', 'WorktreeBasePicker'],
    ['../conversation/components/message-attachments', 'MessageAttachments'],
    ['../detail/harness-settings', 'HarnessSettings'],
    ['./car-composer', 'CarComposer'],
  ].map(([path, name]) => ({ path, importer: mobile, contents: `export const ${name}=()=>null;` })),
]
stubs.push({
  ...stubs.find((stub) => stub.path === '../../agents/use-model-catalog'),
  path: './use-model-catalog',
})
stubs.push({
  ...stubs.find((stub) => stub.path === '../../runtime/connection/provider'),
  path: '../runtime/connection/provider',
})
stubs.push({ path: '../ui/controls/choice', importer: mobile, contents: controls })
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: mobile,
      loader: 'tsx',
      contents: `
import {useState,useRef} from 'react';import {createRoot} from 'react-dom/client';import {Effect} from 'effect';
import {defaultTaskHarness} from '@dovo/protocol';
import {TaskEmptyState} from './src/tasks/creation/task-empty-state';import {Composer} from './src/tasks/composer/composer';import {ComposerActivity} from './src/tasks/composer/composer-activity';
window.calls=[];window.navigations=[];window.alerts=[];window.sideCount=0;
function App(){
  const [task,setTask]=useState({id:'task',title:'Review',repositoryId:'repo',harness:defaultTaskHarness('codex'),status:'running',activeRunId:'active-run',messages:[{id:'first',role:'user',text:'Review'}],turns:[],queue:[{id:'queued',role:'user',text:'Check the tests'}],contextUsage:{used:190000,limit:200000},files:[],draftAttachments:[]});
  const [inputs,setInputs]=useState({questions:[],approvals:[]});window.setInputs=setInputs;
  const [turnSettings,setTurnSettings]=useState(null);window.turnSettings=turnSettings;window.setTurnSettings=setTurnSettings;const [text,setText]=useState('Continue the review');window.setDraftText=setText;const [connected,setConnected]=useState(true);
  window.currentTask=task;window.setTask=update=>setTask(task=>({...task,...update}));window.setConnected=setConnected;
  const snapshot={queuedTurnSettingsSupported:true,autoProjectSelectionEnabled:true,...inputs,workspace:{repositories:[{id:'repo',name:'Project',path:'/repo',branch:'main'},{id:'scratch',kind:'scratch',name:'No project',path:'/private',branch:''}],agents:[]}};
  const [pendingFork,setPendingFork]=useState();window.setPendingFork=setPendingFork;const forkRef=useRef();const textRef=useRef(text);textRef.current=text;const [pendingMessages,setPendingMessages]=useState([]);window.setPendingMessages=setPendingMessages;const [editing,setEditing]=useState(null);const draft={text:editing?.text??text,ready:true,key:'draft',pendingFork,stageForkEffect:fork=>Effect.sync(()=>{forkRef.current=fork;setPendingFork(fork);return fork}),confirmForkEffect:()=>Effect.sync(()=>{const fork={...forkRef.current,accepted:true};if(textRef.current===fork.draftText)setText('');forkRef.current=fork;setPendingFork(fork);return fork}),finishForkEffect:()=>Effect.sync(()=>setPendingFork(undefined)),discardForkEffect:()=>Effect.sync(()=>setPendingFork(undefined)),revision:editing?.text??text,update:value=>editing?setEditing({...editing,text:value}):setText(value)};
  window.runtime={connected,snapshot,overviews:[{profile:{id:'runtime',name:'Local machine',nameIsCustom:true,connection:{address:'http://runtime.lan'}},connected,snapshot}],activeId:'runtime',profile:{id:'runtime',name:'Local machine',nameIsCustom:true,connection:{address:'http://runtime.lan',token:'token'}},call:async(path,input)=>{window.calls.push({path,input});if(path==='/api/tasks/checklist/clear'){if(window.failClear)throw Error('Clear failed');if(JSON.stringify(window.currentTask.nativeTodos)!==JSON.stringify(input.expectedItems))throw Error('The checklist changed');const finish=()=>{window.setTask({nativeTodos:undefined});return {ok:true}};return window.holdClear?new Promise(resolve=>{window.finishClear=()=>resolve(finish())}):finish()};if(window.failSideSave)throw Error('Side save failed');if(path==='/api/tasks/side-chat/save')return {id:'side-'+(++window.sideCount)};return {answer:'Answer'}},callEffect:(path,input)=>Effect.try({try:()=>{window.calls.push({path,input});if(input.action==='duplicate'&&window.failDuplicate)throw Error('Duplicate failed');return path==='/api/tasks/start-fork'?{id:input.forkId}:{ok:true}},catch:error=>error})};
  window.conversation={send:mode=>{if(editing){window.calls.push({path:'/api/tasks/queue',input:{id:task.id,action:'edit',messageId:editing.message.id,text:editing.text,expectedText:editing.message.text,turnSettings:editing.settings,expectedTurnSettings:editing.message.turnSettings??null}});setEditing(null)}else window.calls.push({mode:mode??'queue'})},stop:()=>window.calls.push({mode:'stop'}),actions:{editing,restoreQueuedMessage:async message=>{window.calls.push({path:'/api/tasks/queue',input:{id:task.id,action:'restore',messageId:message.id}});setText(text=>[text,message.text].filter(Boolean).join('\\n\\n'));if(message.turnSettings)setTurnSettings(message.turnSettings)},beginEdit:message=>setEditing({message,text:message.text,settings:message.turnSettings??null}),cancelEdit:()=>setEditing(null),turnSettings:editing?editing.settings:turnSettings,setTurnSettings:value=>editing?setEditing({...editing,settings:value}):setTurnSettings(value),agent:{...defaultTaskHarness('codex'),id:'agent',name:'Agent'},connected,snapshot,draft,dictation:{active:false},busy:false,stopping:false,error:'',attaching:false,setAttaching(){},act:work=>void work(),attachmentPicker:{pick(){throw new Error('Attachment chooser must not open')},select(source){window.calls.push({mode:'attach',source})},upload(){}},firstMessage:task.status==='draft'&&!task.messages.length,checkoutEditable:task.status==='draft',hasInput:!!draft.text,canSend:connected&&!!draft.text,patch:async changes=>{window.calls.push({patch:changes});setTask(old=>({...old,...Object.fromEntries(Object.entries(changes).map(([key,value])=>[key,value.after]))}))},threadScope:'runtime:task',pendingMessages}};
  return <Composer task={task} renderAbove={(setup,startModes)=>task.status==='draft'&&!task.messages.length?<><div style={{flex:1,minHeight:0,overflowY:'auto',display:'flex',padding:20}}><TaskEmptyState startModes={startModes} projectName="Project"/></div>{setup}</>:<>{setup}<div>Conversation</div></>} queuedMessages={<ComposerActivity task={task}/>} onAsk={chatId=>window.calls.push({mode:'aside',chatId})}/>;
}createRoot(document.getElementById('app')).render(<App/>);
`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    alias: {
      react: mobile + 'node_modules/react',
      '@dovo/protocol': root + 'packages/protocol/src/index.ts',
    },
    nodePaths: [mobile + 'node_modules'],
    define: { 'process.env.NODE_ENV': '"production"' },
  },
  stubs,
)
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 320, height: 900 } })
  page.setDefaultTimeout(7000)
  const errors = []
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.error(error.message)
  })
  await page.setContent(
    '<style>body{margin:0;background:#101010;color:#eee;font-family:system-ui}button,textarea,select{font:inherit}#app{display:flex;flex-direction:column}</style><div id="app"></div>',
  )
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const initialQueued = page.getByRole('button', { name: /^View queued message 1:/ })
  const queuedMessages = page.getByTestId('Queued messages')
  await initialQueued.waitFor()
  assert.equal(await queuedMessages.getByText('You', { exact: true }).count(), 0)
  await page.evaluate(() =>
    window.setTask({
      queue: [{ ...window.currentTask.queue[0], source: { kind: 'user' } }],
    }),
  )
  assert.equal(await queuedMessages.getByText('You', { exact: true }).count(), 0)
  await page.evaluate(() =>
    window.setTask({
      queue: [
        { ...window.currentTask.queue[0], source: { kind: 'system', label: 'Review update' } },
      ],
    }),
  )
  await queuedMessages.getByText('Review update', { exact: true }).waitFor()
  await page.evaluate(() =>
    window.setTask({ queue: [{ ...window.currentTask.queue[0], source: undefined }] }),
  )
  assert.match(
    await initialQueued.getAttribute('aria-description'),
    /^Queued message 1 of 1, not sent/,
  )
  const queueAnnouncement = page.locator('[data-testid="Queued messages"] [aria-live="polite"]')
  assert.equal(await queueAnnouncement.textContent(), '1 queued message')
  await page.getByRole('button', { name: 'Queue follow-up', exact: true }).click()
  assert.deepEqual(await page.evaluate(() => window.calls.at(-1)), { mode: 'queue' })
  assert.equal(
    await page.getByRole('button', { name: 'More message actions', exact: true }).count(),
    0,
  )
  const primary = page.getByRole('button', { name: 'Queue follow-up', exact: true })
  const primaryBounds = await primary.boundingBox()
  assert.ok(primaryBounds.width >= 44 && primaryBounds.height >= 44)
  assert.ok(primaryBounds.x >= 0 && primaryBounds.x + primaryBounds.width <= 320)
  assert.equal(await page.getByRole('button', { name: 'Stop', exact: true }).count(), 0)
  const openMessageActions = async () => {
    const button = page
      .getByTestId('Composer toolbar')
      .getByRole('button', { name: /^(Queue follow-up|Stop)$/ })
    await button.hover()
    await page.getByRole('textbox', { name: 'Message', exact: true }).focus()
    await button.hover()
    await page.mouse.down()
    await page.getByRole('menu', { name: 'Message actions', exact: true }).waitFor()
    assert.equal(
      await page.getByRole('menu', { name: 'Message actions', exact: true }).count(),
      1,
      'Open message actions as soon as the hold is detected',
    )
    assert.equal(
      await page
        .getByRole('textbox', { name: 'Message', exact: true })
        .evaluate((node) => document.activeElement === node),
      true,
      'Holding keeps the input focused',
    )
    const beforeRelease = await page.evaluate(() => window.calls.length)
    await page
      .getByRole('button', { name: 'Dismiss Message actions', exact: true })
      .dispatchEvent('click')
    await page
      .getByRole('menuitem', { name: 'Queue follow-up', exact: true })
      .dispatchEvent('click')
    assert.equal(
      await page.getByRole('menu', { name: 'Message actions', exact: true }).count(),
      1,
      'The originating release cannot dismiss the menu',
    )
    assert.equal(
      await page.evaluate(() => window.calls.length),
      beforeRelease,
      'A release without a fresh press cannot send',
    )
    await page.mouse.up()
    await page.getByRole('menu', { name: 'Message actions', exact: true }).waitFor()
  }
  const messageMenu = page.getByRole('menu', { name: 'Message actions', exact: true })
  const beforeHold = await page.evaluate(() => window.calls.length)
  const composerBeforeMenu = await page.getByTestId('Composer').boundingBox()
  await page.evaluate((y) => {
    window.keyboardMetrics = { screenY: y }
  }, primaryBounds.y + primaryBounds.height)
  await openMessageActions()
  assert.equal(await page.evaluate(() => window.calls.length), beforeHold, 'Holding does not send')
  await page.evaluate(() => {
    for (const callback of window.keyboardListeners?.keyboardDidHide ?? []) callback()
  })
  await page.setViewportSize({ width: 320, height: 840 })
  await messageMenu.waitFor()
  await page.setViewportSize({ width: 320, height: 900 })
  await messageMenu.waitFor()
  assert.deepEqual(
    await page.getByTestId('Composer').boundingBox(),
    composerBeforeMenu,
    'Inline menu does not move the composer',
  )
  const heldMenuBounds = await messageMenu.boundingBox()
  if (screenshots) await page.screenshot({ path: screenshots + '/message-actions-inline.png' })
  assert.ok(
    heldMenuBounds.width <= 264 &&
      heldMenuBounds.x >= 12 &&
      heldMenuBounds.x + heldMenuBounds.width <= 308,
  )
  assert.ok(
    heldMenuBounds.y + heldMenuBounds.height <= primaryBounds.y,
    'Held menu fits above the keyboard and trigger',
  )
  assert.equal(await page.getByRole('dialog', { name: 'Message actions', exact: true }).count(), 0)
  await page
    .getByRole('button', { name: 'Dismiss Message actions', exact: true })
    .click({ position: { x: 4, y: 4 } })
  await messageMenu.waitFor({ state: 'detached' })
  assert.equal(
    await page.evaluate(() => window.calls.length),
    beforeHold,
    'Outside tap only dismisses the menu',
  )
  await page.evaluate(() => {
    window.keyboardMetrics = undefined
  })
  await openMessageActions()
  for (const name of ['Fork', 'Queue follow-up', 'Steer agent', 'Stop']) {
    assert.equal(await messageMenu.getByRole('menuitem', { name, exact: true }).isEnabled(), true)
  }
  await messageMenu.getByRole('menuitem', { name: 'Stop', exact: true }).click()
  assert.deepEqual(await page.evaluate(() => window.calls.at(-1)), { mode: 'stop' })
  await page.evaluate(() => window.setDraftText(''))
  await page.getByRole('textbox', { name: 'Message', exact: true }).focus()
  const checkFullComposer = async () => {
    const field = page.getByRole('textbox', { name: 'Message', exact: true })
    await field.evaluate((node) => node.blur())
    assert.equal((await field.boundingBox()).height, 44)
    await page.evaluate(() => {
      window.minimalComposer = false
      window.setTask({})
    })
    await page.getByRole('button', { name: 'Agent & model', exact: true }).waitFor()
    assert.ok(
      (await field.boundingBox()).height > 44,
      'Full mode shows the expanded composer while empty and unfocused',
    )
    await field.fill('A message')
    await field.fill('')
    await field.evaluate((node) => node.blur())
    assert.ok(
      (await field.boundingBox()).height > 44,
      'Clearing and blurring keeps full mode expanded',
    )
    await page.evaluate(() => {
      window.minimalComposer = true
      window.setTask({})
    })
    await page
      .getByRole('button', { name: 'Agent & model', exact: true })
      .waitFor({ state: 'detached' })
    assert.equal((await field.boundingBox()).height, 44)
  }
  await checkFullComposer()
  await page.getByRole('textbox', { name: 'Message', exact: true }).focus()
  const contextUsage = page.getByText('95%', { exact: true })
  await contextUsage.waitFor()
  await page.evaluate(() => {
    window.showContextUsage = false
    window.setTask({ title: 'Hidden context' })
  })
  await contextUsage.waitFor({ state: 'detached' })
  assert.equal(await page.getByRole('button', { name: 'Compact context', exact: true }).count(), 1)
  await page.evaluate(() => {
    window.showContextUsage = true
    window.setTask({ title: 'Review' })
  })
  await contextUsage.waitFor()
  await page
    .getByTestId('Composer toolbar')
    .getByRole('button', { name: 'Stop', exact: true })
    .click()
  assert.deepEqual(await page.evaluate(() => window.calls.at(-1)), { mode: 'stop' })
  await page.evaluate(() => window.setDraftText('Continue the review'))
  await page.waitForFunction(
    () => document.querySelector('[aria-label="Message"]').value === 'Continue the review',
  )
  const compact = await page
    .getByRole('button', { name: 'Compact context', exact: true })
    .boundingBox()
  const queue = await page.getByTestId('Queued messages').boundingBox()
  const input = await page.getByRole('textbox', { name: 'Message', exact: true }).boundingBox()
  assert.ok(compact.y + compact.height <= queue.y && queue.y + queue.height <= input.y)
  await page.getByText('Check the tests', { exact: true }).waitFor()
  const draftBeforeResize = await page
    .getByRole('textbox', { name: 'Message', exact: true })
    .inputValue()
  // The composer follows window width, and stays readable on iPad and landscape phones.
  for (const [width, height] of [
    [320, 900],
    [544, 1024],
    [768, 1024],
    [1024, 768],
    [1366, 1024],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height })
    const bounds = await page.getByTestId('Composer').boundingBox()
    assert.ok(
      bounds.width <= 768 && bounds.width <= width,
      JSON.stringify({ width, height, bounds }),
    )
    assert.ok(
      Math.abs(bounds.x - (width - bounds.width) / 2) < 1,
      JSON.stringify({ width, height, bounds }),
    )
    assert.equal(
      await page.getByRole('textbox', { name: 'Message', exact: true }).inputValue(),
      draftBeforeResize,
    )
    const editor = page.getByRole('textbox', { name: 'Message', exact: true })
    const beforeFocus = await editor.boundingBox()
    await editor.evaluate((node) => {
      window.composerInput = node
    })
    await editor.focus()
    const focusedBounds = await editor.boundingBox()
    await page.getByRole('button', { name: 'Dismiss keyboard', exact: true }).click()
    const blurredBounds = await editor.boundingBox()
    for (const bounds of [focusedBounds, blurredBounds]) {
      assert.equal(bounds.x, beforeFocus.x, 'Keyboard changes keep the draft aligned')
      assert.equal(bounds.width, beforeFocus.width, 'Keyboard changes preserve draft wrapping')
    }
    assert.equal(
      await editor.evaluate((node) => node === window.composerInput),
      true,
      'Keyboard dismissal keeps the input mounted',
    )
  }
  await page.setViewportSize({ width: 320, height: 900 })

  assert.equal(await page.getByRole('dialog', { name: 'Queued messages', exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Up 1', exact: true }).count(), 0)
  assert.equal(
    await page.getByRole('button', { name: 'Agent & model', exact: true }).innerText(),
    'GPT\nDefault',
  )
  await page.evaluate(() =>
    window.setTurnSettings({
      provider: 'codex',
      model: 'large-model',
      reasoning: 'high',
      harness: {
        provider: 'codex',
        model: 'large-model',
        reasoning: 'high',
        serviceTier: 'priority',
      },
    }),
  )
  await page.waitForFunction(() =>
    document.querySelector('[aria-label="Agent & model"]').textContent.includes('High'),
  )
  assert.match(
    await page
      .getByRole('button', { name: 'Agent & model', exact: true })
      .getAttribute('aria-valuetext'),
    /High reasoning, Fast mode/,
  )
  await page.evaluate(() => window.setTurnSettings(null))
  for (const name of ['Steer with queued message 1', 'Actions for queued message 1']) {
    const bounds = await page.getByRole('button', { name, exact: true }).boundingBox()
    assert.ok(bounds && bounds.width >= 44 && bounds.height >= 44)
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 320)
  }
  assert.equal(await page.getByRole('button', { name: 'Pause queue', exact: true }).count(), 0)
  assert.equal(await page.getByText('After this turn', { exact: true }).count(), 0)
  await page.getByRole('button', { name: 'Actions for queued message 1', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Pause queued message 1', exact: true }).click()
  await page.waitForFunction(() => window.calls.at(-1)?.input?.action === 'pause-message')
  assert.equal(await page.evaluate(() => window.calls.at(-1).input.messageId), 'queued')
  await page.evaluate(() =>
    window.setTask({ queue: window.currentTask.queue.map((item) => ({ ...item, paused: true })) }),
  )
  await page.getByRole('button', { name: 'Actions for queued message 1', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Resume queued message 1', exact: true }).click()
  await page.waitForFunction(() => window.calls.at(-1)?.input?.action === 'resume-message')
  await page.evaluate(() =>
    window.setTask({ queue: window.currentTask.queue.map((item) => ({ ...item, paused: false })) }),
  )
  // Steering is available directly on the row and targets the current run.
  await page.getByRole('button', { name: 'Steer with queued message 1', exact: true }).click()
  await page.waitForFunction(() => window.calls.at(-1)?.input?.action === 'steer')
  assert.equal(await page.evaluate(() => window.calls.at(-1).input.runId), 'active-run')
  assert.equal(await page.evaluate(() => window.calls.at(-1).input.messageId), 'queued')
  assert.equal(await page.getByRole('dialog', { name: 'Queued message 1', exact: true }).count(), 0)
  const queueBeforeMenu = await page.getByTestId('Queued messages').boundingBox()
  const steerBeforeMenu = await page
    .getByRole('button', { name: 'Steer with queued message 1', exact: true })
    .boundingBox()
  await page.getByRole('button', { name: 'Actions for queued message 1', exact: true }).click()
  const menu = page.getByRole('menu', { name: 'Actions for queued message 1', exact: true })
  const menuBox = await menu.boundingBox()
  assert.ok(menuBox.width <= 264 && menuBox.height <= 230, JSON.stringify(menuBox))
  assert.ok(menuBox.x >= 0 && menuBox.x + menuBox.width <= 320)
  assert.ok(menuBox.y >= 0 && menuBox.y + menuBox.height <= 900)
  assert.equal(await page.getByRole('dialog').count(), 0)
  assert.deepEqual(await page.getByTestId('Queued messages').boundingBox(), queueBeforeMenu)
  assert.deepEqual(
    await page
      .getByRole('button', { name: 'Steer with queued message 1', exact: true })
      .boundingBox(),
    steerBeforeMenu,
  )
  await page.getByRole('button', { name: 'Dismiss queued message actions', exact: true }).click()
  assert.equal(await page.getByRole('menu').count(), 0)
  // Lost responses keep the same duplicate id; a successful new click gets a fresh id.
  const duplicate = async () => {
    await page.getByRole('button', { name: 'Actions for queued message 1', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Duplicate queued message 1', exact: true }).click()
  }
  const draftBeforeDuplicate = await page
    .getByRole('textbox', { name: 'Message', exact: true })
    .inputValue()
  await page.evaluate(() => {
    window.failDuplicate = true
  })
  await duplicate()
  await page.getByRole('alert').filter({ hasText: 'Duplicate failed' }).waitFor()
  const duplicateId = await page.evaluate(() => window.calls.at(-1).input.duplicateMessageId)
  assert.ok(duplicateId)
  await page.evaluate(() => {
    window.failDuplicate = false
  })
  await duplicate()
  await page.waitForFunction(() => !document.querySelector('[role="alert"]'))
  assert.equal(await page.evaluate(() => window.calls.at(-1).input.duplicateMessageId), duplicateId)
  await duplicate()
  await page.waitForFunction(
    (id) => window.calls.at(-1).input.duplicateMessageId !== id,
    duplicateId,
  )
  assert.equal(
    await page.getByRole('textbox', { name: 'Message', exact: true }).inputValue(),
    draftBeforeDuplicate,
  )
  for (const update of [{ archived: true }, { activeRunId: null }, { status: 'review' }]) {
    await page.evaluate((update) => window.setTask(update), update)
    await page.waitForFunction(
      () => document.querySelector('[aria-label="Steer with queued message 1"]')?.disabled,
    )
    assert.equal(
      await page
        .getByRole('button', { name: 'Steer with queued message 1', exact: true })
        .isDisabled(),
      true,
    )
    await page.evaluate(() =>
      window.setTask({
        archived: false,
        activeRunId: 'active-run',
        status: 'running',
        queue: [{ id: 'queued', role: 'user', text: 'Check the tests' }],
      }),
    )
  }
  await page.evaluate(() =>
    window.setTask({
      queue: [{ id: 'queued', role: 'user', text: 'Check the tests', steering: true }],
    }),
  )
  await page
    .getByRole('button', { name: 'Steer with queued message 1', exact: true })
    .waitFor({ state: 'detached' })
  await page.evaluate(() =>
    window.setTask({ queue: [{ id: 'queued', role: 'user', text: 'Check the tests' }] }),
  )
  await openMessageActions()
  await messageMenu.getByRole('menuitem', { name: 'Steer agent', exact: true }).click()
  assert.deepEqual(await page.evaluate(() => window.calls.at(-1)), { mode: 'steer' })
  assert.equal(await page.getByRole('menu', { name: 'Message actions' }).count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Agent & model', exact: true }).count(), 1)
  assert.equal(
    await page.getByRole('button', { name: 'Next turn model and reasoning', exact: true }).count(),
    0,
  )
  const activeHarness = await page.evaluate(() => window.currentTask.harness)
  await page.getByRole('button', { name: 'Agent & model', exact: true }).click()
  assert.equal(await page.getByRole('tab', { name: 'Agents', exact: true }).count(), 0)
  await page.getByRole('button', { name: 'Large model', exact: true }).click()
  await page.getByRole('combobox', { name: 'Reasoning level', exact: true }).selectOption('high')
  assert.deepEqual(await page.evaluate(() => window.turnSettings), {
    provider: 'codex',
    model: 'large-model',
    reasoning: 'high',
  })
  assert.deepEqual(await page.evaluate(() => window.currentTask.harness), activeHarness)
  assert.equal(
    await page.evaluate(() => window.calls.some((call) => call.path === '/api/workspace')),
    false,
  )
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await openMessageActions()
  assert.equal(
    await messageMenu.getByRole('menuitem', { name: 'Steer agent', exact: true }).isDisabled(),
    true,
  )
  assert.equal(
    await messageMenu.getByRole('menuitem', { name: 'Fork', exact: true }).isDisabled(),
    true,
  )
  assert.equal(
    await page
      .getByText('Fork uses the thread’s settings. Select Use thread defaults to fork.')
      .isVisible(),
    true,
  )
  await page
    .getByRole('button', { name: 'Dismiss Message actions', exact: true })
    .click({ position: { x: 4, y: 4 } })
  await page.getByRole('button', { name: 'Agent & model', exact: true }).click()
  await page.getByRole('button', { name: 'Use thread defaults', exact: true }).click()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await openMessageActions()
  await messageMenu.getByRole('menuitem', { name: 'Fork', exact: true }).click()
  await page.waitForFunction(() => window.navigations.length === 1)
  assert.deepEqual(await page.evaluate(() => window.navigations[0]), [
    'tasks',
    await page.evaluate(
      () => window.calls.find((call) => call.path === '/api/tasks/start-fork').input.forkId,
    ),
    'runtime',
  ])
  assert.equal(await page.getByRole('textbox', { name: 'Message', exact: true }).inputValue(), '')
  await page.getByRole('button', { name: 'Actions for queued message 1', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Edit queued message 1', exact: true }).click()
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Verify before shipping')
  await page.getByRole('button', { name: 'Agent & model', exact: true }).click()
  await page.getByRole('button', { name: 'Fast model', exact: true }).click()
  await page.getByRole('combobox', { name: 'Reasoning level', exact: true }).selectOption('low')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await page.waitForFunction(() => window.calls.at(-1)?.input?.action === 'edit')
  assert.equal(await page.evaluate(() => window.calls.at(-1).input.expectedText), 'Check the tests')
  assert.deepEqual(await page.evaluate(() => window.calls.at(-1).input.turnSettings), {
    provider: 'codex',
    model: 'fast-model',
    reasoning: 'low',
  })
  assert.equal(await page.evaluate(() => window.calls.at(-1).input.expectedTurnSettings), null)
  const sideCommand = page.getByRole('button', {
    name: 'Command sidechat: Ask a side question',
    exact: true,
  })
  await page
    .getByRole('textbox', { name: 'Message', exact: true })
    .fill('Explain this checkout\n/sidechat')
  await sideCommand.click()
  await page.waitForFunction(() =>
    window.calls.some((call) => call.path === '/api/tasks/side-chat/ask'),
  )
  assert.deepEqual(
    await page.evaluate(
      () => window.calls.find((call) => call.path === '/api/tasks/side-chat/ask').input,
    ),
    { id: 'task', chatId: 'side-1', question: 'Explain this checkout\n' },
  )
  assert.equal(await page.getByRole('textbox', { name: 'Message', exact: true }).inputValue(), '')
  assert.deepEqual(await page.evaluate(() => window.calls.find((call) => call.mode === 'aside')), {
    mode: 'aside',
    chatId: 'side-1',
  })
  // The local slash command saves before sending in both running and idle threads.
  await page.evaluate(() => window.setTask({ status: 'review' }))
  await page
    .getByRole('textbox', { name: 'Message', exact: true })
    .fill('From the command\n/sidechat')
  await sideCommand.click()
  await page.waitForFunction(
    () => window.calls.filter((call) => call.path === '/api/tasks/side-chat/ask').length === 2,
  )
  await page.evaluate(() => {
    window.failSideSave = true
  })
  await page
    .getByRole('textbox', { name: 'Message', exact: true })
    .fill('Keep on failure\n/sidechat')
  await sideCommand.click()
  await page.waitForFunction(() => window.alerts.some((alert) => alert[1] === 'Side save failed'))
  assert.equal(
    await page.getByRole('textbox', { name: 'Message', exact: true }).inputValue(),
    'Keep on failure\n',
  )
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Offline draft')
  await page.evaluate(() => {
    window.setTask({ status: 'running' })
  })
  await openMessageActions()
  await page.evaluate(() => {
    window.setConnected(false)
  })
  await page.waitForFunction(
    () => document.querySelector('[aria-label="Queue follow-up"]')?.disabled,
  )
  assert.equal(
    await messageMenu.getByRole('menuitem', { name: 'Queue follow-up', exact: true }).isDisabled(),
    true,
  )
  assert.equal(
    await messageMenu.getByRole('menuitem', { name: 'Steer agent', exact: true }).isDisabled(),
    true,
  )
  assert.equal(
    await messageMenu.getByRole('menuitem', { name: 'Fork', exact: true }).isDisabled(),
    true,
  )
  assert.equal(await sideCommand.count(), 0)
  await page
    .getByRole('button', { name: 'Dismiss Message actions', exact: true })
    .click({ position: { x: 4, y: 4 } })
  await page.getByRole('button', { name: 'Actions for queued message 1', exact: true }).click()
  for (const name of [
    'Pause queued message 1',
    'Edit queued message 1',
    'Duplicate queued message 1',
    'Steer with queued message 1',
    'Steer with message 1',
    'Return message 1 to composer',
  ]) {
    assert.equal(
      await page
        .getByRole(name.startsWith('Steer with queued') ? 'button' : 'menuitem', {
          name,
          exact: true,
        })
        .isDisabled(),
      true,
    )
  }
  await page.getByRole('button', { name: 'Dismiss queued message actions', exact: true }).click()
  await page.evaluate(() => window.setTask({ repositoryId: undefined }))
  await page.getByRole('menuitem', { name: 'Fork', exact: true }).waitFor({ state: 'detached' })
  await page.evaluate(() => {
    window.setConnected(true)
    window.setTask({ repositoryId: 'scratch', status: 'draft', messages: [], linkedCheckouts: [] })
  })
  await page.getByRole('button', { name: 'Link projects', exact: true }).click()
  const links = page.getByRole('dialog', { name: 'Linked projects', exact: true })
  await links.getByRole('button', { name: 'Add checkout', exact: true }).click()
  await links.getByRole('combobox', { name: 'Checkout', exact: true }).selectOption('main')
  await links.getByRole('combobox', { name: 'Access', exact: true }).selectOption('edit')
  assert.equal(
    await page.evaluate(
      () => window.calls.filter((c) => c.patch).at(-1).patch.linkedCheckouts.after[0].access,
    ),
    'edit',
  )
  await links.getByRole('button', { name: 'Done', exact: true }).click()
  await page.getByRole('button', { name: 'Link projects (1)', exact: true }).waitFor()
  await page.evaluate(() => window.setConnected(false))
  await page.waitForFunction(() =>
    [...document.querySelectorAll('button')].some(
      (b) => b.textContent === 'Link projects (1)' && b.disabled,
    ),
  )
  assert.equal(
    await page.getByRole('button', { name: 'Link projects (1)', exact: true }).isDisabled(),
    true,
  )
  await page.evaluate(() => {
    window.setConnected(true)
    window.setTask({ autoProject: true, autoProjectExecution: undefined })
  })
  const advanced = page.getByRole('button', { name: 'Advanced', exact: true })
  const defaults = page.getByRole('button', { name: 'Project defaults', exact: true })
  assert.equal(await defaults.count(), 0)
  assert.equal(await advanced.getAttribute('aria-expanded'), 'false')
  await advanced.click()
  await defaults.waitFor()
  await page.getByRole('button', { name: 'New worktrees', exact: true }).click()
  assert.equal(
    await page.evaluate(
      () => window.calls.filter((c) => c.patch).at(-1).patch.autoProjectExecution.after,
    ),
    'worktree',
  )
  await advanced.click()
  assert.equal(await defaults.count(), 0)
  await advanced.click()
  await page.evaluate(() => window.setTask({ repositoryId: 'repo', autoProject: false }))
  await page
    .getByRole('button', { name: 'Checkout & branch', exact: true })
    .waitFor({ state: 'detached' })
  assert.equal(
    await page.getByRole('button', { name: 'Checkout & branch', exact: true }).count(),
    0,
  )
  await advanced.click()
  await page.getByRole('button', { name: 'Checkout & branch', exact: true }).waitFor()
  await advanced.click()
  assert.equal(
    await page.getByRole('button', { name: 'Checkout & branch', exact: true }).count(),
    0,
  )
  await page.evaluate(() =>
    window.setTask({
      status: 'running',
      messages: [{ id: 'first', role: 'user', text: 'Started' }],
      queue: [{ id: 'tabs', role: 'user', text: 'Queued follow-up' }],
      nativeTodos: [{ text: 'Native progress step', status: 'in-progress' }],
    }),
  )
  const queueTab = page.getByRole('tab', { name: 'Queue · 1', exact: true })
  const checklistTab = page.getByRole('tab', { name: /Checklist · 0\/1/ })
  await queueTab.waitFor()
  assert.match(await queueTab.innerText(), /Queue.*1/s)
  assert.match(await checklistTab.innerText(), /Checklist.*0\/1/s)
  const activityHeader = page
    .getByLabel('Composer activity', { exact: true })
    .locator(':scope > div')
    .first()
  const activityGeometry = () =>
    activityHeader.evaluate((header) => {
      const origin = header.getBoundingClientRect()
      return [...header.querySelectorAll('button')].map((node) => {
        const box = node.getBoundingClientRect()
        return { x: box.x - origin.x, y: box.y - origin.y, width: box.width, height: box.height }
      })
    })
  const runningGeometry = await activityGeometry()
  await page.evaluate(() => window.setTask({ queuePaused: true, status: 'completed' }))
  await page.getByRole('tab', { name: 'Queue · 1 · Paused', exact: true }).waitFor()
  await page.getByRole('tab', { name: 'Checklist · 0/1 · Unfinished', exact: true }).waitFor()
  assert.deepEqual(
    await activityGeometry(),
    runningGeometry,
    'Native pause and unfinished indicators keep the header steady',
  )
  await page.evaluate(() => window.setTask({ queuePaused: false, status: 'running' }))
  await queueTab.waitFor()
  assert.deepEqual(await activityGeometry(), runningGeometry)
  await checklistTab.click()
  await page.getByText('Native progress step', { exact: true }).waitFor()
  assert.deepEqual(
    await activityGeometry(),
    runningGeometry,
    'Selecting another tab keeps the header geometry',
  )
  assert.equal(await queueTab.getAttribute('aria-selected'), 'false')
  assert.equal(await page.getByTestId('Queued messages').isVisible(), false)
  const collapse = page.getByRole('button', { name: 'Collapse composer activity', exact: true })
  const expand = page.getByRole('button', { name: 'Expand composer activity', exact: true })
  await collapse.click()
  assert.equal(await page.getByText('Native progress step', { exact: true }).isVisible(), false)
  assert.equal(await expand.getAttribute('aria-expanded'), 'false')
  await checklistTab.click()
  await page.getByText('Native progress step', { exact: true }).waitFor()
  await queueTab.click()
  await page.getByTestId('Queued messages').waitFor()
  await page.getByText('Queued follow-up', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Actions for queued message 1', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Edit queued message 1', exact: true }).click()
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Keep native queue edit')
  await page.evaluate(() =>
    window.setInputs({
      questions: [{ id: 'foreign', taskId: 'other', prompt: {} }],
      approvals: [],
    }),
  )
  assert.equal(await page.getByRole('dialog', { name: 'Queued messages', exact: true }).count(), 0)
  await page.evaluate(() =>
    window.setInputs({
      questions: [{ id: 'question', taskId: 'task', prompt: { blocking: false } }],
      approvals: [],
    }),
  )
  await expand.waitFor()
  assert.equal(await page.getByRole('dialog', { name: 'Queued messages', exact: true }).count(), 0)
  await expand.click()
  assert.equal(
    await page.getByRole('textbox', { name: 'Message', exact: true }).inputValue(),
    'Keep native queue edit',
  )
  await page.evaluate(() =>
    window.setInputs({
      questions: [{ id: 'question', taskId: 'task', prompt: { blocking: false } }],
      approvals: [],
    }),
  )
  assert.equal(await page.getByRole('dialog', { name: 'Queued messages', exact: true }).count(), 0)
  await page.evaluate(() =>
    window.setInputs({
      questions: [{ id: 'question', taskId: 'task', prompt: { blocking: false } }],
      approvals: [{ id: 'approval', taskId: 'task' }],
    }),
  )
  await expand.waitFor()
  await page.evaluate(() => window.setInputs({ questions: [], approvals: [] }))
  await expand.click()
  await page.evaluate(() => window.setTask({ queue: [] }))
  await page.getByText('Native progress step', { exact: true }).waitFor()
  assert.equal(
    await page.getByRole('textbox', { name: 'Message', exact: true }).inputValue(),
    'Keep native queue edit',
  )
  await page.getByRole('button', { name: 'Cancel edit', exact: true }).click()
  await page.getByText('Native progress step', { exact: true }).waitFor()
  assert.equal(await page.getByRole('tab').count(), 0)
  await collapse.click()
  assert.equal(await page.getByText('Native progress step', { exact: true }).isVisible(), false)
  await page.evaluate(() =>
    window.setTask({ nativeTodos: [{ text: 'Updated progress step', status: 'completed' }] }),
  )
  await expand.waitFor()
  await expand.click()
  await page.getByText('Updated progress step', { exact: true }).waitFor()
  const clear = page.getByRole('button', { name: 'Clear checklist', exact: true })
  const confirmClear = page.getByRole('button', { name: 'Confirm clear checklist', exact: true })
  const clearRequests = () =>
    page.evaluate(() =>
      window.calls.filter((request) => request.path === '/api/tasks/checklist/clear'),
    )
  await clear.click()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  assert.equal((await clearRequests()).length, 0)
  await page.evaluate(() => window.setConnected(false))
  await page.getByRole('button', { name: 'Clear checklist', exact: true, disabled: true }).waitFor()
  assert.equal(await clear.isDisabled(), true)
  await page.evaluate(() => {
    window.setConnected(true)
    window.failClear = true
  })
  await clear.click()
  await confirmClear.click()
  await page.getByText('Clear failed', { exact: true }).waitFor()
  assert.equal(await page.getByText('Updated progress step', { exact: true }).isVisible(), true)
  await page.evaluate(() => {
    window.failClear = false
  })
  await clear.click()
  await page.evaluate(() =>
    window.setTask({
      nativeTodos: [
        ...window.currentTask.nativeTodos,
        { text: 'Added during confirmation', status: 'pending' },
      ],
    }),
  )
  await confirmClear.click()
  await page.getByText('The checklist changed', { exact: true }).waitFor()
  await page.getByText('Added during confirmation', { exact: true }).waitFor()
  await page.evaluate(() => {
    window.holdClear = true
  })
  await clear.click()
  await confirmClear.click()
  await page.getByRole('button', { name: 'Clearing…', exact: true }).waitFor()
  assert.equal(
    await page.getByRole('button', { name: 'Clearing…', exact: true }).isDisabled(),
    true,
  )
  await page.evaluate(() => window.finishClear())
  await page.getByLabel('Composer activity', { exact: true }).waitFor({ state: 'detached' })
  await page.evaluate(() =>
    window.setTask({
      queue: [{ id: 'keep-queue', role: 'user', text: 'Preserve queued message' }],
      nativeTodos: [{ text: 'Clear this step', status: 'pending' }],
    }),
  )
  await page.getByRole('tab', { name: 'Queue · 1', exact: true }).click()
  await page.getByText('Preserve queued message', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Actions for queued message 1', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Edit queued message 1', exact: true }).click()
  const queueEdit = page.getByRole('textbox', { name: 'Message', exact: true })
  await queueEdit.fill('Keep edit after clearing checklist')
  await page.getByRole('tab', { name: /Checklist · 0\/1/ }).click()
  await clear.click()
  await confirmClear.click()
  await page.evaluate(() => window.finishClear())
  await queueEdit.waitFor()
  assert.equal(await queueEdit.inputValue(), 'Keep edit after clearing checklist')
  assert.equal(await page.getByRole('button', { name: 'Clear checklist', exact: true }).count(), 0)
  assert.equal(
    await page.evaluate(() => window.currentTask.queue[0].text),
    'Preserve queued message',
  )
  await page.getByRole('button', { name: 'Cancel edit', exact: true }).click()
  await page.evaluate(() =>
    window.setTask({
      queue: Array.from({ length: 20 }, (_, index) => ({
        id: 'queue-' + index,
        role: 'user',
        text: 'Queued item ' + (index + 1),
      })),
    }),
  )
  await page
    .getByRole('button', { name: 'Actions for queued message 20', exact: true })
    .waitFor({ state: 'attached' })
  await page.evaluate(() =>
    window.setTask({
      queue: window.currentTask.queue.map((item, index) => ({ ...item, paused: index === 0 })),
    }),
  )
  await page
    .getByRole('button', { name: /^View queued message 2:.*Waiting behind paused message 1/ })
    .waitFor()
  await page.evaluate(() =>
    window.setTask({ queue: window.currentTask.queue.map((item) => ({ ...item, paused: false })) }),
  )
  assert.equal(
    await page
      .getByRole('button', { name: /^View queued message 2:.*Waiting behind paused message/ })
      .count(),
    0,
  )
  assert.equal(await queueAnnouncement.textContent(), '20 queued messages')
  const queuedList = page.getByLabel('Queued message list', { exact: true })
  assert.ok(await queuedList.evaluate((element) => element.scrollHeight > element.clientHeight))
  assert.ok((await queuedList.boundingBox()).height <= 180)
  // Long multiline messages stay on one row, including metadata and attachments.
  const longMessage =
    'Review all changed files and explain the remaining work. '.repeat(8) + '\nSecond paragraph'
  await page.evaluate(
    (text) =>
      window.setTask({
        queue: window.currentTask.queue.map((message, index) =>
          index === 0
            ? {
                ...message,
                text,
                attachments: [
                  { id: 'attachment', name: 'review.txt', mime: 'text/plain', size: 12 },
                ],
                turnSettings: { model: 'test-model' },
              }
            : message,
        ),
      }),
    longMessage,
  )
  const row = page.getByTestId('Queued message row 1')
  const rowBounds = await row.boundingBox()
  assert.ok(rowBounds.height >= 44 && rowBounds.height <= 48, JSON.stringify(rowBounds))
  assert.ok(rowBounds.x >= 0 && rowBounds.x + rowBounds.width <= 320)
  const preview = row.locator('span').last()
  assert.equal(await preview.evaluate((element) => getComputedStyle(element).whiteSpace), 'nowrap')
  assert.ok(await preview.evaluate((element) => element.scrollWidth > element.clientWidth))
  await page.getByRole('button', { name: /^View queued message 1:/ }).click()
  const details = page.getByRole('dialog', { name: 'Queued message 1', exact: true })
  assert.equal(await details.getByText(longMessage, { exact: true }).textContent(), longMessage)
  assert.equal(await row.getByText('test-model · Default reasoning', { exact: true }).count(), 0)
  await details.getByText('test-model · Default reasoning', { exact: true }).waitFor()
  await details.getByText('review.txt', { exact: true }).waitFor()
  await details.getByRole('button', { name: 'Close', exact: true }).click()

  // Touch-and-hold a message, then move it across another row.
  const source = page.getByRole('button', { name: /^View queued message 2:/ })
  await queuedList.evaluate((node) => {
    node.scrollTop = 0
  })
  await source.scrollIntoViewIfNeeded()
  const sourceBox = await source.boundingBox()
  const targetBox = await row.boundingBox()
  await page.mouse.move(sourceBox.x + 10, sourceBox.y + sourceBox.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(350)
  await page.mouse.move(sourceBox.x + 10, targetBox.y + 4, { steps: 4 })
  await page.mouse.up()
  await page.waitForFunction(() => window.calls.at(-1)?.input?.action === 'move')
  assert.equal(await page.evaluate(() => window.calls.at(-1).input.messageId), 'queue-1')
  assert.equal(await page.evaluate(() => window.calls.at(-1).input.beforeMessageId), 'queue-0')
  assert.equal(await page.getByRole('button', { name: 'Up 2', exact: true }).count(), 0)
  // The bounded queue scrolls at its edge while a held message is dragged.
  const moveCount = () =>
    page.evaluate(() => window.calls.filter((call) => call.input?.action === 'move').length)
  const beforeAutoScroll = await moveCount()
  await queuedList.evaluate((node) => {
    node.scrollTop = 0
  })
  await source.scrollIntoViewIfNeeded()
  const secondBox = await source.boundingBox()
  const listBox = await queuedList.boundingBox()
  await page.mouse.move(secondBox.x + 10, secondBox.y + secondBox.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(350)
  await page.mouse.move(secondBox.x + 10, listBox.y + listBox.height - 4, { steps: 4 })
  await page.waitForFunction(
    () => document.querySelector('[aria-label="Queued message list"]').scrollTop > 120,
  )
  await page.mouse.up()
  assert.equal(await moveCount(), beforeAutoScroll + 1)
  assert.notEqual(await page.evaluate(() => window.calls.at(-1).input.beforeMessageId), 'queue-0')
  // Cancelled gestures leave the authoritative order alone.
  await source.scrollIntoViewIfNeeded()
  const cancelBox = await source.boundingBox()
  const beforeCancel = await moveCount()
  await page.mouse.move(cancelBox.x + 10, cancelBox.y + cancelBox.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(350)
  await source.evaluate((node) =>
    node.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true })),
  )
  await page.mouse.move(310, 10)
  await page.mouse.up()
  assert.equal(await moveCount(), beforeCancel)
  // VoiceOver users can reorder without visible sort buttons.
  await source.focus()
  await page.keyboard.press('ArrowDown')
  await page.waitForFunction(() => window.calls.at(-1)?.input?.beforeMessageId === 'queue-3')

  await page.getByRole('button', { name: 'Actions for queued message 2', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Steer with message 2', exact: true }).click()
  await page.waitForFunction(() => window.calls.at(-1)?.input?.action === 'steer')
  assert.equal(await page.evaluate(() => window.calls.at(-1).input.messageId), 'queue-1')
  await page.getByRole('button', { name: 'Actions for queued message 20', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Return message 20 to composer', exact: true }).click()
  await page.waitForFunction(() => window.calls.at(-1)?.input?.action === 'restore')
  await page.waitForFunction(() =>
    window.conversation.actions.draft.text.includes('Queued item 20'),
  )
  assert.equal(await page.getByRole('dialog', { name: 'Queued messages', exact: true }).count(), 0)
  await page.evaluate(() => window.setTask({ queue: [] }))
  await page.getByTestId('Queued messages').waitFor({ state: 'detached' })
  // The plus menu keeps draft tools available without a permanent toolbar row.
  assert.equal(await page.getByLabel('Draft tools', { exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Stashed drafts', exact: true }).count(), 0)
  const beforePlus = await page.getByTestId('Composer').boundingBox()
  const dismissalsBeforePlus = await page.evaluate(() => window.keyboardDismissals ?? 0)
  await page.getByRole('button', { name: 'Add to draft', exact: true }).click()
  const plusMenu = page.getByRole('menu', { name: 'Add to draft', exact: true })
  await plusMenu.waitFor()
  const plusBounds = await plusMenu.boundingBox()
  if (screenshots) await page.screenshot({ path: screenshots + '/plus-menu-inline.png' })
  assert.ok(plusBounds.width <= 264 && plusBounds.x >= 12 && plusBounds.x + plusBounds.width <= 308)
  assert.deepEqual(await page.getByTestId('Composer').boundingBox(), beforePlus)
  assert.equal(await page.evaluate(() => window.keyboardDismissals ?? 0), dismissalsBeforePlus)
  assert.equal(await page.getByRole('dialog', { name: 'Add to draft', exact: true }).count(), 0)
  await page
    .getByRole('button', { name: 'Dismiss Add to draft', exact: true })
    .click({ position: { x: 4, y: 4 } })
  await plusMenu.waitFor({ state: 'detached' })
  await page.getByRole('button', { name: 'Add to draft', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Stashed drafts', exact: true }).click()
  const stash = page.getByRole('dialog', { name: 'Stashed drafts', exact: true })
  await stash.waitFor()
  const originalDraft = await page
    .getByRole('textbox', { name: 'Message', exact: true })
    .inputValue()
  await stash.getByRole('button', { name: 'Stash current text', exact: true }).click()
  await page.waitForFunction(() => window.conversation.actions.draft.text === '')
  await stash.getByRole('button', { name: 'Restore', exact: true }).click()
  await stash.waitFor({ state: 'detached' })
  assert.equal(
    await page.getByRole('textbox', { name: 'Message', exact: true }).inputValue(),
    originalDraft,
  )
  await page.getByRole('button', { name: 'Add to draft', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Attach thread context', exact: true }).click()
  await page.getByRole('textbox', { name: 'Search threads', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('button', { name: 'Add to draft', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Photos', exact: true }).click()
  await page.waitForFunction(() => window.calls.at(-1)?.mode === 'attach')
  assert.equal(await page.evaluate(() => window.calls.at(-1).source), 'photos')
  for (const [name, source] of [
    ['Camera', 'camera'],
    ['Files', 'files'],
  ]) {
    await page.getByRole('button', { name: 'Add to draft', exact: true }).click()
    await page.getByRole('menuitem', { name, exact: true }).click()
    await page.waitForFunction((source) => window.calls.at(-1)?.source === source, source)
  }
  assert.equal(await page.getByRole('menu', { name: 'Add to draft', exact: true }).count(), 0)
  // Prompt-first native layout uses the production empty state and start modes.
  await page.evaluate(() => {
    window.setDraftText('')
    window.setTask({
      status: 'draft',
      messages: [],
      queue: [],
      nativeTodos: undefined,
      contextUsage: undefined,
      repositoryId: 'scratch',
      autoProject: false,
    })
    document.getElementById('app').style.height = '100dvh'
  })
  for (const viewport of [
    { width: 320, height: 700 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 320, height: 400 },
  ]) {
    await page.setViewportSize(viewport)
    const start = page.getByTestId('Thread start')
    await start.waitFor()
    const field = page.getByRole('textbox', { name: 'Message', exact: true })
    await field.evaluate((node) => node.blur())
    assert.equal(
      await page.getByRole('button', { name: 'Agent & model', exact: true }).count(),
      0,
      'Empty start stays one line',
    )
    await checkFullComposer()
    const compact = await field.boundingBox()
    assert.equal(compact.height, 44)
    await field.focus()
    await page.getByRole('button', { name: 'Agent & model', exact: true }).waitFor()
    assert.ok((await field.boundingBox()).height > compact.height)
    await field.evaluate((node) => node.blur())
    assert.equal(await start.getByText('Browse threads', { exact: true }).count(), 0)
    for (const label of ['Build something', 'Fix a bug', 'Understand code', 'Plan a change']) {
      assert.equal(await page.getByRole('button', { name: label, exact: true }).count(), 0)
    }
    for (const label of [
      'Start without a project',
      'Start in Scope',
      'Choose project',
      'Task server',
    ]) {
      const button = page.getByRole('button', { name: label, exact: true })
      await button.scrollIntoViewIfNeeded()
      const box = await button.boundingBox()
      assert.ok(
        box &&
          box.width >= 44 &&
          box.height >= 44 &&
          box.height <= 44 &&
          box.x >= 0 &&
          box.x + box.width <= viewport.width,
        JSON.stringify(box),
      )
    }
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    )
    const scopeBounds = await page
      .getByRole('button', { name: 'Start in Scope', exact: true })
      .boundingBox()
    const dropdownBounds = await page
      .getByRole('button', { name: 'Choose project', exact: true })
      .boundingBox()
    const deviceBounds = await page
      .getByRole('button', { name: 'Task server', exact: true })
      .boundingBox()
    assert.ok(scopeBounds && dropdownBounds && deviceBounds)
    assert.ok(Math.abs(scopeBounds.x + scopeBounds.width - dropdownBounds.x) < 1)
    assert.equal(scopeBounds.y, dropdownBounds.y)
    assert.ok(deviceBounds.y >= scopeBounds.y + scopeBounds.height)
    if (viewport.height >= 700) {
      await start.evaluate((node) => {
        node.parentElement.scrollTop = 0
      })
      const heading = await page
        .getByText('What would you like to work on?', { exact: true })
        .boundingBox()
      assert.ok(heading && heading.y >= 0 && heading.height <= 110, JSON.stringify(heading))
    }
    if (screenshots)
      await page.screenshot({
        path: screenshots + '/native-adapter-' + viewport.width + 'x' + viewport.height + '.png',
      })
  }
  const general = page.getByRole('button', { name: 'Start without a project', exact: true })
  const scope = page.getByRole('button', { name: 'Start in Scope', exact: true })
  const projects = page.getByRole('button', { name: 'Choose project', exact: true })
  assert.equal(
    await page
      .getByTestId('Task setup')
      .getByRole('button', { name: 'Choose project', exact: true })
      .count(),
    0,
  )
  assert.equal(
    await page
      .getByTestId('Task setup')
      .getByRole('button', { name: 'Task server', exact: true })
      .count(),
    0,
  )
  await scope.click()
  await page.waitForFunction(() => window.currentTask.autoProject === true)
  assert.equal(await page.getByRole('dialog', { name: 'Project', exact: true }).count(), 0)
  assert.equal(await scope.getAttribute('aria-selected'), 'true')
  assert.equal(await page.evaluate(() => window.currentTask.repositoryId), 'scratch')
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Keep this draft')
  const beforeScopeReselect = await page.evaluate(() => window.calls.length)
  await scope.click()
  assert.equal(await page.evaluate(() => window.calls.length), beforeScopeReselect)
  await projects.click()
  assert.equal(await page.evaluate(() => window.currentTask.autoProject), true)
  await page.getByRole('button', { name: 'Project', exact: true }).click()
  await page.waitForFunction(() => window.currentTask.repositoryId === 'repo')
  const selectedProject = page.getByRole('button', {
    name: 'Selected project: Project',
    exact: true,
  })
  assert.equal(await scope.count(), 0)
  assert.equal(await selectedProject.getAttribute('aria-selected'), 'true')
  assert.equal(await selectedProject.getByText('Project', { exact: true }).count(), 1)
  assert.equal(await selectedProject.getByTestId('Selected project icon').count(), 1)
  await selectedProject.click()
  assert.equal(await page.evaluate(() => window.currentTask.repositoryId), 'repo')
  await page.getByRole('button', { name: 'Scope mode', exact: true }).click()
  await page.waitForFunction(() => window.currentTask.autoProject === true)
  assert.equal(await page.evaluate(() => window.currentTask.repositoryId), 'scratch')
  await general.click()
  await page.waitForFunction(() => !window.currentTask.autoProject)
  assert.equal(await general.getAttribute('aria-selected'), 'true')
  assert.equal(
    await page.getByRole('textbox', { name: 'Message', exact: true }).inputValue(),
    'Keep this draft',
  )
  await page.evaluate(() => window.setConnected(false))
  await page.waitForFunction(
    () => document.querySelector('[aria-label="Start without a project"]').disabled,
  )
  assert.equal(await general.isDisabled(), true)
  assert.equal(await scope.isDisabled(), true)
  assert.equal(await projects.isDisabled(), true)
  await page.evaluate(() => {
    window.setConnected(true)
    window.setInputs({ questions: [], approvals: [], autoProjectSelectionEnabled: false })
  })
  await page.waitForFunction(
    () => !document.querySelector('[aria-label="Start without a project"]').disabled,
  )
  assert.equal(await scope.count(), 0)
  assert.equal(await projects.textContent(), 'Choose project')
  assert.equal(await projects.isDisabled(), false)
  assert.equal(await general.isDisabled(), false)
  await projects.click()
  await page.getByRole('button', { name: 'Project', exact: true }).click()
  await page.waitForFunction(() => window.currentTask.repositoryId === 'repo')
  assert.equal(await projects.getByText('Project', { exact: true }).count(), 1)
  assert.equal(await projects.isDisabled(), false)
  await general.click()
  await page.waitForFunction(() => window.currentTask.repositoryId === 'scratch')
  await page.evaluate(() => {
    window.setInputs({ questions: [], approvals: [] })
    window.setDraftText('')
  })
  const draftInput = page.getByRole('textbox', { name: 'Message', exact: true })
  await draftInput.fill('My own draft')
  assert.equal(await draftInput.inputValue(), 'My own draft')
  // A saved retry waits for an in-progress machine operation, including automatic replay.
  const beforeMachineRetry = await page.evaluate(() => window.calls.length)
  await page.evaluate(() => {
    window.machineSelector.onMoving(true)
    window.setPendingFork({
      id: 'machine-pending',
      sourceTaskId: 'task',
      text: 'My own draft',
      draftText: 'My own draft',
      attachmentIds: [],
      connection: JSON.stringify(['http://runtime.lan', 'token']),
      accepted: false,
    })
  })
  await page.getByText('A fork request is waiting for this computer.').waitFor()
  assert.equal(await page.evaluate(() => window.calls.length), beforeMachineRetry)
  await page.evaluate(() => window.machineSelector.onMoving(false))
  await page.waitForFunction(() => window.calls.at(-1)?.input?.forkId === 'machine-pending')
  await page
    .getByText('A fork request is waiting for this computer.')
    .waitFor({ state: 'detached' })
  // Unresolved forks lock project/computer moves and reject a stale picker callback.
  await page.evaluate(() => {
    window.setConnected(false)
    window.setPendingFork({
      id: 'locked-pending',
      sourceTaskId: 'task',
      text: 'Saved',
      draftText: 'Saved',
      attachmentIds: [],
      connection: 'original',
      accepted: false,
    })
  })
  await page.getByText('A fork request is waiting for this computer.').waitFor()
  assert.equal(await page.evaluate(() => window.machineSelector.disabled), true)
  const beforeProjectMove = await page.evaluate(() => window.calls.length)
  const moveError = await page.evaluate(async () => {
    try {
      await window.machineSelector.onProjectChange({
        id: 'another',
        name: 'Another',
        path: '/another',
        branch: 'main',
      })
      return ''
    } catch (error) {
      return error.message
    }
  })
  assert.match(moveError, /pending fork/)
  assert.equal(await page.evaluate(() => window.calls.length), beforeProjectMove)
  assert.deepEqual(errors, [])
  console.log(
    'Mobile composer: default Queue / empty Stop, anchored Fork/Queue/Steer/Stop and + menus, keyboard bounds and outside dismissal without composer movement or accidental send, inline scrollable queue and 44pt actions at 320px, pause/resume/reorder/direct steer/restore, compact anchored queue menus, retry-safe duplication, composer queue editing, checklist collapse, side-chat sending, failure recovery and offline guards passed with native control adapters.',
  )
} finally {
  await browser.close()
}
