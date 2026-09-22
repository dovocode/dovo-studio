const { app } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const data = fs.mkdtempSync('/tmp/dovo-task-keyboard-')
const output = path.join(root, 'work/verification/task-keyboard')
fs.mkdirSync(output, { recursive: true })
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
    try {
      window.setSize(1200, 840)
      window.show()
      await run(`
        window.qa = {};
        qa.wait = async check => { for(let i=0;i<150;i++){if(await check())return;await new Promise(r=>setTimeout(r,100))}throw new Error('Keyboard timeout: '+document.body.innerText.slice(-1200)) };
        qa.button = label => [...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===label||b.innerText.trim()===label);
        qa.results = [];
        qa.check = (name, condition) => {qa.results.push({name,pass:!!condition}); if(!condition)throw new Error(name)};
        qa.key = (key,options={}) => document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...options}));
        await qa.wait(()=>document.body.innerText.includes('Workspace synced'));
        await qa.wait(()=>qa.button('Create task'));qa.button('Create task').click();
        await qa.wait(()=>document.querySelector('textarea[aria-label="Message task"]'));
        qa.composer=document.querySelector('textarea[aria-label="Message task"]');
        const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;
        setter.call(qa.composer,'Keep this draft and selection');qa.composer.dispatchEvent(new Event('input',{bubbles:true}));
        await qa.wait(()=>qa.composer.value==='Keep this draft and selection');
        qa.composer.focus();qa.composer.setSelectionRange(4,9);
        qa.key(String.fromCharCode(96),{ctrlKey:true});
        await qa.wait(()=>qa.button('Terminal').getAttribute('aria-pressed')==='true');
        qa.check('Terminal shortcut moves focus into visible pane',!!document.activeElement.closest('section[aria-label="Terminal"]')&&document.activeElement.getClientRects().length>0);
        qa.key(String.fromCharCode(96),{ctrlKey:true});
        await qa.wait(()=>qa.button('Chat').getAttribute('aria-pressed')==='true');
        qa.check('Terminal shortcut restores composer focus and selection',document.activeElement===qa.composer&&qa.composer.selectionStart===4&&qa.composer.selectionEnd===9);
        qa.check('Surface switch preserves mounted draft',qa.composer===document.querySelector('textarea[aria-label="Message task"]')&&qa.composer.value==='Keep this draft and selection');
        qa.key(String.fromCharCode(96),{ctrlKey:true,repeat:true});
        await new Promise(r=>setTimeout(r,80));
        qa.check('Held shortcut does not repeatedly switch surfaces',qa.button('Chat').getAttribute('aria-pressed')==='true');
        qa.key(String.fromCharCode(96),{ctrlKey:true,isComposing:true});
        await new Promise(r=>setTimeout(r,80));
        qa.check('IME composition does not switch surfaces',qa.button('Chat').getAttribute('aria-pressed')==='true');
        qa.button('Changes').focus();qa.button('Changes').click();
        await qa.wait(()=>qa.button('Changes').getAttribute('aria-pressed')==='true');
        qa.check('Workspace buttons retain keyboard focus',document.activeElement===qa.button('Changes'));
        qa.key(String.fromCharCode(96),{ctrlKey:true});await qa.wait(()=>qa.button('Terminal').getAttribute('aria-pressed')==='true');
        qa.button('Hide terminal pane').focus();qa.button('Hide terminal pane').click();
        await qa.wait(()=>qa.button('Chat').getAttribute('aria-pressed')==='true');
        qa.check('Hide terminal returns to the preserved composer',document.activeElement===qa.composer);
        qa.button('Task actions').click();await qa.wait(()=>qa.button('Task settings'));
        qa.button('Task settings').click();await qa.wait(()=>document.querySelector('[role="dialog"] input'));
        document.querySelector('[role="dialog"] input').focus();
        qa.key(String.fromCharCode(96),{ctrlKey:true});qa.key('k',{metaKey:true});
        await new Promise(r=>setTimeout(r,100));
        qa.check('Task settings keeps shortcuts scoped to its dialog',qa.button('Chat').getAttribute('aria-pressed')==='true'&&document.querySelectorAll('[role="dialog"]').length===1&&!document.querySelector('input[aria-label="Search commands"]'));
        qa.button('Close').click();await qa.wait(()=>!document.querySelector('[role="dialog"]'));
        qa.composer.focus();qa.key('k',{metaKey:true});await qa.wait(()=>document.querySelector('input[aria-label="Search commands"]'));
        qa.check('Command shortcut opens from composer',document.activeElement===document.querySelector('input[aria-label="Search commands"]'));
        qa.key('k',{metaKey:true});await qa.wait(()=>!document.querySelector('[role="dialog"]'));
        await qa.wait(()=>document.activeElement===qa.composer);
        qa.check('Closing command palette restores composer focus',document.activeElement===qa.composer);
        qa.key('k',{metaKey:true});await qa.wait(()=>document.querySelector('input[aria-label="Search commands"]'));
        const search=document.querySelector('input[aria-label="Search commands"]');
        const inputSetter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
        inputSetter.call(search,'Toggle terminal');search.dispatchEvent(new Event('input',{bubbles:true}));
        await qa.wait(()=>document.querySelectorAll('[role="option"]').length===1);
        qa.key('Enter',{isComposing:true});await new Promise(r=>setTimeout(r,80));
        qa.check('IME confirmation does not run palette commands',!!document.querySelector('[role="dialog"]')&&qa.button('Chat').getAttribute('aria-pressed')==='true');
        qa.key('k',{metaKey:true});await qa.wait(()=>!document.querySelector('[role="dialog"]'));
        qa.key('k',{metaKey:true});await qa.wait(()=>document.querySelector('input[aria-label="Search commands"]'));
        qa.check('Reopening palette clears previous search',document.querySelector('input[aria-label="Search commands"]').value==='');
        const reopened=document.querySelector('input[aria-label="Search commands"]');
        inputSetter.call(reopened,'Toggle terminal');reopened.dispatchEvent(new Event('input',{bubbles:true}));
        await qa.wait(()=>document.querySelectorAll('[role="option"]').length===1);
        qa.key('Enter');await qa.wait(()=>!document.querySelector('[role="dialog"]')&&qa.button('Terminal').getAttribute('aria-pressed')==='true');
        await new Promise(r=>setTimeout(r,100));
        qa.check('Palette terminal command focuses the terminal surface',!!document.activeElement.closest('section[aria-label="Terminal"]'));
        qa.key(String.fromCharCode(96),{ctrlKey:true});await qa.wait(()=>qa.button('Chat').getAttribute('aria-pressed')==='true');
      `)
      window.setMinimumSize(0, 0)
      window.setSize(1200, 380)
      await run(`
        await new Promise(r=>setTimeout(r,100));
        const nav=document.querySelector('[aria-label="Extensions"]'),help=qa.button('Walkthrough');
        help.focus();help.scrollIntoView({block:'nearest'});
        const a=help.getBoundingClientRect(),b=nav.getBoundingClientRect();
        qa.check('Short desktop windows keep bottom navigation reachable',nav.scrollHeight>nav.clientHeight&&['auto','scroll'].includes(getComputedStyle(nav).overflowY)&&a.top>=b.top&&a.bottom<=b.bottom+1);
      `)
      const results = await run('return qa.results')
      fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2))
      fs.writeFileSync(
        path.join(output, 'short-navigation.png'),
        (await window.webContents.capturePage()).toPNG(),
      )
      console.log(JSON.stringify(results, null, 2))
      exitCode = 0
    } catch (error) {
      console.error(error)
      console.error(
        await run(
          'return {results:qa?.results,focused:document.activeElement?.outerHTML.slice(0,500),screen:document.body.innerText.slice(-1000)}',
        ),
      )
      fs.writeFileSync(
        path.join(output, 'failure.png'),
        (await window.webContents.capturePage()).toPNG(),
      )
    } finally {
      app.quit()
    }
  })
})
setTimeout(() => {
  console.error('Keyboard verification timeout')
  app.quit()
}, 60000).unref()
import(path.join(root, 'apps/desktop/dist-electron/main.js')).catch((error) => {
  console.error(error)
  app.exit(1)
})
