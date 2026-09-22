const { app } = require('electron')
const fs = require('node:fs')
const { execFileSync } = require('node:child_process')
const root = require('node:path').resolve(__dirname, '..')
const data = fs.mkdtempSync('/tmp/dovo-pulls-check-')
process.env.DOVO_TEST_RICH_PULLS = '1'
process.env.DOVO_PORT = '0'
process.env.DOVO_HOST = '127.0.0.1'
let exitCode = 0
for (const directory of ['work/implementation-reference', 'work/verification'])
  fs.mkdirSync(`${root}/${directory}`, { recursive: true })
for (const name of ['first', 'second']) execFileSync('git', ['init', '-q', `${data}/${name}`])
app.setPath('userData', `${data}/electron`)
app.once('will-quit', () => {
  fs.rmSync(data, { recursive: true, force: true })
  app.exit(exitCode)
})
app.on('browser-window-created', (_event, window) => {
  window.webContents.once('did-finish-load', async () => {
    try {
      const result = await window.webContents.executeJavaScript(`(async()=>{
        const wait=async(check)=>{for(let i=0;i<250;i++){if(check())return;await new Promise(r=>setTimeout(r,100))}throw new Error('PR UI timeout: '+document.body.innerText.slice(-1800))};
        await wait(()=>document.body.innerText.includes('Workspace synced'));
        const c=await window.dovo.runtimeConnection();
        const call=async(path,body,method='POST')=>{const response=await fetch(c.address+path,{method,headers:{Authorization:'Bearer '+c.token,'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await response.json();if(!response.ok)throw new Error(JSON.stringify(result));return result};
        const config=await call('/api/commands/read',{});await call('/api/commands/save',{...config.settings,gh:${JSON.stringify(root + '/scripts/fixtures/github.cjs')}});
        for(const name of ['first','second'])await call('/api/workspace',{collection:'repositories',id:name,changes:{},create:{id:name,name,path:${JSON.stringify(data)}+'/'+name,branch:'main'}},'PATCH');
        const button=label=>[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===label||b.title===label||b.innerText.trim().replace(/\\s+/g,' ')===label);
      const pick = async (label, value) => {
        button(label).click(); await wait(()=>document.querySelector('[role="listbox"]'));
        const option = [...document.querySelectorAll('[role="option"]')].find(o=>o.dataset.value===value);
        if(!option) throw new Error('Missing option '+label+': '+value);
        option.click(); await wait(()=>!document.querySelector('[role="listbox"]'));
      };
        button('Pull requests').click();
        await wait(()=>document.body.innerText.includes('Fix first runtime')&&document.body.innerText.includes('Fix second runtime'));
        if(document.querySelector('[aria-label="PR repository"]').closest('header').getBoundingClientRect().height>170)throw new Error('PR toolbar is not compact');
        if(!document.body.innerText.includes('Your review requested'))throw new Error('Personal review request missing');
        if(!document.body.innerText.includes('Checks failed'))throw new Error('Overview check status missing');
        button('Needs attention').click();await wait(()=>document.body.innerText.includes('Fix second runtime')&&!document.body.innerText.includes('Fix first runtime'));
        button('Needs attention').click();await wait(()=>document.body.innerText.includes('Fix first runtime'));
        const overview=document.querySelector('[aria-label="Pull request sidebar"]');
        if(Math.abs(overview.getBoundingClientRect().width-overview.parentElement.getBoundingClientRect().width)>2||document.querySelector('[aria-label="Pull request details"]'))throw new Error('PR overview is not full width');
        const contextRow=[...overview.querySelectorAll('button')].find(b=>b.innerText.includes('Fix first runtime'));
        contextRow.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:200,clientY:200}));
        await wait(()=>document.querySelector('[role="menu"]'));
        if(document.querySelector('[aria-label="Pull request details"]'))throw new Error('Right click unexpectedly selected a PR');
        if(![...document.querySelectorAll('[role="menuitem"]')].some(m=>m.innerText==='Copy PR link'))throw new Error('PR context actions missing');
        document.querySelector('[role="menu"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
        await wait(()=>!document.querySelector('[role="menu"]'));
        contextRow.focus();contextRow.dispatchEvent(new KeyboardEvent('keydown',{key:'F10',shiftKey:true,bubbles:true}));
        await wait(()=>document.querySelector('[role="menu"]'));
        [...document.querySelectorAll('[role="menuitem"]')].find(m=>m.innerText==='Open PR details').click();
        await wait(()=>document.querySelector('[aria-label="Pull request details"]'));
        button('Back to PRs').click(); await wait(()=>button('PR repository'));await wait(()=>!document.querySelector('[aria-label="Pull request details"]'));
        if(Math.abs(overview.getBoundingClientRect().width-overview.parentElement.getBoundingClientRect().width)>2)throw new Error('Overview width was not restored');
        await pick('PR repository','first');
        await wait(()=>document.body.innerText.includes('Fix first runtime')&&!document.body.innerText.includes('Fix second runtime'));
        [...document.querySelectorAll('button')].find(b=>b.innerText.includes('Fix first runtime')).click();
        await wait(()=>button('Activity (5)'));
        if(button('PR repository') || button('Create PR')) throw new Error('PR detail retains collection controls'); if(!button('Review')) throw new Error('Primary Review action is missing'); const markdown=document.querySelector('[aria-label="PR description"] .studio-markdown');
        if(!markdown?.querySelector('h2')||!markdown.querySelector('table')||!markdown.querySelector('blockquote')||!markdown.querySelector('input[type="checkbox"]:checked'))throw new Error('Rich PR Markdown missing headings, table, quote or checklist');
        const setupLink=[...markdown.querySelectorAll('[data-streamdown="link"]')].find(a=>a.textContent==='setup instructions');
        if(!setupLink)throw new Error('Relative Markdown link missing: '+markdown.innerHTML.slice(-5000));
        setupLink.click();await wait(()=>document.querySelector('[data-streamdown="link-safety-modal"]'));
        const preview=document.querySelector('[data-streamdown="link-safety-modal"]');
        if(!preview.innerText.includes('https://github.com/test/first/blob/'+ 'a'.repeat(40)+'/docs/setup.md'))throw new Error('Relative Markdown file link does not target the reviewed revision: '+preview.innerText);
        preview.querySelector('button[title="Close"]').click();await wait(()=>!document.querySelector('[data-streamdown="link-safety-modal"]'));
        await wait(()=>markdown.querySelector('pre code span[style]'));
        const block=markdown.querySelector('[data-streamdown="code-block"]');
        const copy=block?.querySelector('button');
        if(!copy||copy.getBoundingClientRect().width<28||copy.getBoundingClientRect().height<28)throw new Error('Code copy action lost its touch space');
        if(block.querySelector('[data-streamdown="code-block-header"]').getBoundingClientRect().right>copy.getBoundingClientRect().left)throw new Error('Code copy action overlaps its language header');
        if(markdown.scrollWidth>markdown.clientWidth+2)throw new Error('PR Markdown expands beyond its column');
        button('Activity (5)').click();await wait(()=>document.body.innerText.includes('Verified second comment page.'));
        const activity=document.querySelector('#pr-panel-discussion');
        if(!activity.querySelector('#review-3')?.innerText.includes('Approved')||!activity.querySelector('#review-5')?.innerText.includes('Review comment')||!activity.querySelector('#review-6')?.innerText.includes('Changes requested'))throw new Error('Review types are not distinct, including approval without a body');
        button('Reviews 3').click();await wait(()=>activity.querySelectorAll('article').length===3);
        if(activity.querySelector('[data-comment-kind="comment"]'))throw new Error('Review filter includes discussion comments');
        button('Comments 2').click();await wait(()=>activity.querySelectorAll('article').length===2);
        if(activity.querySelector('[data-comment-kind="review"]'))throw new Error('Discussion filter includes reviews');
        button('All activity 5').click();await wait(()=>activity.querySelectorAll('article').length===5);
        button('Checks (1)').click();await wait(()=>document.body.innerText.includes('Typecheck')&&document.body.innerText.includes('Approved'));
        button('Files (1)').click();await wait(()=>document.body.innerText.includes('Inline cancellation feedback'));

        const sidebar=document.querySelector('[aria-label="Pull request sidebar"]');
        if(!sidebar||!sidebar.getBoundingClientRect().width||!sidebar.innerText.includes('first')||!sidebar.innerText.includes('Checks passed')||!sidebar.querySelector('[aria-current="true"]'))throw new Error('Persistent PR sidebar metadata missing');

        await wait(()=>[...document.querySelectorAll('diffs-container')].some(e=>e.shadowRoot?.textContent.includes('new')));
        [...document.querySelectorAll('summary')].find(e=>e.innerText==='Diff context').click();await wait(()=>document.body.innerText.includes('Review excerpt'));if(document.body.innerText.includes('Could not render this patch'))throw new Error('Truncated review context failed');
        const commentLine=async(range=false)=>{
          const shadow=document.querySelector('diffs-container').shadowRoot;
          if(range){
            const numbers=[...shadow.querySelectorAll('[data-column-number]')];
            const select=(el,shiftKey=false)=>{for(const type of ['pointerdown','pointerup'])el.dispatchEvent(new PointerEvent(type,{bubbles:true,composed:true,pointerType:'mouse',pointerId:1,button:0,shiftKey}))};
            select(numbers.at(-2));select(numbers.at(-1),true);
            await wait(()=>document.querySelector('[aria-label="Line comment"]'));return;
          }
          const line=shadow.querySelector('[data-column-number]');
          line.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,composed:true,pointerType:'mouse'}));
          await wait(()=>shadow.querySelector('[data-gutter-utility-slot] button'));
          const plus=shadow.querySelector('[data-gutter-utility-slot] button');
          plus.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,composed:true,pointerType:'mouse',button:0,pointerId:1}));
          plus.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,composed:true,pointerType:'mouse',button:0,pointerId:1}));
          await wait(()=>document.querySelector('[aria-label="Line comment"]'));
        };
        await commentLine(true);
        button('Suggest code change').click();await wait(()=>document.querySelector('[aria-label="Suggested replacement"]'));
        const replacement=document.querySelector('[aria-label="Suggested replacement"]');if(replacement.value!=='new\\ntail')throw new Error('PR selection prefill mismatch');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(replacement,'fixed\\ncode');replacement.dispatchEvent(new Event('input',{bubbles:true}));
        await pick('Comment destination','github');
        const textarea=document.querySelector('[aria-label="Line comment"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(textarea,'Explain this decision');textarea.dispatchEvent(new Event('input',{bubbles:true}));
        await wait(()=>button('Post to GitHub')&&!button('Post to GitHub').disabled);button('Post to GitHub').click();
        await wait(()=>!document.querySelector('[aria-label="Line comment"]')&&document.body.innerText.includes('Inline cancellation feedback'));
        button('Unified diff').click();await wait(()=>button('Split diff'));
        button('Hide files').click();await wait(()=>!document.querySelector('[aria-label="Filter changed files"]'));button('Show files').click();
        document.querySelector('[role="checkbox"]').click();await wait(()=>document.body.innerText.includes('1/1 viewed'));
        button('Checks (1)').click();await wait(()=>document.body.innerText.includes('Typecheck')&&document.body.innerText.includes('success'));
        button('Files (1)').click();await wait(()=>document.body.innerText.includes('1/1 viewed'));

        const fill=(label,value)=>{const input=document.querySelector('[aria-label="'+label+'"]');if(!input)throw new Error('Missing form field '+label);const prototype=input.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}))};
        const action=async(label)=>{if(label==='Submit review'){button('Review').click();await wait(()=>document.querySelector('[role="dialog"] form'));return}const trigger=button('PR actions');trigger.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'mouse',button:0}));await wait(()=>document.querySelector('[role="menu"]'));const item=[...document.querySelectorAll('[role="menuitem"]')].find(i=>i.innerText.trim()===label);if(!item)throw new Error('Missing PR action '+label);item.click();await wait(()=>document.querySelector('[role="dialog"] form'))};
        const submit=async()=>{await wait(()=>document.querySelector('[role="dialog"] button[type="submit"]')&&!document.querySelector('[role="dialog"] button[type="submit"]').disabled);document.querySelector('[role="dialog"] button[type="submit"]').click();await wait(()=>!document.querySelector('[role="dialog"]'))};
        await action('Comment on PR');fill('PR action body','Discussion from desktop');await submit();
        await action('Submit review');await pick('Review decision','approve');await submit();
        await action('Submit review');await pick('Review decision','request-changes');fill('PR action body','Cover cancellation before merging.');await submit();
        await action('Manage reviewers');fill('Reviewers','reviewer');fill('Review teams','maintainers');await submit();
        await action('Manage reviewers');await pick('Reviewer action','remove');fill('Reviewers','reviewer');await submit();
        button('Files (1)').click();await wait(()=>document.querySelector('#inline-4 button'));
        document.querySelector('#inline-4 button').click();await wait(()=>document.querySelector('[role="dialog"] form'));fill('PR action body','Reply from desktop');await submit();
        await wait(()=>[...document.querySelectorAll('#inline-4 button')].some(b=>b.innerText==='Resolve thread'));
        [...document.querySelectorAll('#inline-4 button')].find(b=>b.innerText==='Resolve thread').click();await wait(()=>document.querySelector('[role="dialog"] form'));await submit();
        await wait(()=>document.querySelector('#inline-4')?.innerText.includes('Resolved'));
        button('Checks (1)').click();await wait(()=>document.querySelector('#pr-panel-checks').innerText.includes('taskId'));
        document.querySelector('#pr-panel-checks details summary').click();await wait(()=>document.querySelector('#pr-panel-checks').innerText.includes('Cancellation path verified.'));
        button('Back to PRs').click();await wait(()=>button('Connections'));button('Connections').click();await wait(()=>document.querySelector('[role="dialog"]')?.innerText.includes('Source control'));
        if(!document.querySelector('[role="dialog"]').innerText.includes('Add connection'))throw new Error('Source control setup entry missing');
        document.querySelector('[role="dialog"] button:has(.sr-only)').click();await wait(()=>!document.querySelector('[role="dialog"]'));
        button('Create PR').click();await wait(()=>document.querySelector('[aria-label="New PR title"]'));
        fill('New PR title','Created through desktop');fill('New PR base branch','main');fill('New PR head branch','fix');fill('New PR description','A **reviewable** change.');await submit();
        await wait(()=>document.querySelector('[aria-label="Pull request details"] h2')?.textContent==='Created through desktop');
        await action('Edit pull request');fill('PR title','Edited through desktop');await submit();
        await wait(()=>document.querySelector('[aria-label="Pull request details"] h2')?.textContent==='Edited through desktop');
        await action('Close pull request');await submit();await wait(()=>document.querySelector('[aria-label="Pull request details"]')?.innerText.includes('Pull request closed'));
        await action('Reopen pull request');await submit();await wait(()=>document.querySelector('[aria-label="Pull request details"]')?.innerText.includes('No merge conflicts'));
        await action('Merge pull request');
        if(!document.querySelector('[role="dialog"] button[type="submit"]').disabled)throw new Error('Merge did not require confirmation');
        await pick('Merge method','squash');document.querySelector('[aria-label="Confirm merge of reviewed commit"]').click();await submit();
        await wait(()=>document.querySelector('[aria-label="Pull request details"]')?.innerText.includes('Already merged'));

        button('Back to PRs').click(); await wait(()=>button('PR repository'));
        await pick('PR state','merged');
        await wait(()=>document.body.innerText.includes('Fix first runtime')&&[...document.querySelectorAll('button')].some(b=>b.innerText.includes('Merged')));
        [...document.querySelectorAll('button')].find(b=>b.innerText.includes('Fix first runtime')).click();
        await wait(()=>button('Files (1)'));button('Files (1)').click();await wait(()=>document.body.innerText.includes('Inline cancellation feedback'));
        await call('/api/workspace',{collection:'agents',id:'pr-agent',changes:{},create:{id:'pr-agent',name:'PR reviewer',provider:'codex',model:'',instructions:'',permission:'read-only',endpoint:''}},'PATCH');
        await commentLine();
        const agentComment=document.querySelector('[aria-label="Line comment"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(agentComment,'Fix this exact line');agentComment.dispatchEvent(new Event('input',{bubbles:true}));
        await wait(()=>button('Start agent task')&&!button('Start agent task').disabled);button('Start agent task').click();await wait(()=>button('PR task agent'));
        if(!document.querySelector('[aria-label="PR task objective"]').value.includes('Fix this exact line'))throw new Error('Line feedback missing from PR task');
        button('Create task').click();await wait(()=>document.body.innerText.includes('PR #7')&&!document.querySelector('[role="dialog"]'));
        const cached=await call('/api/scm/pulls/detail',{repositoryId:'first',number:7});
        if(!cached.cachedAt)throw new Error('PR detail was not served from cache');
        button('Settings').click();await wait(()=>button('Devices & runtime'));button('Devices & runtime').click();
        await wait(()=>[...document.querySelectorAll('summary')].some(item=>item.textContent.trim()==='Activity & message history'));
        [...document.querySelectorAll('summary')].find(item=>item.textContent.trim()==='Activity & message history').click();
        await wait(()=>document.querySelector('[aria-label="Search activity"]'));
        const search=document.querySelector('[aria-label="Search activity"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(search,'Explain this decision');search.dispatchEvent(new Event('input',{bubbles:true}));
        await wait(()=>[...document.querySelectorAll('details')].some(e=>e.textContent.includes('Explain this decision')));
        return {prActionForms:true,reviewSubmission:true,threadReplies:true,threadResolution:true,createEditCloseReopenMerge:true,richCheckOutput:true,connectionsEntry:true,richMarkdown:true,highlightedCode:true,markdownContained:true,codeActionSpace:true,distinctReviewDecisions:true,discussionFilters:true,fullWidthOverview:true,contextMenu:true,keyboardContextMenu:true,cachedDetail:true,activitySearch:true,repositoryFilter:true,mergedFilter:true,paginatedComments:true,inlineComments:true,reviews:true,files:true,checks:true,pierreDiff:true,splitDiff:true,collapsibleFiles:true,viewed:true,taskFromPR:true};
      })().catch(error=>({failure:String(error),stack:error.stack,body:document.body.innerText.slice(-4000)}))`)
      if (result.failure) throw new Error(JSON.stringify(result))
      const actions = fs
        .readFileSync(data + '/first/.git/dovo-actions.jsonl', 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
      for (const field of [
        'event=APPROVE',
        'event=REQUEST_CHANGES',
        'body=Reply from desktop',
        'team_reviewers[]=maintainers',
        'title=Created through desktop',
        'title=Edited through desktop',
        'state=closed',
        'state=open',
        'merge_method=squash',
      ]) {
        if (!actions.some((args) => args.includes(field)))
          throw new Error('Missing verified upstream action: ' + field)
      }
      if (!actions.some((args) => args.includes('DELETE') && args.includes('reviewers[]=reviewer')))
        throw new Error('No upstream reviewer removal')
      if (!actions.some((args) => args.some((arg) => arg.includes('resolveReviewThread(input:'))))
        throw new Error('No upstream thread resolution')
      console.log(JSON.stringify(result))
      await window.webContents.executeJavaScript(`(async()=>{
        const wait=async(check)=>{for(let i=0;i<100;i++){if(check())return;await new Promise(r=>setTimeout(r,100))}throw new Error('Review capture timeout')};
        [...document.querySelectorAll('button')].find(b=>b.title==='Pull requests'||b.getAttribute('aria-label')==='Pull requests'||b.innerText.trim()==='Pull requests').click();
        await wait(()=>document.querySelector('[aria-label="Pull request sidebar"]')?.innerText.includes('Fix first runtime'));
        document.querySelector('[aria-label="PR repository"]').click();await wait(()=>document.querySelector('[role="listbox"]'));
        document.querySelector('[role="option"][data-value="first"]').click();await wait(()=>!document.querySelector('[role="listbox"]'));
        await wait(()=>!document.querySelector('[aria-label="Pull request sidebar"]')?.innerText.includes('Fix second runtime'));
        const refresh=[...document.querySelectorAll('button')].find(b=>b.innerText.trim()==='Refresh PRs');await wait(()=>!refresh.disabled);refresh.click();await wait(()=>!refresh.disabled);
      })()`)
      fs.writeFileSync(
        root + '/work/implementation-reference/pulls-desktop-overview.png',
        (await window.webContents.capturePage()).toPNG(),
      )
      await window.webContents.executeJavaScript(`(async()=>{
        const wait=async(check)=>{for(let i=0;i<100;i++){if(check())return;await new Promise(r=>setTimeout(r,100))}throw new Error('PR detail capture timeout')};
        const row=[...document.querySelectorAll('button')].find(b=>b.innerText.includes('Fix first runtime'));if(row)row.click();
        await wait(()=>[...document.querySelectorAll('button')].some(b=>b.innerText.trim()==='Files (1)'));
        await wait(()=>document.querySelector('[aria-label="PR description"]'));
        document.querySelector('[aria-label="Pull request details"]').scrollTop=0;
      })()`)
      window.show()
      await new Promise((r) => setTimeout(r, 600))
      fs.writeFileSync(
        root + '/work/implementation-reference/pulls-desktop.png',
        (await window.webContents.capturePage()).toPNG(),
      )
      const normalSize = window.getContentSize()
      window.setContentSize(880, 860)
      const narrow = await window.webContents.executeJavaScript(`(async()=>{
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const details=document.querySelector('[aria-label="Pull request details"]');
        const toolbar=details.firstElementChild;
        const bounds=toolbar.getBoundingClientRect();
        const actions=[...toolbar.querySelectorAll('button')].map(button=>({button,rect:button.getBoundingClientRect()}));
        if(window.innerWidth!==880||actions.length!==4)throw new Error('Narrow PR fixture did not render the expected viewport and actions');
        for(const {button,rect} of actions){
          if(rect.width<=0||rect.height<32||rect.left<bounds.left-1||rect.right>bounds.right+1||rect.top<bounds.top-1||rect.bottom>bounds.bottom+1)throw new Error('PR action escaped its toolbar at 880px: '+button.innerText);
          if(button.scrollWidth>button.clientWidth+1)throw new Error('PR action text is clipped at 880px: '+button.innerText);
        }
        for(let i=0;i<actions.length;i++)for(let j=i+1;j<actions.length;j++){
          const a=actions[i].rect,b=actions[j].rect;
          if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)throw new Error('PR header actions overlap at 880px');
        }
        for(const element of [document.documentElement,document.querySelector('.studio-main'),details,toolbar]){
          if(element.scrollWidth>element.clientWidth+2)throw new Error('PR page overflows horizontally at 880px: '+element.tagName+' '+element.className);
        }
        return {viewport:window.innerWidth,narrowPRHeaderBounded:true,narrowPRActionsDoNotOverlap:true,narrowPRPageContained:true};
      })()`)
      console.log(JSON.stringify(narrow))
      fs.writeFileSync(
        root + '/work/verification/desktop-pr-narrow.png',
        (await window.webContents.capturePage()).toPNG(),
      )
      window.setContentSize(...normalSize)
      // Block only this isolated fixture runtime, then reload the renderer to discard memory caches.
      // PR lists, discussion, and diffs must still hydrate from the credential-scoped disk cache.
      const address = await window.webContents.executeJavaScript(
        '(async()=> (await window.dovo.runtimeConnection()).address)()',
      )
      window.webContents.session.webRequest.onBeforeRequest(
        { urls: [address + '/*'] },
        (_details, callback) => callback({ cancel: true }),
      )
      await new Promise((resolve) => {
        window.webContents.once('did-finish-load', resolve)
        window.webContents.reload()
      })
      const offline = await window.webContents.executeJavaScript(`(async()=>{
        const wait=async(check)=>{for(let i=0;i<250;i++){if(check())return;await new Promise(r=>setTimeout(r,100))}throw new Error('Offline PR cache timeout: '+document.body.innerText.slice(-1800))};
        const button=label=>[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===label||b.title===label||b.innerText.trim().replace(/\\s+/g,' ')===label);
        await wait(()=>button('Pull requests'));
        button('Pull requests').click();
        await wait(()=>document.body.innerText.includes('Fix first runtime'));
        if(!button('Refresh PRs').disabled)throw new Error('Offline PR refresh is enabled');
        [...document.querySelectorAll('button')].find(b=>b.innerText.includes('Fix first runtime')).click();
        await wait(()=>button('Activity (5)'));
        if(!document.body.innerText.includes('Offline · showing last loaded details.'))throw new Error('Cached PR is not marked offline');
        if(!button('Refresh details').disabled||!button('PR actions').disabled||!button('Review').disabled)throw new Error('Offline PR mutation is enabled');
        button('Activity (5)').click();
        await wait(()=>document.body.innerText.includes('Verified second comment page.'));
        button('Files (1)').click();
        await wait(()=>[...document.querySelectorAll('diffs-container')].some(e=>e.shadowRoot?.textContent.includes('new')));
        if(document.body.innerText.includes('Drag line numbers or Shift-click'))throw new Error('Offline line comment actions are enabled');
        return {offlineReload:true,persistentPullList:true,persistentDiscussion:true,persistentDiff:true,offlineMutationsDisabled:true};
      })()`)
      console.log(JSON.stringify(offline))
      fs.writeFileSync(
        root + '/work/implementation-reference/pulls-desktop-offline.png',
        (await window.webContents.capturePage()).toPNG(),
      )
      app.quit()
    } catch (error) {
      console.error(error)
      exitCode = 1
      app.quit()
    }
  })
})
setTimeout(() => {
  console.error('PR verification timeout')
  exitCode = 1
  app.quit()
}, 90000).unref()
import(root + '/apps/desktop/dist-electron/main.js').catch((error) => {
  console.error(error)
  app.exit(1)
})
