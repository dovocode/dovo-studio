const { app } = require('electron')
process.env.DOVO_PORT = '0'
process.env.DOVO_HOST = '127.0.0.1'
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const data = fs.mkdtempSync('/tmp/dovo-resources-')
fs.writeFileSync(
  path.join(data, 'SKILL.md'),
  '---\nname: imported\ndescription: Review code\n---\nCheck the changed code.',
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
      window.webContents.setBackgroundThrottling(false)
      const result = await window.webContents.executeJavaScript(`(async()=>{
      const wait=async check=>{for(let i=0;i<150;i++){if(await check())return;await new Promise(r=>setTimeout(r,100))}throw new Error('Timeout '+check.toString()+' '+document.body.innerText.slice(-1000))};
      const button=label=>[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===label||b.innerText.trim()===label);
      const input=(label,value)=>{const el=[...document.querySelectorAll('input,textarea')].find(e=>e.getAttribute('aria-label')===label||e.closest('label')?.childNodes[0]?.textContent===label||e.id&&document.querySelector('label[for="'+e.id+'"]')?.innerText===label);if(!el)throw new Error('Missing input '+label);Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));};
      await wait(()=>document.body.innerText.includes('Workspace synced'));
      const connection=await window.dovo.runtimeConnection();const call=async(url,body,method='POST')=>{const response=await fetch(connection.address+url,{method,headers:{Authorization:'Bearer '+connection.token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const result=await response.json();if(!response.ok)throw new Error(JSON.stringify(result));return result};
      const snapshot=()=>call('/api/snapshot',null,'GET');
      for(const [collection,entity] of [['repositories',{id:'resource-repo',name:'Resource project',path:${JSON.stringify(data)},branch:'main'}],['agents',{id:'resource-agent',name:'Resource agent',provider:'codex',model:'',instructions:'',permission:'ask',endpoint:''}]])await call('/api/workspace',{collection,id:entity.id,create:entity,changes:{}},'PATCH');
      button('Settings').click();await wait(()=>button('MCP & skills'));button('MCP & skills').click();await wait(()=>button('Resource scope'));
      await wait(()=>!button('Resource scope').disabled);button('Resource scope').click();await wait(()=>document.querySelector('[data-value="repositories:resource-repo"]'));document.querySelector('[data-value="repositories:resource-repo"]').click();
      button('Add skill').click();await wait(()=>button('Import'));input('SKILL.md path',${JSON.stringify(path.join(data, 'SKILL.md'))});await new Promise(r=>setTimeout(r,50));button('Import').click();await wait(()=>document.querySelector('textarea')?.value==='Review code');button('Save skill').click();await wait(()=>button('Edit skill imported'));
      await wait(async()=> (await snapshot()).workspace.repositories.find(r=>r.id==='resource-repo').resources?.skills.length===1);
      button('Add MCP server').click();await wait(()=>button('Save server'));input('Name','docs');input('Executable','node');await new Promise(r=>setTimeout(r,50));button('Save server').click();await wait(()=>button('Edit MCP docs'));
      document.querySelector('[aria-label="Enable MCP docs"]').click();await wait(async()=> (await snapshot()).workspace.repositories.find(r=>r.id==='resource-repo').resources?.mcpServers[0].enabled===false);
      await wait(()=>!button('Resource scope').disabled);button('Resource scope').click();await wait(()=>document.querySelector('[data-value="agents:resource-agent"]'));document.querySelector('[data-value="agents:resource-agent"]').click();await wait(()=>!button('Edit MCP docs'));if(button('Edit skill imported'))throw new Error('Project skill leaked into agent scope');
      await wait(()=>!button('Resource scope').disabled);button('Resource scope').click();await wait(()=>document.querySelector('[data-value="repositories:resource-repo"]'));document.querySelector('[data-value="repositories:resource-repo"]').click();await wait(()=>button('Edit MCP docs'));
      button('Remove MCP docs').click();await wait(async()=> (await snapshot()).workspace.repositories.find(r=>r.id==='resource-repo').resources?.mcpServers.length===0);
      const nativeFetch = window.fetch;
      const catalogServer={name:'registry-docs',enabled:true,transport:'http',url:'https://example.com/mcp',command:'',args:[],env:{},headerEnv:{},bearerTokenEnv:'',sourceUrl:'https://registry.modelcontextprotocol.io/v0.1/servers/example',sourceRevision:'1.0'};
      window.fetch=async(url,init)=>{
        if(String(url).endsWith('/api/agents/catalogs/mcp'))return Response.json({entries:[{name:'io.example/docs',description:'Fixture catalog server',version:'1.0',url:catalogServer.sourceUrl,variants:[{id:'remote:0',label:'Streamable HTTP',server:catalogServer,notes:[]}]}]});
        if(String(url).endsWith('/api/agents/catalogs/skills'))return Response.json({entries:[{id:'catalog-skill',name:'Catalog skill',source:'owner/repo',installs:12,url:'https://skills.sh/owner/repo/catalog-skill',supported:true}]});
        if(String(url).endsWith('/api/agents/catalogs/skills/import'))return Response.json({name:'catalog-skill',description:'Catalog description',content:'Catalog instructions',enabled:true,sourceUrl:'https://skills.sh/owner/repo/catalog-skill',sourceRevision:'a'.repeat(40)});
        return nativeFetch(url,init);
      };
      button('Browse MCP Registry').click();await wait(()=>document.body.innerText.includes('Fixture catalog server'));[...document.querySelectorAll('button')].find(b=>b.innerText.includes('io.example/docs')).click();await wait(()=>button('Configure server'));button('Configure server').click();await wait(()=>button('Save server'));button('Save server').click();await wait(()=>button('Edit MCP registry-docs'));
      button('Browse skills.sh').click();await wait(()=>document.querySelector('[aria-label="Search catalog"]'));input('Search catalog','catalog');await wait(()=>button('Import skill'));button('Import skill').click();await wait(()=>button('Save skill'));button('Save skill').click();await wait(()=>button('Edit skill catalog-skill'));
      const beforeDuplicate=(await snapshot()).workspace.repositories.find(r=>r.id==='resource-repo').resources;
      button('Browse skills.sh').click();await wait(()=>document.querySelector('[aria-label="Search catalog"]'));input('Search catalog','catalog');await wait(()=>button('Import skill'));button('Import skill').click();await wait(()=>button('Save skill'));button('Save skill').click();await wait(()=>document.querySelector('[role="alert"]')?.innerText.includes('unique'));
      const afterDuplicate=(await snapshot()).workspace.repositories.find(r=>r.id==='resource-repo').resources;
      if(JSON.stringify(beforeDuplicate)!==JSON.stringify(afterDuplicate))throw new Error('Duplicate catalog import overwrote existing resources');
      document.querySelector('[role="dialog"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
      return {skillImport:true,persistence:true,mcpCreateToggleRemove:true,scopeIsolation:true,catalogSearch:true,registryImport:true,skillCatalogImport:true,duplicateImportProtected:true};
    })()`)
      fs.writeFileSync('/tmp/dovo-resources.png', (await window.webContents.capturePage()).toPNG())
      console.log(JSON.stringify(result))
      exitCode = 0
    } catch (error) {
      console.error(error)
    }
    app.quit()
  }),
)
setTimeout(() => {
  console.error('Resources verification timeout')
  app.quit()
}, 60000).unref()
import(root + '/apps/desktop/dist-electron/main.js').catch((error) => {
  console.error(error)
  app.exit(1)
})
