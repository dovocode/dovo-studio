import assert from 'node:assert/strict'
import { bundleBrowser, chromium } from './browser/harness.mjs'
const root = new URL('../', import.meta.url).pathname.replace(/\/$/, '')
const mobile = root + '/apps/mobile'
const themeStub = `import {useMemo} from 'react';
        export const useTheme=()=>{
          const dark=window.diffDark;const custom=window.customCode;
          const colors=dark?{selection:'#443',success:'#8ad5b0',error:'#ff7e97',background:'#16181c',surface:'#25282d',muted:'#a0a0a0',text:'#ededed'}:{selection:'#ffc',success:'#080',error:'#800',background:'#fff',surface:'#eee',muted:'#666',text:'#111'};
          const syntaxTheme=useMemo(()=>({name:custom?'custom':dark?'dark':'light',type:dark?'dark':'light',fg:custom?.colors.text??colors.text,bg:custom?.colors.background??colors.background,tokenColors:[{scope:['keyword','storage'],settings:{foreground:custom?'#c02d69':dark?'#7cc9ff':'#005cc5'}},{scope:'comment',settings:{foreground:'#777777',fontStyle:'italic'}},{scope:'entity.name.type',settings:{foreground:'#445566',fontStyle:'bold underline'}}]}),[dark,custom]);
          return {colors,styles:{muted:{color:colors.muted}},syntaxTheme,code:custom};
        };`
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: mobile,
      loader: 'tsx',
      contents: `import {createRoot} from 'react-dom/client';
        import {DiffView} from './src/tasks/preview/diff-view.ios';
        import {CodeBlock} from './src/ui/content/code-block';
        const root=createRoot(document.getElementById('app'));
        window.renderDiff=()=>root.render(<DiffView {...window.diffOptions}/>);
        window.renderCode=()=>root.render(<CodeBlock content={window.source} language={window.language}/>);
        window.diffOptions={path:'Card.tsx',patch:'--- a/file\\n+++ b/file\\n@@ -1,2 +1,2 @@\\n-export const old = <span title="old" />;\\n+export const next = <span title="new" />;\\n context\\n',focusedLine:1,onLinePress:(line,side)=>window.comment={line,side},annotations:[{line:1,side:'additions',text:'Check persistence'}]};
        window.renderDiff();`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    jsx: 'automatic',
    platform: 'browser',
    alias: { react: mobile + '/node_modules/react' },
    nodePaths: [mobile + '/node_modules', root + '/node_modules'],
  },
  [
    {
      path: './syntax-engine',
      importer: mobile,
      // Only the engine is substituted: renderers, hook, grammar loading and tokenization are real.
      contents: `import {createSyntaxHighlighter} from './src/ui/content/syntax-highlighter';
        import {createOnigurumaEngine} from '@shikijs/engine-oniguruma';
        const prepare=createSyntaxHighlighter(()=>createOnigurumaEngine(import('@shikijs/engine-oniguruma/wasm-inlined')));
        export async function prepareSyntax(...args){
          if(window.failSyntax) throw new Error('Test: engine unavailable');
          if(window.delaySyntax) await new Promise(resolve=>window.resolveSyntax=resolve);
          return prepare(...args);
        }`,
    },
    {
      path: 'react-native',
      contents: `import {forwardRef,useImperativeHandle} from 'react';
        export const View=({children,style,...props})=><div style={style} role={props.accessibilityRole}>{children}</div>;
        export const ScrollView=({children,contentContainerStyle,style})=><div style={style}><div style={contentContainerStyle}>{children}</div></div>;
        export const Pressable=({children,accessibilityLabel,onPress,disabled,style})=><button style={style} aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>{children}</button>;
        export const Switch=({value,onValueChange})=><input type="checkbox" checked={value} onChange={e=>onValueChange(e.target.checked)}/>;
        export const Platform={OS:'ios'};export const useWindowDimensions=()=>({width:360,fontScale:window.diffFontScale??1});
        export const FlatList=forwardRef(({data,renderItem,keyExtractor,style,contentContainerStyle,scrollIndicatorInsets},ref)=>{window.diffListWidth=style.width;window.diffBottomPadding=contentContainerStyle.paddingBottom;window.diffIndicatorBottom=scrollIndicatorInsets.bottom;useImperativeHandle(ref,()=>({scrollToIndex:input=>window.scrollTarget=input,scrollToOffset:()=>{}}));return <div>{data.map((item,index)=><div key={keyExtractor(item,index)}>{renderItem({item})}</div>)}</div>});`,
    },
    {
      path: 'react-native-safe-area-context',
      contents: 'export const useSafeAreaInsets=()=>({top:59,bottom:34});',
    },
    {
      path: './text',
      importer: mobile + '/src/ui/content',
      contents: `export const Text=({children,style,accessibilityRole})=><span role={accessibilityRole} style={{...style,...(typeof style?.lineHeight==='number'?{lineHeight:style.lineHeight+'px'}:{})}}>{children}</span>;`,
    },
    {
      path: '../../ui/content/text',
      importer: mobile,
      contents: `export const Text=({children,style,accessibilityRole})=><span role={accessibilityRole} style={{...style,...(typeof style?.lineHeight==='number'?{lineHeight:style.lineHeight+'px'}:{})}}>{children}</span>;`,
    },
    {
      path: '../../runtime/preferences/app-preferences',
      importer: mobile,
      contents: 'export const carZoom=1.3;export const useCarMode=()=>false;',
    },
    {
      path: '../../ui/theme',
      importer: mobile,
      contents: themeStub,
    },
    {
      path: '../theme',
      importer: mobile + '/src/ui/content',
      contents: themeStub,
    },
  ],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 360, height: 740 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const keywords = page.getByText('export', { exact: true })
  await keywords.first().waitFor()
  assert.equal(await keywords.count(), 2)
  for (const keyword of await keywords.all())
    assert.equal(
      await keyword.evaluate((element) => getComputedStyle(element).color),
      'rgb(0, 92, 197)',
    )
  await page.getByRole('button', { name: 'Comment on new line 1' }).click()
  assert.deepEqual(await page.evaluate(() => window.comment), { line: 1, side: 'additions' })
  await page.getByRole('button', { name: 'Comment on old line 1' }).click()
  assert.deepEqual(await page.evaluate(() => window.comment), { line: 1, side: 'deletions' })
  assert.equal(await page.getByText('Check persistence', { exact: true }).isVisible(), true)
  await page.waitForFunction(() => window.scrollTarget)
  assert.equal(await page.evaluate(() => window.scrollTarget.index), 2)
  assert.equal(await page.evaluate(() => window.diffBottomPadding), 46)
  assert.equal(await page.evaluate(() => window.diffIndicatorBottom), 34)
  // A containing toolbar owns wrapping without leaving a duplicate row above the code.
  await page.evaluate(() => {
    window.diffOptions.wrapLines = true
    window.renderDiff()
  })
  await page.waitForFunction(() => window.diffListWidth === '100%')
  assert.equal(await page.getByRole('checkbox').count(), 0)
  await page.evaluate(() => {
    window.diffOptions.wrapLines = false
    window.renderDiff()
  })
  await page.waitForFunction(() => typeof window.diffListWidth === 'number')
  assert.equal(await page.getByRole('checkbox').count(), 0)
  await page.evaluate(() => {
    delete window.diffOptions.wrapLines
    window.renderDiff()
  })
  await page.getByRole('checkbox').waitFor()
  const originalWidth = await page.evaluate(() => window.diffListWidth)
  await page.evaluate(() => {
    window.diffFontScale = 2
    window.renderDiff()
  })
  await page.waitForFunction((width) => window.diffListWidth === width * 2, originalWidth)
  assert.equal(
    await keywords
      .first()
      .evaluate((element) => getComputedStyle(element.parentElement).fontFamily),
    'Menlo',
  )
  await page.getByRole('checkbox').check()
  assert.equal(await page.getByRole('checkbox').isChecked(), true)
  await page.evaluate(() => {
    window.diffDark = true
    window.renderDiff()
  })
  await page.waitForFunction(() =>
    [...document.querySelectorAll('span')].some(
      (element) =>
        element.textContent === 'export' &&
        getComputedStyle(element).color === 'rgb(124, 201, 255)',
    ),
  )
  assert.equal(await page.getByRole('checkbox').isChecked(), true)
  assert.equal(await page.getByText('Check persistence', { exact: true }).isVisible(), true)

  await page.evaluate(() => {
    window.diffOptions = {
      path: 'new.tsx',
      previousPath: 'old.py',
      patch:
        '--- a/file\n+++ b/file\n@@ -1 +1 @@\n-def example(): pass\n+export const next = <span />;\n',
    }
    window.renderDiff()
  })
  await page.getByText('def', { exact: true }).waitFor()
  assert.equal(await keywords.count(), 1)
  await page.evaluate(() => {
    window.customCode = {
      colors: {
        background: '#fefdfa',
        text: '#123456',
        gutter: '#777777',
        selection: '#ffeebb',
        addition: '#008855',
        deletion: '#cc3344',
      },
    }
    window.diffOptions = {
      path: 'file.ts',
      patch: '@@ -1 +1 @@\n-export const n = 1;\n+export const n = 2;\n',
    }
    window.renderDiff()
  })
  await page.waitForFunction(() =>
    [...document.querySelectorAll('span')].some(
      (element) =>
        element.textContent === 'export' && getComputedStyle(element).color === 'rgb(192, 45, 105)',
    ),
  )
  for (const [appDark, background, gutter] of [
    [true, '#fefdfa', '#777777'],
    [false, '#16181c', '#bbbbbb'],
  ]) {
    await page.evaluate(
      ({ appDark, background, gutter }) => {
        window.diffDark = appDark
        window.customCode = { colors: { ...window.customCode.colors, background, gutter } }
        window.renderDiff()
      },
      { appDark, background, gutter },
    )
    const expected = appDark ? 'rgb(119, 119, 119)' : 'rgb(187, 187, 187)'
    const lineNumbers = page.getByRole('button', { name: /Comment on (old|new) line 1/ })
    await page.waitForFunction(
      (color) =>
        [...document.querySelectorAll('button[aria-label^="Comment on"] span')].every(
          (element) => getComputedStyle(element).color === color,
        ),
      expected,
    )
    assert.equal(await lineNumbers.count(), 2)
  }

  // The ordinary source viewer uses the same loaded grammar and complete token styles.
  await page.evaluate(() => {
    window.source = '// Héllo 👋\r\n\r\n\tclass Example {}\r\n'
    window.language = 'ts'
    window.renderCode()
  })
  const name = page.getByText('Example', { exact: true })
  await name.waitFor()
  assert.deepEqual(
    await name.evaluate((element) => ({
      weight: getComputedStyle(element).fontWeight,
      decoration: getComputedStyle(element).textDecorationLine,
    })),
    { weight: '700', decoration: 'underline' },
  )
  assert.equal(
    await page
      .getByText('// Héllo 👋', { exact: true })
      .evaluate((element) => getComputedStyle(element).fontStyle),
    'italic',
  )
  const codeText = await name.evaluate((element) => element.parentElement.parentElement.textContent)
  assert.equal(codeText, '// Héllo 👋\r\n\r\n\tclass Example {}\r\n')
  await page.evaluate(() => {
    window.language = 'unknown'
    window.source = '<script>literal & source</script>'
    window.renderCode()
  })
  await page.getByText('<script>literal & source</script>', { exact: true }).waitFor()
  assert.equal(await name.count(), 0)

  // Old asynchronous results must not replace a newly selected file.
  await page.evaluate(() => {
    window.delaySyntax = true
    window.source = 'const oldFile = 1;'
    window.language = 'ts'
    window.renderCode()
  })
  await page.waitForFunction(() => window.resolveSyntax)
  await page.evaluate(() => {
    window.language = 'unknown'
    window.source = 'new file'
    window.renderCode()
  })
  await page.getByText('new file', { exact: true }).waitFor()
  await page.evaluate(() => {
    window.delaySyntax = false
    window.resolveSyntax()
  })
  assert.equal(await page.getByText('new file', { exact: true }).isVisible(), true)
  await page.evaluate(() => {
    window.failSyntax = true
    window.language = 'ts'
    window.source = 'const readable = true;'
    window.renderCode()
  })
  await page.getByRole('alert').waitFor()
  assert.equal(await page.getByText('const readable = true;', { exact: true }).isVisible(), true)
  assert.deepEqual(errors, [])
  console.log(
    'Mobile diff/code: real Shiki tokens, full themes/styles, Unicode/CRLF, wrapping, comments, annotations, scaling, renames, stale results and readable failure fallback passed.',
  )
} finally {
  await browser.close()
}
