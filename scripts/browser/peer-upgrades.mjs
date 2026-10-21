import assert from 'node:assert/strict'
import { bundleBrowser } from './harness.mjs'

export async function checkPeerUpgrades(browser, root) {
  const mobile = root + '/apps/mobile/src/runtime/connection/'
  const built = await bundleBrowser(
    {
      stdin: {
        contents: `
      import {createRoot} from 'react-dom/client';
      import {Effect} from 'effect';
      import {DeviceManager} from '${root}/packages/extension-runtime/src/device-manager.tsx';
      import {UpgradeInternet} from '${mobile}upgrade-internet.tsx';
      window.calls=[];window.upgrades=[];window.cancelled=[];
      window.profile={id:'existing-profile',name:'Server',connection:{address:'http://server.lan:8787',token:'existing-private-device-token'}};
      window.dispatch=async(path,input)=>{
        window.calls.push({path,input});
        if(path.endsWith('/request')){
          window.pending={id:'upgrade-'+window.calls.length,deviceId:'phone',name:'My phone',status:'pending',expiresAt:new Date(Date.now()+120000).toISOString(),...input};
          window.render();return window.pending;
        }
        if(path.endsWith('/claim')){
          if(window.holdClaim)return new Promise(resolve=>window.releaseClaim=()=>resolve({...window.pending,status:'approved',peer:{origin:'https://connect.example',secret:'a'.repeat(64)}}));
          return {...window.pending,...(window.pending.status==='approved'?{peer:{origin:'https://connect.example',secret:'a'.repeat(64),...(window.pending.relay?{relay:window.pending.relay}:{})}}:{})};
        }
        if(path.endsWith('/approve')){window.pending.status=input.allow?'approved':'denied';window.render();return {ok:true}}
        if(path.endsWith('/cancel')){window.cancelled.push(input.id);if(window.pending?.id===input.id)window.pending.status='denied';window.render();return {ok:true}}
        throw Error('Unexpected request '+path);
      };
      window.desktop=()=>({snapshot:{owner:true,devices:[{id:'phone',name:'My phone'}],pendingDevices:[],pendingPeerUpgrades:window.pending?.status==='pending'?[window.pending]:[]},request:window.dispatch,connected:true,runtimeRegistry:{profiles:[]},refreshRuntime:async()=>{window.render()}});
      window.runtime={connected:true,upgradeInternetEffect:(id,previous,peer)=>window.failProbe?Effect.fail(new Error('Internet path blocked; original connection kept')):Effect.sync(()=>{window.upgrades.push({id,previous,peer});window.finished=true;window.render()})};
      const app=createRoot(document.getElementById('app'));
      window.reset=()=>{window.round=(window.round??0)+1;window.pending=null;window.finished=false;window.failProbe=false;window.holdClaim=false;window.hidden=false;window.render()};
      window.render=()=>app.render(<><DeviceManager/>{window.finished?<p>Internet enabled</p>:!window.hidden&&<UpgradeInternet key={window.round} profile={window.profile}/>}</>);
      window.reset();`,
        loader: 'tsx',
        resolveDir: root,
      },
      bundle: true,
      write: false,
      format: 'iife',
      platform: 'browser',
      jsx: 'automatic',
      conditions: ['development'],
      alias: {
        react: root + '/packages/studio-ui/node_modules/react',
        'react-dom': root + '/packages/studio-ui/node_modules/react-dom',
      },
      nodePaths: [root + '/packages/studio-ui/node_modules'],
    },
    [
      {
        path: '@dovo/protocol',
        contents: `export * from '${root}/packages/protocol/src/index.ts';import {Effect} from 'effect';export const runtimeRequest=(connection,address,path,input)=>window.dispatch(path,input);export const runtimeRequestEffect=(...args)=>Effect.tryPromise({try:()=>window.dispatch(args[2],args[3]),catch:error=>error});`,
      },
      {
        path: '@dovo/studio-core',
        contents: `export {responses} from '${root}/packages/protocol/src/index.ts';export {useAccount} from '${root}/packages/studio-core/src/use-account';export const useStudioHost=()=>({});export const useWorkspace=()=>window.desktop();`,
      },
      {
        path: '@dovo/studio-core/state',
        contents: `import {useState} from 'react';export const useApplicationState=useState;`,
      },
      {
        path: '@dovo/studio-ui',
        contents: `export const Button=({children,onClick,disabled,...props})=><button aria-label={props['aria-label']} onClick={onClick} disabled={disabled}>{children}</button>;export const Input=props=><input {...props}/>;export const Textarea=props=><textarea {...props}/>;`,
      },
      {
        path: './desktop-network',
        importer: root + '/packages/extension-runtime/src/device-manager.tsx',
        contents: 'export const DesktopNetwork=()=>null;',
      },
      {
        path: './pairing-guide',
        importer: root + '/packages/extension-runtime/src/device-manager.tsx',
        contents: 'export const PairingGuide=()=>null;',
      },
      {
        path: './provider',
        importer: mobile,
        contents: 'export const useRuntime=()=>window.runtime;',
      },
      {
        path: '../../runtime/state/application-state',
        importer: root + '/apps/mobile/src/ui/controls/use-action.ts',
        contents: `import {useState} from 'react';export const useApplicationState=useState;`,
      },
      {
        path: 'react-native',
        contents: `export const AppState={currentState:'active'};export const View=({children})=><div>{children}</div>;`,
      },
      {
        path: '../../ui/content/text',
        importer: mobile,
        contents: `export const Text=({children,accessibilityRole})=><p role={accessibilityRole==='alert'?'alert':undefined}>{children}</p>;`,
      },
      {
        path: '../../ui/controls/action',
        importer: mobile,
        contents: `export const Action=({label,disabled,onPress})=><button disabled={disabled} onClick={onPress}>{label}</button>;`,
      },
      {
        path: '../../ui/controls/choice',
        importer: mobile,
        contents: `export const Choice=({label,value,items,onChange,disabled})=><select aria-label={label} value={value} disabled={disabled} onChange={event=>onChange(event.target.value)}>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>;`,
      },
      {
        path: '../../ui/theme',
        importer: mobile,
        contents: 'export const useTheme=()=>({styles:{},colors:{}});',
      },
    ],
  )
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    await page.setContent('<div id="app"></div>')
    await page.addScriptTag({ content: built.outputFiles[0].text })
    await page.getByRole('button', { name: 'Enable internet connection', exact: true }).click()
    await page.getByText(/Waiting for approval/).waitFor()
    await page
      .getByRole('button', { name: 'Approve internet access for My phone', exact: true })
      .click()
    await page.getByText('Internet enabled', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.upgrades[0].id), 'existing-profile')
    assert.equal(
      await page.evaluate(() => window.upgrades[0].previous.token),
      'existing-private-device-token',
    )
    assert.deepEqual(
      await page.evaluate(() => window.cancelled),
      [],
      'Saving the registry may unmount the form; it must not revoke the approved connection',
    )
    await page.evaluate(() => window.reset())
    await page.getByRole('combobox', { name: 'Relay fallback' }).last().selectOption('dovo')
    await page.getByRole('button', { name: 'Enable internet connection', exact: true }).click()
    await page.getByText(/Allows Dovo relay fallback/).waitFor()
    await page
      .getByRole('button', { name: 'Deny internet access for My phone', exact: true })
      .click()
    await page.getByText(/Internet access was declined/).waitFor()
    assert.equal(await page.evaluate(() => window.upgrades.length), 1)
    await page.evaluate(() => window.reset())
    await page.getByRole('button', { name: 'Enable internet connection', exact: true }).click()
    await page.getByRole('button', { name: 'Cancel internet request', exact: true }).click()
    await page.getByText(/Request cancelled/).waitFor()
    await page.evaluate(() => {
      window.reset()
      window.failProbe = true
    })
    await page.getByRole('button', { name: 'Enable internet connection', exact: true }).click()
    await page
      .getByRole('button', { name: 'Approve internet access for My phone', exact: true })
      .click()
    await page.getByText(/Internet path blocked/).waitFor()
    await page.evaluate(() => {
      window.reset()
      window.holdClaim = true
    })
    await page.getByRole('button', { name: 'Enable internet connection', exact: true }).click()
    await page.waitForFunction(() => typeof window.releaseClaim === 'function')
    await page.getByRole('button', { name: 'Cancel internet request', exact: true }).click()
    await page.evaluate(() => window.releaseClaim())
    await page.getByText(/Request cancelled/).waitFor()
    assert.equal(
      await page.evaluate(() => window.upgrades.length),
      1,
      'A late claim after cancellation cannot switch the saved connection',
    )
    await page.evaluate(() => window.reset())
    await page.getByRole('combobox', { name: 'Relay fallback' }).last().selectOption('custom')
    await page.getByRole('button', { name: 'Enable internet connection', exact: true }).click()
    await page
      .getByText(/Direct first, with the configured computer or organization TURN relay/)
      .waitFor()
    await page
      .getByRole('button', { name: 'Approve internet access for My phone', exact: true })
      .click()
    await page.getByText('Internet enabled', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.upgrades.at(-1).peer.relay), 'custom')
    assert.deepEqual(errors, [])
    console.log(
      'Existing pairing upgrade UI: owner approval, relay consent, denial, cancel races, probe failure and successful form disposal passed.',
    )
  } finally {
    await page.close()
  }
}
