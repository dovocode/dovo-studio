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
    const mocks = mobile
      ? [
          {
            path: 'react-native',
            contents: `export const Keyboard={dismiss:()=>{}};export const Alert={alert:(...args)=>window.alerts.push(args)};export const Pressable=({children,onPress,accessibilityRole,accessibilityLabel,style})=><button role={accessibilityRole} aria-label={accessibilityLabel} onClick={onPress} style={style}>{children}</button>;`,
          },
          {
            path: '../../../ui/content/text',
            importer: mobileDir,
            contents: `export const Text=({children})=><span>{children}</span>;`,
          },
          {
            path: '../../../ui/theme',
            importer: mobileDir,
            contents: `export const useTheme=()=>({colors:{accent:'blue'},styles:{muted:{color:'gray'}}});`,
          },
          {
            path: '../../../runtime/connection/provider',
            importer: mobileDir,
            contents: `export const useRuntime=()=>({activeId:'current-profile',profiles:[{id:'saved-owner',connection:{runtimeId:'owning-computer'}}],overviews:[]});`,
          },
          {
            path: '../../../ui/content/open-link',
            importer: mobileDir,
            contents: `export const openAppLink=async(url,external,origin)=>window.opened.push({url,origin});`,
          },
          {
            path: '../../../ui/content/link-origin',
            importer: mobileDir,
            contents: `export const useLinkOrigin=taskId=>({runtimeId:'current-profile',taskId});`,
          },
          {
            path: '../../../ui/layout/sheet',
            importer: mobileDir,
            contents: `export const useSheetNavigation=()=>navigate=>{window.dismissed=(window.dismissed??0)+1;navigate();};`,
          },
          {
            path: 'expo-router',
            contents: `export const router={push:target=>window.opened.push(target),canGoBack:()=>false};`,
          },
        ]
      : [
          {
            path: '@dovo/studio-core',
            contents: `export const useStudioHost=()=>({openThread:target=>window.opened.push(target),navigate:target=>window.opened.push(target)});export const useWorkspace=()=>({activeRuntimeId:'current-profile'});`,
          },
        ]
    const built = await bundleBrowser(
      {
        stdin: {
          resolveDir: root,
          loader: 'tsx',
          contents: `import{createRoot}from'react-dom/client';import{MessageSource}from'./${mobile ? 'apps/mobile/src/tasks/conversation/components' : 'packages/extension-tasks/src/chat/thread'}/message-source';window.opened=[];window.alerts=[];const sources=[{kind:'thread',runtimeId:'stale-profile',runtimeIdentity:'owning-computer',threadId:'reviewer',title:'Review',computerName:'Mac'},{kind:'thread',runtimeId:'local',threadId:'local-thread',title:'Local'},{kind:'automation',automationId:'flow',runId:'run',title:'Daily check'},{kind:'pipeline',url:'https://github.com/team/repo/actions/runs/1'},{kind:'user'}];createRoot(document.getElementById('app')).render(<>{sources.map((source,index)=><div key={index}><MessageSource source={source} taskId="thread"/></div>)}</>);`,
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
      mocks,
    )
    const page = await browser.newPage({ viewport: { width: mobile ? 390 : 1000, height: 844 } })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setContent('<div id="app"></div>')
    await page.addScriptTag({ content: built.outputFiles[0].text })
    await page.getByText('You', { exact: true }).waitFor()
    await page
      .getByRole(mobile ? 'link' : 'button', {
        name: mobile ? 'Open source: Review · Mac' : 'Open source thread: Review · Mac',
      })
      .click()
    await page
      .getByRole(mobile ? 'link' : 'button', {
        name: mobile ? 'Open source: Local' : 'Open source thread: Local',
      })
      .click()
    await page
      .getByRole(mobile ? 'link' : 'button', { name: 'Open source: Automation · Daily check' })
      .click()
    if (mobile) {
      await page.getByRole('link', { name: 'Open source: Pipeline watch' }).click()
      assert.deepEqual(await page.evaluate(() => window.opened), [
        {
          pathname: '/(tasks)/thread/[runtimeId]/[taskId]',
          params: {
            runtimeId: 'saved-owner',
            taskId: 'reviewer',
            runtimeIdentity: 'owning-computer',
          },
        },
        {
          pathname: '/(tasks)/thread/[runtimeId]/[taskId]',
          params: { runtimeId: 'current-profile', taskId: 'local-thread' },
        },
        {
          pathname: '/settings/automations/[runtimeId]/[automationId]',
          params: { runtimeId: 'current-profile', automationId: 'flow' },
        },
        {
          url: 'https://github.com/team/repo/actions/runs/1',
          origin: { runtimeId: 'current-profile', taskId: 'thread' },
        },
      ])
      assert.deepEqual(await page.evaluate(() => window.alerts), [])
      assert.equal(await page.evaluate(() => window.dismissed), 4)
    } else {
      assert.equal(
        await page.getByRole('link', { name: 'Open source: Pipeline watch' }).getAttribute('href'),
        'https://github.com/team/repo/actions/runs/1',
      )
      assert.deepEqual(await page.evaluate(() => window.opened), [
        {
          runtimeId: 'stale-profile',
          runtimeIdentity: 'owning-computer',
          threadId: 'reviewer',
          title: 'Review',
        },
        { runtimeId: 'current-profile', threadId: 'local-thread', title: 'Local' },
        { viewId: 'jobs', entityId: 'run' },
      ])
    }
    assert.deepEqual(errors, [])
    await page.close()
    console.log(`${mobile ? 'Mobile' : 'Desktop'} message provenance/source navigation passed.`)
  }
} finally {
  await browser.close()
}
