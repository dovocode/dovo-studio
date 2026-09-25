const { app } = require('electron')
const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { startDeviceRuntime, seedDeviceRuntime, request } = require('./fixtures/device-runtime.cjs')
const root = resolve(__dirname, '..')
const directory = mkdtempSync(join(tmpdir(), 'dovo-devices-check-'))
const localTitle = 'Local fixture thread'
const remoteTitle = 'Remote fixture thread'
let exitCode = 0
let remote
let finishing = false
let verificationWindow
const helperScript = `window.deviceSmoke = {
  wait: async check => {const until=Date.now()+30000;while(Date.now()<until){if(await check())return;await new Promise(r=>setTimeout(r,100))}throw new Error('Device UI timeout ('+check.toString()+'): '+document.body.innerText.slice(-2000))},
  button: label => [...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===label||b.title===label||b.innerText.trim()===label),
  input: (label,value) => {const el=document.querySelector('[aria-label="'+label+'"]');if(!el)throw new Error('Missing input '+label);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}))},
  outboxes: async()=>new Promise((resolve,reject)=>{const open=indexedDB.open('dovo-read-cache',1);open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,store=db.transaction('entries').objectStore('entries'),keys=store.getAllKeys(),values=store.getAll();values.onsuccess=()=>{resolve(keys.result.flatMap((key,index)=>String(key).startsWith('dovo.workspace-outbox.v1.')?[JSON.parse(values.result[index])]:[]));db.close()};values.onerror=()=>reject(values.error)}}),
};undefined;`
process.env.DOVO_PORT = '0'
process.env.DOVO_HOST = '127.0.0.1'
app.setPath('userData', join(directory, 'electron'))
app.once('will-quit', () => {
  rmSync(directory, { recursive: true, force: true })
  app.exit(exitCode)
})
const finish = async (error) => {
  if (finishing) return
  finishing = true
  if (error) {
    console.error(error)
    exitCode = 1
    if (verificationWindow && !verificationWindow.isDestroyed()) {
      const captures = join(root, 'work/implementation-reference')
      mkdirSync(captures, { recursive: true })
      writeFileSync(
        join(captures, 'devices-desktop-failure.png'),
        (await verificationWindow.webContents.capturePage()).toPNG(),
      )
    }
  }
  await remote?.stop()
  app.quit()
}
app.on('browser-window-created', (_event, window) => {
  verificationWindow = window
  window.webContents.once('did-finish-load', async () => {
    try {
      console.log('Device smoke: renderer loaded')
      await window.webContents.executeJavaScript(helperScript)
      const local = await window.webContents.executeJavaScript(`(async()=>{
        await deviceSmoke.wait(()=>document.body.innerText.includes('Workspace synced'));
        return window.dovo.runtimeConnection();
      })()`)
      console.log('Device smoke: local runtime connected')
      await seedDeviceRuntime(local, {
        directory: join(directory, 'local'),
        repository: 'first',
        title: localTitle,
      })
      console.log('Device smoke: pairing and checking dashboard')
      await window.webContents.executeJavaScript(`(async()=>{
        const {wait,button,input}=deviceSmoke;
        await wait(()=>button('Settings'));button('Settings').click();
        await wait(()=>button('Devices & runtime'));button('Devices & runtime').click();
        await wait(()=>button('Connect computer'));button('Connect computer').click();
        await wait(()=>document.querySelector('[aria-label="Pairing code"]'));
        input('Runtime address',${JSON.stringify(remote.connection.address)});
        input('Pairing device name','Multi-device verification');
        input('Pairing code',${JSON.stringify(remote.pairing.code)});
        await wait(()=>button('Connect runtime')&&!button('Connect runtime').disabled);
        button('Connect runtime').click();
        await wait(()=>!document.querySelector('[role="dialog"]'));
        await wait(async()=>{const saved=JSON.parse(await window.dovo.readRuntimeRegistry());return saved.profiles.length===2&&saved.activeId===${JSON.stringify(remote.connection.address)}});
        button('Overview').click();
        await wait(()=>document.querySelector('[aria-label="All devices overview"]'));
        button('Refresh devices').click();
        await new Promise(r=>setTimeout(r,100));
        await wait(()=>!button('Refresh devices').disabled);
        const overview=()=>document.querySelector('[aria-label="All devices overview"]');
        await wait(()=>overview().innerText.includes(${JSON.stringify(localTitle)})&&overview().innerText.includes(${JSON.stringify(remoteTitle)}));
        if(overview().querySelectorAll('article').length!==2)throw new Error('Both device cards were not preserved');
        const computers=()=>overview().querySelector('[aria-label="Connected computers"]');
        if(!computers()?.innerText.includes('2 of 2 online'))throw new Error('Online aggregate is not 2 of 2');
        await wait(()=>computers()?.innerText.includes('1 PR needs attention'));
        for(const article of overview().querySelectorAll('article'))if(!article.innerText.includes('1 PRs'))throw new Error('Host PR count missing: '+article.innerText);
        if(overview().querySelector('[aria-label="Tasks across devices"]').querySelectorAll('button[aria-label^="Open "]').length!==2)throw new Error('Overlapping task IDs were merged');
        const pick=async(label,value)=>{button(label).click();await wait(()=>document.querySelector('[role="listbox"]'));const option=[...document.querySelectorAll('[role="option"]')].find(el=>el.dataset.value===value);if(!option)throw new Error('Missing '+label+' '+value);option.click();await wait(()=>!document.querySelector('[role="listbox"]'))};
        await pick('Overview device',${JSON.stringify(remote.connection.address)});
        await wait(()=>overview().querySelectorAll('article').length===1);
        if(overview().innerText.includes(${JSON.stringify(localTitle)}))throw new Error('Device filter leaks another host task');
        if(!overview().innerText.includes(${JSON.stringify(remoteTitle)}))throw new Error('Device filter removed its task');
        await pick('Overview device','');
        const openTask=title=>[...(overview()?.querySelectorAll('button[aria-label^="Open "]')??[])].find(b=>b.getAttribute('aria-label').startsWith('Open '+title+' on '));
        openTask(${JSON.stringify(localTitle)}).click();
        await wait(()=>document.querySelector('h1')?.textContent===${JSON.stringify(localTitle)});
        await wait(async()=>JSON.parse(await window.dovo.readRuntimeRegistry()).activeId===${JSON.stringify(local.address)});
        button('Overview').click();await wait(()=>openTask(${JSON.stringify(remoteTitle)}));openTask(${JSON.stringify(remoteTitle)}).click();
        await wait(()=>document.querySelector('h1')?.textContent===${JSON.stringify(remoteTitle)});
        await wait(async()=>JSON.parse(await window.dovo.readRuntimeRegistry()).activeId===${JSON.stringify(remote.connection.address)});
        button('Task actions').click();await wait(()=>button('Pin task'));button('Pin task').click();
        await wait(()=>button('Unpin task'));
      })()`)
      console.log('Device smoke: host navigation verified')
      for (let attempt = 0; attempt < 100; attempt++) {
        const snapshot = await remote.request('/api/snapshot')
        if (snapshot.workspace.tasks.find((task) => task.id === 'shared-task')?.pinned) break
        if (attempt === 99) throw new Error('Task pin was not written to its host')
        await new Promise((resolveWait) => setTimeout(resolveWait, 100))
      }
      const localSnapshot = await request(local, '/api/snapshot')
      if (localSnapshot.workspace.tasks.find((task) => task.id === 'shared-task')?.pinned)
        throw new Error('Pinning the remote task modified the local task with the same ID')
      window.webContents.session.webRequest.onBeforeRequest((details, callback) =>
        callback({ cancel: details.url.startsWith(remote.connection.address + '/') }),
      )
      await window.webContents.executeJavaScript(`(async()=>{
        const {wait,button,outboxes}=deviceSmoke;
        await wait(()=>button('Unpin task'));button('Unpin task').click();
        await wait(()=>button('Retry sync'));
        await wait(async()=>{const saved=await outboxes();return saved.some(entry=>entry.workspace.tasks.some(task=>task.id==='shared-task'&&task.pinned===false)&&entry.patches.some(patch=>patch.changes.pinned?.after===false))});
      })()`)
      const stillPinned = await remote.request('/api/snapshot')
      if (!stillPinned.workspace.tasks.find((task) => task.id === 'shared-task')?.pinned)
        throw new Error('Offline edit reached the server before reconnecting')
      const reloaded = new Promise((resolveReload) =>
        window.webContents.once('did-finish-load', resolveReload),
      )
      window.webContents.reload()
      await reloaded
      await window.webContents.executeJavaScript(helperScript)
      await window.webContents.executeJavaScript(`(async()=>{
        const {wait,button}=deviceSmoke;
        await wait(()=>button('Retry sync'));
        button('Tasks').click();
        const row=()=>[...document.querySelectorAll('[aria-label="Task sidebar"] button')].find(el=>el.innerText.includes(${JSON.stringify(remoteTitle)}));
        await wait(()=>row());
        if(row().querySelector('[aria-label="Pinned"]'))throw new Error('Offline edit was overwritten on reload');
        row().click();await wait(()=>document.querySelector('h1')?.textContent===${JSON.stringify(remoteTitle)});
      })()`)
      window.webContents.session.webRequest.onBeforeRequest(null)
      await window.webContents.executeJavaScript(
        `deviceSmoke.wait(async()=>{try{const connection=await window.dovo.runtimeConnection();const response=await fetch(connection.address+'/api/snapshot',{headers:{Authorization:'Bearer '+connection.token}});return response.ok}catch{return false}})`,
      )
      await window.webContents.executeJavaScript(
        `deviceSmoke.wait(()=>document.querySelector('footer')?.innerText.includes('Unsent workspace changes · retry required'))`,
      )
      const beforeRetry = await remote.request('/api/snapshot')
      if (!beforeRetry.workspace.tasks.find((task) => task.id === 'shared-task')?.pinned)
        throw new Error('Restored outbox replayed without explicit Retry sync')
      await window.webContents.executeJavaScript(`(async()=>{
        const {wait,button,outboxes}=deviceSmoke;
        button('Retry sync').click();
        await wait(()=>!button('Retry sync'));
        await wait(async()=>(await outboxes()).length===0);
      })()`)
      const afterRetry = await remote.request('/api/snapshot')
      if (afterRetry.workspace.tasks.find((task) => task.id === 'shared-task')?.pinned)
        throw new Error('Retry did not send the restored edit to its host')
      if (
        (await request(local, '/api/snapshot')).workspace.tasks.find(
          (task) => task.id === 'shared-task',
        )?.pinned
      )
        throw new Error('Retry changed the local task with the same ID')
      console.log('Device smoke: offline edits survived reload and explicit retry')
      await window.webContents.executeJavaScript(`(async()=>{
        await new Promise(resolve=>setTimeout(resolve,1500));
        const original=IDBObjectStore.prototype.put;
        const writes={workspace:0,snapshots:{}};
        IDBObjectStore.prototype.put=function(value,key){
          if(key==='dovo.workspace.v1')writes.workspace++;
          if(String(key).startsWith('dovo.read-cache.v1.')&&String(key).endsWith('.snapshot'))writes.snapshots[key]=(writes.snapshots[key]??0)+1;
          return original.call(this,value,key);
        };
        try {
          await new Promise(resolve=>setTimeout(resolve,11000));
          if(writes.workspace!==0)throw new Error('Unchanged polls rewrote the workspace '+writes.workspace+' times');
          if(Object.values(writes.snapshots).some(count=>count>1))throw new Error('Unchanged polls repeatedly rewrote a snapshot cache: '+JSON.stringify(writes.snapshots));
        } finally {IDBObjectStore.prototype.put=original}
      })()`)
      console.log('Device smoke: unchanged snapshots do not rewrite persistent workspace/cache')
      const replacementPairing = await remote.request('/api/pair/code', { autoApprove: true })
      await window.webContents.executeJavaScript(`(async()=>{
        const {wait,button,input}=deviceSmoke;
        const address=${JSON.stringify(remote.connection.address)};
        const saved=JSON.parse(await window.dovo.readRuntimeRegistry());
        const originalToken=saved.profiles.find(profile=>profile.id===address).connection.token;
        const originalFetch=window.fetch;
        let replacementToken;
        window.fetch=async(resource,options)=>{
          const target=new URL(resource instanceof Request?resource.url:String(resource));
          const authorization=new Headers(options?.headers).get('Authorization');
          if(target.origin===address&&target.pathname==='/api/snapshot'&&authorization&&authorization!=='Bearer '+originalToken){
            replacementToken=authorization.slice(7);
            return Response.json({error:'Simulated replacement connection failure'},{status:503});
          }
          return originalFetch(resource,options);
        };
        try {
          button('Settings').click();await wait(()=>button('Devices & runtime'));button('Devices & runtime').click();
          await wait(()=>button('Connect computer'));button('Connect computer').click();
          await wait(()=>document.querySelector('[aria-label="Pairing code"]'));
          input('Runtime address',address);input('Pairing device name','Replacement verification');
          input('Pairing code',${JSON.stringify(replacementPairing.code)});
          await wait(()=>button('Connect runtime')&&!button('Connect runtime').disabled);button('Connect runtime').click();
          await wait(()=>document.body.innerText.includes('Simulated replacement connection failure'));
          await new Promise(resolve=>setTimeout(resolve,6000));
          const current=JSON.parse(await window.dovo.readRuntimeRegistry());
          if(current.profiles.find(profile=>profile.id===address).connection.token!==originalToken)
            throw new Error('Failed credential replacement overwrote the active saved credentials');
          if(!replacementToken)throw new Error('Replacement connection was not exercised');
          const hash=async(value)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');
          const prefix='dovo.read-cache.v1.'+await hash(address)+'.'+await hash(replacementToken)+'.';
          const leaked=await new Promise((resolve,reject)=>{
            const open=indexedDB.open('dovo-read-cache',1);open.onerror=()=>reject(open.error);
            open.onsuccess=()=>{const db=open.result;const keys=db.transaction('entries').objectStore('entries').getAllKeys();keys.onsuccess=()=>{resolve(keys.result.some(key=>String(key).startsWith(prefix)));db.close()};keys.onerror=()=>reject(keys.error)};
          });
          if(leaked)throw new Error('Old active snapshot was written under replacement credentials');
          const close=document.querySelector('[role="dialog"] [data-slot="dialog-close"]')||button('Cancel');
          if(close)close.click();else document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
          await wait(()=>!document.querySelector('[role="dialog"]'));
        } finally {window.fetch=originalFetch}
      })()`)
      console.log('Device smoke: failed credential replacement preserves host and cache isolation')
      await window.webContents.executeJavaScript(`(async()=>{
        const {wait,button}=deviceSmoke;button('Overview').click();
        await wait(()=>document.querySelector('[aria-label="All devices overview"]'));
        button('Refresh devices').click();await new Promise(r=>setTimeout(r,100));await wait(()=>!button('Refresh devices').disabled);
      })()`)
      const captures = join(root, 'work/implementation-reference')
      mkdirSync(captures, { recursive: true })
      writeFileSync(
        join(captures, 'devices-desktop.png'),
        (await window.webContents.capturePage()).toPNG(),
      )
      await remote.stop()
      const result = await window.webContents.executeJavaScript(`(async()=>{
        const {wait,button}=deviceSmoke;
        button('Refresh devices').click();await new Promise(r=>setTimeout(r,100));await wait(()=>!button('Refresh devices').disabled);
        const overview=document.querySelector('[aria-label="All devices overview"]');
        await wait(()=>[...overview.querySelectorAll('article')].some(a=>a.innerText.includes(${JSON.stringify(remote.connection.address)})&&a.innerText.includes('Offline')));
        const task=[...overview.querySelectorAll('button[aria-label^="Open "]')].find(b=>b.getAttribute('aria-label').startsWith('Open '+${JSON.stringify(remoteTitle)}+' on '));
        if(!task?.disabled||!task.innerText.includes('Offline'))throw new Error('Offline task is missing or still actionable');
        if(!overview.innerText.includes('Cached tasks shown'))throw new Error('Offline cache freshness is not explained');
        if(!overview.innerText.includes(${JSON.stringify(localTitle)}))throw new Error('Offline host removed online tasks');
        const saved=JSON.parse(await window.dovo.readRuntimeRegistry());
        if(saved.profiles.length!==2)throw new Error('Offline runtime was forgotten');
        return {pairedWhileConnected:true,overlappingIds:true,unifiedCounts:true,deviceFilter:true,taskHostSwitch:true,noCrossHostWrite:true,offlineCache:true,durableOutboxReload:true,explicitRetry:true,unchangedSnapshotWritesSkipped:true,failedCredentialReplacementIsolated:true};
      })()`)
      writeFileSync(
        join(captures, 'devices-desktop-offline.png'),
        (await window.webContents.capturePage()).toPNG(),
      )
      console.log(JSON.stringify(result))
      await finish()
    } catch (error) {
      await finish(error)
    }
  })
})
setTimeout(() => void finish(new Error('Device verification timeout')), 120000).unref()
void (async () => {
  remote = await startDeviceRuntime({
    directory: join(directory, 'remote'),
    repository: 'second',
    title: remoteTitle,
  })
  await import(root + '/apps/desktop/dist-electron/main.js')
})().catch(finish)
