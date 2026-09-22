const { app } = require('electron')
process.env.DOVO_PORT = '0'
process.env.DOVO_HOST = '127.0.0.1'
const fs = require('node:fs')
const { execFileSync } = require('node:child_process')
const root = require('node:path').resolve(__dirname, '..')
const data = fs.mkdtempSync('/tmp/dovo-daily-check-')
for (const args of [
  ['init', '-q'],
  ['config', 'user.name', 'Fixture'],
  ['config', 'user.email', 'fixture@example.invalid'],
])
  execFileSync('git', args, { cwd: data })
fs.writeFileSync(`${data}/.gitignore`, 'electron/\n')
fs.writeFileSync(`${data}/hello.txt`, 'Original\n')
execFileSync('git', ['add', 'hello.txt'], { cwd: data })
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
      const wait=async check=>{for(let i=0;i<250;i++){if(await check())return;await new Promise(r=>setTimeout(r,100))}throw new Error('Daily workflow timeout ('+check.toString()+'): '+document.body.innerText.slice(-1800))};
      await wait(()=>document.body.innerText.includes('Workspace synced'));
      const connection=await window.dovo.runtimeConnection();
      const call=async(path,body,method='POST')=>{const r=await fetch(connection.address+path,{method,headers:{Authorization:'Bearer '+connection.token,'Content-Type':'application/json'},body:JSON.stringify(body)});const v=await r.json();if(!r.ok)throw new Error(JSON.stringify(v));return v};
      const snapshot=async()=>{const r=await fetch(connection.address+'/api/snapshot',{headers:{Authorization:'Bearer '+connection.token}});return r.json()};
      const config=await call('/api/commands/read',{});await call('/api/commands/save',{...config.settings,codex:${JSON.stringify(root + '/scripts/fixtures/codex.cjs')}});
      for(const [collection,entity] of [['repositories',{id:'repo',name:'Daily project',path:${JSON.stringify(data)},branch:'main'}],['agents',{id:'agent',name:'Daily agent',provider:'codex',model:'',instructions:'',permission:'ask',endpoint:''}],['tasks',{id:'daily',title:'Daily workflow',repositoryId:'repo',agentId:'agent',status:'draft',createdAt:new Date().toISOString(),messages:[],files:[],draft:'',example:false}]])await call('/api/workspace',{collection,id:entity.id,create:entity,changes:{}},'PATCH');
      const button=label=>[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===label||b.title===label||b.innerText.trim()===label);
      const click=async label=>{try{await wait(()=>button(label)&&!button(label).disabled)}catch(error){throw new Error('Cannot click '+label+': '+error.message)}button(label).click()};
      const pick = async (label, value) => {
        const trigger=button(label);if(trigger.getAttribute('aria-haspopup')==='menu')trigger.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));else trigger.click(); await wait(()=>document.querySelector('[role="listbox"],[role="menu"]'));
        if(label==='Task permissions'){const names=[...document.querySelectorAll('[role="option"]')].map(o=>o.textContent);for(const name of ['Supervised','Auto-accept edits','Auto','Full access','Read only'])if(!names.includes(name))throw new Error('Missing access mode '+name);}
        const option = [...document.querySelectorAll('[role="option"],[role="menuitemradio"],[role="menuitem"]')].find(o=>o.dataset.value===value);
        if(!option) throw new Error('Missing option '+label+': '+value);
        option.click(); await wait(()=>!document.querySelector('[role="listbox"],[role="menu"]')&&button(label)?.dataset.value===value);
      };
      const fill=(el,value)=>{Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}))};
      await click('Tasks');await wait(()=>document.querySelector('[aria-label="Message task"]'));
      fill(document.querySelector('[aria-label="Message task"]'),'First request');await wait(()=>button('Send to agent')&&!button('Send to agent').disabled);await click('Send to agent');
      await wait(()=>button('Stop'));
      fill(document.querySelector('[aria-label="Message task"]'),'Second request');await wait(()=>button('Queue follow-up')&&!button('Queue follow-up').disabled);await click('Queue follow-up');
      await wait(()=>document.querySelector('[aria-label="Queued follow-ups"]'));
      await click('Pause queue');await wait(()=>button('Resume queue'));
      await wait(async()=>{const s=await snapshot();return s.workspace.tasks[0].status==='review'});
      const queued=(await snapshot()).workspace.tasks[0].queue[0];await call('/api/tasks/message',{id:'daily',messageId:queued.id,text:queued.text});
      if((await snapshot()).workspace.tasks[0].queue.length!==1)throw new Error('Queue retry duplicated input');
      await click('Resume queue');await wait(async()=>{const t=(await snapshot()).workspace.tasks[0];return t.turns.length===2&&t.status==='review'});
      await wait(()=>document.querySelector('[aria-label="Task tool activity"]'));
      document.querySelector('[aria-label="Task tool activity"] summary').click();await wait(()=>document.body.innerText.includes('git status --short'));
      await click('Task actions');await wait(()=>button('Pin task'));await click('Pin task');await wait(()=>document.querySelector('[aria-label="Task sidebar"]').innerText.includes('Pinned'));
      await wait(()=>button('Task settings'));await click('Task settings');await wait(()=>button('Model')&&!document.body.innerText.includes('Loading provider models'));
      await click('Model');await wait(()=>document.querySelector('[role="combobox"]'));
      const search=document.querySelector('[role="combobox"]');fill(search,'fixture');await wait(()=>document.querySelectorAll('[role="option"]').length===1);
      search.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
      search.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await wait(()=>!document.querySelector('[role="listbox"]'));
      if(button('Model').dataset.value!=='fixture/model')throw new Error('Keyboard model selection failed'); await pick('Reasoning level','high'); await pick('Task permissions','workspace-write');
      await click('Save task settings');await wait(()=>!document.querySelector('[role="dialog"]'));
      const dailyTitle=(await snapshot()).workspace.tasks[0].title;
      const configured=(await snapshot()).workspace;if(configured.agents[0].model!==''||configured.agents[0].permission!=='ask'||configured.tasks[0].agentOverrides.permission!=='workspace-write'||configured.tasks[0].agentOverrides.model!=='fixture/model')throw new Error('Task override leaked into agent');
      button('Snooze task').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
      await wait(()=>document.querySelector('[role="menu"]'));
      document.querySelector('[role="menuitem"]').focus();
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const snoozeAnchor=document.querySelector('[aria-label="Task sidebar"] [aria-label="Snooze task"][data-state="open"]');
      const anchorBounds=snoozeAnchor.getBoundingClientRect();
      const menuBounds=document.querySelector('[role="menu"]').getBoundingClientRect();
      if(!anchorBounds.width||!anchorBounds.height)throw new Error('Snooze anchor disappeared after menu took focus');
      if(Math.min(Math.abs(menuBounds.top-anchorBounds.bottom),Math.abs(menuBounds.bottom-anchorBounds.top))>16)throw new Error('Snooze menu detached from task row');
      [...document.querySelectorAll('[role="menuitem"]')].find(el=>el.innerText==='For 1 hour').click();
      await wait(async()=>!!(await snapshot()).workspace.tasks[0].snoozedUntil);
      await pick('Task status filter','snoozed');
      await wait(()=>document.querySelector('[aria-label="Task sidebar"]').innerText.includes(dailyTitle));
      button('Snooze task').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
      await wait(()=>document.querySelector('[role="menu"]'));
      [...document.querySelectorAll('[role="menuitem"]')].find(el=>el.innerText==='Unsnooze').click();
      await wait(async()=>!(await snapshot()).workspace.tasks[0].snoozedUntil);
      await pick('Task status filter','active');
      await click('Settle task');await wait(()=>button('Reopen task'));
      await pick('Task status filter','archived');await wait(()=>document.querySelector('[aria-label="Task sidebar"]').innerText.includes(dailyTitle));
      await click('Reopen task');await wait(async()=>!(await snapshot()).workspace.tasks[0].archived);
      await pick('Task status filter','active');await wait(()=>button('Settle task'));await wait(()=>button('Task status filter').dataset.value==='active'&&document.querySelector('[aria-label="Task sidebar"]').innerText.includes('Pinned'));
      await wait(()=>!document.querySelector('[aria-label="Task tool activity"]').innerText.toLowerCase().includes('running'));
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      if(!button('Choose task model')||!button('Copy message'))throw new Error('AI Elements conversation controls are missing');
      await call('/api/tasks/message',{id:'daily',messageId:'checkpoint-verification',text:'Checkpoint verification'});
      await wait(async()=>{const t=(await snapshot()).workspace.tasks[0];return t.turns.length===3&&t.status==='review'});
      const checkpoint=(await snapshot()).workspace.tasks[0].turns.at(-1).checkpoint;
      if(!checkpoint.before||!checkpoint.after||checkpoint.files[0]?.after!=='Checkpoint fixture change\\n')throw new Error('Checkpoint was not persisted');
      await wait(()=>button('Review turn'));await click('Review turn');await wait(()=>button('Checkpoint file'));
      await wait(()=>document.querySelector('[role="dialog"] diffs-container')?.shadowRoot?.textContent.includes('Checkpoint fixture change'));
      await click('Close');await wait(()=>!document.querySelector('[role="dialog"]'));
      const sidebar=document.querySelector('[aria-label="Task sidebar"]').innerText;
      if(!sidebar.includes('Daily project')||!sidebar.includes('Daily agent')||!sidebar.includes(checkpoint? (await snapshot()).runtimeHost : ''))throw new Error('Sidebar metadata missing');
      fill(document.querySelector('[aria-label="Message task"]'),'Start steering verification');
      await wait(()=>button('Send to agent')&&!button('Send to agent').disabled);await click('Send to agent');
      await wait(()=>button('Stop'));
      if(!document.querySelector('form [aria-label="Stop"]')||button('Run task')||button('Continue task')||button('New session'))throw new Error('Unexpected composer run controls');
      fill(document.querySelector('[aria-label="Message task"]'),'Change direction immediately');
      await wait(()=>button('Steer agent')&&!button('Steer agent').disabled);await click('Steer agent');
      await wait(async()=>{const t=(await snapshot()).workspace.tasks[0];return t.turns.length===5&&t.status==='review'});
      const steered=(await snapshot()).workspace.tasks[0];
      if(steered.turns[3].status!=='cancelled'||!steered.turns[3].checkpoint.after||!steered.messages.some(m=>m.text==='Change direction immediately'))throw new Error('Steering failed');
      const selectedRow=document.querySelector('[aria-label="Task sidebar"] button[aria-current="true"]');selectedRow.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerType:'mouse'}));
      await wait(()=>document.querySelector('[role="tooltip"]')?.textContent.includes('terminal'));
      if(!document.querySelector('[role="tooltip"]').textContent.includes(dailyTitle))throw new Error('Hover details missing title');
      await click('Settings');await wait(()=>[...document.querySelectorAll('summary')].some(el=>el.innerText==='Titles & dictation'));
      [...document.querySelectorAll('summary')].find(el=>el.innerText==='Titles & dictation').click();
      await wait(()=>button('Title harness'));await pick('Title harness',(await snapshot()).workspace.agents[0].id);
      await wait(()=>button('Model')&&!document.body.innerText.includes('Loading provider models'));
      await pick('Model','fixture/model');await pick('Reasoning level','high');
      await click('Save title settings');await wait(()=>document.body.innerText.includes('Title settings saved.'));
      const titleSettings=await call('/api/agents/title-settings/read',{});if(titleSettings.model!=='fixture/model'||titleSettings.reasoning!=='high')throw new Error('Title settings not persisted');
      await click('Tasks');await wait(()=>button('New task'));
      const beforeCreate=await snapshot();
      await click('New task');
      await wait(async()=> (await snapshot()).workspace.tasks.length===beforeCreate.workspace.tasks.length+1);
      await wait(()=>document.querySelector('[aria-label="Message task"]')?.value==='');
      if(document.querySelector('[role="dialog"]'))throw new Error('Task creation still opens a form');
      const createdTask=(await snapshot()).workspace.tasks.find(t=>!beforeCreate.workspace.tasks.some(old=>old.id===t.id));
      if(createdTask.messages.length||createdTask.agentId||createdTask.harness?.provider!=='codex')throw new Error('New task is not an empty direct-harness chat');
      await pick('Task project','repo');
      await pick('Working directory','worktree');await pick('Working directory','main');
      await click('Choose task model');await wait(()=>document.querySelector('[aria-label="Search models"]'));
      await wait(()=>!document.body.innerText.includes('Loading provider models')&&document.querySelector('[role="option"][data-value="fixture/model"]'));
      const pickerBounds=document.querySelector('[aria-label="Choose harness and model"]').getBoundingClientRect();
      const modelTrigger=button('Choose task model').getBoundingClientRect();
      if(Math.abs(pickerBounds.bottom-modelTrigger.top)>20)throw new Error('Model picker is not anchored above composer');
      await click('Favorite Fixture model');await click('Favorite models');
      await wait(()=>document.querySelector('[role="option"][data-value="fixture/model"]'));
      document.querySelector('[role="option"][data-value="fixture/model"]').click();await wait(()=>!document.querySelector('[aria-label="Search models"]'));
      const chooseOption=async(group,value)=>{
        button('Configure task permissions').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));await wait(()=>document.querySelector('[aria-label="'+group+'"] [data-value="'+value+'"]')&&!document.body.innerText.includes('Loading provider models'));
        const option=document.querySelector('[aria-label="'+group+'"] [data-value="'+value+'"]');
        if(!option)throw new Error('Missing harness option '+group+' '+value);
        option.click();await wait(()=>!document.querySelector('[role="menu"]')&&!button('Configure task permissions').disabled);
      };
      await chooseOption('Reasoning level','high');await chooseOption('Service tier','priority');await chooseOption('Harness access','workspace-write');
      const inline=(await snapshot()).workspace.tasks.find(t=>t.id===createdTask.id);
      if(inline.harness.model!=='fixture/model'||inline.harness.reasoning!=='high'||inline.harness.serviceTier!=='priority'||inline.harness.permission!=='workspace-write'||JSON.stringify((await snapshot()).workspace.agents)!==JSON.stringify(beforeCreate.workspace.agents))throw new Error('Inline harness did not persist independently');
      const instruction='Simplify task creation\\nKeep the full context in the conversation.';
      fill(document.querySelector('[aria-label="Message task"]'),instruction);
      const titleFetch=window.fetch;
      window.fetch=(input,init)=>String(input).endsWith('/api/tasks/title')?Promise.resolve(new Response(JSON.stringify({error:'Title generation fixture failed'}),{status:502,headers:{'Content-Type':'application/json'}})):titleFetch(input,init);
      await wait(()=>!button('Send to agent').disabled);await click('Send to agent');
      await wait(()=>document.querySelector('[role="alert"]')?.textContent.includes('fixture failed'));
      if(document.querySelector('[aria-label="Message task"]').value!==instruction||(await snapshot()).workspace.tasks.find(t=>t.id===createdTask.id).messages.length)throw new Error('Title failure lost or submitted task input');
      window.fetch=titleFetch;await wait(()=>!button('Send to agent').disabled);await click('Send to agent');
      await wait(async()=>{const t=(await snapshot()).workspace.tasks.find(t=>t.id===createdTask.id);return t.status==='review'&&t.turns?.[0]?.model==='fixture/model'});
      const started=(await snapshot()).workspace.tasks.find(t=>t.id===createdTask.id);
      if(started.title!=='Simplify task creation'||started.messages[0]?.text!==instruction||started.messages.filter(m=>m.role==='user').length!==1)throw new Error('First send did not define task and title');
      await wait(()=>button('Working directory').disabled);
      return {anchoredModelPicker:true,favoriteModels:true,serviceTier:true,directHarness:true,harnessExecution:true,titleFailureRecovery:true,generatedTitle:true,titleSettings:true,composerTaskCreation:true,checkoutSelection:true,snoozeMenuAnchor:true,hoverDetails:true,snooze:true,settle:true,composerStop:true,steering:true,sidebarMetadata:true,taskPermissions:true,checkpoints:true,keyboardPicker:true,orderedQueue:true,pauseResume:true,idempotentSend:true,turnHistory:true,toolActivity:true,projectGroups:true,pinArchiveRestore:true,taskModelOverride:true,aiElementsConversation:true};
    })()`)
      console.log(JSON.stringify(result))
      fs.writeFileSync(
        '/tmp/dovo-daily-workflow.png',
        (await window.webContents.capturePage()).toPNG(),
      )
      await window.webContents.executeJavaScript(`(async()=>{
        for(let i=0;i<50;i++){
          if(!document.querySelector('[aria-label="Choose task model"]').disabled)break;
          await new Promise(r=>setTimeout(r,100));
        }
        document.querySelector('[aria-label="Choose task model"]').click();
        for(let i=0;i<50;i++){
          const rail=document.querySelector('[aria-label="Codex models"]');
          if(rail){rail.click();break;}await new Promise(r=>setTimeout(r,100));
        }
        for(let i=0;i<50;i++){
          if(document.querySelector('[role="option"][data-value="fixture/model"]'))return;
          await new Promise(r=>setTimeout(r,100));
        }
        throw new Error('Model picker did not reopen');
      })()`)
      fs.writeFileSync(
        '/tmp/dovo-composer-picker.png',
        (await window.webContents.capturePage()).toPNG(),
      )
      exitCode = 0
      app.quit()
    } catch (error) {
      fs.writeFileSync(
        '/tmp/dovo-daily-workflow-failure.png',
        (await window.webContents.capturePage()).toPNG(),
      )
      console.error(error)
      exitCode = 1
      app.quit()
    }
  }),
)
setTimeout(() => {
  console.error('Daily workflow timeout')
  exitCode = 1
  app.quit()
}, 90000).unref()
import(root + '/apps/desktop/dist-electron/main.js').catch((error) => {
  console.error(error)
  app.exit(1)
})
