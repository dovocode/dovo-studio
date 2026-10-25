import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const screen = root + 'apps/mobile/src/screens/'
const native = `
const flat=style=>Array.isArray(style)?Object.assign({},...style.map(flat)):style??{};
const css=style=>{const value=flat(style);return {...value,paddingLeft:value.paddingHorizontal,paddingRight:value.paddingHorizontal,paddingTop:value.paddingVertical,paddingBottom:value.paddingVertical,fontSize:value.fontSize?value.fontSize*window.fontScale:undefined,lineHeight:value.lineHeight?value.lineHeight*window.fontScale+'px':undefined}};
export const StyleSheet={hairlineWidth:1};
export const useWindowDimensions=()=>({width:innerWidth,height:innerHeight,fontScale:window.fontScale});
export const View=({children,style,accessibilityRole,accessibilityLabel,accessibilityValue})=><div role={accessibilityRole==='image'?'img':accessibilityRole} aria-label={accessibilityLabel} aria-valuenow={accessibilityValue?.now} style={{display:'flex',flexDirection:'column',boxSizing:'border-box',flexShrink:0,minWidth:0,...css(style)}}>{children}</div>;
export const Text=({children,style,numberOfLines,accessibilityLiveRegion})=><span data-text aria-live={accessibilityLiveRegion} style={{display:'block',overflowWrap:'anywhere',...css(style),...(numberOfLines?{display:'-webkit-box',WebkitBoxOrient:'vertical',WebkitLineClamp:numberOfLines,overflow:'hidden'}:{})}}>{children}</span>;
export const FlatList=({data,renderItem,keyExtractor,ListHeaderComponent,ListEmptyComponent,contentContainerStyle})=><View style={contentContainerStyle}>{ListHeaderComponent}{data.map((item,index)=><View key={keyExtractor(item)}>{renderItem({item,index})}</View>)}{!data.length&&ListEmptyComponent}</View>;
export const SettingsPage=View;
export const useSettingsTheme=()=>({colors:{surface:'#f6f8fa',border:'#d0d7de',accent:'#0969da',error:'#cf222e',warning:'#9a6700'},styles:{content:{padding:12,gap:20,maxWidth:768,width:'100%',alignSelf:'center'},text:{fontSize:16,lineHeight:22},muted:{fontSize:13,lineHeight:18,color:'#57606a'},title:{fontSize:17,lineHeight:23},card:{padding:12,gap:10,borderRadius:16,backgroundColor:'#f6f8fa'}}});
export const SettingsField=({label,value,onChangeText,secureTextEntry,placeholder})=><label>{label}<input aria-label={label} type={secureTextEntry?'password':'text'} value={value} placeholder={placeholder} onChange={event=>onChangeText(event.target.value)} /></label>;
export const SettingsAction=({label,disabled,onPress})=><button disabled={disabled} onClick={onPress}>{label}</button>;
export const SettingsChoice=({label,value,items,onChange})=><label>{label}<select aria-label={label} value={value} onChange={event=>onChange(event.target.value)}>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>;
export const SettingsGroup=({title,footer,children})=><View>{title&&<h2>{title}</h2>}{children}{footer&&<Text>{footer}</Text>}</View>;
`
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root + 'apps/mobile',
      loader: 'tsx',
      contents: `import {createRoot} from 'react-dom/client';import {useState} from 'react';import Usage from './src/screens/usage';
window.fontScale=1;const now=Date.now();const turn=(id,reported)=>({id,assistantId:id,agentId:'agent',provider:'codex',model:'gpt-6.1-sol',status:'completed',startedAt:new Date(now-(id==='missing'?2:1)*86400000).toISOString(),finishedAt:new Date(now-(id==='missing'?2:1)*86400000+60000).toISOString(),...(reported?{tokens:12000,estimatedCostUsd:.035}:{})});
window.usageHost={connected:true,profile:{id:'mac',name:'Mac Studio',nameIsCustom:true,connection:{address:'http://runtime',token:'test-token'}},snapshot:{workspace:{tasks:[{id:'task',title:'Improve composer and usage visualization across computers',example:false,turns:[turn('reported',true),turn('missing',false)]}],planLimits:[]}}};window.missingTurn=turn('unreported',false);
function App(){const[,render]=useState(0);window.refreshLayout=scale=>{window.fontScale=scale;render(value=>value+1)};return <Usage/>}createRoot(document.getElementById('app')).render(<App/>);`,
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    alias: {
      react: root + 'apps/mobile/node_modules/react',
      'react-dom': root + 'apps/mobile/node_modules/react-dom',
    },
  },
  [
    { path: 'react-native', contents: native },
    ...['./settings-theme', './settings-controls', './settings-group', '../ui/content/text'].map(
      (path) => ({ path, importer: screen, contents: native }),
    ),
    { path: './usage-prices', importer: screen, contents: 'export const UsagePrices=()=>null;' },
    { path: './reset-credits', importer: screen, contents: 'export const ResetCredits=()=>null;' },
    {
      path: '../ui/layout/screen-header',
      importer: screen,
      contents: 'export const ScreenHeader=({title})=><h1>{title}</h1>;',
    },
    {
      path: '../runtime/state/app-active',
      importer: screen,
      contents: 'export const useAppActive=()=>true;export const useForegroundInterval=()=>{};',
    },
    {
      path: '../runtime/connection/provider',
      importer: screen,
      contents: `import {useSyncExternalStore} from 'react';window.hubWrites=[];window.hubEntries=[];window.failHubWrite=false;
const hubRead=(path,input)=>{
 if(path==='/api/usage/hubs/read')return window.hubEntries;
 if(path==='/api/usage/hubs/remove'){window.hubEntries=window.hubEntries.filter(h=>h.id!==input.id);return window.hubEntries}
 if(path==='/api/usage/hubs/write'){
  window.hubWrites.push(input);
  if(window.failHubWrite)throw new Error('Hub unavailable');
  const old=window.hubEntries.find(h=>h.id===input.id);
  if((!old||old.url!==input.url)&&!input.managementKey)throw new Error('Missing management key');
  const value={id:input.id||'hub',label:input.label,url:input.url,enabled:input.enabled,checkedAt:new Date().toISOString(),limits:[{provider:'claude',window:'Session',windowId:'five_hour',usedPercent:25,updatedAt:new Date().toISOString(),account:{id:'hub-account',label:'Hub account'}}]};
  window.hubEntries=[...window.hubEntries.filter(h=>h.id!==value.id),value];return window.hubEntries;
 }
};
const cache={read:async()=>null,write:async()=>{}};const readRuntime=async(profile,path,input)=>{(window.usageReads??=[]).push(path);if(path.startsWith('/api/usage/hubs/'))return hubRead(path,input);return path==='/api/usage/limits/read'?{checkedAt:new Date().toISOString(),accounts:[],hubs:window.hubEntries.map(hub=>window.partialHub?{...hub,error:'1 of 2 accounts could not report limits.',accounts:[{id:'good',provider:'claude',account:{id:'hub-account',label:'Hub account'},status:'ok'},{id:'bad',provider:'claude',account:{id:'unreported',label:'Failed hub account'},status:'failed'}]}:hub)}:{sourceId:profile.id,records:[],notices:[]}};let overviews;const listeners=new Set();const subscribe=callback=>{listeners.add(callback);return ()=>listeners.delete(callback)};const current=()=>overviews??=[window.usageHost];window.changeUsageScenario=scenario=>{overviews=(scenario==='unpaired'?[]:[{...window.usageHost,snapshot:{workspace:{tasks:scenario==='empty'?[]:scenario==='zero'?[{...window.usageHost.snapshot.workspace.tasks[0],turns:[{...window.missingTurn,tokens:0,estimatedCostUsd:0}]}]:scenario==='missing'?[{...window.usageHost.snapshot.workspace.tasks[0],turns:[window.missingTurn]}]:window.usageHost.snapshot.workspace.tasks,planLimits:[]}}}]);listeners.forEach(callback=>callback())};export const useRuntime=()=>({overviews:useSyncExternalStore(subscribe,current),readRuntime,refreshRuntime:async()=>{},cacheForRuntime:()=>cache});`,
    },
  ],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  page.setDefaultTimeout(5000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<body style="margin:0;font-family:system-ui"><div id="app"></div></body>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.getByRole('heading', { name: 'Usage & limits', exact: true }).waitFor()
  await page.getByLabel('Period', { exact: true }).selectOption('quarter')
  for (const [width, scale] of [
    [320, 1],
    [390, 1],
    [768, 1],
    [1024, 1.5],
    [320, 2],
    [390, 2],
  ]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.evaluate((scale) => window.refreshLayout(scale), scale)
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    )
    const bars = page.getByRole('img')
    assert.ok((await bars.count()) >= 90)
    assert.equal(
      await bars.evaluateAll((nodes) =>
        nodes.every((node) => node.getBoundingClientRect().width >= 1),
      ),
      true,
      'Quarterly bars remain visible at ' + width + '/' + scale,
    )
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
      'Usage fits at ' + width + '/' + scale,
    )
    const tokens = await page.getByText('Reported tokens', { exact: true }).boundingBox()
    const records = await page.getByText('Usage records', { exact: true }).boundingBox()
    if (width / scale < 360)
      assert.ok(
        tokens.y > records.y && Math.abs(tokens.x - records.x) < 1,
        'Metrics stack at ' + width + '/' + scale,
      )
  }
  await page.getByLabel('Usage view', { exact: true }).selectOption('tokens')
  assert.ok((await page.getByRole('img', { name: /Tokens not reported/ }).count()) > 0)
  await page.evaluate(() => window.changeUsageScenario('missing'))
  await page.getByText('No tokens reported in this period.', { exact: true }).waitFor()
  assert.equal(await page.getByRole('img').count(), 0)
  await page.getByLabel('Usage view', { exact: true }).selectOption('costs')
  await page.getByText('No priced usage in this period.', { exact: true }).waitFor()
  await page.evaluate(() => window.changeUsageScenario('zero'))
  await page.getByText('Reported cost is $0.00 in this period.', { exact: true }).waitFor()
  await page.getByLabel('Usage view', { exact: true }).selectOption('tokens')
  await page.getByText('Reported token usage is zero in this period.', { exact: true }).waitFor()
  await page.evaluate(() => window.changeUsageScenario('empty'))
  await page.getByText('No usage in this period.', { exact: true }).waitFor()
  assert.equal(await page.getByRole('img').count(), 0)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  assert.equal(
    await page.evaluate(() => window.usageReads.includes('/api/usage/limits/read')),
    false,
  )
  const historyReads = await page.evaluate(
    () => window.usageReads.filter((path) => path === '/api/usage/history/read').length,
  )
  await page.getByLabel('Usage view', { exact: true }).selectOption('limits')
  await page.getByText(/No account limits reported/).waitFor()
  await page.waitForFunction(() => window.usageReads.includes('/api/usage/limits/read'))
  assert.equal(
    await page.evaluate(
      () => window.usageReads.filter((path) => path === '/api/usage/history/read').length,
    ),
    historyReads,
    'Native Limits must not download history',
  )

  await page.getByRole('button', { name: 'Manage usage hubs', exact: true }).click()
  await page.getByLabel('Hub name', { exact: true }).fill('Home hub')
  await page.getByLabel('Hub URL', { exact: true }).fill('http://hub.internal:8317')
  await page.getByLabel('Management key', { exact: true }).fill('test-management-key')
  await page.evaluate(() => (window.failHubWrite = true))
  await page.getByRole('button', { name: 'Save hub', exact: true }).click()
  await page.getByText(/Could not save hubs/).waitFor()
  assert.equal(
    await page.getByLabel('Management key', { exact: true }).inputValue(),
    'test-management-key',
    'Failed saves preserve the draft',
  )
  await page.evaluate(() => (window.failHubWrite = false))
  await page.getByRole('button', { name: 'Save hub', exact: true }).click()
  await page.getByRole('button', { name: 'Edit Home hub', exact: true }).waitFor()
  assert.equal(
    await page.getByLabel('Management key', { exact: true }).inputValue(),
    '',
    'Saved keys leave the form',
  )
  await page.getByText('Pooled availability', { exact: true }).waitFor()
  assert.ok(await page.getByRole('img', { name: /Hub account: 75% left/ }).count())
  await page.evaluate(() => (window.partialHub = true))
  await page.getByRole('button', { name: 'Refresh usage', exact: true }).click()
  await page.getByText(/1 of 2 accounts available/).waitFor()
  assert.equal(
    await page.getByRole('img', { name: 'Failed hub account: unknown', exact: true }).count(),
    1,
  )
  assert.ok(
    await page.getByRole('img', { name: /Hub account: 75% left/ }).count(),
    'A failed sibling must not disable healthy quota',
  )
  await page.evaluate(() => (window.partialHub = false))
  await page.getByRole('button', { name: 'Edit Home hub', exact: true }).click()
  assert.equal(
    await page.getByLabel('Management key', { exact: true }).inputValue(),
    '',
    'Edit never retrieves the stored key',
  )
  await page.getByLabel('Hub name', { exact: true }).fill('Renamed hub')
  await page.getByRole('button', { name: 'Save hub', exact: true }).click()
  await page.getByRole('button', { name: 'Remove Renamed hub', exact: true }).click()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: 'Confirm removal', exact: true }).count(), 0)
  await page.getByRole('button', { name: 'Remove Renamed hub', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm removal', exact: true }).click()
  await page.waitForFunction(() => window.hubEntries.length === 0)
  await page.getByRole('button', { name: 'Save hub', exact: true }).waitFor()
  await page.evaluate(() => window.changeUsageScenario('unpaired'))
  await page
    .getByText('Connect a computer to see recorded usage and account limits.', { exact: true })
    .waitFor()
  assert.equal(
    await page.getByRole('button', { name: 'Refresh usage', exact: true }).isDisabled(),
    true,
  )
  assert.deepEqual(errors, [])
  console.log(
    'Mobile usage: quarterly chart, phone/tablet and large text, missing token/price reports, empty chart and account limits, and unpaired guidance passed (native boundaries adapted).',
  )
} finally {
  await browser.close()
}
