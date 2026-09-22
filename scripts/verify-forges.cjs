const { app } = require('electron')
const fs = require('node:fs')
const http = require('node:http')
const { execFileSync } = require('node:child_process')
const { join, resolve } = require('node:path')
const root = resolve(__dirname, '..')
const data = fs.mkdtempSync('/tmp/dovo-forges-check-')
const token = 'fixture-only-scoped-token'
const cloneLog = join(data, 'clone.json')
const git = join(data, 'git-fixture.cjs')
let exitCode = 0,
  finishing = false,
  windowRef,
  address
process.env.DOVO_PORT = '0'
process.env.DOVO_HOST = '127.0.0.1'
app.setPath('userData', join(data, 'electron'))
fs.mkdirSync(join(data, 'clones'))
execFileSync('/usr/bin/git', ['init', '-q', '-b', 'main', join(data, 'existing')])
fs.writeFileSync(
  git,
  `#!/usr/bin/env node
const {execFileSync,spawnSync}=require('node:child_process');
const fs=require('node:fs');const args=process.argv.slice(2);
if(args[0]==='clone'){
  const destination=args.at(-1),url=args.at(-2);
  if(!url.startsWith('http://127.0.0.1:')||!destination.startsWith(${JSON.stringify(fs.realpathSync(join(data, 'clones')) + '/')}))process.exit(2);
  fs.writeFileSync(${JSON.stringify(cloneLog)},JSON.stringify({url,destination,headerPresent:process.env.GIT_CONFIG_KEY_0==='http.'+url+'.extraHeader'&&process.env.GIT_CONFIG_VALUE_0?.startsWith('Authorization: Basic '),redirectsDisabled:process.env.GIT_CONFIG_VALUE_2==='false'}));
  execFileSync('/usr/bin/git',['init','-q','-b','main',destination]);process.exit(0);
}
const result=spawnSync('/usr/bin/git',args,{stdio:'inherit'});process.exit(result.status??1);
`,
  { mode: 0o755 },
)

const provider = http.createServer((request, response) => {
  const path = new URL(request.url, address).pathname
  const send = (status, value) => {
    response.writeHead(status, { 'content-type': 'application/json' })
    response.end(JSON.stringify(value))
  }
  if (request.headers.authorization !== `token ${token}`)
    return send(401, { message: 'Fixture token required' })
  if (path === '/forge/api/v1/user/repos' || path === '/forge/api/v1/user')
    return send(403, { message: 'Repository-scoped token' })
  if (path === '/forge/api/v1/version') return send(200, { version: '16.0.5' })
  const match = /^\/forge\/api\/v1\/repos\/team\/(existing|cloned)$/.exec(path)
  if (match)
    return send(200, {
      id: match[1] === 'existing' ? 1 : 2,
      name: match[1],
      full_name: `team/${match[1]}`,
      html_url: `${address}/forge/team/${match[1]}`,
      clone_url: `${address}/forge/team/${match[1]}.git`,
      default_branch: 'main',
      allow_merge_commits: true,
      allow_squash_merge: true,
      allow_rebase: false,
    })
  return send(404, { message: 'Fixture endpoint not found' })
})

