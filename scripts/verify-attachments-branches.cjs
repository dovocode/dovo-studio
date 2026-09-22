const { app } = require('electron')
process.env.DOVO_PORT = '0'
process.env.DOVO_HOST = '127.0.0.1'
const fs = require('node:fs')
const { execFileSync } = require('node:child_process')
const root = require('node:path').resolve(__dirname, '..')
const data = fs.mkdtempSync('/tmp/dovo-attachment-check-')
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
        const wait=async check=>{for(let i=0;i<250;i++){if(await check())return;await new Promise(r=>setTimeout(r,100))}throw new Error('Attachment workflow timeout: '+document.body.innerText.slice(-2200))};
        await wait(()=>document.body.innerText.includes('Workspace synced'));
        const connection=await window.dovo.runtimeConnection();
        const call=async(path,body,method='POST')=>{const r=await fetch(connection.address+path,{method,headers:{Authorization:'Bearer '+connection.token,'Content-Type':'application/json'},body:JSON.stringify(body)});const v=await r.json();if(!r.ok)throw new Error(JSON.stringify(v));return v};
        const snapshot=async()=>{const r=await fetch(connection.address+'/api/snapshot',{headers:{Authorization:'Bearer '+connection.token}});return r.json()};
        const config=await call('/api/commands/read',{});await call('/api/commands/save',{...config.settings,codex:${JSON.stringify(root + '/scripts/fixtures/codex.cjs')}});
        for(const [collection,entity] of [['repositories',{id:'repo',name:'Attachment project',path:${JSON.stringify(data)},branch:'main'}],['agents',{id:'agent',name:'Attachment agent',provider:'codex',model:'',instructions:'',permission:'ask',endpoint:''}],['tasks',{id:'attachment-task',title:'Attachments and branches',repositoryId:'repo',agentId:'agent',status:'draft',createdAt:new Date().toISOString(),messages:[],files:[],draft:'',example:false}]])await call('/api/workspace',{collection,id:entity.id,create:entity,changes:{}},'PATCH');
        const button=label=>[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===label||b.title===label||b.innerText.trim()===label);
      const pick = async (label, value) => {
        button(label).click(); await wait(()=>document.querySelector('[role="listbox"]'));
        const option = [...document.querySelectorAll('[role="option"]')].find(o=>o.dataset.value===value);
        if(!option) throw new Error('Missing option '+label+': '+value);
        option.click(); await wait(()=>!document.querySelector('[role="listbox"]'));
      };
        const fill=(el,value)=>{Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}))};
        button('Tasks').click();await wait(()=>button('Task actions'));button('Task actions').click();await wait(()=>button('Task settings'));
        button('Task settings').click();await wait(()=>button('Branches'));button('Branches').click();await wait(()=>button('Target branch')&&!button('Target branch').disabled&&button('Create branch'));
        const initial=await call('/api/scm/branches',{repositoryId:'repo'});
        fill(document.querySelector('[aria-label="New branch name"]'),'feature/attachments');await wait(()=>!button('Create branch').disabled);button('Create branch').click();
        await wait(async()=>(await snapshot()).workspace.repositories.find(r=>r.id==='repo').branch==='feature/attachments');
        button('Save task settings').click();await wait(()=>!document.querySelector('[role="dialog"]'));
        const picker=document.querySelector('[aria-label="Choose attachments"]');const chosen=new DataTransfer();chosen.items.add(new File(['Attachment fixture context'],'context.txt',{type:'text/plain'}));picker.files=chosen.files;picker.dispatchEvent(new Event('change',{bubbles:true}));
        await wait(()=>button('Preview context.txt')&&!button('Attach files').disabled);
        const pasted=new DataTransfer();pasted.items.add(new File([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1kAAAAASUVORK5CYII='),c=>c.charCodeAt(0))],'picture.png',{type:'image/png'}));
        document.querySelector('[aria-label="Message task"]').dispatchEvent(new ClipboardEvent('paste',{clipboardData:pasted,bubbles:true,cancelable:true}));
        await wait(()=>button('Preview picture.png')&&!button('Attach files').disabled);
        const dropped=new DataTransfer();dropped.items.add(new File(['remove me'],'remove.txt',{type:'text/plain'}));document.querySelector('[aria-label="Message task"]').closest('form').dispatchEvent(new DragEvent('drop',{dataTransfer:dropped,bubbles:true,cancelable:true}));
        await wait(()=>button('Remove remove.txt')&&!button('Attach files').disabled);button('Remove remove.txt').click();await wait(()=>!button('Remove remove.txt')&&!button('Attach files').disabled);
        button('Preview context.txt').click();await wait(()=>document.querySelector('[role="dialog"]')?.innerText.includes('Attachment fixture context'));button('Close').click();await wait(()=>!document.querySelector('[role="dialog"]'));
        button('Preview picture.png').click();await wait(()=>document.querySelector('[role="dialog"] img')?.naturalWidth===1);button('Close').click();await wait(()=>!document.querySelector('[role="dialog"]'));
        fill(document.querySelector('[aria-label="Message task"]'),'Attachment verification with image');await wait(()=>button('Send to agent')&&!button('Send to agent').disabled);button('Send to agent').click();
        await wait(()=>document.body.innerText.includes('Attachment inputs verified.'));await wait(async()=>(await snapshot()).workspace.tasks.find(t=>t.id==='attachment-task').status==='review');
        const task=(await snapshot()).workspace.tasks.find(t=>t.id==='attachment-task');if(task.messages.find(m=>m.role==='user').attachments.length!==2||task.draftAttachments.length)throw new Error('Attachments were lost or draft was not cleared');
        button('Task actions').click();await wait(()=>button('Task settings'));button('Task settings').click();await wait(()=>button('Branches'));button('Branches').click();await wait(()=>button('Target branch')&&!button('Target branch').disabled);
        await pick('Target branch','refs/heads/'+initial.current);await wait(()=>!button('Switch').disabled);button('Switch').click();
        await wait(async()=>(await snapshot()).workspace.repositories.find(r=>r.id==='repo').branch===initial.current);button('Save task settings').click();await wait(()=>!document.querySelector('[role="dialog"]'));
        const switched=(await snapshot()).workspace.tasks.find(t=>t.id==='attachment-task');if(switched.sessionId||switched.messages.length!==2)throw new Error('Branch switch retained provider context or lost chat');
        await wait(()=>button('Send to agent')&&document.querySelector('h1')?.closest('header')?.innerText.includes('Attachment project')&&document.querySelector('h1')?.closest('header')?.innerText.includes(initial.current));
        return {filePicker:true,pastedImage:true,dropAndRemove:true,textAndImagePreviews:true,providerAttachmentInput:true,createAndSwitchBranch:true,conversationPreserved:true};
      })()`)
      fs.writeFileSync(
        '/tmp/dovo-attachments-branches.png',
        (await window.webContents.capturePage()).toPNG(),
      )
      console.log(JSON.stringify(result))
      exitCode = 0
      app.quit()
    } catch (error) {
      fs.writeFileSync(
        '/tmp/dovo-attachments-branches-failure.png',
        (await window.webContents.capturePage()).toPNG(),
      )
      console.error(error)
      app.quit()
    }
  }),
)
setTimeout(() => {
  console.error('Attachment verification timeout')
  app.quit()
}, 90000).unref()
import(root + '/apps/desktop/dist-electron/main.js').catch((error) => {
  console.error(error)
  app.exit(1)
})
