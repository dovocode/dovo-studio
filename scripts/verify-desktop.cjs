const { app } = require('electron')
process.env.DOVO_PORT = '0'
process.env.DOVO_HOST = '127.0.0.1'
const fs = require('node:fs')
const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const { homedir } = require('node:os')
const { join } = require('node:path')
const path = require('node:path').resolve(__dirname, '..')
let exitCode = 0
app.once('will-quit', () => {
  fs.rmSync(checkoutRoot, { recursive: true, force: true })
  fs.rmSync(data, { recursive: true, force: true })
  app.exit(exitCode)
})
const data = fs.mkdtempSync('/tmp/dovo-terminal-check-')
const repo = data + '/repo'
fs.mkdirSync(repo)
execFileSync('git', ['init', '-q', repo])
execFileSync('git', [
  '-C',
  repo,
  '-c',
  'user.name=Dovo Test',
  '-c',
  'user.email=test@example.invalid',
  'commit',
  '--allow-empty',
  '-qm',
  'Fixture',
])
const checkoutRoot = join(
  homedir(),
  '.dovo',
  'worktrees',
  createHash('sha256')
    .update(fs.realpathSync(repo) + '/.git')
    .digest('hex')
    .slice(0, 24),
)
app.setPath('userData', data + '/electron')
app.on('browser-window-created', (_event, window) => {
  window.webContents.on('did-finish-load', async () => {
    try {
      await window.webContents.executeJavaScript(`(async () => {
        const wait = async (check) => { for (let i=0;i<120;i++) {if(check())return; await new Promise(r=>setTimeout(r,100))}throw new Error('UI timeout: '+document.body.innerText.slice(-500))};
        const c = await window.dovo.runtimeConnection();
        const call = async (path, body, method='POST') => {const r=await fetch(c.address+path,{method,headers:{Authorization:'Bearer '+c.token,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const value=await r.json();if(!r.ok)throw new Error(JSON.stringify(value));return value};
        await wait(()=>document.body.innerText.includes('Workspace synced'));
        const button = label => [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === label || b.title === label || b.innerText.trim() === label);
        await wait(()=>button('Settings'));if(document.querySelector('[aria-label="Extensions"] [aria-label="Agents"]')||document.querySelector('[aria-label="Extensions"] [aria-label="Devices & runtime"]'))throw new Error('Settings pages remain in main navigation');button('Settings').click();await wait(()=>document.querySelector('[aria-label="Settings sections"]'));if(!button('Agents'))throw new Error('Agents missing from Settings'); await wait(()=>button('Devices & runtime')); button('Devices & runtime').click();
        await wait(()=>[...document.querySelectorAll('summary')].some(item=>item.innerText.includes('CLI commands & shell')));[...document.querySelectorAll('summary')].find(item=>item.innerText.includes('CLI commands & shell')).click();await wait(()=>document.querySelector('[aria-label="Terminal shell"]'));
        const input = (label, value, kind) => {const el=document.querySelector('[aria-label="'+label+'"]');Object.getOwnPropertyDescriptor(kind.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}))};
        input('Terminal shell','/bin/bash',HTMLInputElement);
        input('Shell arguments','--noprofile\\n--norc',HTMLTextAreaElement);
        input('Git executable','/usr/bin/git',HTMLInputElement);
        await new Promise(r=>setTimeout(r,100));button('Save command settings').click();
        await wait(()=>document.body.innerText.includes('Command settings saved.'));
        const settings=(await call('/api/commands/read',{})).settings;
        if(settings.shell!=='/bin/bash' || settings.git!=='/usr/bin/git' || settings.shellArgs.join(',')!=='--noprofile,--norc')throw new Error('Command settings did not persist');
        button('Tasks').click();
        const snapshot=await call('/api/snapshot',undefined,'GET');
        await call('/api/workspace',{collection:'repositories',id:'smoke-repo',changes:{},create:{id:'smoke-repo',name:'Smoke repository',path:${JSON.stringify(repo)},branch:'main'}},'PATCH');
        await call('/api/workspace',{collection:'tasks',id:'smoke-task',changes:{},create:{id:'smoke-task',title:'Terminal smoke task',repositoryId:'smoke-repo',agentId:snapshot.workspace.agents[0].id,execution:'worktree',status:'draft',createdAt:new Date().toISOString(),messages:[],files:[],draft:'',example:false}},'PATCH');
        const taskButton=()=>[...document.querySelectorAll('button')].find(b=>b.innerText.includes('Terminal smoke task'));
        await wait(taskButton); taskButton().click();
        await wait(()=>document.querySelector('h1')?.textContent==='Terminal smoke task');
        for(const value of ['activity','newest','oldest','title','project','priority']){button('Thread sort').click();await wait(()=>document.querySelector('[role="listbox"]'));const option=[...document.querySelectorAll('[role="option"]')].find(el=>el.dataset.value===value);if(!option)throw new Error('Missing thread sort '+value);option.click();await wait(()=>!document.querySelector('[role="listbox"]'));if(button('Thread sort').dataset.value!==value)throw new Error('Thread sort not applied');}

        if(button('Task settings'))throw new Error('Task settings should be in the actions menu');button('Task actions').click();await wait(()=>button('Task settings'));button('Task actions').click();await wait(()=>!button('Task settings'));
        if(!['Smoke repository','Worktree'].every(text=>document.querySelector('h1').closest('header').innerText.includes(text))) throw new Error('Selected checkout is not visible');
        document.querySelector('button[aria-label="Terminal"]').click();
        await wait(()=>[...document.querySelectorAll('button')].find(b=>b.innerText==='Open terminal'));
        [...document.querySelectorAll('button')].find(b=>b.innerText==='Open terminal').click();
        await wait(()=>document.querySelector('.xterm-helper-textarea'));
        await new Promise(r=>setTimeout(r,500));
        document.querySelector('.xterm-helper-textarea').focus();
      })()`)
      await window.webContents.insertText(
        `printf 'DOVO_TERMINAL_UI_OK:%s:END BASH:%s\\n' "$PWD" "$BASH_VERSION"`,
      )
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' })
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' })
      await new Promise((r) => setTimeout(r, 700))
      const result = await window.webContents.executeJavaScript(`(async()=>{
        const terminal=document.querySelector('.xterm');if(!terminal || terminal.getBoundingClientRect().height<80)throw new Error('Terminal has no usable height');
        const text=terminal.querySelector('.xterm-rows')?.textContent ?? terminal.textContent;
        if(!/BASH:[0-9]/.test(text))throw new Error('Configured shell was not used: '+text);
        if(!text.includes('DOVO_TERMINAL_UI_OK:'+${JSON.stringify(checkoutRoot)}+'/'))throw new Error('Terminal output missing: '+text);
        document.querySelector('[aria-label="Hide terminal pane"]').click();
        await new Promise(r=>setTimeout(r,200));
        const collapsed=document.querySelector('section[aria-label="Terminal"]').getBoundingClientRect().height===0;
        document.querySelector('button[aria-label="Terminal"]').click();
        await new Promise(r=>setTimeout(r,1000));
        return {terminalOutput:text.slice(-300),collapsed,reconnected:document.querySelector('.xterm')?.textContent.includes('DOVO_TERMINAL_UI_OK'),alerts:[...document.querySelectorAll('[role="alert"]')].map(e=>e.textContent)};
      })()`)
      fs.writeFileSync(
        path + '/work/implementation-reference/terminal-desktop.png',
        (await window.webContents.capturePage()).toPNG(),
      )
      console.log(JSON.stringify(result))
      if (!result.collapsed || !result.reconnected || result.alerts.length) exitCode = 1
      app.quit()
    } catch (error) {
      console.error(error)
      exitCode = 1
      app.quit()
    }
  })
})
setTimeout(() => {
  console.error('Terminal smoke timeout')
  exitCode = 1
  app.quit()
}, 30000).unref()
import(path + '/apps/desktop/dist-electron/main.js').catch((error) => {
  console.error(error)
  app.exit(1)
})
