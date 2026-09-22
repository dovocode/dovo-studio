const { app } = require('electron')
process.env.DOVO_PORT = '0'
process.env.DOVO_HOST = '127.0.0.1'
const fs = require('node:fs')
const path = require('node:path').resolve(__dirname, '..')
const data = fs.mkdtempSync('/tmp/dovo-agent-check-')
fs.mkdirSync(path + '/work/implementation-reference', { recursive: true })
let exitCode = 0
app.setPath('userData', data)
app.once('will-quit', () => {
  fs.rmSync(data, { recursive: true, force: true })
  app.exit(exitCode)
})
app.on('browser-window-created', (_event, window) => {
  window.webContents.once('did-finish-load', async () => {
    try {
      const result = await window.webContents.executeJavaScript(`(async () => {
        const wait = async (check) => { for (let i=0;i<300;i++) {if(check())return; await new Promise(r=>setTimeout(r,100))}throw new Error('UI timeout: '+document.body.innerText.slice(-1000))};
        const c = await window.dovo.runtimeConnection();
        const snapshot = async () => (await fetch(c.address+'/api/snapshot',{headers:{Authorization:'Bearer '+c.token}})).json();
        await wait(()=>document.body.innerText.includes('Workspace synced'));
        if ((await snapshot()).workspace.tasks.length) throw new Error('Fresh runtime contains dummy chats');
        const call=async(endpoint,body)=>{const response=await fetch(c.address+endpoint,{method:'POST',headers:{Authorization:'Bearer '+c.token,'Content-Type':'application/json'},body:JSON.stringify(body)});if(!response.ok)throw new Error(await response.text());return response.json()};
        const commands=await call('/api/commands/read',{});await call('/api/commands/save',{...commands.settings,codex:${JSON.stringify(path + '/scripts/fixtures/codex.cjs')}});
        const button = (label) => [...document.querySelectorAll('button')].find(b=>b.innerText.trim()===label || b.getAttribute('aria-label')===label || b.title===label);
        await wait(()=>button('Settings'));button('Settings').click();await wait(()=>button('Agents')); button('Agents').click();
        await wait(()=>button('Configure')); button('Configure').click();
        await wait(()=>button('Model')&&!document.body.innerText.includes('Loading provider models'));
        button('Model').click(); await wait(()=>document.querySelector('[role="listbox"]'));
        const choice = [...document.querySelectorAll('[role="option"]')].find(o=>o.dataset.value&&o.dataset.value!=='__custom__');
        if(!choice)throw new Error('No discovered model');
        const modelId=choice.dataset.value;choice.click();await wait(()=>!document.querySelector('[role="listbox"]'));
        button('Reasoning level').click();await wait(()=>document.querySelector('[role="listbox"]'));
        const options=[...document.querySelectorAll('[role="option"]')];
        const effort=options.find(o=>o.dataset.value==='high')||options.find(o=>o.dataset.value);
        if(!effort)throw new Error('No discovered reasoning level');
        const effortId=effort.dataset.value;effort.click();await wait(()=>!document.querySelector('[role="listbox"]'));
        await new Promise(r=>setTimeout(r,100));
        button('Save configuration').click();
        await wait(()=>!document.querySelector('[role="dialog"]'));
        let saved;
        for(let i=0;i<50;i++){saved=(await snapshot()).workspace.agents.find(a=>a.model===modelId && a.reasoning===effortId);if(saved)break;await new Promise(r=>setTimeout(r,100))}
        if(!saved)throw new Error('Agent model/reasoning did not persist');
        button('Configure').click();
        await wait(()=>button('Model')?.dataset.value===modelId && button('Reasoning level')?.dataset.value===effortId);
        return {model: modelId, reasoning: effortId, persisted: true, dummyChats: 0};
      })()`)
      console.log(JSON.stringify(result))
      window.show()
      await new Promise((resolve) => setTimeout(resolve, 1000))
      fs.writeFileSync(
        path + '/work/implementation-reference/agent-settings-desktop.png',
        (await window.webContents.capturePage()).toPNG(),
      )
      app.quit()
    } catch (error) {
      console.error(error)
      exitCode = 1
      app.quit()
    }
  })
})
setTimeout(() => {
  console.error('Agent settings smoke timeout')
  exitCode = 1
  app.quit()
}, 60000).unref()
import(path + '/apps/desktop/dist-electron/main.js').catch((error) => {
  console.error(error)
  app.exit(1)
})
