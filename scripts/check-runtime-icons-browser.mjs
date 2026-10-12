import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
import {useState} from 'react';import {createRoot} from 'react-dom/client';import {Effect} from 'effect';
import {RuntimeIconSettings as DesktopSettings} from './packages/extension-runtime/src/runtime-icon-settings.tsx';
import {RuntimeIconSettings as MobileSettings} from './apps/mobile/src/runtime/connection/runtime-icon-settings.tsx';
import {RuntimeIcon} from '@dovo/studio-ui/runtime-icon';
window.saves=[];window.icon='desktop';window.connected=true;window.supported=true;
function App(){const [,refresh]=useState(0);window.refresh=()=>refresh(value=>value+1);
const snapshot=window.supported?{runtimeIcon:window.icon}:{};const source={profile:{id:'remote-computer'},connected:window.connected,snapshot};
const save=async(profile,path,input)=>{window.saves.push({id:profile.id,path,input});if(window.fail)throw Error('Runtime unavailable');window.icon=input.runtimeIcon;return {runtimeIcon:window.icon}};
window.workspace={readRuntime:save,refreshRuntime:async()=>window.refresh()};
window.runtime={connected:window.connected,snapshot,callEffect:(path,input)=>Effect.tryPromise({try:async()=>{await save(source.profile,path,input);window.refresh()},catch:error=>error})};
return <><section data-client="desktop"><DesktopSettings source={source}/></section><section data-client="mobile"><MobileSettings/></section><RuntimeIcon icon={snapshot.runtimeIcon}/></>}
createRoot(document.getElementById('app')).render(<App/>);`,
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    nodePaths: [root + 'packages/studio-ui/node_modules', root + 'apps/mobile/node_modules'],
    alias: {
      '@dovo/protocol': root + 'packages/protocol/src/index.ts',
      '@dovo/studio-ui/runtime-icon': root + 'packages/studio-ui/src/runtime-icon.tsx',
    },
  },
  [
    { path: '@dovo/studio-core', contents: 'export const useWorkspace=()=>window.workspace;' },
    {
      path: '@dovo/studio-core/state',
      contents: "export {useState as useApplicationState} from 'react';",
    },
    {
      path: '@dovo/studio-ui',
      contents:
        'export const Button=({children,...props})=><button {...props}>{children}</button>;',
    },
    {
      path: './provider',
      importer: root + 'apps/mobile/src/runtime/connection/',
      contents: 'export const useRuntime=()=>window.runtime;',
    },
    {
      path: '../../runtime/state/application-state',
      importer: root + 'apps/mobile/src/ui/controls/',
      contents: "export {useState as useApplicationState} from 'react';",
    },
    {
      path: '../../ui/theme',
      importer: root + 'apps/mobile/src/runtime/connection/',
      contents: 'export const useTheme=()=>({styles:{},colors:{}});',
    },
    {
      path: '../../ui/content/text',
      importer: root + 'apps/mobile/src/runtime/connection/',
      contents:
        'export const Text=({children,accessibilityRole})=><span role={accessibilityRole}>{children}</span>;',
    },
    {
      path: '../controls/icon',
      importer: root + 'apps/mobile/src/ui/content/',
      contents: 'export const Icon=({name})=><span data-native-icon={name}/>;',
    },
    {
      path: 'react-native',
      contents:
        'export const View=({children})=><div>{children}</div>;export const Pressable=({children,onPress,disabled,accessibilityLabel,accessibilityState})=><button aria-label={accessibilityLabel} aria-pressed={accessibilityState?.selected} onClick={onPress} disabled={disabled}>{children}</button>;',
    },
  ],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage(),
    errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const desktop = page.locator('[data-client="desktop"]'),
    mobile = page.locator('[data-client="mobile"]')
  for (const label of ['Desktop', 'Laptop', 'Server', 'Cloud', 'CPU', 'Terminal']) {
    await desktop.getByRole('button', { name: label, exact: true }).click()
    await page.waitForFunction(() => window.icon === window.saves.at(-1).input.runtimeIcon)
    await mobile.getByRole('button', { name: label, exact: true, pressed: true }).waitFor()
  }
  await mobile.getByRole('button', { name: 'Server', exact: true }).click()
  await desktop.getByRole('button', { name: 'Server', exact: true, pressed: true }).waitFor()
  assert.equal(
    await desktop
      .getByRole('button', { name: 'Server', exact: true })
      .locator('svg')
      .getAttribute('data-runtime-icon'),
    'server',
  )
  assert.equal(
    await mobile
      .getByRole('button', { name: 'Server', exact: true })
      .locator('[data-native-icon]')
      .getAttribute('data-native-icon'),
    'server',
  )
  assert.equal(
    await page.evaluate(() =>
      window.saves.every(
        (save) => save.id === 'remote-computer' && save.path === '/api/runtime/preferences/save',
      ),
    ),
    true,
  )
  await page.evaluate(() => {
    window.fail = true
  })
  await desktop.getByRole('button', { name: 'Cloud', exact: true }).click()
  await desktop.getByRole('alert').getByText('Runtime unavailable', { exact: true }).waitFor()
  await mobile.getByRole('button', { name: 'Laptop', exact: true }).click()
  await mobile.getByRole('alert').getByText('Runtime unavailable', { exact: true }).waitFor()
  const count = await page.evaluate(() => window.saves.length)
  await page.evaluate(() => {
    window.connected = false
    window.refresh()
  })
  await desktop
    .getByRole('button', { name: 'Server', exact: true })
    .and(desktop.locator(':disabled'))
    .waitFor()
  await mobile
    .getByRole('button', { name: 'Server', exact: true })
    .and(mobile.locator(':disabled'))
    .waitFor()
  assert.equal(
    await desktop.getByRole('button', { name: 'Server', exact: true }).isDisabled(),
    true,
  )
  assert.equal(await mobile.getByRole('button', { name: 'Server', exact: true }).isDisabled(), true)
  await page.evaluate(() => {
    window.connected = true
    window.supported = false
    window.refresh()
  })
  for (const client of [desktop, mobile]) {
    await client.getByText('Update this runtime to customize its icon.', { exact: true }).waitFor()
    assert.equal(
      await client.getByRole('button', { name: 'Server', exact: true }).isDisabled(),
      true,
    )
  }
  assert.equal(await page.evaluate(() => window.saves.length), count)
  assert.deepEqual(errors, [])
  console.log(
    'Runtime icons: desktop and mobile choices, shared selection, target runtime, errors, offline and older runtime behavior pass.',
  )
} finally {
  await browser.close()
}
