import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const core = `export * from '@dovo/protocol';export * from '@dovo/client-runtime';export const useStudioHost=()=>({});export const useWorkspace=()=>window.store;export const readAppPreferences=()=>({mergeMethod:'auto',pullDraft:false});`
const ui = `export * as DropdownMenu from '@radix-ui/react-dropdown-menu';export const Button=({children,size,variant,...props})=><button {...props}>{children}</button>;export const Input=props=><input {...props}/>;export const Textarea=props=><textarea {...props}/>;export const FormField=({label,children})=><label>{label}{children}</label>;export const ChoicePicker=({children,onValueChange,...props})=><select {...props} onChange={e=>onValueChange(e.target.value)}>{children}</select>;export const Checkbox=({checked,onCheckedChange,...props})=><input type="checkbox" checked={checked} onChange={e=>onCheckedChange(e.target.checked)} {...props}/>;export const Dialog=({children})=><section role="dialog">{children}</section>;export const DialogContent=({children})=><div>{children}</div>;export const DialogHeader=DialogContent;export const DialogTitle=({children})=><h2>{children}</h2>;export const DialogDescription=({children})=><p>{children}</p>;`
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
import {createRoot} from 'react-dom/client';import {decode,RuntimeRequestError} from '@dovo/protocol';
import {ApplicationStateProvider} from '@dovo/studio-core/state';
import {PullCommentComposer,PullActions} from '${root}packages/extension-scm/src/pulls/list/actions.tsx';
import {WorkForm} from '${root}packages/extension-scm/src/work/work-form.tsx';
import {CreatePull} from '${root}packages/extension-scm/src/pulls/list/create.tsx';
window.requests=[];window.completed=[];window.currentDestination='old-destination';
window.pull={number:7,title:'PR',body:'Original description',base:'main',headSha:'same-sha',url:'https://github.com/team/project/pull/7',destination:'old-destination',provider:'github'};
window.options={destination:'old-destination',provider:'github',issues:true,issueTypes:['Issue'],issueStates:['open','closed'],labels:true,assignees:true,pipelines:true,pipelineActions:['run']};
window.issue={id:'7',title:'Original issue',body:'Original issue body',state:'open',revision:'same-revision',assignees:[],labels:[],destination:'old-destination',url:'https://github.com/team/project/issues/7'};
window.store={activeRuntimeId:'a',connection:{address:'http://a',token:'paired'},connected:true,workspace:{repositories:[{id:'repo',name:'Project',branch:'feature',path:'/repo'}],tasks:[]},request:async(path,input,schema)=>{
 window.requests.push({path,input});
 if(path==='/api/scm/source/identity')return decode(schema,{readerIdentity:'same-account',destination:window.currentDestination});
 if(path==='/api/scm/pulls/options/read')return decode(schema,{provider:'github',draft:true,destination:'old-destination'});
 if(path==='/api/scm/pulls/overview')return decode(schema,{pulls:[],page:1,hasMore:false});
 if(path==='/api/scm/work/pipelines/definitions')return decode(schema,{items:[{id:'build',name:'Build'}]});
 throw new RuntimeRequestError({kind:'response',status:409,message:'The displayed destination changed before dispatch.'});
}};
const app=createRoot(document.getElementById('app'));window.render=(mode=window.mode)=>{window.mode=mode;app.render(<ApplicationStateProvider><div key={mode}>
 {mode==='comment'?<PullCommentComposer repositoryId="repo" detail={{pull:window.pull,destination:window.pull.destination,capabilities:{actions:['comment']}}} onDone={()=>window.completed.push('comment')}/>:
 mode==='edit-pr'?<PullActions repositoryId="repo" detail={{pull:window.pull,destination:window.pull.destination,capabilities:{actions:['edit'],reviewDecisions:[],mergeMethods:[]}}} onDone={()=>window.completed.push('edit')}/>:
 mode==='create-pr'?<CreatePull initialRepositoryId="repo" onClose={()=>window.completed.push('close')} onCreated={()=>window.completed.push('create')}/>:
 <WorkForm kind={mode==='pipeline'?'run':'edit'} repositoryId="repo" issue={mode==='pipeline'?undefined:window.issue} initialRef="main" options={window.options} onClose={()=>window.completed.push('close')} onDone={()=>window.completed.push('work')}/>}
 </div></ApplicationStateProvider>)};
