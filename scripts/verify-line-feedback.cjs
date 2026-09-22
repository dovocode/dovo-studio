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
        await wait(()=>button('Settings')); button('Settings').click(); await wait(()=>button('Devices & runtime')); button('Devices & runtime').click();
        await wait(()=>[...document.querySelectorAll('summary')].some(item=>item.innerText==='CLI commands & shell'));[...document.querySelectorAll('summary')].find(item=>item.innerText==='CLI commands & shell').click();await wait(()=>document.querySelector('[aria-label="Terminal shell"]'));
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
        await call('/api/workspace',{collection:'tasks',id:'smoke-task',changes:{files:{before:[],after:[{path:'review.ts',before:'old\\ntail',after:'new\\ntail',viewed:false}]}}},'PATCH');
        const taskButton=()=>[...document.querySelectorAll('button')].find(b=>b.innerText.includes('Terminal smoke task'));
        await wait(taskButton); taskButton().click();
        await wait(()=>document.querySelector('h1')?.textContent==='Terminal smoke task');
        if(!['Smoke repository','Worktree'].every(text=>document.querySelector('h1').closest('header').innerText.includes(text))) throw new Error('Selected checkout is not visible');
        button('Changes').click();
        await wait(()=>document.querySelector('diffs-container')?.shadowRoot?.querySelector('[data-column-number]'));
        const shadow=document.querySelector('diffs-container').shadowRoot;
        const numbers=[...shadow.querySelectorAll('[data-column-number]')];
        const first=numbers.at(-2),last=numbers.at(-1);
        const select=(el,shiftKey=false)=>{for(const type of ['pointerdown','pointerup'])el.dispatchEvent(new PointerEvent(type,{bubbles:true,composed:true,pointerType:'mouse',pointerId:1,button:0,shiftKey}))};
        select(first);select(last,true);
        await wait(()=>document.querySelector('[aria-label="Line comment"]'));
        button('Suggest code change').click();
        await wait(()=>document.querySelector('[aria-label="Suggested replacement"]'));
        if(document.querySelector('[aria-label="Suggested replacement"]').value!=='new\\ntail')throw new Error('Multiline suggestion was not prefilled');
        input('Suggested replacement','better\\ncode',HTMLTextAreaElement);
        input('Line comment','Please preserve cancellation semantics',HTMLTextAreaElement);
        await wait(()=>button('Add steering to chat')&&!button('Add steering to chat').disabled);button('Add steering to chat').click();
        await wait(()=>document.body.innerText.includes('Agent steering')&&!document.querySelector('[aria-label="Line comment"]'));
        const feedback=(await call('/api/snapshot',undefined,'GET')).workspace.tasks.find(t=>t.id==='smoke-task').messages.at(-1);
        if(!feedback.diffComment?.body.includes('better\\ncode')||!feedback.text.includes('review.ts:1-2'))throw new Error('Line steering did not persist');
      })()`)
      console.log(JSON.stringify({ lineSteering: true, persisted: true, inlineAnnotation: true }))
      window.show()
      await new Promise((r) => setTimeout(r, 600))
      fs.writeFileSync(
        path + '/work/implementation-reference/line-feedback-desktop.png',
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
  console.error('Terminal smoke timeout')
  exitCode = 1
  app.quit()
}, 30000).unref()
import(path + '/apps/desktop/dist-electron/main.js').catch((error) => {
  console.error(error)
  app.exit(1)
})
