import { readFileSync } from 'node:fs'
const fixtureUrl = new URL('./check-mobile-composer-actions-browser.mjs', import.meta.url)
const source = readFileSync(fixtureUrl, 'utf8')
const setup = source
  .slice(0, source.indexOf('const browser = await chromium.launch'))
  .replace(
    "'./browser/harness.mjs'",
    JSON.stringify(new URL('./browser/harness.mjs', import.meta.url).href),
  )
  .replaceAll('import.meta.url', JSON.stringify(fixtureUrl.href))
  .replace(
    'return <Composer task={task}',
    'return <Composer task={task} onStartInBackground={window.backgroundCallback===false?undefined:(configuration,attemptId)=>{(window.backgroundStarts??=[]).push({configuration,attemptId});return {confirmed(){},settled(){}}}}',
  )
  .replace(
    'canSend:connected&&!!draft.text,',
    'canSend:connected&&!!draft.text,canStartInBackground:window.backgroundAllowed!==false,backgroundSubmitting:false,',
  )
  .replace(
    'send:mode=>{if(editing)',
    'send:(mode,start)=>{if(start)start("background-attempt");if(editing)',
  )
const test = `
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage({viewport:{width:320,height:900}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setContent('<style>body{margin:0;background:#101010;color:#eee;font-family:system-ui}button,textarea,select{font:inherit}#app{display:flex;flex-direction:column}</style><div id="app"></div>');
  await page.addScriptTag({content:built.outputFiles[0].text});
  await page.evaluate(()=>{window.stageSupported=true;window.setTask({status:'draft',activeRunId:undefined,messages:[],queue:[]})});
  const send=page.getByRole('button',{name:'Send',exact:true});
  const menu=page.getByRole('menu',{name:'Message actions',exact:true});
  const background=page.getByRole('menuitem',{name:'Start in background',exact:true});
  const hold=async()=>{
    await send.hover();
    await page.mouse.down();
    await menu.waitFor();
    await page.mouse.up();
  };
  for(const width of [320,390,768]) {
    await page.setViewportSize({width,height:900});
    await send.waitFor();
    assert.equal(await page.getByRole('button',{name:'Start in background',exact:true}).count(),0,'Background start belongs in the hold menu');
    const sendBounds=await send.boundingBox();
    assert.ok(sendBounds.x>=0&&sendBounds.x+sendBounds.width<=width);
    const model=await page.getByRole('button',{name:'Agent & model',exact:true}).boundingBox();
    assert.ok(model.width>=44,'Model picker should remain usable');
    const before=await page.evaluate(()=>window.calls.length);
    await hold();
    await background.waitFor();
    const bounds=await menu.boundingBox();
    assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width,'Menu stays within viewport');
    assert.equal(await page.evaluate(()=>window.calls.length),before,'Holding and releasing must not send');
    await page.getByRole('button',{name:'Dismiss Message actions',exact:true}).click({position:{x:5,y:5}});
    await menu.waitFor({state:'hidden'});
  }
  await send.click();
  assert.deepEqual(await page.evaluate(()=>window.calls.at(-1)),{mode:'queue'});
  assert.equal(await page.evaluate(()=>window.backgroundStarts?.length??0),0,'Normal tap starts in the foreground');
  await page.evaluate(()=>window.setTurnSettings({model:'selected-model',reasoning:'high'}));
  await hold();
  await background.click();
  await menu.waitFor({state:'hidden'});
  const start=await page.evaluate(()=>window.backgroundStarts);
  assert.equal(start.length,1);
  assert.equal(start[0].attemptId,'background-attempt');
  assert.equal(start[0].configuration.repositoryId,'repo');
  assert.deepEqual(start[0].configuration.draftTurnSettings,{model:'selected-model',reasoning:'high'});
  assert.deepEqual(await page.evaluate(()=>window.calls.at(-1)),{mode:'queue'});
  // Background start does not depend on runtime queue-staging support.
  await page.evaluate(()=>{window.stageSupported=false;window.setTask({queue:[]})});
  await hold();
  await background.waitFor();
  assert.equal(await background.isEnabled(),true);
  assert.equal(await menu.getByRole('menuitem').count(),1,'Older runtimes expose only background start');
  await page.getByRole('button',{name:'Dismiss Message actions',exact:true}).click({position:{x:5,y:5}});
  // Keep the action visibly disabled when an earlier send must be resolved.
  await page.evaluate(()=>{window.backgroundAllowed=false;window.stageSupported=true;window.setTask({queue:[]})});
  await hold();
  assert.equal(await background.isDisabled(),true);
  await page.evaluate(()=>window.setConnected(false));
  assert.equal(await background.isDisabled(),true,'Disconnect disables an already-open action');
  await page.evaluate(()=>{window.setConnected(true);window.setDraftText('')});
  assert.equal(await background.isDisabled(),true,'Empty draft cannot start in background');
  await page.getByRole('button',{name:'Dismiss Message actions',exact:true}).click({position:{x:5,y:5}});
  await page.evaluate(()=>{window.setDraftText('Next prompt');window.backgroundAllowed=true;window.setTask({status:'review',messages:[{id:'first',role:'user',text:'Already sent'}]})});
  await hold();
  assert.equal(await background.count(),0,'Existing threads must not offer background start');
  await page.getByRole('button',{name:'Dismiss Message actions',exact:true}).click({position:{x:5,y:5}});
  await page.evaluate(()=>window.conversation.actions.beginEdit({id:'queued-edit',text:'Edit queued message'}));
  const save=page.getByRole('button',{name:'Save changes',exact:true});
  await save.waitFor();
  assert.equal(await save.getAttribute('aria-description'),null,'Editing keeps its normal save action');
  assert.equal(await background.count(),0);
  await page.evaluate(()=>{window.conversation.actions.cancelEdit();window.backgroundCallback=false;window.setTask({status:'draft',messages:[]})});
  await hold();
  assert.equal(await background.count(),0,'Only the Start thread host supplies this action');
  assert.equal(await page.evaluate(()=>window.backgroundStarts.length),1);
  assert.deepEqual(errors,[]);
  console.log('Mobile background composer: Send hold menu, no accidental send, foreground tap, retained configuration, eligibility and 320/390/768px layout passed with native control adapters.');
} finally {await browser.close();}
`
await import(`data:text/javascript;base64,${Buffer.from(setup + test).toString('base64')}`)
