import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { bundleBrowser, chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const mobile = root + 'apps/mobile/src'
const native = `
const flat=style=>Object.assign({},...(Array.isArray(style)?style.flat(Infinity):[style]));
export const View=({children,style,accessibilityLabel,accessibilityRole,accessibilityValue})=><div aria-label={accessibilityLabel} role={accessibilityRole} aria-valuenow={accessibilityValue?.now} aria-valuemax={accessibilityValue?.max} style={{display:'flex',flexDirection:'column',...flat(style)}}>{children}</div>;
export const Text=({children,style,accessibilityLabel})=><span aria-label={accessibilityLabel} style={flat(style)}>{children}</span>;
export const Pressable=({children,style,onPress,disabled,accessibilityLabel,accessibilityState})=><button aria-label={accessibilityLabel} aria-pressed={accessibilityState?.selected} disabled={disabled} onClick={onPress} style={{display:'flex',padding:0,border:0,...flat(typeof style==='function'?style({pressed:false}):style)}}>{children}</button>;
export const TextInput=({ref,value,onChangeText,accessibilityLabel,accessibilityHint,style,editable})=><input ref={ref} aria-label={accessibilityLabel} aria-description={accessibilityHint} value={value} disabled={editable===false} onChange={event=>onChangeText?.(event.target.value)} style={flat(style)}/>;
export const ScrollView=View;export const Platform={OS:'android'};
export const Icon=()=>null;
export const IconButton=({label,onPress})=><button aria-label={label} onClick={onPress}/>;
export const useTheme=()=>window.mobileTheme??({mode:'light',colors:{text:'#202020',surface:'#f7f7f7',selection:'#e0e7ff',action:'#222',accent:'#1645a0',border:'#bbb',muted:'#595959',error:'#b00020',success:'#137333',onAccent:'#fff'},styles:{input:{border:'1px solid #bbb',fontSize:17},text:{color:'#202020'},muted:{color:'#595959'},error:{color:'#b00020'}}});
`
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root + 'apps/mobile',
      loader: 'tsx',
      contents: `
import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import {RuntimeRequestError} from '@dovo/protocol';
import {useAction} from '${mobile}/ui/controls/use-action';
import {studioThemes} from '${root}packages/studio-core/src/themes';
import {accessibleThemeColors} from '${root}packages/studio-core/src/accessibility';
window.studioThemes=studioThemes;window.accessibleThemeColors=accessibleThemeColors;
import {Action} from '${mobile}/ui/controls/action';
import {Field} from '${mobile}/ui/controls/field';
import {ValidationFields} from '${mobile}/ui/controls/validation-fields';
import {ChangeTypeFilters} from '${mobile}/ui/content/change-types';
import {NativeTodos} from '${mobile}/tasks/conversation/components/native-todos';
import {ScreenHeader} from '${mobile}/ui/layout/screen-header';
const files=['normal','tests','mocks','docs','generated'].map(changeKind=>({path:changeKind,changeKind}));
function App(){const action=useAction();const[renderedTheme,setRenderedTheme]=useState();window.setMobileTheme=value=>{window.mobileTheme=value;setRenderedTheme(value)};const[url,setUrl]=useState('valid'),[filter,setFilter]=useState();const [distribution,setDistribution]=useState({files,weightBy:'files'});window.setDistribution=setDistribution;return <main style={{background:renderedTheme?.colors.background,padding:16,maxWidth:600,margin:'auto',display:'flex',flexDirection:'column',gap:16}}>
<ScreenHeader title="Example thread" titleMenu buttons={[{label:'Open next sheet',icon:'edit',overflow:true,onPress:()=>window.openedNext=true}]}/>
<Action label="Save linked projects" onPress={()=>{}}/><Action secondary label="Delete artifact" onPress={()=>{}}/><Action label="Try again" onPress={()=>{}}/>
<Action icon="edit" label="Explicit icon" onPress={()=>{}}/>
<ValidationFields validationAttempt={action.validationAttempt}><Field label="Name" hint="A useful name" value="" editable={!action.busy} error={action.fieldError('name')}/><Field label="URL" value={url} onChangeText={setUrl} error={!url?'URL is required':undefined}/></ValidationFields>
<button onClick={()=>action.act(()=>{throw new RuntimeRequestError({kind:'response',message:'Invalid fields',issues:[{path:'name',code:'required',message:'Name is required'}]})})}>Validate</button>
<ChangeTypeFilters files={distribution.files} weightBy={distribution.weightBy} value={filter} onChange={setFilter}/><output aria-label="Active file type">{filter??'all'}</output>
<NativeTodos task={{status:'running',nativeTodos:[{text:'First',status:'completed'},{text:'Second',status:'pending'},{text:'Third',status:'in-progress'}]}}/>
</main>};createRoot(document.getElementById('app')).render(<App/>);`,
    },
    nodePaths: [root + 'apps/mobile/node_modules'],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  },
  [
    { path: 'react-native', contents: native },
    { path: 'expo-router', contents: 'export const Stack={};' },
    {
      path: '../../runtime/preferences/app-build',
      importer: mobile,
      contents: 'export const appChannel=null;',
    },
    {
      path: '../../shell/navigation',
      importer: mobile,
      contents:
        "import {createContext} from 'react';export const NavigationContext=createContext(null);",
    },
    {
      path: '../../runtime/state/application-state',
      importer: mobile,
      contents: "export {useState as useApplicationState} from 'react';",
    },
    { path: '../controls/icon-assets', importer: mobile, contents: 'export const iconAssets={};' },
    {
      path: './sheet',
      importer: mobile,
      contents: `import {useImperativeHandle} from 'react';export const useInsideSheet=()=>false;export const Sheet=({ref,title,children,onClose})=>{useImperativeHandle(ref,()=>({dismiss:after=>window.finishDismiss=()=>{onClose();after?.()}}));return <div role="dialog" aria-label={title}>{children}</div>};`,
    },
    ...[
      './text',
      '../content/text',
      '../theme',
      './icon',
      './icon-button',
      '../../../ui/content/text',
      '../../../ui/theme',
      '../../../ui/controls/icon',
      '../controls/icon',
      '../controls/icon-button',
    ].map((path) => ({ path, importer: mobile, contents: native })),
  ],
)
const browser = await chromium.launch()
try {
  for (const width of [320, 390, 840]) {
    const page = await browser.newPage({ viewport: { width, height: 800 } })
    page.setDefaultTimeout(5000)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setContent('<div id="app"></div>')
    await page.addScriptTag({ content: built.outputFiles[0].text })
    await page.getByRole('button', { name: 'Thread actions', exact: true }).click()
    assert.deepEqual(errors, [])
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Open next sheet', exact: true })
      .click()
    assert.equal(
      await page.evaluate(() => window.openedNext),
      undefined,
      'Wait for native dismissal before next action',
    )
    assert.equal(await page.getByRole('dialog').count(), 1)
    await page.evaluate(() => window.finishDismiss())
    assert.equal(await page.evaluate(() => window.openedNext), true)
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    assert.equal(await page.getByRole('dialog').count(), 0)
    for (const name of ['Save linked projects', 'Delete artifact', 'Try again'])
      assert.equal(await page.getByRole('button', { name, exact: true }).innerText(), name)
    assert.equal(await page.getByRole('button', { name: 'Explicit icon' }).innerText(), '')
    await page.getByRole('button', { name: 'Validate', exact: true }).click()
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Name')
    assert.match(
      await page
        .getByRole('textbox', { name: 'Name', exact: true })
        .getAttribute('aria-description'),
      /Name is required/,
    )
    const url = page.getByRole('textbox', { name: 'URL', exact: true })
    await url.fill('')
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    )
    assert.equal(
      await url.evaluate((el) => el === document.activeElement),
      true,
      'Live validation preserves the field being edited',
    )
    await page.getByRole('button', { name: 'Validate', exact: true }).click()
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Name')
    await page.getByRole('button', { name: /Checklist, 1 of 3 done/ }).click()
    for (const label of ['First, completed', 'Second, pending', 'Third, in progress'])
      assert.equal(await page.getByLabel(label, { exact: true }).count(), 1)
    await page.getByRole('button', { name: 'Filter Tests: 1 files', exact: true }).click()
    assert.equal(await page.getByLabel('Active file type').textContent(), 'tests')
    await page.getByRole('button', { name: 'Filter Tests: 1 files', exact: true }).click()
    assert.equal(await page.getByLabel('Active file type').textContent(), 'all')
    assert.equal(
      await page
        .getByRole('progressbar', { name: 'Checklist completion' })
        .getAttribute('aria-valuenow'),
      '1',
    )
    if (width === 390) {
      const require = createRequire(new URL('../apps/design-system/package.json', import.meta.url))
      await page.addScriptTag({
        path: require.resolve('axe-core', {
          paths: [dirname(require.resolve('@storybook/addon-a11y/package.json'))],
        }),
      })
      for (const palette of await page.evaluate(() => Object.keys(window.studioThemes)))
        for (const mode of ['light', 'dark'])
          for (const highContrast of [false, true]) {
            await page.evaluate(
              ({ palette, mode, highContrast }) => {
                const tokens = window.accessibleThemeColors(
                  window.studioThemes[palette][mode],
                  mode,
                  highContrast,
                )
                window.setMobileTheme({
                  mode,
                  highContrast,
                  colors: {
                    background: tokens.background,
                    surface: tokens.card,
                    text: tokens.foreground,
                    muted: tokens['muted-foreground'],
                    border: tokens.border,
                    selection: tokens.selection,
                  },
                  styles: {},
                })
              },
              { palette, mode, highContrast },
            )
            for (const name of ['All 5', 'Code 1', 'Tests 1', 'Mocks 1', 'Docs 1', 'Generated 1']) {
              await page.getByRole('button', { name, exact: true }).click()
              const violations = await page.evaluate(async () =>
                (
                  await axe.run('[aria-label="Change types"]', {
                    runOnly: { type: 'rule', values: ['color-contrast'] },
                  })
                ).violations.map((v) => ({
                  id: v.id,
                  nodes: v.nodes.map((n) => n.failureSummary),
                })),
              )
              assert.deepEqual(
                violations,
                [],
                `Mobile ${palette} ${mode} highContrast=${highContrast} ${name}`,
              )
            }
          }
    }
    await page.evaluate(() =>
      window.setDistribution({
        weightBy: 'lines',
        files: [
          { path: 'app.ts', additions: 10, deletions: 10 },
          { path: 'app.test.ts', additions: 90, deletions: 90 },
          { path: 'README.md' },
        ],
      }),
    )
    const lineBar = page.getByLabel('Changed line distribution', { exact: true })
    const codeSegment = lineBar.getByRole('button', {
      name: 'Filter Code: 1 files, 20 of 200 changed lines',
      exact: true,
    })
    const testSegment = lineBar.getByRole('button', {
      name: 'Filter Tests: 1 files, 180 of 200 changed lines',
      exact: true,
    })
    const codeBox = await codeSegment.boundingBox(),
      testBox = await testSegment.boundingBox()
    assert.ok(
      Math.abs(testBox.width / codeBox.width - 9) < 0.1,
      'Mobile segments reflect changed-line volume',
    )
    assert.ok(codeBox.height >= 44 && testBox.height >= 44)
    await testSegment.click()
    assert.equal(await page.getByLabel('Active file type').textContent(), 'tests')
    await page.getByRole('button', { name: 'Docs 1', exact: true }).click()
    assert.equal(await page.getByLabel('Active file type').textContent(), 'docs')
    await page.evaluate(() =>
      window.setDistribution({
        weightBy: 'lines',
        files: [
          { path: 'app.ts', additions: 10000 },
          { path: 'app.test.ts', additions: 1 },
        ],
      }),
    )
    const tinySegment = page.getByRole('button', {
      name: 'Filter Tests: 1 files, 1 of 10001 changed lines',
      exact: true,
    })
    assert.ok((await tinySegment.boundingBox()).width >= 8, 'Even a tiny category stays visible')
    await tinySegment.click()
    assert.equal(await page.getByLabel('Active file type').textContent(), 'tests')
    await page.evaluate(() =>
      window.setDistribution({ weightBy: 'lines', files: [{ path: 'README.md' }] }),
    )
    await page.getByLabel('File type distribution', { exact: true }).waitFor()
    const bounds = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      width: innerWidth,
    }))
    assert.ok(bounds.scroll <= bounds.width, `No horizontal overflow: ${JSON.stringify(bounds)}`)
    assert.deepEqual(errors, [])
    await page.close()
  }
  console.log(
    'Mobile controls: visible action labels, explicit icons, validation focus/hints, category filtering and checklist progress passed at 320, 390 and 840px (native boundary adapted).',
  )
} finally {
  await browser.close()
}
