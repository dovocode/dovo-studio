import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const mobile = root + 'apps/mobile/src/runtime/connection/'
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
    import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
    import {useAccount} from '${root}packages/studio-core/src/use-account';
    import {ServiceUrlSettings as Desktop} from '${root}packages/extension-runtime/src/service-url-settings';
    import {ServiceUrlSettings as Mobile} from '${mobile}service-url-settings';
    const hosted='https://connect.dovo.studio',custom='https://connect.example.com';
    const tokens=new Map([[hosted,'a'.repeat(43)],[custom,'b'.repeat(43)]]);
    const storage={read:async origin=>tokens.get(origin)??null,write:async(token,origin)=>tokens.set(origin,token)};
    const open=async()=>{};
    window.calls=[];window.saves=[];window.services={connectOrigin:'',artifactsOrigin:'',ready:true};
    window.fetch=async(url,init)=>{
      const target=new URL(url),auth=new Headers(init.headers).get('Authorization');window.calls.push({url,auth});
      if(target.origin===hosted||target.origin===custom){
        if(auth!=='Bearer '+tokens.get(target.origin))throw Error('Credential sent to wrong Connect origin');
        if(target.pathname==='/v1/servers')return Response.json({user:{id:target.origin,name:target.origin},servers:[]});
        if(target.pathname==='/v1/artifacts/service')return Response.json({origin:'https://artifacts.example.com'});
        if(target.pathname==='/v1/artifacts/session')return Response.json({origin:'https://artifacts.example.com',token:'c'.repeat(43),expiresAt:Date.now()+60000});
      }
      if(url==='https://artifacts.example.com/v1/publications/sources'&&auth==='Bearer '+'c'.repeat(43))return Response.json({publications:[]});
      throw Error('Unexpected request '+url);
    };
    const app=createRoot(document.getElementById('app'));let kind,round=0;
    function App(){const account=useAccount(storage,open,window.services);return <><output aria-label="Account server">{account.directory?.user.id??'Signed out'}</output>{kind==='desktop'?<Desktop/>:<Mobile/>}</>}
    window.render=()=>flushSync(()=>app.render(<App key={round}/>));
    window.save=patch=>{window.services={...window.services,...patch};window.saves.push(patch);window.render()};
    window.reset=value=>{kind=value;round++;window.services={connectOrigin:'',artifactsOrigin:'',ready:true};window.calls=[];window.saves=[];window.render()};
    window.reset('desktop');
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
    },
    nodePaths: [root + 'packages/studio-ui/node_modules'],
  },
  [
    {
      path: '@dovo/studio-core',
      contents:
        'export const useAppPreferences=()=>window.services;export const updateAppPreferences=patch=>window.save(patch);',
    },
    {
      path: '@dovo/studio-ui',
      contents: `export {Button} from '${root}packages/studio-ui/src/components/ui/button';export {Input} from '${root}packages/studio-ui/src/components/ui/input';`,
    },
    {
      path: '../preferences/app-preferences',
      importer: mobile,
      contents:
        'export const useMobilePreferences=()=>window.services;export const updateMobilePreferences=patch=>window.save(patch);',
    },
    {
      path: 'react-native',
      contents:
        'export const View=({children,accessibilityLabel})=><section aria-label={accessibilityLabel}>{children}</section>;',
    },
    {
      path: '../../screens/settings-controls',
      importer: mobile,
      contents:
        'export const SettingsField=({label,value,onChangeText})=><label>{label}<input value={value} onChange={e=>onChangeText(e.target.value)}/></label>;export const SettingsAction=({label,disabled,onPress})=><button disabled={disabled} onClick={onPress}>{label}</button>;',
    },
    {
      path: '../../screens/settings-theme',
      importer: mobile,
      contents: 'export const useSettingsTheme=()=>({styles:{}});',
    },
    {
      path: '../../ui/content/text',
      importer: mobile,
      contents:
        'export const Text=({children,accessibilityRole})=><span role={accessibilityRole}>{children}</span>;',
    },
  ],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  for (const kind of ['desktop', 'mobile']) {
    await page.evaluate((kind) => window.reset(kind), kind)
    const account = page.getByLabel('Account server')
    await account.filter({ hasText: 'https://connect.dovo.studio' }).waitFor()
    const connect = page.getByLabel('Dovo Connect URL', { exact: true })
    const artifacts = page.getByLabel('Dovo Artifacts URL', { exact: true })
    const save = page.getByRole('button', { name: 'Save service URLs', exact: true })
    assert.equal(await save.isDisabled(), true)
    await connect.fill('https://user:secret@connect.example.com/path')
    await save.click()
    await page.getByRole('alert').waitFor()
    assert.equal(await page.evaluate(() => window.saves.length), 0)
    await connect.fill(' https://CONNECT.example.com/ ')
    await artifacts.fill('https://artifacts.example.com/')
    await save.click()
    await account.filter({ hasText: 'https://connect.example.com' }).waitFor()
    assert.deepEqual(await page.evaluate(() => window.saves.at(-1)), {
      connectOrigin: 'https://connect.example.com',
      artifactsOrigin: 'https://artifacts.example.com',
    })
    await page.evaluate(() => window.render())
    assert.equal(await connect.inputValue(), 'https://connect.example.com')
    await page.getByRole('button', { name: 'Use defaults', exact: true }).click()
    await save.click()
    await account.filter({ hasText: 'https://connect.dovo.studio' }).waitFor()
    assert.deepEqual(await page.evaluate(() => window.saves.at(-1)), {
      connectOrigin: '',
      artifactsOrigin: '',
    })
    assert.equal(await connect.inputValue(), '')
    assert.equal(await artifacts.inputValue(), '')
    assert.equal(
      (await page.evaluate(() => window.calls)).some(
        (call) =>
          call.url.startsWith('https://connect.example.com') &&
          call.auth === 'Bearer ' + 'a'.repeat(43),
      ),
      false,
    )
  }
  assert.deepEqual(errors, [])
  console.log(
    'Desktop/mobile service URLs: validated saves, defaults, retained values and origin-isolated account sessions passed.',
  )
} finally {
  await browser.close()
}
