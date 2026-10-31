import { readFileSync } from 'node:fs'

const fixtureUrl = new URL('./check-composer-send-browser.mjs', import.meta.url)
const source = readFileSync(fixtureUrl, 'utf8')
const setup = source
  .slice(0, source.indexOf('const browser = await chromium.launch'))
  .replace("'esbuild'", JSON.stringify(import.meta.resolve('esbuild')))
  .replace(
    "'./browser/harness.mjs'",
    JSON.stringify(new URL('./browser/harness.mjs', import.meta.url).href),
  )
  .replaceAll('import.meta.url', JSON.stringify(fixtureUrl.href))
  .replace(
    "const preferences={showPlanButton:true,showSendOptions:true,followUp:'queue',confirmStop:false};",
    "const preferences={showPlanButton:true,showSendOptions:true,followUp:'queue',confirmStop:false};window.composerPreferences=preferences;",
  )
  .replace(
    'controller,submitBusy,submittedText,disabled})',
    'controller,submitBusy,submittedText,disabled,input})',
  )
  .replace('<textarea data-editor-mount={mount}', '<textarea ref={input} data-editor-mount={mount}')
  .replace(
    'permissionPolicySupported:true}};',
    'permissionPolicySupported:true,promptQueueStagingSupported:true,queuePausePreservationSupported:true,planModeSupported:true}};',
  )
