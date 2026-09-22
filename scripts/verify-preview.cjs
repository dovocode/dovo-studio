const { app } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const data = fs.mkdtempSync('/tmp/dovo-browser-check-')
const root = path.resolve(__dirname, '..')
process.env.DOVO_PORT = '0'
process.env.DOVO_HOST = '127.0.0.1'
app.setPath('userData', data)
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html')
  res.end(
    '<meta name="viewport" content="width=device-width,initial-scale=1"><h1>Preview fixture</h1><a href="/next">Next</a><p id="size"></p><script>size.textContent=innerWidth</script>',
  )
})
let result = 1
app.once('will-quit', () => {
  server.close()
  fs.rmSync(data, { recursive: true, force: true })
  app.exit(result)
})
app.on('browser-window-created', (_event, window) =>
  window.webContents.once('did-finish-load', async () => {
    try {
      const port = server.address().port
      await window.webContents.executeJavaScript(`(async()=>{
    const wait=async(f)=>{for(let i=0;i<150;i++){if(f())return;await new Promise(r=>setTimeout(r,100))}throw new Error('Timeout: '+document.body.innerText.slice(-500))};
    await wait(()=>document.body.innerText.includes('Workspace synced'));
    const c=await window.dovo.runtimeConnection();
    const call=async(path,body)=>{const r=await fetch(c.address+path,{method:'PATCH',headers:{Authorization:'Bearer '+c.token,'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw new Error(await r.text())};
    await call('/api/workspace',{collection:'tasks',id:'preview-test',changes:{},create:{id:'preview-test',title:'Preview test',repositoryId:'',agentId:'',status:'draft',createdAt:new Date().toISOString(),messages:[],files:[],draft:'',example:false}});
    await wait(()=>[...document.querySelectorAll('button')].some(b=>b.innerText.includes('Preview test')));
    [...document.querySelectorAll('button')].find(b=>b.innerText.includes('Preview test')).click();
    await wait(()=>document.querySelector('[aria-label="Browser"]'));
    document.querySelector('[aria-label="Browser"]').click();
    await wait(()=>[...document.querySelectorAll('button')].some(b=>b.innerText==='Responsive'));
    [...document.querySelectorAll('button')].find(b=>b.innerText==='Responsive').click();
    await wait(()=>document.querySelector('[aria-label="Preview URL"]'));
    const input=document.querySelector('[aria-label="Preview URL"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'http://127.0.0.1:${port}');input.dispatchEvent(new Event('input',{bubbles:true}));
    await new Promise(r=>setTimeout(r,100));input.closest('form').requestSubmit();
  })()`)
      const wait = async (f) => {
        for (let i = 0; i < 100; i++) {
          if (await f()) return
          await new Promise((r) => setTimeout(r, 100))
        }
        throw new Error('Native browser timeout')
      }
      await wait(() =>
        window.contentView.children.some((v) =>
          v.webContents?.getURL().startsWith('http://127.0.0.1:' + port),
        ),
      )
      const view = window.contentView.children.find((v) =>
        v.webContents?.getURL().startsWith('http://127.0.0.1:' + port),
      )
      const isolated = await view.webContents.executeJavaScript(
        '({node:typeof require,bridge:typeof window.dovo,title:document.querySelector("h1")?.textContent})',
      )
      if (
        isolated.node !== 'undefined' ||
        isolated.bridge !== 'undefined' ||
        isolated.title !== 'Preview fixture'
      )
        throw new Error('Browser isolation failed')
      await window.webContents.executeJavaScript(
        `(()=>{const s=document.querySelector('[aria-label="Viewport"]');s.value='phone';s.dispatchEvent(new Event('change',{bubbles:true}))})()`,
      )
      await wait(async () => (await view.webContents.executeJavaScript('innerWidth')) === 390)
      await view.webContents.executeJavaScript('document.querySelector("a").click()')
      await wait(() => view.webContents.getURL().endsWith('/next'))
      await wait(
        async () =>
          await window.webContents.executeJavaScript(
            `document.querySelector('[aria-label="Preview URL"]').value.endsWith('/next')`,
          ),
      )
      await window.webContents.executeJavaScript(
        `document.querySelector('[aria-label="Chat"]').click()`,
      )
      await wait(() => !view.getVisible())
      fs.writeFileSync(
        path.join(root, 'work/design/device-preview/desktop.png'),
        (await window.webContents.capturePage()).toPNG(),
      )
      console.log(
        'PASS: embedded browser loads, is isolated, uses 390px viewport, tracks navigation, and hides on Chat',
      )
      fs.writeFileSync(
        path.join(root, 'work/design/device-preview/desktop-result.json'),
        JSON.stringify({ passed: true }),
      )
      result = 0
    } catch (error) {
      console.error(error)
    } finally {
      app.quit()
    }
  }),
)
server.listen(0, '127.0.0.1', () =>
  import(path.join(root, 'apps/desktop/dist-electron/main.js')).catch((error) => {
    console.error(error)
    app.quit()
  }),
)
setTimeout(() => {
  console.error('Preview verification timeout')
  app.quit()
}, 45000).unref()
