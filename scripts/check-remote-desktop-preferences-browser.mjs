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
        import {createRoot} from 'react-dom/client';
        import {Effect} from 'effect';
        import {decode,runtimePreferencesSchema} from '@dovo/protocol';
        import RemoteDesktop from '${root}packages/extension-runtime/src/remote-desktop-view.tsx';
        window.requests=[];window.navigation=[];
        window.preferences=decode(runtimePreferencesSchema,{});
        window.runtime={connected:true,snapshot:{},request:()=>Promise.reject(new Error('Unexpected viewer request')),requestEffect:(path,input)=>{
          window.requests.push({path,input});
          if(path==='/api/runtime/preferences/save')Object.assign(window.preferences,input);
          return Effect.succeed({...window.preferences});
        }};
        const app=createRoot(document.getElementById('app'));
        window.show=enabled=>{window.runtime.snapshot=enabled===null?{}:{remoteDesktopEnabled:enabled};window.preferences.enableRemoteDesktop=enabled===true;app.render(<RemoteDesktop key={String(enabled)}/>)};
      `,
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    alias: {
      react: root + 'packages/studio-ui/node_modules/react',
      '@dovo/protocol': root + 'packages/protocol/src/index.ts',
      '@dovo/client-runtime': root + 'packages/client-runtime/src/index.ts',
    },
    nodePaths: [root + 'packages/studio-ui/node_modules'],
  },
  [
    {
      path: '@dovo/studio-core',
      contents: `export {clientTaskScope} from '@dovo/client-runtime';export const useWorkspace=()=>window.runtime;export const useStudioHost=()=>({navigate:target=>window.navigation.push(target)});export const useSettingsDraft=()=>{};`,
    },
    {
      path: '@dovo/studio-core/state',
      contents: `export {useState as useApplicationState} from 'react';`,
    },
    {
      path: '@dovo/studio-ui',
      contents: `import {Switch} from '${root}packages/studio-ui/src/components/ui/switch.tsx';export const Input=props=><input {...props}/>;export const Button=({children,variant,size,...props})=><button {...props}>{children}</button>;export const Select=({children})=>children;export const SelectContent=Select;export const SelectItem=Select;export const SelectTrigger=Select;export const SelectValue=()=>null;export const SettingsGroup=({title,description,children})=><section><h2>{title}</h2><p>{description}</p>{children}</section>;export const SettingRow=({label,children})=><div>{label}{children}</div>;export const Toggle=({label,checked,disabled,onChange})=><Switch aria-label={label} checked={checked} disabled={disabled} onCheckedChange={onChange}/>;`,
    },
    {
      path: './host-page',
      importer: root + 'packages/extension-runtime/src/',
      contents: `export const HostPage=({title,description,children})=><main><h1>{title}</h1><p>{description}</p>{children}</main>;`,
    },
    {
      path: './desktop-viewer',
      importer: root + 'packages/extension-runtime/src/',
      contents: `export const DesktopViewer=({enabled})=><div data-testid="desktop-viewer" data-enabled={String(enabled)}>Supported desktop viewer</div>;`,
    },
  ],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.evaluate(() => window.show(null))
  const notice = page.getByRole('status')
  await notice
    .getByText('Remote desktop requires a newer runtime. Update this computer to use it.', {
      exact: true,
    })
    .waitFor()
  assert.equal(await page.getByRole('status').count(), 1)
  assert.equal(await page.getByRole('switch').count(), 0)
  assert.equal(await page.getByTestId('desktop-viewer').count(), 0)
  assert.deepEqual(await page.evaluate(() => window.requests), [])
  await notice.getByRole('button', { name: 'Open Devices & runtime', exact: true }).click()
  assert.deepEqual(await page.evaluate(() => window.navigation), [{ viewId: 'runtime' }])
  for (const enabled of [false, true]) {
    await page.evaluate((enabled) => window.show(enabled), enabled)
    const toggle = page.getByRole('switch', { name: 'Enable remote desktop', exact: true })
    await toggle.waitFor()
    await page.waitForFunction(() => !document.querySelector('[role="switch"]').disabled)
    assert.equal(await toggle.isChecked(), enabled)
    assert.equal(
      await page.getByTestId('desktop-viewer').getAttribute('data-enabled'),
      String(enabled),
    )
    assert.equal(
      await page.getByText('Remote desktop requires a newer runtime.', { exact: false }).count(),
      0,
    )
    await toggle.click()
    await page.waitForFunction(() => !document.querySelector('[role="switch"]').disabled)
    assert.equal(await toggle.isChecked(), !enabled)
    assert.deepEqual(await page.evaluate(() => window.requests.at(-1)), {
      path: '/api/runtime/preferences/save',
      input: { enableRemoteDesktop: !enabled },
    })
  }
  await page.evaluate(() => window.show(null))
  await notice.waitFor()
  assert.equal(await page.getByRole('switch').count(), 0)
  assert.equal(await page.getByTestId('desktop-viewer').count(), 0)
  assert.deepEqual(errors, [])
  console.log(
    'Remote desktop capability checks passed: one legacy update action, supported settings and viewer retained.',
  )
} finally {
  await browser.close()
}
