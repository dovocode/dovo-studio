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
      contents: `import {createRoot} from 'react-dom/client';import {DiffView} from './src/tasks/preview/interactive-diff-view';import {DiffView as IosDiffView} from './src/tasks/preview/diff-view.ios';const root=createRoot(document.getElementById('app'));window.renderDiff=()=>root.render(<DiffView path="Card.tsx" patch={'diff --git a/file b/file\\n--- a/file\\n+++ b/file\\n@@ -1,2 +1,2 @@\\n-export const old = <span title="old" />;\\n+export const next = <span title="new" />;\\n context\\n'} focusedLine={1} onLinePress={(line,side)=>window.comment={line,side}} annotations={[{line:1,side:'additions',text:'Check persistence'}]}/>);window.renderNativeDiff=()=>root.render(<IosDiffView {...window.nativeOptions}/>);window.renderDiff();`,
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
      path: 'react-native-diffs',
      contents: 'export const DiffsView=({content})=><pre data-native-diff>{content}</pre>;',
    },
    {
      path: 'react-native',
      contents: `import {forwardRef,useImperativeHandle} from 'react';export const View=({children,style})=><div style={style}>{children}</div>;export const ScrollView=View;export const Pressable=({children,accessibilityLabel,onPress,disabled,style})=><button style={style} aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>{children}</button>;export const Switch=({value,onValueChange})=><input type="checkbox" checked={value} onChange={e=>onValueChange(e.target.checked)}/>;export const useWindowDimensions=()=>({width:360});export const FlatList=forwardRef(({data,renderItem,keyExtractor},ref)=>{useImperativeHandle(ref,()=>({scrollToIndex:input=>window.scrollTarget=input,scrollToOffset:()=>{}}));return <div>{data.map((item,index)=><div key={keyExtractor(item,index)}>{renderItem({item})}</div>)}</div>});`,
    },
    {
      path: '../../ui/content/text',
      importer: mobile,
      contents: `export const Text=({children,style})=><span style={{...style,...(typeof style?.lineHeight === "number" ? {lineHeight:style.lineHeight+"px"}: {})}}>{children}</span>;`,
    },
    {
      path: '../../ui/theme',
      importer: mobile,
      contents: `export const useTheme=()=>({colors:window.diffDark ? {selection:'#443',success:'#8ad5b0',error:'#ff7e97',background:'#16181c',surface:'#25282d',muted:'#a0a0a0',text:'#ededed',syntaxKeyword:'#7cc9ff',syntaxFunction:'#7cc9ff',warning:'#e7c681'} : {selection:'#ffc',success:'#080',error:'#800',background:'#fff',surface:'#eee',muted:'#666',text:'#111',syntaxKeyword:'#005cc5',syntaxFunction:'#005cc5',warning:'#946200'},styles:{},code:window.customCode});`,
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
  await page.getByRole('button', { name: 'Comment on new line 1' }).click()
  assert.deepEqual(await page.evaluate(() => window.comment), { line: 1, side: 'additions' })
  await page.getByRole('button', { name: 'Comment on old line 1' }).click()
  assert.deepEqual(await page.evaluate(() => window.comment), { line: 1, side: 'deletions' })
  assert.equal(await page.getByText('Check persistence', { exact: true }).isVisible(), true)
  await page.waitForFunction(() => window.scrollTarget)
  assert.equal(await page.evaluate(() => window.scrollTarget.index), 2)
  const keywords = page.getByText('export', { exact: true })
  assert.equal(await keywords.count(), 2)
  for (const keyword of await keywords.all())
    assert.equal(
      await keyword.evaluate((element) => getComputedStyle(element).color),
      'rgb(0, 92, 197)',
    )
  await page.getByRole('checkbox').check()
  assert.equal(await page.getByRole('checkbox').isChecked(), true)
  assert.equal(await page.getByText('Check persistence', { exact: true }).isVisible(), true)
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
  for (const keyword of await keywords.all())
    assert.equal(
      await keyword.evaluate((element) => getComputedStyle(element).color),
      'rgb(124, 201, 255)',
    )
  if (process.env.DOVO_REVIEW_SCREENSHOTS) {
    await mkdir(process.env.DOVO_REVIEW_SCREENSHOTS, { recursive: true })
    await page.addStyleTag({
      content:
        'body{margin:0;font:14px system-ui;background:#fff}body:before{content:"Mobile diff · sample test data";display:block;padding:16px;background:#eee;color:#555}button{border:0;background:transparent}span{display:inline-block}',
    })
    await page.screenshot({
      path: process.env.DOVO_REVIEW_SCREENSHOTS + '/review-mobile-diff.png',
      fullPage: true,
    })
  }
  // Verify the real iOS wrapper: its native renderer requires an explicit fence language.
  await page.evaluate(() => {
    window.nativeOptions = {
      path: 'Card.tsx',
      patch:
        '--- a/file\n+++ b/file\n@@ -1 +1 @@\n-export const old = "```";\n+export const next = "new";\n',
    }
    window.renderNativeDiff()
  })
  const native = page.locator('[data-native-diff]')
  await native.waitFor()
  assert.ok((await native.textContent()).startsWith('````diff tsx\n'))
  assert.ok((await native.textContent()).endsWith('\n````'))
  await page.evaluate(() => {
    window.nativeOptions = {
      path: 'new.tsx',
      previousPath: 'old.py',
      patch:
        '--- a/file\n+++ b/file\n@@ -1 +1 @@\n-def example(): pass\n+export const next = <span />;\n',
    }
    window.renderNativeDiff()
  })
  await native.waitFor({ state: 'detached' })
  assert.equal(await page.getByText('def', { exact: true }).count(), 1)
  assert.equal(await page.getByText('export', { exact: true }).count(), 1)
  await page.evaluate(() => {
    window.customCode = {
      custom: true,
      colors: {
        background: '#fefdfa',
        text: '#123456',
        gutter: '#777777',
        comment: '#888888',
        keyword: '#c02d69',
        function: '#112233',
        string: '#008855',
        number: '#885500',
        type: '#445566',
      },
    }
    window.nativeOptions = {
      path: 'file.ts',
      patch: '@@ -1 +1 @@\n-export const n = 1;\n+export const n = 2;\n',
    }
    window.renderNativeDiff()
  })
  await page.getByText('Wrap lines', { exact: true }).waitFor()
  assert.equal(await page.locator('[data-native-diff]').count(), 0)
  for (const keyword of await page.getByText('export', { exact: true }).all())
    assert.equal(
      await keyword.evaluate((element) => getComputedStyle(element).color),
      'rgb(192, 45, 105)',
    )
  assert.deepEqual(errors, [])
  console.log(
    'Mobile review diff: old/new syntax in both themes, wrapping, line comments, anchored annotations and finding navigation, iOS language fences and cross-language renames passed',
  )
} finally {
  await browser.close()
}
