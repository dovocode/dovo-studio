const { app } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const data = fs.mkdtempSync('/tmp/dovo-settings-check-')
process.env.DOVO_PORT = '0'
process.env.DOVO_HOST = '127.0.0.1'
app.setPath('userData', data)
let exitCode = 1
app.once('will-quit', () => {
  fs.rmSync(data, { recursive: true, force: true })
  app.exit(exitCode)
})
app.on('browser-window-created', (_event, window) => {
  window.webContents.once('did-finish-load', async () => {
    try {
      const result = await window.webContents.executeJavaScript(`(async () => {
        const wait = async check => { for(let i=0;i<150;i++){if(check())return;await new Promise(r=>setTimeout(r,100))}throw new Error('Settings timeout: '+document.body.innerText.slice(-800)) };
        const button = label => [...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===label||b.innerText.trim()===label);
        await wait(()=>document.body.innerText.includes('Workspace synced'));
        const navigation=document.querySelector('[aria-label="Extensions"]');
        if(navigation.querySelector('[aria-label="Agents"]')||navigation.querySelector('[aria-label="Devices & runtime"]'))throw new Error('Settings pages in main navigation');
        button('Settings').click();await wait(()=>button('Configure'));
        if(!document.querySelector('[aria-label="Settings sections"]')||button('Settings').getAttribute('aria-current')!=='page')throw new Error('Settings navigation missing');
        button('Configure').click();await wait(()=>document.querySelector('[role="dialog"]'));
        button('Close').click();await wait(()=>!document.querySelector('[role="dialog"]'));
        button('Devices & runtime').click();await wait(()=>document.querySelector('[aria-label="Terminal shell"]'));
        const commands=[...document.querySelectorAll('summary')].find(el=>el.textContent==='CLI commands & shell');
        if(!commands||commands.parentElement.open)throw new Error('Host command disclosure missing');
        commands.click();
        if(!commands.parentElement.open||!document.body.innerText.includes('Activity'))throw new Error('Runtime controls missing');
        button('Tasks').click();await wait(()=>!document.querySelector('[aria-label="Settings sections"]'));
        button('Settings').click();await wait(()=>button('Configure'));
        return {settingsNavigation:true,agentEditor:true,runtimeControls:true,returnToTasks:true};
      })()`)
      fs.writeFileSync('/tmp/dovo-settings.png', (await window.webContents.capturePage()).toPNG())
      console.log(JSON.stringify(result))
      exitCode = 0
      app.quit()
    } catch (error) {
      console.error(error)
      app.quit()
    }
  })
})
setTimeout(() => {
  console.error('Settings verification timeout')
  app.quit()
}, 60000).unref()
import(root + '/apps/desktop/dist-electron/main.js').catch((error) => {
  console.error(error)
  app.exit(1)
})
