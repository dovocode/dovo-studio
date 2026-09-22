const { app } = require('electron')
process.env.DOVO_PORT = '0'
process.env.DOVO_HOST = '127.0.0.1'
const fs = require('node:fs')
const { execFileSync } = require('node:child_process')
const root = require('node:path').resolve(__dirname, '..')
const data = fs.mkdtempSync('/tmp/dovo-question-check-')
for (const args of [
  ['init', '-q'],
  ['config', 'user.name', 'Fixture'],
  ['config', 'user.email', 'fixture@example.invalid'],
])
  execFileSync('git', args, { cwd: data })
fs.writeFileSync(`${data}/.gitignore`, 'electron/\n')
execFileSync('git', ['add', '.gitignore'], { cwd: data })
execFileSync('git', ['commit', '-qm', 'Fixture'], { cwd: data })
app.setPath('userData', `${data}/electron`)
let exitCode = 1
app.once('will-quit', () => {
  fs.rmSync(data, { recursive: true, force: true })
  app.exit(exitCode)
})
app.on('browser-window-created', (_event, window) =>
  window.webContents.once('did-finish-load', async () => {
    try {
      window.webContents.setBackgroundThrottling(false)
      window.show()
      const result = await window.webContents.executeJavaScript(`(async () => {
        const wait=async check=>{for(let i=0;i<200;i++){if(await check())return;await new Promise(r=>setTimeout(r,100))}throw new Error('Question workflow timeout: '+document.body.innerText.slice(-1800))};
        await wait(()=>document.body.innerText.includes('Workspace synced'));
        const connection=await window.dovo.runtimeConnection();
        const call=async(path,body,method='POST')=>{const r=await fetch(connection.address+path,{method,headers:{Authorization:'Bearer '+connection.token,'Content-Type':'application/json'},body:JSON.stringify(body)});const v=await r.json();if(!r.ok)throw new Error(JSON.stringify(v));return v};
        const snapshot=async()=>{const r=await fetch(connection.address+'/api/snapshot',{headers:{Authorization:'Bearer '+connection.token}});return r.json()};
        const config=await call('/api/commands/read',{});await call('/api/commands/save',{...config.settings,codex:${JSON.stringify(root + '/scripts/fixtures/codex.cjs')}});
        for(const [collection,entity] of [['repositories',{id:'repo',name:'Question project',path:${JSON.stringify(data)},branch:'main'}],['agents',{id:'agent',name:'Question agent',provider:'codex',model:'',instructions:'',permission:'ask',endpoint:''}],['tasks',{id:'question-task',title:'Question verification',repositoryId:'repo',agentId:'agent',status:'draft',createdAt:new Date().toISOString(),messages:[],files:[],draft:'',example:false}]])await call('/api/workspace',{collection,id:entity.id,create:entity,changes:{}},'PATCH');
        const button=label=>[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===label||b.title===label||b.innerText.trim()===label);
        const fill=(el,value)=>{Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}))};
        const form=()=>document.querySelector('[aria-label="Agent questions"]');
        button('Tasks').click();await wait(()=>document.querySelector('[aria-label="Message task"]'));
        fill(document.querySelector('[aria-label="Message task"]'),'Question verification');await wait(()=>button('Send to agent')&&!button('Send to agent').disabled);button('Send to agent').click();
        await wait(()=>form());
        if(document.querySelector('[aria-label="Message task"]').getBoundingClientRect().height||!button('Stop')||button('Queue follow-up')||button('Steer agent'))throw new Error('Question must own the answer form while Stop remains available');
        const first=(await snapshot()).questions[0];
        if(form().querySelector('[aria-pressed="true"]'))throw new Error('Answers were preselected');
        if(!document.querySelector('[aria-label="Task sidebar"]').innerText.includes('Needs input'))throw new Error('Missing needs input indicator');
        button('Send answers').click();await wait(()=>form()?.querySelector('[role="alert"]'));
        [...form().querySelectorAll('button')].find(b=>b.innerText.includes('Use existing patterns')).click();
        fill(document.querySelector('[aria-label="Answer: Details"]'),'Keep it compact');
        await new Promise(resolve=>requestAnimationFrame(resolve));
        return {id:first.id};
      })()`)
      fs.writeFileSync(
        '/tmp/dovo-agent-questions.png',
        (await window.webContents.capturePage()).toPNG(),
      )
      const verified = await window.webContents.executeJavaScript(`(async () => {
        const wait=async check=>{for(let i=0;i<200;i++){if(await check())return;await new Promise(r=>setTimeout(r,100))}throw new Error('Question resolution timeout: '+document.body.innerText.slice(-1800))};
        const button=label=>[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===label||b.title===label||b.innerText.trim()===label);
        const connection=await window.dovo.runtimeConnection();
        const snapshot=async()=>{const r=await fetch(connection.address+'/api/snapshot',{headers:{Authorization:'Bearer '+connection.token}});return r.json()};
        button('Send answers').click();
        await wait(()=>document.body.innerText.includes('Question answers verified.')&&!document.querySelector('[aria-label="Agent questions"]'));
        const stale=await fetch(connection.address+'/api/tasks/answer',{method:'POST',headers:{Authorization:'Bearer '+connection.token,'Content-Type':'application/json'},body:JSON.stringify({id:${JSON.stringify(result.id)},answers:null})});
        if(stale.status!==409)throw new Error('A second device could overwrite the answer');
        await wait(async()=>{const t=(await snapshot()).workspace.tasks[0];return t.status==='review'});
        await wait(()=>button('Send to agent'));
        { const el=document.querySelector('[aria-label="Message task"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'Question verification');el.dispatchEvent(new Event('input',{bubbles:true})); }
        await wait(()=>button('Send to agent')&&!button('Send to agent').disabled);button('Send to agent').click();await wait(()=>document.querySelector('[aria-label="Agent questions"]'));
        button('Decline').click();await wait(()=>document.body.innerText.includes('Question declined or unexpected answers.'));
        await wait(async()=>{const t=(await snapshot()).workspace.tasks[0];return t.status==='review'});
        await wait(()=>button('Send to agent'));
        { const el=document.querySelector('[aria-label="Message task"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'Question verification');el.dispatchEvent(new Event('input',{bubbles:true})); }
        await wait(()=>button('Send to agent')&&!button('Send to agent').disabled);button('Send to agent').click();await wait(()=>document.querySelector('[aria-label="Agent questions"]'));
        button('Stop').click();await wait(async()=>{const s=await snapshot();return s.questions.length===0&&s.workspace.tasks[0].status==='cancelled'});
        return {requiredValidation:true,choiceAndText:true,providerReply:true,staleReplyRejected:true,decline:true,stopCancelsQuestions:true};
      })()`)
      console.log(JSON.stringify(verified))
      exitCode = 0
      app.quit()
    } catch (error) {
      fs.writeFileSync(
        '/tmp/dovo-agent-questions-failure.png',
        (await window.webContents.capturePage()).toPNG(),
      )
      console.error(error)
      app.quit()
    }
  }),
)
setTimeout(() => {
  console.error('Question verification timeout')
  app.quit()
}, 90000).unref()
import(root + '/apps/desktop/dist-electron/main.js').catch((error) => {
  console.error(error)
  app.exit(1)
})
