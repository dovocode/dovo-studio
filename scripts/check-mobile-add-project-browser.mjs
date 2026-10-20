import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const importer = root + 'apps/mobile/src/screens/repositories.tsx'
const controls = `
export const View=({children})=><div>{children}</div>;export const ScrollView=View;
export const Text=({children})=><span>{children}</span>;
export const Action=({label,disabled,onPress})=><button disabled={disabled} onClick={onPress}>{label}</button>;
export const Field=({label,value,onChangeText})=><input aria-label={label} value={value} onChange={e=>onChangeText(e.target.value)}/>;
export const Sheet=({children,title})=><div role="dialog" aria-label={title}>{children}</div>;
export const useTheme=()=>({styles:{}});
`
const mocks = {
  'react-native': controls,
  '../runtime/state/application-state': "export {useState as useApplicationState} from 'react';",
  '../runtime/connection/provider':
    'export const useRuntime=()=>window.runtime;export const RuntimeScope=({children})=>children;',
  '../shell/navigation': 'export const useNavigation=()=>({});',
  '../scm/connections/repository-checkouts': 'export const RepositoryCheckouts=()=>null;',
  '../scm/connections/directory-picker': `export const DirectoryPicker=({onSelect})=><>{['/Users/test/Code/first-project','C:\\\\Code\\\\second-project\\\\','/Users/test/Code/custom-project','/Users/test/CloneParent'].map(path=><button key={path} onClick={()=>onSelect(path)}>{path}</button>)}</>;`,
  '../scm/connections/github-repository-picker': `export const GithubRepositoryPicker=({onSelect})=><>{['alpha','beta'].map(name=><button key={name} onClick={()=>onSelect({fullName:'team/'+name,name})}>{name}</button>)}</>;`,
  '../runtime/connection/creation-target': 'export const CreationTarget=()=>null;',
  '../ui/layout/screen-header': 'export const ScreenHeader=()=>null;',
  '../ui/controls/icon-button': 'export const IconButton=()=>null;',
  ...Object.fromEntries(
    [
      '../ui/layout/sheet',
      '../ui/content/text',
      '../ui/controls/action',
      '../ui/controls/field',
      '../ui/theme',
    ].map((path) => [path, controls]),
  ),
  '../ui/controls/use-action': `import {Effect} from 'effect';export const useAction=()=>({busy:false,error:'',act:run=>Effect.runPromise(run())});`,
}
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `import {createRoot} from 'react-dom/client';import {Effect} from 'effect';import {AddProject} from './apps/mobile/src/screens/repositories';window.submissions=[];window.runtime={connected:true,profile:{name:'Fixture',nameIsCustom:true},callEffect:(path,input)=>{window.submissions.push(input);return Effect.succeed({...input,id:'added',branch:'main'})}};createRoot(document.getElementById('app')).render(<AddProject onClose={()=>{}}/>);`,
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    alias: {
      react: root + 'packages/studio-ui/node_modules/react',
      'react-dom': root + 'packages/studio-ui/node_modules/react-dom',
    },
  },
  Object.entries(mocks).map(([path, contents]) => ({ path, contents, importer })),
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const name = page.getByRole('textbox', { name: 'Project name', exact: true })
  const create = page.getByRole('button', { name: 'Create project', exact: true })
  assert.equal(await create.isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: 'Browse runtime folders…' }).count(), 0)
  await name.fill('My notes')
  await create.click()
  await page.waitForFunction(() => window.submissions.length === 1)
  assert.deepEqual(await page.evaluate(() => window.submissions.shift()), {
    source: 'dovo',
    name: 'My notes',
  })
  await page.getByRole('button', { name: 'Local path', exact: true }).click()
  const browse = () =>
    page.getByRole('button', { name: 'Browse runtime folders…', exact: true }).click()
  await browse()
  await page.getByRole('button', { name: '/Users/test/Code/first-project', exact: true }).click()
  assert.equal(await name.inputValue(), 'first-project')
  await browse()
  await page.getByRole('button', { name: /^C:/ }).click()
  assert.equal(await name.inputValue(), 'second-project')
  await name.fill('My project')
  await browse()
  await page.getByRole('button', { name: '/Users/test/Code/custom-project', exact: true }).click()
  assert.equal(await name.inputValue(), 'My project')
  await page.getByRole('button', { name: 'Add repository', exact: true }).click()
  await page.waitForFunction(() => window.submissions.length === 1)
  assert.deepEqual(await page.evaluate(() => window.submissions[0]), {
    source: 'local',
    name: 'My project',
    path: '/Users/test/Code/custom-project',
  })
  await page.getByRole('button', { name: 'GitHub', exact: true }).click()
  const github = () =>
    page.getByRole('button', { name: 'Choose from GitHub…', exact: true }).click()
  await github()
  await page.getByRole('button', { name: 'alpha', exact: true }).click()
  assert.equal(await name.inputValue(), 'alpha')
  await github()
  await page.getByRole('button', { name: 'beta', exact: true }).click()
  assert.equal(await name.inputValue(), 'beta')
  await browse()
  await page.getByRole('button', { name: '/Users/test/CloneParent', exact: true }).click()
  assert.equal(await name.inputValue(), 'beta')
  await name.fill('Custom clone')
  await github()
  await page.getByRole('button', { name: 'alpha', exact: true }).click()
  assert.equal(await name.inputValue(), 'Custom clone')
  await page.getByRole('button', { name: 'Clone and add repository', exact: true }).click()
  await page.waitForFunction(() => window.submissions.length === 2)
  assert.deepEqual(await page.evaluate(() => window.submissions[1]), {
    source: 'github',
    name: 'Custom clone',
    repository: 'team/alpha',
    directory: '/Users/test/CloneParent',
  })
  assert.deepEqual(errors, [])
  console.log(
    'Mobile Dovo Projects need only a name; local/GitHub selection preserves custom names and submits the visible value.',
  )
} finally {
  await browser.close()
}
