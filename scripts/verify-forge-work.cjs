const { app } = require('electron')
const fs = require('node:fs'),
  http = require('node:http'),
  { join, resolve } = require('node:path')
const root = resolve(__dirname, '..'),
  data = fs.mkdtempSync('/tmp/dovo-work-check-')
let address,
  windowRef,
  finished = false,
  exitCode = 0,
  comments = []
const writes = []
process.env.DOVO_PORT = '0'
process.env.DOVO_HOST = '127.0.0.1'
app.setPath('userData', join(data, 'electron'))
const aclicli = join(data, 'acli.cjs')
fs.writeFileSync(
  aclicli,
  `#!/usr/bin/env node
const a=process.argv.slice(2);
const project={key:'TEAM',name:'Team delivery',self:'https://team.atlassian.net/rest/api/3/project/1',issueTypes:[{name:'Task'}]};
const issue={id:'100',key:'TEAM-1',self:'https://team.atlassian.net/rest/api/3/issue/100',fields:{summary:'Independent Jira issue',description:{version:1,type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Jira rich text'}]}]},status:{name:'To Do'},issuetype:{name:'Task'},labels:[],updated:'2026-09-20T10:00:00Z'}};
if(a.join(' ')==='jira auth status')console.log('Authenticated\\nSite: team.atlassian.net\\nEmail: fixture@example.test');
else if(a[1]==='project'&&a[2]==='list')console.log(JSON.stringify([{key:project.key,name:project.name}]));
else if(a[1]==='project'&&a[2]==='view')console.log(JSON.stringify(project));
else if(a[1]==='workitem'&&a[2]==='search')console.log(JSON.stringify([issue]));
else if(a[1]==='workitem'&&a[2]==='view')console.log(JSON.stringify(issue));
else{console.error('Unexpected fixture CLI invocation: '+a.join(' '));process.exitCode=1;}
`,
  { mode: 0o755 },
)
const provider = http.createServer(async (req, res) => {
  const url = new URL(req.url, address),
    path = url.pathname
  const issue = {
    number: 1,
    title: 'Issue workflow fixture',
    body: '## Useful details\n\nUse `safe code`.',
    state: 'open',
    html_url: address + '/team/app/issues/1',
    user: { login: 'developer' },
    labels: [],
    updated_at: '2026-09-20T10:00:00Z',
  }
  const run = {
    id: 42,
    display_title: 'Verify workflow fixture',
    html_url: address + '/team/app/actions/runs/42',
    head_branch: 'main',
    head_sha: 'a'.repeat(40),
    status: 'completed',
    conclusion: 'success',
    created_at: '2026-09-20T10:00:00Z',
    started_at: '2026-09-20T10:00:30Z',
    completed_at: '2026-09-20T10:03:45Z',
    updated_at: '2026-09-20T10:03:50Z',
    run_number: 1042,
    run_attempt: 2,
    event: 'push',
    path: '.gitea/workflows/ci.yaml',
    actor: { login: 'developer' },
    workflow_id: 1,
  }
  const failedRun = {
    ...run,
    id: 43,
    run_number: 1043,
    run_attempt: 1,
    display_title: 'Failing workflow fixture',
    html_url: address + '/team/app/actions/runs/43',
    head_branch: 'feature/failing',
    head_sha: 'c'.repeat(40),
    conclusion: 'failure',
    event: 'pull_request',
    created_at: '2026-09-20T11:00:00Z',
    started_at: '2026-09-20T11:00:10Z',
    completed_at: '2026-09-20T11:02:10Z',
    updated_at: '2026-09-20T11:02:10Z',
  }
  const send = (v, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(v))
  }
  if (req.method !== 'GET') {
    let body = ''
    for await (const c of req) body += c
    writes.push({ path, body: body ? JSON.parse(body) : null })
    if (path.endsWith('/comments'))
      comments.push({
        id: comments.length + 1,
        body: JSON.parse(body).body,
        user: { login: 'developer' },
        created_at: '2026-09-20T11:00:00Z',
      })
    return send(path.endsWith('/issues') ? issue : {})
  }
  if (path === '/api/v1/version') return send({ version: '1.27.3' })
  if (path === '/api/v1/repos/team/app')
    return send({
      id: 1,
      name: 'app',
      full_name: 'team/app',
      html_url: address + '/team/app',
      clone_url: address + '/team/app.git',
      default_branch: 'main',
    })
  if (path.endsWith('/issues/1/comments')) return send(comments)
  if (path.endsWith('/issues/1')) return send(issue)
  if (path.endsWith('/issues'))
    return send(url.searchParams.get('q') === 'absent-fixture-result' ? [] : [issue])
  if (path.endsWith('/actions/workflows'))
    return send({ workflows: [{ id: 1, name: 'CI', state: 'active' }] })
  if (path.endsWith('/actions/runs/42/jobs'))
    return send({
      jobs: [
        {
          id: 10,
          name: 'Typecheck',
          status: 'completed',
          conclusion: 'success',
          html_url: run.html_url,
          runner_name: 'dovo-runner-1',
          started_at: '2026-09-20T10:00:35Z',
          completed_at: '2026-09-20T10:03:40Z',
          steps: [
            {
              number: 1,
              name: 'Checkout source',
              status: 'completed',
              conclusion: 'success',
              started_at: '2026-09-20T10:00:35Z',
              completed_at: '2026-09-20T10:00:45Z',
            },
            {
              number: 2,
              name: 'Run TypeScript compiler',
              status: 'completed',
              conclusion: 'success',
              started_at: '2026-09-20T10:00:45Z',
              completed_at: '2026-09-20T10:03:40Z',
            },
          ],
        },
      ],
    })
  if (path.endsWith('/actions/runs/43/jobs'))
    return send({
      jobs: [
        {
          id: 20,
          name: 'Build application',
          status: 'completed',
          conclusion: 'failure',
          html_url: failedRun.html_url,
          runner_name: 'dovo-runner-2',
          started_at: '2026-09-20T11:00:15Z',
          completed_at: '2026-09-20T11:02:05Z',
          steps: [
            {
              number: 1,
              name: 'Checkout source',
              status: 'completed',
              conclusion: 'success',
              started_at: '2026-09-20T11:00:15Z',
              completed_at: '2026-09-20T11:00:25Z',
            },
            {
              number: 2,
              name: 'Compile application',
              status: 'completed',
              conclusion: 'failure',
              started_at: '2026-09-20T11:00:25Z',
              completed_at: '2026-09-20T11:02:05Z',
            },
            {
              number: 3,
              name: 'Publish package',
              status: 'completed',
              conclusion: 'skipped',
              started_at: null,
              completed_at: null,
            },
          ],
        },
      ],
    })
  if (path.endsWith('/actions/runs/42')) return send(run)
  if (path.endsWith('/actions/runs/43')) return send(failedRun)
  if (path.endsWith('/actions/runs')) return send({ workflow_runs: [failedRun, run] })
  send({}, 404)
})
async function finish(error) {
  if (finished) return
  finished = true
  if (error) {
    exitCode = 1
    console.error(error)
  }
  if (windowRef && !windowRef.isDestroyed()) {
    fs.mkdirSync(join(root, 'work/verification'), { recursive: true })
    fs.writeFileSync(
      join(root, 'work/verification/work-desktop' + (error ? '-failure' : '') + '.png'),
      (await windowRef.webContents.capturePage()).toPNG(),
    )
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
  const captured = new Set()
  window.webContents.on('console-message', (details) => {
    const name = details.message.replace(/^DOVO_WORK_CAPTURE:/, '')
    if (
      ![
        'pipeline-desktop',
        'pipeline-desktop-failed',
        'pipeline-desktop-jobs',
        'pipeline-desktop-failed-jobs',
      ].includes(name)
    )
      return
    void (async () => {
      fs.mkdirSync(join(root, 'work/verification'), { recursive: true })
      fs.writeFileSync(
        join(root, 'work/verification', name + '.png'),
        (await window.webContents.capturePage()).toPNG(),
      )
      captured.add(name)
      await window.webContents.executeJavaScript(`window.dovoWorkCapture = ${JSON.stringify(name)}`)
    })().catch(finish)
  })
  window.webContents.once('did-finish-load', async () => {
    try {
      const result = await window.webContents.executeJavaScript(`(async()=>{
 const wait=async(check)=>{for(let i=0;i<200;i++){if(await check())return;await new Promise(r=>setTimeout(r,100))}throw new Error('Work UI timeout: '+document.body.innerText.slice(-2200))};
 const capture=async(name)=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);console.log('DOVO_WORK_CAPTURE:'+name);await wait(()=>window.dovoWorkCapture===name);delete window.dovoWorkCapture};
 const button=label=>[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===label||b.title===label||b.innerText.trim()===label);
 const hasPipelineAction=async(label)=>{button('Pipeline actions').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));await wait(()=>document.querySelector('[role="menu"]'));const present=[...document.querySelectorAll('[role="menuitem"]')].some(item=>item.textContent===label);document.querySelector('[role="menu"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await wait(()=>!document.querySelector('[role="menu"]'));return present};
 const choose=async(label,match)=>{await wait(()=>button(label)&&!button(label).disabled);button(label).click();await wait(()=>document.querySelector('[role="listbox"]'));await wait(()=>[...document.querySelectorAll('[role="option"]')].some(match));[...document.querySelectorAll('[role="option"]')].find(match).click();await wait(()=>!document.querySelector('[role="listbox"]'))};
 const workProject=option=>{try{return JSON.parse(option.dataset.value)[1]==='work'}catch{return false}};
 const pickProject=async(title)=>{await wait(()=>document.querySelector('h1')?.innerText===title);await choose('Issue source',workProject)};
 const createPull=async()=>{button('Create PR').click();await wait(()=>document.querySelector('[role="dialog"] [aria-label="Find project"]'));[...document.querySelectorAll('[role="dialog"] button')].find(item=>item.innerText.includes('Work fixture')).click();await wait(()=>document.querySelector('[role="dialog"] [aria-label="Create PR project"]'))};
 const field=label=>document.querySelector('[aria-label="'+label+'"]')||[...document.querySelectorAll('label')].find(e=>e.childNodes[0]?.textContent.trim()===label)?.querySelector('input,textarea');
 const input=(label,value)=>{const element=field(label);if(!element)throw new Error('No field '+label);Object.getOwnPropertyDescriptor(element.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(element,value);element.dispatchEvent(new Event('input',{bubbles:true}))};
 await wait(()=>document.body.innerText.includes('Workspace synced'));
 const c=await window.dovo.runtimeConnection();const call=async(path,body,method='POST')=>{const r=await fetch(c.address+path,{method,headers:{Authorization:'Bearer '+c.token,'Content-Type':'application/json'},body:JSON.stringify(body)});const value=await r.json();if(!r.ok)throw new Error(JSON.stringify(value));return value};
 const snapshot=async()=>{const response=await fetch(c.address+'/api/snapshot',{headers:{Authorization:'Bearer '+c.token}});if(!response.ok)throw new Error('Snapshot failed');return response.json()};
 const commands=await call('/api/commands/read',{});await call('/api/commands/save',{...commands.settings,acli:${JSON.stringify(aclicli)}});
 await call('/api/workspace',{collection:'repositories',id:'work',changes:{},create:{id:'work',name:'Work fixture',path:${JSON.stringify(data)},branch:'main'}},'PATCH');
 const account=await call('/api/scm/connections/save',{provider:'gitea',name:'Fixture',baseUrl:${JSON.stringify(address)},credential:'token',token:'fixture'});
 await call('/api/scm/repositories/forge/bind',{repositoryId:'work',forge:{connectionId:account.id,repository:'team/app'}});
 const originalFetch=window.fetch.bind(window);let delayedPage,cachedIssue,releaseTask,hiddenTaskId='',failOptions=false,failDefinitions=true,definitionPages=0,agentRuns=0,exposeCancellation=false,cancellationReads=0,injectCheckout=false,checkoutSnapshots=0,restoredSnapshots=0,blockedTaskWrites=0,pullSubmissions=0;const taskRequests=[],issueListRequests=[];
 const fixturePull={provider:'gitea',number:7,title:'Linked workflow pull fixture',url:${JSON.stringify(address + '/team/app/pulls/7')},state:'open',draft:false,author:'developer',updatedAt:'2026-09-20T10:00:00Z',head:'fixture/issue-1',base:'main',labels:[],checksState:'SUCCESS'};
 const failedPull={...fixturePull,number:8,title:'Failing workflow pull fixture',url:${JSON.stringify(address + '/team/app/pulls/8')},head:'feature/failing',checksState:'FAILURE'};
 window.fetch=async(target,options)=>{
   const path=new URL(target).pathname;const input=options?.body?JSON.parse(options.body):{};
   if(path==='/api/scm/work/issues/list')issueListRequests.push(input);
   if(['/api/tasks/run','/api/tasks/message','/api/tasks/steer'].includes(path)){agentRuns++;throw new Error('Linked draft tried to execute an agent')}
   if(path==='/api/workspace'&&input.collection==='tasks'&&(injectCheckout||checkoutSnapshots)){blockedTaskWrites++;throw new Error('PR prefill attempted to write a fixture task')}
   if(path==='/api/scm/pulls/create'){pullSubmissions++;throw new Error('PR prefill attempted to submit an external pull request')}
   if(path==='/api/scm/pulls/options/read')return new Response(JSON.stringify({provider:'gitea',draft:false}));
   if(path==='/api/scm/pulls/overview')return new Response(JSON.stringify({pulls:input.repositoryId==='work'?[fixturePull,failedPull]:[],hasMore:false,page:1}));
   if(path==='/api/scm/pulls/detail'){const failed=input.number===8;return new Response(JSON.stringify({pull:{...(failed?failedPull:fixturePull),headSha:(failed?'c':'a').repeat(40),baseSha:'b'.repeat(40),repositoryUrl:${JSON.stringify(address + '/team/app')},body:'Pipeline navigation fixture',additions:0,deletions:0,changedFiles:0,mergeable:true,reviewers:[],assignees:[]},comments:[],files:[],checks:[{name:failed?'Build application':'Typecheck',status:failed?'FAILURE':'SUCCESS',url:failed?${JSON.stringify(address + '/team/app/actions/runs/43')}:${JSON.stringify(address + '/team/app/actions/runs/42')}}],warnings:[]}))};
   if(path==='/api/scm/work/task'){taskRequests.push(input);if(taskRequests.length===1){hiddenTaskId=input.requestId;await new Promise(resolve=>{releaseTask=resolve})}}
   if(path==='/api/scm/work/options'&&failOptions){failOptions=false;return new Response(JSON.stringify({error:'Fixture account no longer permits this read'}),{status:403})}
   if(path==='/api/scm/work/pipelines/definitions'){
     if(failDefinitions){failDefinitions=false;return new Response(JSON.stringify({error:'Fixture definitions temporarily unavailable'}),{status:503})}
     if(input.cursor){definitionPages++;await new Promise(r=>setTimeout(r,200));return new Response(JSON.stringify({items:[{id:'1',name:'CI'},{id:'2',name:'Release'}]}))}
     return new Response(JSON.stringify({items:[{id:'1',name:'CI'}],next:'definitions-page-2'}));
   }
   if(path==='/api/scm/work/issues/detail'&&input.cursor&&cachedIssue){await new Promise(resolve=>{delayedPage=()=>resolve()});return new Response(JSON.stringify({...cachedIssue,comments:[{id:'late',body:'Late response must not replace the new view',author:'fixture',createdAt:'2026-09-20T10:00:00Z'}]}))}
   let requestOptions=options;
   if(path==='/api/snapshot'&&(injectCheckout||hiddenTaskId)&&(!options?.method||options.method==='GET')){const headers=new Headers(options?.headers);headers.delete('If-None-Match');requestOptions={...options,headers}}
   const response=await originalFetch(target,requestOptions);
   if(path==='/api/snapshot'&&(!options?.method||options.method==='GET')&&response.ok){
     if(hiddenTaskId){const value=await response.clone().json();return new Response(JSON.stringify({...value,workspace:{...value.workspace,tasks:value.workspace.tasks.filter(task=>task.id!==hiddenTaskId)}}),{headers:{ETag:'W/"fixture-hidden-task"'}})}
     if(injectCheckout){checkoutSnapshots++;const value=await response.clone().json();return new Response(JSON.stringify({...value,workspace:{...value.workspace,tasks:value.workspace.tasks.map(task=>task.workItem?{...task,checkoutBranch:task.workItem.kind==='issue'?'fixture/issue-1':'fixture/run-42'}:task)}}),{headers:{ETag:'W/"fixture-checkout"'}})}
     if(checkoutSnapshots)restoredSnapshots++;
   }
   if(path==='/api/scm/work/options'&&input.area==='pipelines'&&exposeCancellation&&response.ok){cancellationReads++;const value=await response.clone().json();return new Response(JSON.stringify({...value,pipelineActions:[...value.pipelineActions,'cancel']}))}
   if(path==='/api/scm/work/issues/detail'&&response.ok){
     const value=await response.clone().json();
     if(value.issue.id==='1'){
       cachedIssue=value;
       return new Response(JSON.stringify({...value,next:'fixture-next'}));
     }
   }
   if(['/api/scm/work/issues/list','/api/scm/work/pipelines/list'].includes(path)&&response.ok){const value=await response.clone().json();return new Response(JSON.stringify({...value,next:input.cursor?undefined:'2'}))}
   return response;
 };
 const loadMoreIssues=()=>[...document.querySelectorAll('button')].find(item=>item.innerText.startsWith('Load more · Work fixture'));
 const searchPagination=async()=>{input('Search issues','absent-fixture-result');await wait(()=>issueListRequests.some(item=>item.query==='absent-fixture-result')&&document.body.innerText.includes('No matching issues')&&loadMoreIssues()&&!loadMoreIssues().disabled);loadMoreIssues().click();await wait(()=>issueListRequests.some(item=>item.query==='absent-fixture-result'&&item.cursor)&&!loadMoreIssues());if(field('Search issues')?.value!=='absent-fixture-result'||!document.body.innerText.includes('No matching issues'))throw new Error('Search reset on pagination');button('Clear filters').click();await wait(()=>field('Search issues')?.value===''&&document.body.innerText.includes('Issue workflow fixture'))};
 const openPullChecks=async(pull)=>{if(button('Back to PRs'))button('Back to PRs').click();else button('Pull requests').click();await wait(()=>document.querySelector('[aria-label="Search pull requests"]'));const row=()=>[...document.querySelectorAll('button')].find(item=>item.innerText.includes(pull.title));await wait(()=>row());row().click();await wait(()=>button('Checks (1)'));button('Checks (1)').click();await wait(()=>document.querySelector('[aria-label="Pull request pipeline runs"]')?.innerText.includes(pull.number===8?'Failing workflow fixture':'Verify workflow fixture')&&!button('Refresh runs')?.disabled)};
 const pipelineMetadata=label=>[...document.querySelectorAll('[aria-label="Pipeline details"] dt')].find(item=>item.textContent===label)?.parentElement.querySelector('dd')?.textContent;
 const assertDraft=async(kind,id)=>{const task=(await snapshot()).workspace.tasks.find(t=>t.id===id);if(!task||task.status!=='draft'||task.messages.length||task.turns?.length||task.queue?.length||task.sessionId||agentRuns)throw new Error('Linked task was not an unsent draft');if(task.repositoryId!=='work'||task.workItem?.kind!==kind||task.workItem.provider!=='gitea'||task.origin!==task.workItem.url||!task.draft.includes(task.workItem.url)||!task.draft.includes('<source-context>'))throw new Error('Linked source metadata or context missing');if(field('Message task')?.value!==task.draft)throw new Error('Linked task context missing from composer');return task};
 button('Issues').click();await pickProject('Issues');await wait(()=>document.body.innerText.includes('Issue workflow fixture'));
 if([...document.querySelectorAll('[aria-label="Extensions"] button')].some(item=>item.getAttribute('aria-label')==='Pipelines'||item.innerText.trim()==='Pipelines'))throw new Error('Pipelines remains in main navigation');
 await searchPagination();
 [...document.querySelectorAll('button')].find(b=>b.innerText.includes('Issue workflow fixture')).click();await wait(()=>button('Comment'));
 if(button('Issue source') || document.querySelector('[aria-label="Search issues"]')) throw new Error('Issue detail retains collection controls'); if(!document.querySelector('code')?.innerText.includes('safe code'))throw new Error('Issue markdown did not render');
 button('More comments').click();await wait(()=>delayedPage);button('Back to issues').click();await wait(()=>!document.body.innerText.includes('Loading…')&&document.body.innerText.includes('Issue workflow fixture'));
 [...document.querySelectorAll('button')].find(b=>b.innerText.includes('Issue workflow fixture')).click();await wait(()=>button('Comment')&&!button('Comment').disabled);delayedPage();await new Promise(r=>setTimeout(r,250));
 if(document.body.innerText.includes('Late response must not replace the new view'))throw new Error('Late detail page overwrote a newer view');
 failOptions=true;button('Refresh').click();await wait(()=>document.body.innerText.includes('Fixture account no longer permits this read'));
 if(!button('Issue actions')?.disabled||!button('Comment')?.disabled)throw new Error('Mutation enabled after failed refresh');
 button('Refresh').click();await wait(()=>button('Comment')&&!button('Comment').disabled);

 button('Comment').click();await wait(()=>document.querySelector('[role="dialog"]'));input('Description','Useful fixture comment');button('Post comment').click();await wait(()=>document.body.innerText.includes('Useful fixture comment')&&!document.querySelector('[role="dialog"]'));
 const startIssue=button('Start task from issue');if(!startIssue||startIssue.disabled)throw new Error('Issue task action missing');startIssue.click();startIssue.click();await wait(()=>releaseTask&&button('Preparing…')?.disabled);if(taskRequests.length!==1)throw new Error('Double click created duplicate task requests');releaseTask();await wait(()=>button('Open created task')&&!button('Open created task').disabled);if(document.querySelector('article h2')?.innerText!=='Issue workflow fixture'||field('Message task'))throw new Error('Task handoff navigated before its snapshot arrived');hiddenTaskId='';const openCreated=button('Open created task');openCreated.click();openCreated.click();await wait(()=>button('Issue #1')&&field('Message task'));if(taskRequests.length!==1)throw new Error('Opening the created task submitted another creation request');
 const issueTask=await assertDraft('issue',taskRequests[0].requestId);if(issueTask.workItem.id!=='1'||issueTask.workItem.url!==${JSON.stringify(address + '/team/app/issues/1')}||!issueTask.draft.includes('Useful details')||!issueTask.draft.includes('Useful fixture comment'))throw new Error('Issue draft lost issue or discussion context');
 button('Issue #1').click();await wait(()=>document.querySelector('article h2')?.innerText==='Issue workflow fixture'&&button('Start task from issue'));
 document.querySelector('[aria-label="Linked tasks"] summary').click(); const relatedIssue=[...document.querySelectorAll('[aria-label="Linked tasks"] button')].find(b=>b.innerText.includes(issueTask.title));if(!relatedIssue)throw new Error('Related issue task missing');relatedIssue.click();await wait(()=>button('Issue #1')&&document.querySelector('h1')?.innerText===issueTask.title);await assertDraft('issue',issueTask.id);button('Issue #1').click();await wait(()=>button('Start task from issue'));
 await openPullChecks(failedPull);if(document.querySelector('[aria-label="Pull request pipeline runs"]').innerText.includes('Verify workflow fixture'))throw new Error('PR includes a run from another commit');
 [...document.querySelectorAll('[aria-label="Pull request pipeline runs"] button')].find(b=>b.innerText.includes('Failing workflow fixture')).click();await wait(()=>document.querySelector('[aria-label="Job Build application"]'));
 const failedJob=document.querySelector('[aria-label="Job Build application"]'); if(button('Project') || document.querySelector('[aria-label="Search pipelines"]')) throw new Error('Collection filters remain in detail'); if(document.querySelector('[aria-label="Pipeline details"] details')?.open) throw new Error('Run metadata should start collapsed');if(failedJob.querySelector('button')?.getAttribute('aria-expanded')!=='true'||!failedJob.innerText.includes('dovo-runner-2')||!failedJob.innerText.includes('1m 50s'))throw new Error('Failed pipeline job is not expanded with runner and duration');
 const failedSteps=[...failedJob.querySelectorAll('[aria-label="Build application steps"] li')];if(failedSteps.length!==3||!failedSteps[1].innerText.includes('Compile application')||!failedSteps[1].innerText.includes('Failed')||!failedSteps[1].innerText.includes('1m 40s')||!failedSteps[2].innerText.includes('Publish package')||!failedSteps[2].innerText.includes('Skipped')||failedSteps[2].innerText.includes('0s'))throw new Error('Failed or skipped pipeline step details are incorrect');
 if(pipelineMetadata('Trigger')!=='pull request'||pipelineMetadata('Duration')!=='2m 0s'||document.querySelector('[aria-label="Reported errors"]'))throw new Error('Failed run metadata invented or omitted provider details');document.querySelector('[aria-label="Pipeline details"] details summary').click(); if(!document.querySelector('[aria-label="Pipeline details"] details').open || !document.querySelector('[aria-label="Pipeline details"] details').innerText.includes('Duration')) throw new Error('Run metadata cannot be expanded'); document.querySelector('[aria-label="Pipeline details"] details summary').click(); await capture('pipeline-desktop-failed');failedJob.scrollIntoView({block:'end'});await capture('pipeline-desktop-failed-jobs');button('Back to pipelines').click();await wait(()=>document.querySelector('[aria-label="Pull request pipeline runs"]')&&document.body.innerText.includes('Failing workflow fixture'));if(!document.querySelector('[aria-label="Pull request details"]'))throw new Error('Back from a pipeline left the PR');
 await openPullChecks(fixturePull);const pipelineSection=document.querySelector('[aria-label="Pull request pipeline runs"]');if(!pipelineSection.innerText.includes('aaaaaaaa')||pipelineSection.innerText.includes('Failing workflow fixture'))throw new Error('PR runs did not match its exact commit');const pipelineRow=[...pipelineSection.querySelectorAll('button')].find(b=>b.innerText.includes('Verify workflow fixture'));for(const text of ['Passed','main'])if(!pipelineRow?.innerText.includes(text))throw new Error('Pipeline row metadata missing '+text);pipelineRow.click();await wait(()=>document.querySelector('[aria-label="Job Typecheck"]'));
 const pipelineArticle=document.querySelector('article');if(!pipelineArticle?.innerText.includes('Passed')||!pipelineArticle.innerText.includes('aaaaaaaa'))throw new Error('Normalized pipeline detail missing');
 for(const [label,value] of Object.entries({Workflow:'ci.yaml',Branch:'main','Triggered by':'developer',Trigger:'push',Attempt:'2',Duration:'3m 15s',Commit:'a'.repeat(40)}))if(pipelineMetadata(label)!==value)throw new Error('Pipeline metadata mismatch for '+label+': '+pipelineMetadata(label));for(const label of ['Created','Started','Finished'])if(!pipelineMetadata(label))throw new Error('Missing pipeline timestamp '+label);if(!pipelineArticle.innerText.includes('Run 1042')||pipelineMetadata('Created')===pipelineMetadata('Started'))throw new Error('Run number or real start time missing');
 const successfulJob=document.querySelector('[aria-label="Job Typecheck"]'),jobToggle=successfulJob?.querySelector('button');if(jobToggle?.getAttribute('aria-expanded')!=='false'||!jobToggle.innerText.includes('3m 5s'))throw new Error('Successful job summary missing duration or collapsed state');jobToggle.click();await wait(()=>document.querySelector('[aria-label="Typecheck steps"]'));const successSteps=[...successfulJob.querySelectorAll('[aria-label="Typecheck steps"] li')];if(successSteps.length!==2||!successSteps[0].innerText.includes('Checkout source')||!successSteps[0].innerText.includes('10s')||!successSteps[1].innerText.includes('Run TypeScript compiler')||!successSteps[1].innerText.includes('2m 55s')||!successSteps.every(step=>step.innerText.includes('Passed'))||!successfulJob.innerText.includes('Runner · dovo-runner-1'))throw new Error('Timed job steps or runner missing');if(![...successfulJob.querySelectorAll('a')].some(link=>link.innerText.includes('Open job logs')&&link.href===${JSON.stringify(address + '/team/app/actions/runs/42')}))throw new Error('Native job log link missing');jobToggle.click();await wait(()=>!document.querySelector('[aria-label="Typecheck steps"]'));jobToggle.click();await wait(()=>document.querySelector('[aria-label="Typecheck steps"]'));
 await capture('pipeline-desktop');successfulJob.scrollIntoView({block:'end'});await capture('pipeline-desktop-jobs');
 if(await hasPipelineAction('Cancel'))throw new Error('Gitea unsupported cancel is visible');
 exposeCancellation=true;button('Refresh').click();await wait(()=>cancellationReads>=1&&button('Investigate run')&&!button('Investigate run').disabled);if(await hasPipelineAction('Cancel'))throw new Error('Completed run cancellation is visible when the provider supports cancel');
 const investigate=button('Investigate run');if(!investigate||investigate.disabled)throw new Error('Pipeline task action missing');investigate.click();investigate.click();await wait(()=>button('Run #42')&&field('Message task'));if(taskRequests.length!==2)throw new Error('Pipeline investigation double click duplicated task requests');
 const pipelineTask=await assertDraft('pipeline',taskRequests[1].requestId);if(pipelineTask.workItem.id!=='42'||pipelineTask.workItem.sha!=='a'.repeat(40)||pipelineTask.workItem.ref!=='main'||pipelineTask.workItem.url!==${JSON.stringify(address + '/team/app/actions/runs/42')}||!pipelineTask.draft.includes('a'.repeat(40))||!pipelineTask.draft.includes('Typecheck: success')||!pipelineTask.draft.includes('Full logs have not been fetched'))throw new Error('Pipeline investigation context missing');
 for(const context of ['Workflow: ci.yaml','Run number: 1042','Attempt: 2','Runner: dovo-runner-1','Step 2: Run TypeScript compiler — success'])if(!pipelineTask.draft.includes(context))throw new Error('Pipeline draft missing enriched context '+context);
 button('Run #42').click();await wait(()=>document.querySelector('article h2')?.innerText==='Verify workflow fixture'&&button('Investigate run'));document.querySelector('[aria-label="Linked tasks"] summary').click(); const relatedRun=[...document.querySelectorAll('[aria-label="Linked tasks"] button')].find(b=>b.innerText.includes(pipelineTask.title));if(!relatedRun)throw new Error('Related pipeline task missing');relatedRun.click();await wait(()=>button('Run #42')&&document.querySelector('h1')?.innerText===pipelineTask.title);await assertDraft('pipeline',pipelineTask.id);button('Run #42').click();await wait(()=>button('Investigate run'));
 button('Pipeline actions').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true})); await wait(()=>document.querySelector('[role="menu"]')); [...document.querySelectorAll('[role="menuitem"]')].find(item=>item.textContent==='Run pipeline').click(); await wait(()=>document.querySelector('[role="dialog"]'));await wait(()=>button('Retry pipelines'));
 if(field('Branch or ref')?.value!=='main')throw new Error('Pipeline ref did not prefill from selected run');
 if(!button('Run pipeline').disabled)throw new Error('Dispatch enabled without loaded definitions');button('Retry pipelines').click();await wait(()=>button('More pipelines'));
 if(button('Pipeline')?.dataset.value!=='1')throw new Error('Pipeline definition did not prefill from selected run');
 const more=button('More pipelines');more.click();more.click();await wait(()=>definitionPages===1&&!button('More pipelines'));
 if(definitionPages!==1)throw new Error('Duplicate definition page request');button('Pipeline').click();await wait(()=>document.querySelector('[role="listbox"]'));
 if(document.querySelectorAll('[role="option"]').length!==2)throw new Error('Overlapping definitions were duplicated');document.querySelector('[role="option"][data-value="1"]').click();
 button('Run pipeline').click();await wait(()=>document.body.innerText.includes('Workflow dispatch accepted'));

 injectCheckout=true;document.dispatchEvent(new Event('visibilitychange'));button('Pull requests').click();await wait(()=>button('PR repository'));await choose('PR repository',workProject);await createPull();await wait(()=>button('PR source task')&&checkoutSnapshots>0);button('PR source task').click();await wait(()=>document.querySelector('[role="listbox"]'));const sourceOption=[...document.querySelectorAll('[role="option"]')].find(option=>option.dataset.value===issueTask.id);if(!sourceOption)throw new Error('Linked issue task unavailable for PR prefill');sourceOption.click();await wait(()=>!document.querySelector('[role="listbox"]')&&field('New PR title')?.value===issueTask.workItem.title);
 if(field('New PR head branch')?.value!=='fixture/issue-1'||!field('New PR description')?.value.includes(issueTask.workItem.url)||!field('New PR description')?.value.includes('Related issue:'))throw new Error('PR prefill lost the linked task branch or source');
 [...document.querySelectorAll('[role="dialog"] button')].find(b=>b.innerText.trim()==='Cancel').click();await wait(()=>!document.querySelector('[role="dialog"]'));injectCheckout=false;document.dispatchEvent(new Event('visibilitychange'));await wait(()=>restoredSnapshots>0);
 const persistedResponse=await originalFetch(c.address+'/api/snapshot',{headers:{Authorization:'Bearer '+c.token}});const persisted=(await persistedResponse.json()).workspace.tasks;if(persisted.some(task=>task.workItem&&task.checkoutBranch)||blockedTaskWrites||pullSubmissions)throw new Error('PR prefill changed the runtime or submitted a PR');
 await createPull();await wait(()=>document.querySelector('[role="dialog"]')&&!button('PR source task'));[...document.querySelectorAll('[role="dialog"] button')].find(b=>b.innerText.trim()==='Cancel').click();await wait(()=>!document.querySelector('[role="dialog"]'));
 await openPullChecks(fixturePull);await wait(()=>document.querySelector('[aria-label="Pull request pipeline runs"]')?.innerText.includes('Verify workflow fixture'));if(document.querySelector('[aria-label="Pull request pipeline runs"]').innerText.includes('Failing workflow fixture')||field('Search pipelines'))throw new Error('PR checks lost embedded exact-commit filtering');button('Check older runs').click();await wait(()=>!button('Check older runs'));if(document.querySelector('[aria-label="Pull request pipeline runs"]').innerText.includes('Failing workflow fixture'))throw new Error('Older pipeline pages leaked another commit');

 button('Issues').click();await pickProject('Issues');await wait(()=>button('Sources'));button('Sources').click();await wait(()=>document.querySelector('[role="dialog"]')&&button('Connect Jira'));button('Connect Jira').click();await wait(()=>button('Jira project'));if(field('Jira Cloud site')?.value!=='https://team.atlassian.net')throw new Error('Jira account site was not discovered');await choose('Jira project',option=>option.dataset.value==='TEAM');button('Connect Jira').click();await wait(()=>document.querySelector('[role="dialog"]')?.innerText.includes('Team delivery')&&!button('Jira project'));document.querySelector('[role="dialog"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await wait(()=>!document.querySelector('[role="dialog"]'));await choose('Issue source',option=>option.dataset.value==='');
 const jiraWorkspace=(await snapshot()).workspace,jiraSource=jiraWorkspace.jiraSources?.find(source=>source.project==='TEAM');if(!jiraSource||jiraWorkspace.repositories.find(repo=>repo.id==='work')?.jira)throw new Error('Jira was not saved independently of the code project');
 await wait(()=>document.body.innerText.includes('Independent Jira issue'));
 [...document.querySelectorAll('button')].find(b=>b.innerText.includes('Independent Jira issue')).click();await wait(()=>document.body.innerText.includes('Jira rich text'));
 if(!document.querySelector('[aria-label="Issue details"] header')?.textContent.includes('To Do'))throw new Error('Missing issue metadata left empty separators');
 if(button('Linked Dovo project')?.dataset.value!=='')throw new Error('New Jira issue was automatically linked to a repository');button('Start task from issue').click();await wait(()=>button('Task project'));if(!button('Create task draft')?.disabled)throw new Error('Unlinked Jira task did not require a destination');button('Cancel').click();await wait(()=>!document.querySelector('[role="dialog"]'));if(taskRequests.length!==2)throw new Error('Choosing a project prematurely created a task');
 await choose('Linked Dovo project',option=>option.dataset.value==='work');await wait(()=>button('Linked Dovo project')?.dataset.value==='work'&&!button('Linked Dovo project').disabled);if(!(await snapshot()).workspace.jiraIssueLinks?.some(link=>link.sourceId===jiraSource.id&&link.issueId==='TEAM-1'&&link.repositoryId==='work'))throw new Error('Optional Jira project link was not saved');await choose('Linked Dovo project',option=>option.dataset.value==='');await wait(()=>button('Linked Dovo project')?.dataset.value===''&&!button('Linked Dovo project').disabled);if((await snapshot()).workspace.jiraIssueLinks?.some(link=>link.sourceId===jiraSource.id&&link.issueId==='TEAM-1'))throw new Error('Jira project unlink failed');

 button('Issue actions').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true})); await wait(()=>document.querySelector('[role="menu"]')); if(![...document.querySelectorAll('[role="menuitem"]')].some(item=>item.textContent==='Change status')) throw new Error('Jira transition control missing'); document.querySelector('[role="menu"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
 if(agentRuns||blockedTaskWrites||pullSubmissions||(await snapshot()).workspace.tasks.filter(t=>t.workItem).length!==2)throw new Error('Linked workflow executed, wrote a fixture task, submitted a PR or duplicated a task');
 window.fetch=originalFetch;
 return {latePageIgnored:true,failedRefreshGuard:true,definitionsRetry:true,definitionPageDeduplication:true,issueMarkdown:true,commentSubmitted:true,issueTaskDraft:true,taskClickDeduplication:true,delayedTaskSnapshotHandoff:true,nativeSourceBacklinks:true,relatedTasks:true,pipelineJobs:true,pipelineStatusMetadata:true,pipelineRunMetadata:true,pipelineTiming:true,pipelineJobExpansion:true,pipelineRunnerAndSteps:true,pipelineFailedAndSkippedSteps:true,completedStateGating:true,pipelineTaskDraft:true,noAutomaticExecution:true,searchPagination:true,capabilityGating:true,dispatchPrefill:true,workflowDispatch:true,pullTaskPrefill:true,pullPrefillCancelledWithoutWrites:true,pipelinesHiddenFromNavigation:true,pullChecksEmbeddedRuns:true,pullChecksExactCommit:true,pipelineBackRetainsPR:true,jiraProjectDiscovery:true,independentJira:true,jiraOptionalProjectLink:true,jiraTaskDestinationRequired:true,jiraMarkdown:true,emptyIssueMetadata:true};
 })().catch(e=>{throw new Error(JSON.stringify({stack:e.stack,text:document.body.innerText.slice(-1800)}))})`)
      if (
        captured.size !== 4 ||
        writes.filter((w) => w.path.endsWith('/comments')).length !== 1 ||
        writes.filter((w) => w.path.endsWith('/dispatches')).length !== 1
      )
        throw new Error('Duplicate or missing writes: ' + JSON.stringify(writes))
      const dispatch = writes.find((w) => w.path.endsWith('/dispatches'))
      if (!dispatch.path.endsWith('/workflows/1/dispatches') || dispatch.body.ref !== 'main')
        throw new Error(
          'Dispatch lost the selected run definition or ref: ' + JSON.stringify(dispatch),
        )
      console.log(JSON.stringify(result))
      await finish()
    } catch (error) {
      await finish(error)
    }
  })
})
setTimeout(() => void finish(new Error('Work verification timeout')), 120000).unref()
provider.listen(0, '127.0.0.1', () => {
  address = 'http://127.0.0.1:' + provider.address().port
  import(root + '/apps/desktop/dist-electron/main.js').catch(finish)
})