const test = `
const browser = await chromium.launch({headless:true});
try {
  const page = await browser.newPage();
  await page.route('https://dovo.test/**', route => route.fulfill({contentType:'text/html',body:'<div id="app"></div>'}));
  await page.goto('https://dovo.test/'); await page.addScriptTag({content:built.outputFiles[0].text});
  // Add to queue starts idle work; later prompts use the same automatically drained queue.
  await page.getByRole('textbox',{name:'Message'}).fill('Automatic first prompt');
  await page.getByRole('button',{name:'More message actions'}).click();
  await page.getByRole('menuitem',{name:'Add to queue',exact:true}).click();
  await page.waitForFunction(() => window.requests.some(request => request.path === '/api/tasks/message'));
  assert.equal(await page.evaluate(() => window.requests.find(request => request.path === '/api/tasks/message').input.queueOnly),undefined);
  assert.equal(await page.evaluate(() => window.requests.find(request => request.path === '/api/tasks/message').input.preserveQueuePause),true);
  await page.evaluate(() => window.response());
  await page.waitForFunction(() => document.querySelector('form').getAttribute('aria-busy') !== 'true');
  await page.evaluate(() => window.setTask(task=>({...task,status:'running',activeRunId:'automatic-run',messages:[{id:'first',role:'user',text:'Automatic first prompt'}]})));
  await page.getByRole('textbox',{name:'Message'}).fill('Automatic second prompt');
  await page.getByRole('button',{name:'Queue follow-up',exact:true}).click();
  await page.waitForFunction(() => window.requests.filter(request => request.path === '/api/tasks/message').length === 2);
  assert.deepEqual(await page.evaluate(() => window.requests.filter(request => request.path === '/api/tasks/message').map(request => ({text:request.input.text,queueOnly:request.input.queueOnly}))),[{text:'Automatic first prompt',queueOnly:undefined},{text:'Automatic second prompt',queueOnly:undefined}]);
  assert.equal(await page.evaluate(() => window.requests.some(request => request.path === '/api/tasks/queue')),false);
  await page.evaluate(() => window.response());
  await page.reload(); await page.addScriptTag({content:built.outputFiles[0].text});
  // A remote pause/start with Steer preferred must not change an automatic retry identity/mode.
  await page.getByRole('textbox',{name:'Message'}).fill('Automatic retry');
  await page.getByRole('button',{name:'Send to agent',exact:true}).click();
  await page.waitForFunction(() => window.requests.some(request => request.path === '/api/tasks/message'));
  const retryId=await page.evaluate(() => window.requests.find(request=>request.path==='/api/tasks/message').input.messageId);
  await page.evaluate(() => {window.fail=true;window.response()});
  await page.getByRole('alert').filter({hasText:'Network failure'}).waitFor();
  await page.evaluate(() => {window.composerPreferences.followUp='steer';window.setTask(task=>({...task,status:'running',activeRunId:'new-run',queuePaused:true,queue:[{id:'other',role:'user',text:'Paused elsewhere'}]}))});
  await page.getByRole('button',{name:'Queue follow-up',exact:true}).click();
  await page.waitForFunction(() => window.requests.filter(request => request.path === '/api/tasks/message').length === 2);
  const retried=await page.evaluate(()=>window.requests.filter(request=>request.path==='/api/tasks/message')[1].input);
  assert.equal(retried.messageId,retryId);assert.equal(retried.preserveQueuePause,true);assert.equal(retried.queueOnly,undefined);
  await page.evaluate(() => {window.fail=false;window.response()});
  await page.reload(); await page.addScriptTag({content:built.outputFiles[0].text});
  await page.evaluate(() => window.setTask(task => ({...task, autoProject:true})));
  await page.getByRole('textbox',{name:'Message'}).fill('Stage the first task');
  await page.getByRole('button',{name:'More message actions'}).click();
  await page.getByRole('menuitem',{name:'Add without starting'}).click();
  await page.waitForFunction(() => window.requests.some(request => request.path === '/api/tasks/message'));
  const result = await page.evaluate(() => ({requests:window.requests,task:window.current}));
  const select = result.requests.findIndex(request => request.path === '/api/tasks/projects/select');
  const send = result.requests.findIndex(request => request.path === '/api/tasks/message');
  assert.ok(select >= 0 && select < send); assert.equal(result.requests[send].input.queueOnly,true);
  assert.equal(result.task.repositoryId,'selected-project'); assert.equal(result.task.title,'Stage the first task');
  await page.evaluate(() => window.response());
  await page.waitForFunction(() => window.requests.some(request => request.path === '/api/tasks/title'));
  assert.equal(await page.evaluate(() => window.requests.find(request => request.path === '/api/tasks/title').input.expectedTitle),'Stage the first task');
  await page.reload(); await page.addScriptTag({content:built.outputFiles[0].text});
  await page.evaluate(() => window.setTask(task => ({...task,status:'idle',queuePaused:false,draftPlan:true,draftAttachments:[{id:'original-file',name:'original.txt',mime:'text/plain',size:1}],draftTurnSettings:{provider:'codex',model:'fast-model',reasoning:'low'},queue:[{id:'head',role:'user',text:'Paused first',paused:true}]})));
  await page.getByRole('textbox',{name:'Message'}).fill('Next prompt');
  await page.getByRole('button',{name:'More message actions'}).click();
  assert.equal(await page.getByRole('menuitem',{name:'Add and run queue'}).isDisabled(),true);
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Add to queue',exact:true}).click();
  await page.waitForFunction(() => window.requests.some(request => request.path === '/api/tasks/message'));
  assert.equal(await page.evaluate(() => window.requests.find(request => request.path === '/api/tasks/message').input.queueOnly),true);
  assert.deepEqual(await page.evaluate(() => window.requests.find(request => request.path === '/api/tasks/message').input.attachmentIds),['original-file']);
  assert.equal(await page.evaluate(() => window.requests.find(request => request.path === '/api/tasks/message').input.plan),true);
  const nextInput = page.getByRole('textbox',{name:'Message'});
  assert.equal(await nextInput.isEditable(),true); assert.equal(await nextInput.inputValue(),'');
  assert.equal(await nextInput.evaluate(element => document.activeElement === element),true);
  await nextInput.fill('A second prompt'); await nextInput.evaluate(element => element.closest('form').requestSubmit());
  assert.equal(await page.evaluate(() => window.requests.filter(request => request.path === '/api/tasks/message').length),1);
  await page.evaluate(() => window.response());
  await page.waitForFunction(() => window.response && window.current.draft === 'A second prompt');
  assert.equal(await nextInput.inputValue(),'A second prompt');
  assert.equal(await page.getByRole('button',{name:'Add to queue',exact:true}).isDisabled(),true);
  await page.evaluate(() => {const id=window.requests.find(request=>request.path==='/api/tasks/message').input.messageId;window.setTask(task=>({...task,draftTurnSettings:null,draftPlan:false,draftAttachments:[],queue:[...task.queue,{id,role:'user',text:'Next prompt'}]}))});
  await page.waitForFunction(() => window.current.draftTurnSettings?.model === 'fast-model');
  assert.equal(await page.evaluate(() => window.current.draftPlan),true);
  assert.deepEqual(await page.evaluate(() => window.current.draftAttachments),[]);
  assert.equal(await nextInput.inputValue(),'A second prompt');
  assert.equal(await page.getByRole('button',{name:'Add to queue',exact:true}).isEnabled(),true);
  await page.reload(); await page.addScriptTag({content:built.outputFiles[0].text});
  await page.evaluate(() => window.setTask(task => ({...task,status:'running',activeRunId:'run',draftAttachments:[{id:'failed-file',name:'failed.txt',mime:'text/plain',size:1}]})));
  await page.getByRole('textbox',{name:'Message'}).fill('First running prompt');
  await page.getByRole('button',{name:'Queue follow-up'}).click();
  await page.waitForFunction(() => window.requests.some(request => request.path === '/api/tasks/message'));
  await page.getByRole('textbox',{name:'Message'}).fill('New running draft');
  await page.evaluate(() => {window.fail=true;window.response()});
  await page.getByRole('alert').filter({hasText:"Remove the failed prompt's attachments"}).waitFor();
  assert.equal(await page.getByRole('textbox',{name:'Message'}).inputValue(),'New running draft');
  assert.equal(await page.getByRole('button',{name:'Queue follow-up'}).isDisabled(),true);
  await page.reload(); await page.addScriptTag({content:built.outputFiles[0].text});
  const gapInput=page.getByRole('textbox',{name:'Message'});
  await gapInput.fill('Stage A');
  await page.getByRole('button',{name:'More message actions'}).click();
  await page.getByRole('menuitem',{name:'Add without starting'}).click();
  await page.waitForFunction(() => window.requests.filter(request=>request.path==='/api/tasks/message').length===1);
  await page.evaluate(() => window.response());
  await page.getByRole('button',{name:'Add to queue',exact:true}).waitFor();
  await gapInput.fill('Stage B');
  await page.getByRole('button',{name:'Add to queue',exact:true}).click();
  await page.waitForFunction(() => window.requests.filter(request=>request.path==='/api/tasks/message').length===2);
  const stagedRequests=await page.evaluate(() => window.requests.filter(request=>request.path==='/api/tasks/message'));
  assert.deepEqual(stagedRequests.map(request=>request.input.queueOnly),[true,true]);
  assert.deepEqual(stagedRequests.map(request=>request.input.text),['Stage A','Stage B']);
  await page.evaluate(() => window.response());
  await page.evaluate(() => {const requests=window.requests.filter(request=>request.path==='/api/tasks/message');window.setTask(task=>({...task,queuePaused:true,queue:requests.map(request=>({id:request.input.messageId,role:'user',text:request.input.text}))}))});
  await page.waitForFunction(() => window.current.queue.length===2);
  await page.evaluate(() => window.setTask(task=>({...task,queuePaused:false})));
  await gapInput.fill('Normal follow-up');
  await page.getByRole('button',{name:'Send to agent',exact:true}).waitFor();
  await page.reload(); await page.addScriptTag({content:built.outputFiles[0].text});
  // Two acknowledged stages can await different snapshots while a third draft is composed.
  await page.reload(); await page.addScriptTag({content:built.outputFiles[0].text});
  await page.evaluate(() => window.setTask(task=>({...task,status:'idle',queuePaused:true,draftPlan:true,draftTurnSettings:{provider:'codex',model:'fast-model',reasoning:'low'},queue:[{id:'head',role:'user',text:'Existing prompt'}]})));
  const protectedInput=page.getByRole('textbox',{name:'Message'});
  await protectedInput.fill('Protected A');
  await page.getByRole('button',{name:'Add to queue',exact:true}).click();
  await page.waitForFunction(() => window.requests.filter(request=>request.path==='/api/tasks/message').length===1);
  await protectedInput.fill('Protected B');
  await page.evaluate(() => window.response());
  await page.waitForFunction(() => !document.querySelector('button[type=submit]').disabled);
  await page.getByRole('button',{name:'Add to queue',exact:true}).click();
  await page.waitForFunction(() => window.requests.filter(request=>request.path==='/api/tasks/message').length===2);
  await protectedInput.fill('Protected C');
  await page.evaluate(() => window.response());
  await page.waitForFunction(() => !document.querySelector('button[type=submit]').disabled);
  for (const index of [0,1]) {
    await page.evaluate(index => {const request=window.requests.filter(request=>request.path==='/api/tasks/message')[index];window.setTask(task=>({...task,draftTurnSettings:null,draftPlan:false,queue:[...task.queue,{id:request.input.messageId,role:'user',text:request.input.text}]}))},index);
    await page.waitForFunction(() => window.current.draftTurnSettings?.model==='fast-model' && window.current.draftPlan===true);
    assert.equal(await protectedInput.inputValue(),'Protected C');
  }
  await page.reload(); await page.addScriptTag({content:built.outputFiles[0].text});
  await page.evaluate(() => {window.failAuto=true;window.setTask(task => ({...task,autoProject:true}))});
  await page.getByRole('textbox',{name:'Message'}).fill('Cannot select project');
  await page.getByRole('button',{name:'More message actions'}).click();
  await page.getByRole('menuitem',{name:'Add without starting'}).click();
  await page.getByRole('alert').filter({hasText:'Scope needs a project choice'}).waitFor();
  assert.equal(await page.evaluate(() => window.requests.some(request => request.path === '/api/tasks/message')),false);
  console.log('Desktop automatic Add to queue, explicit staging and paused-queue setup checks passed');
} finally { await browser.close(); }
`
await import(`data:text/javascript;base64,${Buffer.from(setup + test).toString('base64')}`)