`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    alias: {
      react: root + 'packages/studio-ui/node_modules/react',
      '@dovo/protocol': root + 'packages/protocol/src/index.ts',
      '@dovo/client-runtime': root + 'packages/client-runtime/src/index.ts',
    },
    nodePaths: [root + 'packages/studio-ui/node_modules'],
  },
  [
    { path: '@dovo/studio-core', contents: core },
    { path: '@dovo/studio-ui', contents: ui },
    {
      path: '../detail/markdown-editor',
      importer: root + 'packages/extension-scm/src/pulls/list/',
      contents:
        'export const PullMarkdownEditor=({value,onChange,disabled})=><textarea aria-label="Markdown draft" disabled={disabled} value={value} onChange={e=>onChange(e.target.value)}/>;',
    },
  ],
)
const browser = await chromium.launch()
try {
  for (const mode of ['comment', 'edit-pr', 'edit-issue', 'pipeline', 'create-pr']) {
    const page = await browser.newPage()
    page.setDefaultTimeout(8000)
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.setContent('<div id="app"></div>')
    await page.addScriptTag({ content: built.outputFiles[0].text })
    await page.evaluate((mode) => window.render(mode), mode)
    if (mode === 'edit-pr') {
      await page.getByRole('button', { name: 'PR actions', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Edit pull request', exact: true }).click()
    }
    const draft =
      mode === 'comment' || mode === 'edit-pr'
        ? page.getByRole('textbox', { name: 'Markdown draft' })
        : mode === 'pipeline'
          ? page.getByLabel('Inputs (JSON string values)')
          : mode === 'create-pr'
            ? page.getByRole('textbox', { name: 'New PR description' })
            : page.getByLabel('Description')
    if (mode === 'pipeline') await draft.fill('{"preserve":"pipeline draft"}')
    else await draft.fill('Keep this draft through destination rejection')
    if (mode === 'create-pr') {
      await page.getByRole('textbox', { name: 'New PR title' }).fill('New guarded PR')
      await page.getByRole('textbox', { name: 'New PR base branch' }).fill('main')
    }
    await page.evaluate(() => {
      window.currentDestination = 'new-destination'
      window.pull = { ...window.pull, destination: 'new-destination' }
      window.issue = { ...window.issue, destination: 'new-destination' }
      window.options = { ...window.options, destination: 'new-destination' }
      window.render()
    })
    const names = {
      comment: 'Comment',
      'edit-pr': 'Edit pull request',
      'edit-issue': 'Save changes',
      pipeline: 'Run pipeline',
      'create-pr': 'Create PR',
    }
    await page.getByRole('button', { name: names[mode], exact: true }).click()
    await page.getByRole('alert').filter({ hasText: 'Your draft is preserved' }).waitFor()
    const mutations = await page.evaluate(() =>
      window.requests.filter((r) =>
        [
          '/api/scm/pulls/action',
          '/api/scm/pulls/create',
          '/api/scm/work/issues/action',
          '/api/scm/work/pipelines/action',
        ].includes(r.path),
      ),
    )
    assert.equal(mutations.length, 1)
    assert.equal(mutations[0].input.expectedDestination, 'old-destination', mode)
    assert.equal(
      await draft.inputValue(),
      mode === 'pipeline'
        ? '{"preserve":"pipeline draft"}'
        : 'Keep this draft through destination rejection',
    )
    assert.deepEqual(await page.evaluate(() => window.completed), [])
    const reads = await page.evaluate(() =>
      window.requests.filter(
        (r) =>
          r.path === '/api/scm/pulls/overview' ||
          r.path === '/api/scm/work/pipelines/definitions' ||
          r.path === '/api/scm/pulls/options/read',
      ),
    )
    assert.equal(
      reads.every((r) => r.input.expectedReaderIdentity === 'same-account'),
      true,
    )
    assert.deepEqual(errors, [])
    await page.close()
  }
  console.log(
    'Real desktop forms: comments, PR edits/creation, issue edits and pipeline runs retain their displayed destination, preserve drafts on 409, and verify read identities.',
  )
} finally {
  await browser.close()
}
