const { app } = require('electron')
process.env.DOVO_PORT = '0'
process.env.DOVO_HOST = '127.0.0.1'
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const data = fs.mkdtempSync('/tmp/dovo-automator-')
const repo = path.join(data, 'repo')
fs.mkdirSync(repo)
execFileSync('git', ['init', '-q'], { cwd: repo })
execFileSync(
  'git',
  [
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    'commit',
    '--allow-empty',
    '-qm',
    'Fixture',
  ],
  { cwd: repo },
)
app.setPath('userData', path.join(data, 'electron'))
let exitCode = 1
app.once('will-quit', () => {
  fs.rmSync(data, { recursive: true, force: true })
  app.exit(exitCode)
})
app.on('browser-window-created', (_event, window) =>
  window.webContents.once('did-finish-load', async () => {
    try {
      window.show()
      window.webContents.setBackgroundThrottling(false)
      const point = await window.webContents.executeJavaScript(`(async()=>{
      window.waitForAutomation=async check=>{for(let i=0;i<150;i++){if(await check())return;await new Promise(r=>setTimeout(r,100))}throw new Error('Automator timeout writes='+window.automationNodeWrites+': '+check.toString()+' '+document.body.innerText.slice(-900))};
      const wait=window.waitForAutomation;
      const button=window.automationButton=label=>[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===label||b.innerText.trim()===label);
      await wait(()=>document.body.innerText.includes('Workspace synced'));
      const connection=await window.dovo.runtimeConnection();
      window.automationCall=async(path,body,method='POST')=>{const r=await fetch(connection.address+path,{method,headers:{Authorization:'Bearer '+connection.token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const result=await r.json();if(!r.ok)throw new Error(JSON.stringify(result));return result};
      const call=window.automationCall;
      window.automationSnapshot=()=>call('/api/snapshot',null,'GET');
      const config=await call('/api/commands/read',{});await call('/api/commands/save',{...config.settings,codex:${JSON.stringify(path.join(root, 'scripts/fixtures/codex.cjs'))}});
      const base={label:'Step',kind:'trigger',trigger:'manual',schedule:'',timezone:'UTC',objective:'Fixture automation work',agentId:'automation-agent',repositoryId:'automation-repo',execution:'main'};
      const flow={id:'automation-fixture',name:'Automation fixture',nodes:['trigger','task','review'].map((id,i)=>({id,type:'automation',position:{x:80+i*320,y:80},data:{...base,kind:id,label:id}})),edges:[{id:'one',source:'trigger',target:'task'},{id:'two',source:'task',target:'review'}]};
      for(const [collection,entity] of [['repositories',{id:'automation-repo',name:'Automation repo',path:${JSON.stringify(repo)},branch:'main'}],['agents',{id:'automation-agent',name:'Automation agent',provider:'codex',model:'',instructions:'',permission:'ask',endpoint:''}],['automations',flow]])await call('/api/workspace',{collection,id:entity.id,create:entity,changes:{}},'PATCH');
      button('Automations').click();await wait(()=>button('Automation'));button('Canvas').click();button('Automation').click();await wait(()=>document.querySelector('[data-value="automation-fixture"]'));document.querySelector('[data-value="automation-fixture"]').click();
      await wait(()=>button('Automation').dataset.value==='automation-fixture'&&document.querySelector('.react-flow__node[data-id="task"]')&&getComputedStyle(document.querySelector('.react-flow__node[data-id="task"]')).visibility==='visible');
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      window.automationNodeWrites=0;window.automationGraphWrites=0;const original=window.fetch;window.fetch=(input,init)=>{if(String(input).endsWith('/api/workspace')&&init?.body){const p=JSON.parse(init.body);if(p.collection==='automations'){if(p.changes.nodes)window.automationNodeWrites++;if(p.changes.nodes||p.changes.edges)window.automationGraphWrites++}}if(String(input).endsWith('/api/jobs/run')&&!window.automationLostReply){window.automationLostReply=true;return original(input,init).then(()=>{throw new TypeError('Fixture lost start reply')})}return original(input,init)};
      const bounds=document.querySelector('.react-flow__node[data-id="task"]').getBoundingClientRect();return {x:Math.round(bounds.x+70),y:Math.round(bounds.y+40)};
    })()`)
      window.webContents.sendInputEvent({
        type: 'mouseDown',
        x: point.x,
        y: point.y,
        button: 'left',
        clickCount: 1,
      })
      for (let i = 1; i <= 12; i++) {
        window.webContents.sendInputEvent({
          type: 'mouseMove',
          x: point.x + i * 4,
          y: point.y + i * 3,
          button: 'left',
          modifiers: ['leftButtonDown'],
        })
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      const during = await window.webContents.executeJavaScript('window.automationNodeWrites')
      if (during !== 0) throw new Error(`Dragging sent ${during} intermediate graph writes`)
      window.webContents.sendInputEvent({
        type: 'mouseUp',
        x: point.x + 48,
        y: point.y + 36,
        button: 'left',
        clickCount: 1,
      })
      const result = await window.webContents.executeJavaScript(`(async()=>{
      const wait=window.waitForAutomation,button=window.automationButton,snapshot=window.automationSnapshot;
      await wait(()=>window.automationNodeWrites===1);
      await wait(async()=>{const f=(await snapshot()).workspace.automations.find(f=>f.id==='automation-fixture');return f.nodes.find(n=>n.id==='task').position.x!==400});
      document.querySelector('.react-flow__edge[data-id="two"]').dispatchEvent(new MouseEvent('click',{bubbles:true}));
      await wait(()=>document.querySelector('.react-flow__edge[data-id="two"].selected'));
      if(window.automationGraphWrites!==1)throw new Error('Selection persisted graph data');
      const edge=document.querySelector('.react-flow__edge[data-id="two"]');edge.focus();
      edge.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',code:'Delete',bubbles:true}));await new Promise(r=>setTimeout(r,50));edge.dispatchEvent(new KeyboardEvent('keyup',{key:'Delete',code:'Delete',bubbles:true}));
      await wait(async()=>!(await snapshot()).workspace.automations.find(f=>f.id==='automation-fixture').edges.some(e=>e.id==='two'));
      if(!button('Run automation').disabled)throw new Error('Disconnected graph can run');
      const f=(await snapshot()).workspace.automations.find(f=>f.id==='automation-fixture');await window.automationCall('/api/workspace',{collection:'automations',id:f.id,changes:{edges:{before:f.edges,after:[...f.edges,{id:'two',source:'task',target:'review'}]}}},'PATCH');
      await wait(()=>!button('Run automation').disabled);button('Run automation').click();
      await wait(()=>button('Retry start')&&!button('Retry start').disabled);button('Retry start').click();
      await wait(()=>button('Cancel run'));if(!button('Run automation').disabled)throw new Error('Active run can be submitted again');
      const initialRuns=(await snapshot()).runs.filter(r=>r.automationId==='automation-fixture');
      if(initialRuns.length!==1)throw new Error('Lost start reply created duplicate runs');
      await wait(()=>button('Approve & continue'));
      if(!document.querySelector('[aria-label="Run steps"]')||!document.querySelector('[aria-label="Automation progress"]'))throw new Error('Missing run step progress');
      const reviewRun=(await snapshot()).runs.find(r=>r.id===initialRuns[0].id);
      if(!reviewRun.steps.some(s=>s.kind==='task'&&s.status==='completed'&&s.taskId))throw new Error('Missing completed task context');
      button('Reject').click();await wait(()=>button('Resume run'));
      button('Resume run').click();await wait(()=>button('Approve & continue'));
      const retried=(await snapshot()).runs.find(r=>r.id===reviewRun.id);
      if(JSON.stringify(retried.taskIds)!==JSON.stringify(reviewRun.taskIds))throw new Error('Retry duplicated completed tasks');
      button('Approve & continue').click();
      await wait(()=>document.querySelector('[aria-label="Automation progress"]')?.getAttribute('aria-valuenow')==='3');
      const complete=(await snapshot()).runs.find(r=>r.id===reviewRun.id);
      if(complete.status!=='completed'||complete.attempt!==2)throw new Error('Retry did not complete the same run');
      const finishedFlow=(await snapshot()).workspace.automations.find(f=>f.id==='automation-fixture');
      await window.automationCall('/api/workspace',{collection:'automations',id:finishedFlow.id,changes:{nodes:{before:finishedFlow.nodes,after:finishedFlow.nodes.map(n=>n.data.kind==='trigger'?{...n,data:{...n.data,trigger:'webhook'}}:n)}}},'PATCH');
      button('Triggers').click();await wait(()=>button('Rotate webhook credential'));button('Rotate webhook credential').click();await wait(()=>document.querySelector('code')?.textContent);button('Runs').click();await wait(()=>!document.querySelector('code'));button('Triggers').click();await wait(()=>document.querySelector('code')?.textContent);
      button('New automation').click();await wait(()=>button('Run automation').disabled);
      if(document.querySelector('code')?.textContent)throw new Error('Previous webhook credential leaked into another flow');
      return {dragPersistence:true,edgeSelectionAndDeletion:true,validation:true,runAndReview:true,lostReplyIdempotency:true,retryPreservesTasks:true,stepProgress:true,flowSwitch:true,triggerCredentialScope:true};
    })()`)
      console.log(JSON.stringify(result))
      fs.writeFileSync('/tmp/dovo-automator.png', (await window.webContents.capturePage()).toPNG())
      exitCode = 0
    } catch (error) {
      console.error(error)
      fs.writeFileSync(
        '/tmp/dovo-automator-failure.png',
        (await window.webContents.capturePage()).toPNG(),
      )
    }
    app.quit()
  }),
)
setTimeout(() => {
  console.error('Automator verification timeout')
  app.quit()
}, 60000).unref()
import(root + '/apps/desktop/dist-electron/main.js').catch((error) => {
  console.error(error)
  app.exit(1)
})
