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
      contents: `import {createRoot} from 'react-dom/client';import {DiffView} from './src/tasks/preview/interactive-diff-view';createRoot(document.getElementById('app')).render(<DiffView patch={'diff --git a/a.ts b/a.ts\\n--- a/a.ts\\n+++ b/a.ts\\n@@ -1,2 +1,2 @@\\n-old\\n+new\\n context\\n'} focusedLine={1} onLinePress={(line,side)=>window.comment={line,side}} annotations={[{line:1,side:'additions',text:'Check persistence'}]}/>);`,
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
      contents: `export const useTheme=()=>({colors:{selection:'#ffc',success:'#080',error:'#800',background:'#fff',surface:'#eee',muted:'#666',text:'#111'},styles:{}});`,
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
  assert.deepEqual(errors, [])
  console.log(
    'Mobile review diff: old/new line comments, anchored annotations and finding navigation passed',
  )
} finally {
  await browser.close()
}