async function finish(error) {
  if (finishing) return
  finishing = true
  if (error) {
    exitCode = 1
    console.error(error)
    if (windowRef && !windowRef.isDestroyed()) {
      fs.mkdirSync(join(root, 'work/verification'), { recursive: true })
      fs.writeFileSync(
        join(root, 'work/verification/forge-desktop-failure.png'),
        (await windowRef.webContents.capturePage()).toPNG(),
      )
    }
  }
  provider.closeAllConnections()
  provider.close()
  app.quit()
}
app.once('will-quit', () => {
  fs.rmSync(data, { recursive: true, force: true })
  app.exit(exitCode)
})
app.on('browser-window-created', (_event, window) => {
  windowRef = window
  window.webContents.once('did-finish-load', async () => {
    try {
      const result = await window.webContents.executeJavaScript(`(async()=>{
        const wait=async(check)=>{for(let i=0;i<250;i++){if(await check())return;await new Promise(r=>setTimeout(r,100))}throw new Error('Forge UI timeout: '+document.body.innerText.slice(-2200))};
        const normalize=s=>s.trim().replace(/\\s+/g,' ');
        const button=(label,scope=document)=>[...scope.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===label||b.title===label||normalize(b.innerText)===label);
        const input=(label,value,scope=document)=>{const labelElement=[...scope.querySelectorAll('label')].find(el=>normalize(el.innerText)===label);const field=labelElement?.control??labelElement?.querySelector('input');if(!(field instanceof HTMLInputElement))throw new Error('Missing input '+label);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,value);field.dispatchEvent(new Event('input',{bubbles:true}));};
        const pick=async(label,value)=>{await wait(()=>button(label));button(label).click();await wait(()=>document.querySelector('[role="listbox"]'));await wait(()=>[...document.querySelectorAll('[role="option"]')].some(o=>o.dataset.value===value));const option=[...document.querySelectorAll('[role="option"]')].find(o=>o.dataset.value===value);if(!option)throw new Error('Missing option '+label+': '+value);option.click();await wait(()=>!document.querySelector('[role="listbox"]'));};
        const menu=async(label)=>{button('Projects').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerType:'mouse'}));await wait(()=>document.querySelector('[role="menu"]'));const item=[...document.querySelectorAll('[role^="menuitem"]')].find(m=>normalize(m.innerText)===label);if(!item)throw new Error('Missing Projects item '+label);item.click();await wait(()=>!document.querySelector('[role="menu"]'));};
        const close=async()=>{const dialogs=[...document.querySelectorAll('[role="dialog"]')];button('Close',dialogs.at(-1)).click();await wait(()=>document.querySelectorAll('[role="dialog"]').length<dialogs.length);};
        await wait(()=>document.body.innerText.includes('Workspace synced'));
        const connection=await window.dovo.runtimeConnection();
        const call=async(path,body,method='POST',failure=false)=>{const response=await fetch(connection.address+path,{method,headers:{Authorization:'Bearer '+connection.token,'Content-Type':'application/json'},...(method==='GET'?{}:{body:JSON.stringify(body)})});const result=await response.json();if(!response.ok&&!failure)throw new Error(JSON.stringify(result));return failure?{status:response.status,result}:result;};
        const commands=await call('/api/commands/read',{});await call('/api/commands/save',{...commands.settings,git:${JSON.stringify(git)},gh:${JSON.stringify(join(root, 'scripts/fixtures/github.cjs'))}});
        await call('/api/workspace',{collection:'repositories',id:'forge-project',changes:{},create:{id:'forge-project',name:'Existing fixture',path:${JSON.stringify(join(data, 'existing'))},branch:'main'}},'PATCH');
        const originalFetch=window.fetch;window.forgeAdds=[];const profileReads=[];let failProfileDiscovery=false;let projectRepositoryRead;
        window.fetch=async(input,init)=>{
          const path=String(input);
          if(path.endsWith('/api/scm/repositories/add'))window.forgeAdds.push(JSON.parse(init.body));
          if(path.endsWith('/api/scm/repositories/forge/read'))projectRepositoryRead=JSON.parse(init.body);
          if(path.endsWith('/api/scm/cli-profiles/read')){
            const query=JSON.parse(init.body);profileReads.push(query);
            if(failProfileDiscovery)return new Response(JSON.stringify({error:'Fixture CLI discovery unavailable'}),{status:503});
            return new Response(JSON.stringify({profiles:[{id:'personal',name:'Personal',active:true},{id:'work',name:'Work',username:'developer'}]}));
          }
          return originalFetch(input,init);
        };
        button('Settings').click();await wait(()=>button('Source control'));button('Source control').click();
        await wait(()=>button('Add connection'));button('Add connection').click();await wait(()=>button('CLI profile')&&!button('CLI profile').disabled);
        await pick('CLI project context','forge-project');await wait(()=>profileReads.at(-1)?.repositoryId==='forge-project'&&button('CLI profile')&&!button('CLI profile').disabled);
        await pick('CLI profile','work');failProfileDiscovery=true;button('Refresh profiles').click();await wait(()=>document.body.innerText.includes('Fixture CLI discovery unavailable'));
        const profileField=[...document.querySelectorAll('label')].find(el=>normalize(el.innerText)==='CLI profile (optional)')?.querySelector('input');
        if(profileField?.value!=='work')throw new Error('Discovery failure replaced selected profile');
        input('Connection name','Selected GitHub profile');button('Save connection').click();await wait(()=>document.querySelector('[aria-label="Source control connections"]')?.innerText.includes('Selected GitHub profile'));
        const github=(await call('/api/scm/connections/read',{})).connections.find(c=>c.name==='Selected GitHub profile');
        if(github?.cliProfile!=='work')throw new Error('GitHub CLI account selection was not saved');await call('/api/scm/connections/remove',{id:github.id});failProfileDiscovery=false;
        button('Add connection').click();await pick('Source control provider','forgejo');await pick('Authentication method','token');
        input('Connection name','Scoped Forgejo fixture');input('Server URL',${JSON.stringify(address + '/forge')});input('API token',${JSON.stringify(token)});
        button('Save connection').click();await wait(()=>document.querySelector('[aria-label="Source control connections"]')?.innerText.includes('Scoped Forgejo fixture'));
        const saved=(await call('/api/scm/connections/read',{})).connections[0];
        if(saved.token||JSON.stringify(saved).includes(${JSON.stringify(token)}))throw new Error('Credential returned to client');
        if(saved.baseUrl!==${JSON.stringify(address + '/forge')}||saved.provider!=='forgejo')throw new Error('Wrong connection saved');
        button('Edit').click();await wait(()=>button('Save connection'));input('Connection name','Scoped Forgejo');
        const tokenField=document.querySelector('input[type="password"]');if(tokenField.value)throw new Error('Saved token exposed in edit form');
        button('Save connection').click();await wait(()=>document.querySelector('[aria-label="Source control connections"]')?.innerText.includes('Scoped Forgejo'));
        button('Tasks').click();await wait(()=>button('Projects'));await menu('Existing fixture');await menu('Project settings');
        await wait(()=>button('Source control connection'));await pick('Source control connection',saved.id);
        input('Owner / repository','team/existing');button('Browse repositories…').click();
        await wait(()=>document.body.innerText.includes('token scoped to specific repositories'));
        if(projectRepositoryRead?.repositoryId!=='forge-project')throw new Error('Repository discovery did not use the project checkout');
        button('Save project connection').click();await wait(()=>document.body.innerText.includes('Project connection saved.'));
        const bound=(await call('/api/snapshot',{},'GET')).workspace.repositories.find(r=>r.id==='forge-project');
        if(bound.forge?.connectionId!==saved.id||bound.forge.repository!=='team/existing')throw new Error('Project binding was not persisted');
        const refused=await call('/api/scm/connections/remove',{id:saved.id},'POST',true);if(refused.status!==409)throw new Error('Linked connection removal was allowed');
        await close();await menu('Add project');button('Connected provider').click();
        await pick('Source control connection',saved.id);input('Name','Cloned provider project');input('Owner / repository','team/cloned');input('Clone parent folder',${JSON.stringify(join(data, 'clones'))});
        button('Connections').click();await wait(()=>document.querySelectorAll('[role="dialog"]').length===2);button('Edit').click();
        await wait(()=>button('Save connection'));input('Connection name','Scoped Forgejo');button('Save connection').click();
        await wait(()=>document.querySelector('[aria-label="Source control connections"]')?.innerText.includes('Scoped Forgejo'));
        if(window.forgeAdds.length)throw new Error('Nested connection form submitted clone form');
        await close();await wait(()=>button('Clone and add project')&&!button('Clone and add project').disabled);button('Clone and add project').click();
        await wait(()=>!document.querySelector('[role="dialog"]'));
        const snapshot=await call('/api/snapshot',{},'GET');
        const cloned=snapshot.workspace.repositories.find(r=>r.name==='Cloned provider project');
        if(!cloned||cloned.forge?.connectionId!==saved.id||cloned.forge.repository!=='team/cloned')throw new Error('Clone binding not saved');
        if(window.forgeAdds.length!==1||window.forgeAdds[0].source!=='forge'||window.forgeAdds[0].forge.repository!=='team/cloned'||window.forgeAdds[0].directory!==${JSON.stringify(join(data, 'clones'))})throw new Error('Clone form payload incorrect');
        if(JSON.stringify(snapshot).includes(${JSON.stringify(token)}))throw new Error('Credential leaked into workspace snapshot');
        button('Settings').click();await wait(()=>button('Source control'));button('Source control').click();await wait(()=>button('Remove'));
        if(!button('Remove').disabled)throw new Error('Linked account remove control is enabled');await wait(()=>document.querySelector('[aria-label="Source control connections"]')?.innerText.includes('2 linked projects'));
        window.forgeCheck={id:saved.id,clonedId:cloned.id};
        return {detectedProfiles:true,profileCheckoutContext:true,profileFallbackPreservesSelection:true,githubAccountSelection:true,repositoryCheckoutContext:true,connectionSetup:true,secretWriteOnly:true,tokenRetainedOnEdit:true,scopedDiscoveryFallback:true,projectBinding:true,linkedRemovalBlocked:true,nestedFormIsolation:true,clonePayload:true,cloneBinding:true};
      })()`)
      const cloned = JSON.parse(fs.readFileSync(cloneLog, 'utf8'))
      if (!cloned.headerPresent || !cloned.redirectsDisabled || !cloned.url.startsWith(address))
        throw new Error('Clone did not use host-scoped credential transport')
      console.log(JSON.stringify({ ...result, cloneCredentialTransport: true }))
      fs.mkdirSync(join(root, 'work/verification'), { recursive: true })
      fs.writeFileSync(
        join(root, 'work/verification/forge-desktop-connections.png'),
        (await window.webContents.capturePage()).toPNG(),
      )
      await new Promise((resolve) => {
        window.webContents.once('did-finish-load', resolve)
        window.webContents.reload()
      })
      const persisted = await window.webContents.executeJavaScript(`(async()=>{
        const wait=async(check)=>{for(let i=0;i<250;i++){if(await check())return;await new Promise(r=>setTimeout(r,100))}throw new Error('Forge reload timeout')};
        await wait(()=>document.body.innerText.includes('Workspace synced'));
        const c=await window.dovo.runtimeConnection(),response=await fetch(c.address+'/api/snapshot',{headers:{Authorization:'Bearer '+c.token}}),snapshot=await response.json();
        if(snapshot.workspace.repositories.filter(r=>r.forge?.repository==='team/existing'||r.forge?.repository==='team/cloned').length!==2)throw new Error('Bindings lost after renderer reload');
        return {bindingsPersistAfterReload:true};
      })()`)
      console.log(JSON.stringify(persisted))
      await finish()
    } catch (error) {
      await finish(error)
    }
  })
})
setTimeout(() => void finish(new Error('Forge verification timeout')), 120000).unref()
provider.listen(0, '127.0.0.1', () => {
  address = `http://127.0.0.1:${provider.address().port}`
  import(root + '/apps/desktop/dist-electron/main.js').catch(finish)
})
