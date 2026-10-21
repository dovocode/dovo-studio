import assert from 'node:assert/strict'
import { bundleBrowser } from './harness.mjs'

export async function checkPeerPairing(browser, root) {
  const mobile = root + '/apps/mobile/src/runtime/connection/'
  const protocol = root + '/packages/protocol/src/index.ts'
  const polling = `import {Effect} from 'effect';export const startPolling=(work,options)=>{let stopped=false;queueMicrotask(()=>{if(!stopped)Effect.runPromise(work).catch(options.onError)});return {stop:async()=>{stopped=true}}};`
  const built = await bundleBrowser(
    {
      stdin: {
        contents: `
      import {createRoot} from 'react-dom/client';
      import {PairingGuide} from '${root}/packages/extension-runtime/src/pairing-guide.tsx';
      import {PairComputer} from '${mobile}pair-computer.tsx';
      import {peerAddress} from '${protocol}';
      window.peer={origin:'https://connect.example',secret:'a'.repeat(64)};
      window.permanent={...window.peer,secret:'b'.repeat(64)};
      window.invite={peer:window.peer,address:peerAddress(window.peer),code:'00112233',expiresAt:new Date(Date.now()+120000).toISOString()};
      window.prepared=[];window.forgotten=[];window.connections=[];window.calls=[];window.errors=[];
      window.request=async(connection,address,path,input)=>{
        window.calls.push({connection,address,path,input});
        if(path==='/api/pair/request')return {id:'proof',secret:'proof-secret',expiresAt:window.invite.expiresAt};
        if(path==='/api/pair/claim')return {status:'approved',token:'paired-device-token'};
        if(path==='/api/runtime/peer/enable')return window.permanent;
        throw Error('Unexpected request '+path);
      };
      const app=createRoot(document.getElementById('app'));
      window.show=screen=>app.render(screen==='desktop'?<PairingGuide code={window.invite} pending={false}/>:<PairComputer key={screen} invitation={window.invite}/>);
      window.show('desktop');`,
        loader: 'tsx',
        resolveDir: root,
      },
      bundle: true,
      write: false,
      format: 'iife',
      platform: 'browser',
      jsx: 'automatic',
      alias: {
        react: root + '/packages/studio-ui/node_modules/react',
        'react-dom': root + '/packages/studio-ui/node_modules/react-dom',
      },
      nodePaths: [root + '/packages/studio-ui/node_modules'],
    },
    [
      {
        path: '@dovo/protocol',
        contents: `export * from '${protocol}';import {Effect} from 'effect';export const runtimeRequest=(...args)=>window.request(...args);export const runtimeRequestEffect=(...args)=>Effect.tryPromise(()=>window.request(...args));`,
      },
      {
        path: '@dovo/studio-core',
        contents:
          polling +
          `export const clientTaskScope=()=>({run:effect=>Effect.runPromise(effect),stop:async()=>{}});`,
      },
      { path: '@dovo/client-runtime', contents: polling },
      {
        path: '@dovo/studio-core/state',
        contents: `import {useState} from 'react';export const useApplicationState=useState;`,
      },
      {
        path: '../state/application-state',
        importer: mobile,
        contents: `import {useState} from 'react';export const useApplicationState=useState;`,
      },
      {
        path: '@dovo/studio-ui',
        contents: `export const Button=({children,onClick,disabled})=><button disabled={disabled} onClick={onClick}>{children}</button>;export const Input=props=><input {...props}/>;export const FormField=({label,children})=><label>{label}{children}</label>;`,
      },
      {
        path: 'react-native',
        contents: `export const View=({children})=><div>{children}</div>;export const Pressable=({children,onPress,accessibilityLabel})=><button onClick={onPress} aria-label={accessibilityLabel}>{children}</button>;export const ActivityIndicator=()=>null;export const AppState={currentState:'active',addEventListener:()=>({remove(){}})};export const Keyboard={dismiss(){},addListener:()=>({remove(){}})};`,
      },
      {
        path: './pairing-scanner',
        importer: mobile,
        contents: 'export const PairingScanner=()=>null;',
      },
      {
        path: './peer-transport',
        importer: mobile,
        contents:
          'export const preparePeerConnection=config=>window.prepared.push(config);export const forgetPeerConnection=address=>window.forgotten.push(address);',
      },
      {
        path: './provider',
        importer: mobile,
        contents: `export const useRuntime=()=>({connect:async(...args)=>window.connections.push(args),cancelPairing:async()=>{}});`,
      },
      {
        path: '../../ui/content/text',
        importer: mobile,
        contents: `export const Text=({children,accessibilityRole})=><span role={accessibilityRole}>{children}</span>;`,
      },
      {
        path: '../../ui/controls/action',
        importer: mobile,
        contents: `export const Action=({label,disabled,onPress})=><button disabled={disabled} onClick={onPress}>{label}</button>;`,
      },
      {
        path: '../../ui/controls/choice',
        importer: mobile,
        contents: `export const Choice=({label,value,items,onChange,disabled})=><label>{label}<select aria-label={label} value={value} disabled={disabled} onChange={event=>onChange(event.target.value)}>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>;`,
      },
      {
        path: '../../ui/controls/field',
        importer: mobile,
        contents: `export const Field=({label,value,onChangeText,editable})=><label>{label}<input value={value} disabled={editable===false} onChange={e=>onChangeText(e.target.value)}/></label>;`,
      },
      {
        path: '../../ui/theme',
        importer: mobile,
        contents: 'export const useTheme=()=>({styles:{},colors:{}});',
      },
      { path: '../../ui/controls/icon', importer: mobile, contents: 'export const Icon=()=>null;' },
      {
        path: '../../ui/controls/use-action',
        importer: mobile,
        contents: `import {Effect} from 'effect';export const useAction=()=>({busy:false,error:'',act:fn=>{void Effect.runPromise(fn()).catch(error=>window.errors.push(error.message))}});`,
      },
      {
        path: './connection-help',
        importer: mobile,
        contents: 'export const ConnectionHelp=()=>null;',
      },
    ],
  )
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    await page.setContent('<div id="app"></div>')
    await page.evaluate(() =>
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: async (text) => {
            window.copied = text
          },
        },
        configurable: true,
      }),
    )
    await page.addScriptTag({ content: built.outputFiles[0].text })
    await page.getByRole('button', { name: 'Copy pairing link', exact: true }).click()
    const copied = new URL(await page.evaluate(() => window.copied))
    assert.equal(JSON.parse(copied.searchParams.get('peer')).secret, 'a'.repeat(64))
    assert.equal(await page.getByRole('combobox').count(), 0)
    await page.evaluate(() => window.show('mobile'))
    await page.getByText('Internet connection', { exact: true }).waitFor()
    assert.equal(await page.getByRole('textbox').count(), 0)
    assert.equal(await page.getByLabel('Relay fallback').inputValue(), 'direct')
    await page.getByLabel('Relay fallback').selectOption('dovo')
    await page
      .getByText(/Account-authorized or operator-approved computers can use Dovo servers/)
      .waitFor()
    await page.getByText(/Only your phone and computer can read it/).waitFor()
    await page.getByRole('button', { name: 'Connect', exact: true }).click()
    await page.waitForFunction(() => window.connections.length === 1)
    const result = await page.evaluate(() => ({
      connection: window.connections[0][0],
      prepared: window.prepared,
      forgotten: window.forgotten,
      calls: window.calls,
      errors: window.errors,
    }))
    assert.equal(result.connection.peer.secret, 'b'.repeat(64))
    assert.equal(result.connection.token, 'paired-device-token')
    assert.equal(result.connection.peer.relay, 'dovo')
    assert.ok(result.connection.address.endsWith('.p2p.invalid'))
    assert.equal(result.prepared.length, 2)
    assert.equal(result.forgotten.length, 1)
    assert.equal(
      result.calls.find((call) => call.path === '/api/runtime/peer/enable').connection.token,
      'paired-device-token',
    )
    assert.deepEqual(result.errors, [])
    await page.evaluate(() => window.show('manual'))
    await page.getByRole('button', { name: 'Use a LAN / VPN address instead', exact: true }).click()
    await page.getByLabel('Computer address', { exact: true }).waitFor()
    await page.getByLabel('Pairing code', { exact: true }).waitFor()
    assert.deepEqual(errors, [])
    console.log(
      'Desktop QR and mobile pairing: no IP entry, per-device capability handoff, authenticated enablement and LAN/VPN alternative passed (UI/native boundaries adapted).',
    )
  } finally {
    await page.close()
  }
}
