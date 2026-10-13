import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { bundleBrowser, chromium } from './browser/harness.mjs'
const root = new URL('../', import.meta.url).pathname.replace(/\/$/, '')
const mobile = root + '/apps/mobile'
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: mobile,
      loader: 'tsx',
      contents: `
import {createRoot} from 'react-dom/client';import {useState} from 'react';import {CodeReviewReport} from './src/scm/review/code-review-report';
const finding={id:'finding',path:'src/editor/save.ts',line:42,severity:'high',title:'Closing can lose unsaved changes',trigger:'Close while persistence is pending',impact:'Latest changes are lost',suggestion:'Wait for persistence before closing',status:'addressed'};
const approval={approvedAt:'2026-10-12',baseline:'tree',head:'head'};
const head = 'head'
const latest={id:'review',reviewer:'Reviewer',model:'Thread model',status:'completed',createdAt:'2026-10-12',baseline:'tree',head,findings:[finding],summary:'Inspected persistence and callers',notVerified:['Physical iPhone behavior'],approval};
function App(){const [tab,setTab]=useState('diff'),[scope,setScope]=useState('working');return <CodeReviewReport task={{id:'task',files:[],status:'review'}} tab={tab} onTab={setTab} scope={scope} onScope={setScope} focusedFinding={finding} onOpen={f=>{window.opened=f;setTab('diff')}} onSince={id=>window.since=id} review={{busy:false,error:'',refresh(){},run:(action,input)=>window.action={action,input},report:{reviews:[latest],current:true,approved:true,evidenceLimited:false,commands:[{id:'command',command:'pnpm test save',status:'passed',source:'reviewer',revision:'tree',time:'2026-10-12',output:'Save regression passed',exitCode:0}]}}}/>};createRoot(document.getElementById('app')).render(<App/>);`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    jsx: 'automatic',
    platform: 'browser',
    alias: {
      react: mobile + '/node_modules/react',
      '@dovo/protocol': root + '/packages/protocol/src/index.ts',
    },
    nodePaths: [mobile + '/node_modules', root + '/node_modules'],
  },
  [
    {
      path: 'react-native',
      contents: `const flat=s=>Array.isArray(s)?Object.assign({},...s.map(flat)):s;export const View=({children,style})=><div style={{display:'flex',flexDirection:'column',...flat(style)}}>{children}</div>;export const ScrollView=View;`,
    },
    { path: 'expo-crypto', contents: `export const randomUUID=()=>crypto.randomUUID();` },
    {
      path: '../../runtime/connection/provider',
      importer: mobile,
      contents: `export const useRuntime=()=>({connected:true,snapshot:{workspace:{agents:[]}}});`,
    },
    {
      path: '../../ui/theme',
      importer: mobile,
      contents: `export const useTheme=()=>({colors:{error:'#e66',muted:'#aaa',success:'#8c9'},styles:{row:{flexDirection:'row',gap:8},card:{border:'1px solid #444',borderRadius:8,padding:12},muted:{color:'#aaa'},text:{color:'#eee'},error:{color:'#e66'}}});`,
    },
    {
      path: '../../ui/content/text',
      importer: mobile,
      contents: `export const Text=({children,style,accessibilityRole})=><span role={accessibilityRole} style={Array.isArray(style)?Object.assign({},...style):style}>{children}</span>;`,
    },
    {
      path: '../../ui/controls/action',
      importer: mobile,
      contents: `export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;`,
    },
    {
      path: '../../ui/controls/choice',
      importer: mobile,
      contents: `export const Choice=({label,value,items,onChange,disabled})=><label>{label}<select aria-label={label} value={value} disabled={disabled} onChange={e=>onChange(e.target.value)}>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>;`,
    },
  ],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 360, height: 800 } }),
    errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.route('https://review.test/**', (route) =>
    route.fulfill({ body: '<html></html>', contentType: 'text/html' }),
  )
  await page.goto('https://review.test/')
  await page.setContent(
    '<style>body{margin:0;background:#171717;color:#eee;font:14px system-ui}button,select{min-height:44px;border:1px solid #444;background:#252525;color:#eee;border-radius:8px;padding:8px}span{overflow-wrap:anywhere}</style><div id="app"></div>',
  )
  await page.addScriptTag({ content: built.outputFiles[0].text })
  assert.equal(await page.getByRole('combobox', { name: 'Reviewer configuration' }).count(), 0)
  await page.getByRole('button', { name: 'Local edits', exact: true }).click()
  await page.getByRole('button', { name: 'Re-review', exact: true }).click()
  assert.equal(await page.evaluate(() => window.action.input.scope), 'branch')
  await page.getByRole('button', { name: 'Findings (1)', exact: true }).click()
  assert.equal(
    await page.getByText('Trigger: Close while persistence is pending', { exact: true }).count(),
    0,
  )
  await page.getByRole('button', { name: 'Evidence & suggested fix', exact: true }).click()
  await page.getByText('Trigger: Close while persistence is pending', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Inspect fix delta', exact: true }).click()
  assert.equal(await page.evaluate(() => window.since), 'review')
  await page.getByRole('button', { name: 'Approved · Undo', exact: true }).click()
  assert.equal(await page.evaluate(() => window.action.input.approved), false)
  await page.getByRole('button', { name: 'Verification', exact: true }).click()
  await page.getByText(/Current reviewed snapshot · read-only session/).waitFor()
  await page.getByRole('button', { name: 'Show output', exact: true }).click()
  await page.getByText('Save regression passed', { exact: true }).waitFor()
  if (process.env.DOVO_REVIEW_SCREENSHOTS) {
    await mkdir(process.env.DOVO_REVIEW_SCREENSHOTS, { recursive: true })
    await page.screenshot({
      path: process.env.DOVO_REVIEW_SCREENSHOTS + '/review-mobile-verification.png',
      fullPage: true,
    })
  }
  for (const width of [320, 360, 736]) {
    await page.setViewportSize({ width, height: 800 })
    assert.equal(
      await page.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth),
      true,
    )
  }
  assert.deepEqual(errors, [])
  console.log(
    'Mobile report: compact options, scope, focused finding, evidence, fix delta and stale verification passed',
  )
} finally {
  await browser.close()
}
