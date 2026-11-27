import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const importer = root + 'apps/mobile/src/scm/work/linear-issues.tsx'
const mobile = (path, contents) => ({ path, importer, contents })
const bundle = await bundleBrowser(
  {
    stdin: {
      loader: 'tsx',
      resolveDir: root,
      contents: `import {createRoot} from 'react-dom/client';
import {LinearIssuesSheet} from './apps/mobile/src/scm/work/linear-issues';
const open={id:'open',name:'Open'}, review={id:'review',name:'In review'};
const details={sourceVersion:'fixture-version',state:open,states:[open,review],comments:[]};
const source={profile:{id:'mac',connection:{address:'http://mac',token:'paired'}},connected:true,snapshot:{linearKeySource:'saved',linearIssueActionsSupported:true,workspace:{repositories:[]}}};
window.actions=[];
window.readLinear=async(profile,path,input)=>{
  if(path.endsWith('/actions/read'))return structuredClone(details);
  if(path.endsWith('/action')){
    window.actions.push({owner:profile.id,input});
    if(input.action==='set-status')details.state=review;
    if(input.action==='comment')details.comments=[{id:input.commentId,author:'Tester',body:input.body}];
    return structuredClone(details);
  }
  return {items:[{id:'fixture',identifier:'ENG-7',description:'Fix the timer.',status:details.state.name,title:'Timer',url:'https://linear.app/test/issue/ENG-7'}]};
};
createRoot(document.getElementById('app')).render(<LinearIssuesSheet sources={[source]} onClose={()=>{}}/>);`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    jsx: 'automatic',
    alias: {
      react: root + 'packages/studio-ui/node_modules/react',
      '@dovo/protocol': root + 'packages/protocol/src/index.ts',
    },
    nodePaths: [root + 'packages/studio-ui/node_modules'],
  },
  [
    {
      path: 'react-native',
      contents:
        'export const Alert={alert(){}}; export const Linking={openURL:async()=>{}}; export const View=({children})=><div>{children}</div>;',
    },
    {
      path: 'expo-crypto',
      contents: "export const randomUUID=()=> '00000000-0000-4000-8000-000000000001';",
    },
    {
      path: '@dovo/studio-core',
      contents: `export {useLinearIssues,useLinearIssueActions} from '${root}packages/studio-core/src/scm/use-linear-issues';`,
    },
    mobile(
      '../../runtime/connection/provider',
      'export const useRuntime=()=>({readRuntime:window.readLinear});',
    ),
    mobile(
      '../../ui/controls/action',
      'export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;',
    ),
    mobile(
      '../../ui/controls/choice',
      'export const Choice=({label,value,onChange,items,disabled})=><select aria-label={label} value={value} disabled={disabled} onChange={event=>onChange(event.target.value)}>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>;',
    ),
    mobile(
      '../../ui/controls/field',
      'export const Field=({label,value,editable,onChangeText})=><textarea aria-label={label} value={value} readOnly={editable===false} onChange={event=>onChangeText(event.target.value)}/>;export const SearchField=({label,value,onChangeText})=><input aria-label={label} value={value} onChange={event=>onChangeText(event.target.value)}/>;',
    ),
    mobile('../../ui/content/clipboard', 'export const copyText=async()=>{};'),
    mobile(
      '../../ui/content/text',
      'export const Text=({children,accessibilityRole})=><p role={accessibilityRole}>{children}</p>;',
    ),
    mobile(
      '../../ui/layout/sheet',
      'export const Sheet=({title,children})=><section role="dialog" aria-label={title}>{children}</section>;',
    ),
    mobile('../../ui/theme', 'export const useTheme=()=>({styles:{},colors:{}});'),
  ],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  page.setDefaultTimeout(5000)
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await page.getByRole('button', { name: 'ENG-7 · Open · Timer' }).click()
  await page.getByRole('combobox', { name: 'Status' }).selectOption('review')
  await page.getByRole('button', { name: 'Save status' }).click()
  await page.getByRole('button', { name: 'ENG-7 · In review · Timer' }).waitFor()
  await page.getByRole('textbox', { name: 'Comment' }).fill('Review requested.')
  await page.getByRole('button', { name: 'Post comment' }).click()
  await page.getByText('Tester', { exact: true }).waitFor()
  await page.getByText('Review requested.', { exact: true }).waitFor()
  const requests = await page.evaluate(() => window.actions)
  assert.deepEqual(
    requests.map(({ owner, input }) => [owner, input.issueId, input.action]),
    [
      ['mac', 'fixture', 'set-status'],
      ['mac', 'fixture', 'comment'],
    ],
  )
  assert.equal(await page.getByRole('textbox', { name: 'Comment' }).inputValue(), '')
  console.log('Mobile Linear issue preview changes status and displays the posted comment.')
} finally {
  await browser.close()
}
