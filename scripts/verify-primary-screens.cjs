const { app } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const data = fs.mkdtempSync('/tmp/dovo-primary-screens-')
const repo = path.join(data, 'repo')
const screenshots = path.join(root, 'work/verification')
fs.mkdirSync(repo)
fs.mkdirSync(screenshots, { recursive: true })
execFileSync('git', ['init', '-q', repo])
execFileSync('git', [
  '-C',
  repo,
  '-c',
  'user.name=Fixture',
  '-c',
  'user.email=fixture@example.invalid',
  'commit',
  '--allow-empty',
  '-qm',
  'Fixture',
])
process.env.DOVO_PORT = '0'
process.env.DOVO_HOST = '127.0.0.1'
app.setPath('userData', path.join(data, 'electron'))
let exitCode = 1
app.once('will-quit', () => {
  fs.rmSync(data, { recursive: true, force: true })
  app.exit(exitCode)
})
app.on('browser-window-created', (_event, window) => {
  window.webContents.setBackgroundThrottling(false)
  window.webContents.once('did-finish-load', async () => {
    const run = (source) => window.webContents.executeJavaScript(`(async () => {${source}})()`)
    const capture = async (name) => {
      await run(
        'await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
      )
      fs.writeFileSync(
        path.join(screenshots, `primary-${name}.png`),
        (await window.webContents.capturePage()).toPNG(),
      )
    }
    try {
      window.setSize(1200, 840)
      await run(`
        window.qa = {};
        qa.wait = async check => { for(let i=0;i<150;i++){if(await check())return;await new Promise(r=>setTimeout(r,100))}throw new Error('Screen timeout: '+document.body.innerText.slice(-1000)) };
        qa.button = label => [...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===label||b.title===label||b.innerText.trim()===label);
        qa.results = [];
        qa.check = (name, condition, details) => qa.results.push({name,pass:!!condition,...(condition?{}:{details})});
        qa.contained = (element, parent) => {const a=element.getBoundingClientRect(),b=parent.getBoundingClientRect();return a.left>=b.left-1&&a.right<=b.right+1&&a.top>=b.top-1&&a.bottom<=b.bottom+1};
        qa.pageFits = () => document.querySelector('.studio-main').scrollWidth<=document.querySelector('.studio-main').clientWidth+1;
        const connection = await window.dovo.runtimeConnection();
        qa.call = async (route,body,method='POST') => {const response=await fetch(connection.address+route,{method,headers:{Authorization:'Bearer '+connection.token,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const value=await response.json();if(!response.ok)throw new Error(JSON.stringify(value));return value};
        await qa.wait(()=>document.body.innerText.includes('Workspace synced'));
        await qa.wait(()=>qa.button('Create task'));
        qa.check('Fresh workspace has useful empty task screen',!!qa.button('Create task'));
        const initial=await qa.call('/api/snapshot',undefined,'GET');
        qa.agent=initial.workspace.agents[0];
        qa.projectName='customer-platform-authorization-and-organization-management-service';
        qa.agentName='CustomerPlatformAuthorizationAndOrganizationManagementAssistant';
        qa.resourceName='CustomerPlatformAuthorizationAndOrganizationManagementDocumentationServer';
        const project={id:'qa-repo',name:qa.projectName,path:${JSON.stringify(repo)},branch:'feature/customer-platform-authorization-and-organization-management',resources:{mcpServers:[{name:qa.resourceName,enabled:false,transport:'http',url:'https://example.invalid/mcp'}],skills:[]}};
        await qa.call('/api/workspace',{collection:'repositories',id:project.id,create:project,changes:{}},'PATCH');
        await qa.call('/api/workspace',{collection:'agents',id:qa.agent.id,changes:{name:{before:qa.agent.name,after:qa.agentName},model:{before:qa.agent.model,after:'vendor/customer-platform-authorization-and-organization-management-model'}}},'PATCH');
        for(const id of ['qa-first','qa-second'])await qa.call('/api/workspace',{collection:'tasks',id,create:{id,title:id==='qa-first'?'Inspect primary screen layout':'Second task',repositoryId:project.id,agentId:qa.agent.id,execution:'main',status:'draft',createdAt:new Date().toISOString(),messages:[],files:[],draft:'',example:false},changes:{}},'PATCH');
        await qa.call('/api/workspace',{collection:'tasks',id:'qa-first',changes:{files:{before:[],after:[{path:'review.ts',before:'old\\n',after:'updated\\n',viewed:false}]}}},'PATCH');
        await qa.wait(()=>[...document.querySelectorAll('button')].some(b=>b.innerText.includes('Inspect primary screen layout')));
        [...document.querySelectorAll('button')].find(b=>b.innerText.includes('Inspect primary screen layout')).click();
        await qa.wait(()=>document.querySelector('h1')?.textContent==='Inspect primary screen layout');
        qa.button('Changes').click();
        await qa.wait(()=>qa.button('Changes').getAttribute('aria-pressed')==='true'&&qa.button('Apply saved draft to disk'));
        const header=document.querySelector('h1').closest('header');
        const metadata=header.querySelector('h1').parentElement.nextElementSibling;
        qa.check('Task metadata stays inside conversation',metadata.scrollWidth<=metadata.clientWidth+1,{scroll:metadata.scrollWidth,width:metadata.clientWidth});
        const review=qa.button('Apply saved draft to disk').closest('aside');
        qa.check('Review actions stay inside review pane',qa.contained(qa.button('Reload disk changes'),review));
        qa.check('Task screen fits viewport',qa.pageFits());
        qa.button('Split with chat').click();
        await qa.wait(()=>qa.button('Close split view'));
        qa.check('Composer project and branch fit their row',qa.contained(qa.button('Checkout branch'),qa.button('Checkout branch').parentElement));
        qa.check('Review actions fit split panel width',qa.contained(qa.button('Reload disk changes'),review),{width:review.clientWidth});
        qa.button('Close split view').click();
      `)
      await capture('tasks')
      await run(`
        qa.button('Terminal').click();await qa.wait(()=>qa.button('Open terminal'));
        const nativeFetch=window.fetch;
        qa.terminalRequests=0;
        qa.releaseTerminal=null;
        window.fetch=(input,init)=>{
          if(String(input).endsWith('/api/terminals')&&init?.method==='POST'){
            qa.terminalRequests++;
            return new Promise(resolve=>{qa.releaseTerminal=()=>resolve(new Response(JSON.stringify({error:'First task terminal fixture failure'}),{status:409,headers:{'Content-Type':'application/json'}}))});
          }
          return nativeFetch(input,init);
        };
        qa.button('Open terminal').click();qa.button('Open terminal').click();
        await qa.wait(()=>qa.terminalRequests>0);
        qa.check('Terminal creation ignores rapid duplicate click',qa.terminalRequests===1,qa.terminalRequests);
        [...document.querySelectorAll('button')].find(b=>b.innerText.includes('Second task')).click();
        await qa.wait(()=>document.querySelector('h1')?.textContent==='Second task');
        qa.releaseTerminal();await new Promise(resolve=>setTimeout(resolve,200));
        qa.check('Terminal failure stays with original task',!document.querySelector('section[aria-label="Terminal"]').innerText.includes('First task terminal fixture failure'));
        window.fetch=nativeFetch;
        qa.button('Hide terminal pane').click();
        qa.button('Settings').click();await qa.wait(()=>document.querySelector('h1')?.textContent==='Agents');
        const heading=[...document.querySelectorAll('h2')].find(h=>h.textContent===qa.agentName),card=heading.closest('article');
        qa.check('Long agent name stays inside card',qa.contained(heading,card));
        qa.check('Agent model stays inside card',[...card.querySelectorAll('dd')].every(item=>qa.contained(item,card)));
        qa.check('Agent screen fits viewport',qa.pageFits());
      `)
      await capture('agents')
      window.setSize(1360, 840)
      await run(`
        await new Promise(resolve=>setTimeout(resolve,100));
        const heading=[...document.querySelectorAll('h2')].find(h=>h.textContent===qa.agentName),card=heading.closest('article');
        qa.check('Agent row contains long name at wide widths',qa.contained(heading,card));
        qa.check('Configure action stays inside agent row',qa.contained([...card.querySelectorAll('button')].find(e=>e.innerText.includes('Configure')),card),{viewport:innerWidth,card:card.clientWidth});
        qa.check('Agent list fits wide viewport',qa.pageFits());
      `)
      await capture('agents-grid')
      await run(`
        qa.button('MCP & skills').click();await qa.wait(()=>qa.button('Resource scope'));
        qa.button('Resource scope').click();await qa.wait(()=>document.querySelector('[role="option"][data-value="repositories:qa-repo"]'));document.querySelector('[role="option"][data-value="repositories:qa-repo"]').click();
        await qa.wait(()=>document.querySelector('[aria-label="Edit MCP '+qa.resourceName+'"]'));
        qa.check('Resource scope name fits screen',qa.pageFits());
        const resource=[...document.querySelectorAll('p')].find(p=>p.textContent===qa.resourceName);
        qa.check('Long resource name fits beside its controls',resource.scrollWidth<=resource.clientWidth+1);
      `)
      await capture('resources')
      await run(`
        qa.button('Devices & runtime').click();await qa.wait(()=>document.querySelector('[aria-label="Terminal shell"]'));
        const commands=[...document.querySelectorAll('summary')].find(el=>el.textContent==='CLI commands & shell');
        qa.check('Host commands are collapsed by default',!commands.parentElement.open);commands.click();
        qa.check('Host shell is reachable through disclosure',commands.parentElement.open);
        qa.check('Runtime settings expose commands and devices',!!qa.button('Generate pairing code')&&document.body.innerText.includes('Activity'));
        qa.check('Runtime screen fits viewport',qa.pageFits());
        const nativeFetch=window.fetch;
        let count=0;
        window.fetch=(input,init)=>String(input).endsWith('/api/pair/code')?new Promise(resolve=>{
          count++;setTimeout(()=>resolve(new Response(JSON.stringify({code:'12345678',expiresAt:new Date(Date.now()+120000).toISOString()}),{headers:{'Content-Type':'application/json'}})),200);
        }):nativeFetch(input,init);
        qa.button('Generate pairing code').click();qa.button('Generate pairing code').click();
        await qa.wait(()=>document.body.innerText.includes('12345678'));
        qa.check('Pairing code generation ignores rapid duplicate click',count===1,count);
        window.fetch=nativeFetch;
      `)
      await capture('runtime')
      await run(`
        qa.button('Automations').click();await qa.wait(()=>document.querySelector('h1')?.textContent==='Automations');
        if(qa.button('Create automation'))qa.button('Create automation').click();
        await qa.wait(()=>document.querySelector('[role="group"][aria-label="Automation view"]'));
        qa.check('Automations default to run progress',qa.button('Runs').getAttribute('aria-pressed')==='true');
        qa.button('Canvas').click();await qa.wait(()=>document.querySelector('[aria-label="Automation name"]'));
        qa.check('Automation editing is a distinct surface',qa.button('Canvas').getAttribute('aria-pressed')==='true'&&!!document.querySelector('[aria-label="Automation name"]'));
        qa.check('Automations screen fits viewport',qa.pageFits());
      `)
      await capture('automations')
      window.setSize(840, 760)
      await run(`
        await new Promise(resolve=>setTimeout(resolve,200));
        qa.check('Automations fit minimum desktop width',qa.pageFits());
        qa.button('Tasks').click();await qa.wait(()=>qa.button('Toggle task sidebar'));
        qa.button('Toggle task sidebar').click();await qa.wait(()=>document.querySelector('[role="dialog"]'));
        qa.check('Compact task sidebar opens as a dialog',!!document.querySelector('[role="dialog"]'));
        [...document.querySelectorAll('[role="dialog"] button')].find(b=>b.innerText.includes('Inspect primary screen layout')).click();
        await qa.wait(()=>!document.querySelector('[role="dialog"]'));
        qa.button('Changes').click();await qa.wait(()=>qa.button('Changes').getAttribute('aria-pressed')==='true');
        qa.check('Compact review exposes actions',!!qa.button('Apply saved draft to disk'));
        qa.check('Compact changes owns the workspace',!document.querySelector('[role="dialog"]')&&qa.pageFits());
      `)
      await capture('compact-review')
      await run(`
        qa.button('Chat').click();await qa.wait(()=>qa.button('Chat').getAttribute('aria-pressed')==='true');
        qa.button('Overview').click();await qa.wait(()=>document.querySelector('[aria-label="All devices overview"]'));
        qa.check('All devices exposes device filtering and refresh',!!qa.button('Overview device')&&!!qa.button('Refresh devices'));
        qa.check('All devices fits minimum desktop width',qa.pageFits());
      `)
      await capture('overview')
      await run(`
        qa.button('Walkthrough').click();await qa.wait(()=>document.body.innerText.includes('1 / 14 · Your workspace'));
        const scenes=['Tasks','Tasks','Tasks','Tasks','Tasks','Tasks','Tasks','Issues','Pull requests','Pipelines','Settings','Settings','Automations','Settings'];
        for(let index=0;index<scenes.length;index++){
          await qa.wait(()=>document.body.innerText.includes((index+1)+' / 14 ·'));
          const current=document.querySelector('[aria-label="Extensions"] [aria-current="page"]');
          qa.check('Walkthrough step '+(index+1)+' opens '+scenes[index],current?.getAttribute('aria-label')===scenes[index]);
          if(index===4)qa.check('Walkthrough uses settle and snooze',document.body.innerText.includes('snooze tasks for later')&&document.body.innerText.includes('settle finished tasks'));
          if(index===13)qa.check('Walkthrough distinguishes automatic and manual pairing',document.body.innerText.includes('approve devices automatically for two minutes')&&document.body.innerText.includes('Codes generated here require host approval'));
          qa.button(index===13?'Finish':'Next').click();
        }
        await qa.wait(()=>!qa.button('Close walkthrough'));
        qa.check('Walkthrough finishes cleanly',!qa.button('Close walkthrough'));
      `)
      const results = await run('return qa.results')
      console.log(JSON.stringify(results, null, 2))
      exitCode = results.every((result) => result.pass) ? 0 : 1
    } catch (error) {
      console.error(error)
      console.error(
        await run('return {results:qa?.results,screen:document.body.innerText.slice(-1200)}'),
      )
    } finally {
      app.quit()
    }
  })
})
setTimeout(() => {
  console.error('Primary screen verification timeout')
  app.quit()
}, 90000).unref()
import(path.join(root, 'apps/desktop/dist-electron/main.js')).catch((error) => {
  console.error(error)
  app.exit(1)
})
