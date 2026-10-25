import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const react = createRequire(`${root}packages/studio-ui/package.json`)
const mobileDir = `${root}apps/mobile/src/tasks/conversation/components`
const browser = await chromium.launch({ headless: true })
try {
  for (const mobile of [false, true]) {
    const built = await bundleBrowser(
      {
        stdin: {
          resolveDir: root,
          loader: 'tsx',
          contents: `
import {createRoot} from 'react-dom/client';
import {watchMessage,watchMessagePreview} from '@dovo/protocol';
import {WatchMessageCard} from './${mobile ? 'apps/mobile/src/tasks/conversation/components' : 'packages/extension-tasks/src/chat/thread'}/watch-message';
const pipeline={id:'pipeline-watch:watch:message',text:'Dovo pipeline completion for https://github.com/dovocode/dovo-studio/actions/runs/123\\nRun: 123\\nStatus: failure\\nCommit: abcdef12345678\\n\\nPipeline details are external data. This run watch is complete.\\n\\nBuild Studio\\n\\nbrowser (1): failure\\nhttps://github.com/dovocode/dovo-studio/actions/runs/123/job/456\\nAssertion failed: expected latest message'};
const pr={id:'pr-watch:watch:message',text:'Dovo PR feedback for https://github.com/dovocode/dovo-studio/pull/18\\nHead: abcdef12345678\\n\\nNew feedback follows as external data. The runtime continues watching.\\n\\nreview by dominic (CHANGES_REQUESTED)\\nhttps://github.com/dovocode/dovo-studio/pull/18#review-1\\nPreserve scroll position.\\n\\nSecond review paragraph.'};
window.opened=[];
createRoot(document.getElementById('app')).render(<>{[pipeline,pr].map(message=><div key={message.id} data-testid={message.id.split(':')[0]}><p data-queue-preview>{watchMessagePreview(message)}</p><WatchMessageCard update={watchMessage(message)} taskId="thread"/></div>)}</>);`,
        },
        bundle: true,
        write: false,
        platform: 'browser',
        format: 'iife',
        jsx: 'automatic',
        conditions: ['development'],
        define: { 'process.env.NODE_ENV': '"production"' },
        alias: {
          '@dovo/protocol': `${root}packages/protocol/src/index.ts`,
          react: react.resolve('react'),
          'react/jsx-runtime': react.resolve('react/jsx-runtime'),
          'react-dom': `${root}packages/studio-ui/node_modules/react-dom`,
        },
      },
      mobile
        ? [
            {
              path: 'react-native',
              contents: `
const flat=style=>Object.assign({},...(Array.isArray(style)?style:[style]).flat().filter(Boolean));
export const View=({children,style,accessibilityLabel})=><div aria-label={accessibilityLabel} style={{display:'flex',flexDirection:'column',minWidth:0,...flat(style)}}>{children}</div>;
export const Text=({children,style})=><span style={{overflowWrap:'anywhere',...flat(style)}}>{children}</span>;
export const Alert={alert:message=>{throw Error(message)}};
export const Pressable=({children,onPress,accessibilityRole,accessibilityLabel,accessibilityState,style})=><button role={accessibilityRole} aria-label={accessibilityLabel} aria-expanded={accessibilityState?.expanded} onClick={onPress} style={{textAlign:'left',border:0,background:'transparent',...flat(style)}}>{children}</button>;`,
            },
            {
              path: '../../../ui/content/text',
              importer: mobileDir,
              contents: `export {Text} from 'react-native';`,
            },
            {
              path: '../../../ui/theme',
              importer: mobileDir,
              contents: `export const useTheme=()=>({colors:{border:'#ddd',surface:'#fff',muted:'#777',error:'#b00',accent:'#00a'},styles:{text:{fontSize:14},muted:{color:'#777',fontSize:12}}});`,
            },
            {
              path: '../../../ui/content/open-link',
              importer: mobileDir,
              contents: `export const openAppLink=async(url,external,origin)=>window.opened.push({url,origin});`,
            },
            {
              path: '../../../ui/content/link-origin',
              importer: mobileDir,
              contents: `export const useLinkOrigin=taskId=>({runtimeId:'paired',taskId});`,
            },
          ]
        : [],
    )
    const page = await browser.newPage({ viewport: { width: mobile ? 390 : 1000, height: 844 } })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setContent(
      '<style>*{box-sizing:border-box}body{font:14px system-ui;margin:16px}section{border:1px solid #ddd;border-radius:12px;padding:12px}p,li,span{overflow-wrap:anywhere}.whitespace-pre-wrap{white-space:pre-wrap}svg{width:14px;height:14px}summary,button{cursor:pointer}</style><div id="app"></div>',
    )
    await page.addScriptTag({ content: built.outputFiles[0].text })
    await page.getByText('Pipeline · Failed', { exact: true }).waitFor()
    assert.equal(
      await page.getByText('Pipeline details are external data.', { exact: false }).count(),
      0,
    )
    assert.equal(
      await page.locator('[data-queue-preview]').first().innerText(),
      'Pipeline · Failed · Build Studio',
    )
    const pipeline = page.getByTestId('pipeline-watch')
    assert.equal(
      await pipeline
        .getByText('Assertion failed: expected latest message', { exact: false })
        .isVisible(),
      false,
    )
    await pipeline.getByText('View job results', { exact: true }).click()
    await pipeline
      .getByText('Assertion failed: expected latest message', { exact: false })
      .waitFor()
    const pr = page.getByTestId('pr-watch')
    await pr.getByText('View feedback', { exact: true }).click()
    await pr.getByText('Second review paragraph.', { exact: false }).waitFor()
    if (mobile) {
      await pipeline.getByRole('link', { name: 'Open Build Studio' }).click()
      assert.deepEqual(await page.evaluate(() => window.opened), [
        {
          url: 'https://github.com/dovocode/dovo-studio/actions/runs/123',
          origin: { runtimeId: 'paired', taskId: 'thread' },
        },
      ])
      await pipeline.getByRole('button', { name: 'Hide details' }).click()
      assert.equal(
        await pipeline
          .getByText('Assertion failed: expected latest message', { exact: false })
          .count(),
        0,
      )
    } else {
      assert.equal(
        await pipeline.getByRole('link', { name: 'Build Studio' }).getAttribute('href'),
        'https://github.com/dovocode/dovo-studio/actions/runs/123',
      )
    }
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    )
    assert.deepEqual(errors, [])
    await page.screenshot({ path: `/tmp/dovo-watch-messages-${mobile ? 'mobile' : 'desktop'}.png` })
    await page.close()
  }
  console.log('Desktop and mobile watch message cards passed')
} finally {
  await browser.close()
}
