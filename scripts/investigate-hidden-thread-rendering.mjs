// Generate an isolated probe from the existing TasksView browser fixture.
// Run from the repository root: HIDDEN=8 node scripts/investigate-hidden-thread-rendering.mjs | node --input-type=module
// ChatThread and panels are mocked. Counts do not measure frame time or cached history reconstruction.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
const root = process.cwd(),
  n = Number(process.env.HIDDEN ?? 8)
if (!Number.isSafeInteger(n) || n < 0) throw new Error('HIDDEN must be a non-negative integer')
let s = readFileSync(root + '/scripts/check-desktop-side-chats-browser.mjs', 'utf8')
const swap = (a, b) => {
  if (!s.includes(a)) throw Error('missing: ' + a)
  s = s.replaceAll(a, b)
}
swap('import.meta.url', JSON.stringify(pathToFileURL(root + '/scripts/x.mjs').href))
swap(
  "import {useState} from 'react';import {createRoot}",
  "import {useState,Activity,memo} from 'react';import {createRoot}",
)
swap(
  'tasks:[parent,child,other]',
  `tasks:[parent,child,other,...Array.from({length:${n}},(_,i)=>thread('h'+i,'Hidden '+i,{messages:Array.from({length:40},(_,m)=>({id:'h'+i+'m'+m,role:m%2?'assistant':'user',text:'message '+m}))}))]`,
)
swap(
  '<TasksView key={mount} entityId={route.entity} pullTarget={route.pullTarget} navigationKey={route.key}/>',
  `<><TasksView key={mount} entityId={route.entity} navigationKey={route.key}/>{Array.from({length:${n}},(_,i)=><Activity key={i} mode="hidden"><TasksView embedded entityId={'h'+i}/></Activity>)}</>`,
)
swap(
  'const built = await build({',
  `mocks['../chat/thread/chat-thread']=\`export const ChatThread=({task})=>{window.chatRenders=(window.chatRenders??0)+1;if(task.id.startsWith('h'))window.hiddenRenders=(window.hiddenRenders??0)+1;return <div data-chat-id={task.id}>{task.messages.length}</div>};\`\nconst built = await build({`,
)
swap(
  'export const WorkspaceScope=({children})=>children;',
  "export {WorkspaceScope} from '../studio-core/src/workspace/scope';",
)
swap(
  "import TasksView from '../extension-tasks/src/view';",
  "import TasksView from '../extension-tasks/src/view';import {WorkspaceScope} from '@dovo/studio-core';const ThreadBody=memo(TasksView);const profile={id:'mac',name:'Mac',connection:{address:'http://runtime',token:'token'}};",
)
swap(
  '<Activity key={i} mode="hidden"><TasksView embedded entityId={\'h\'+i}/></Activity>',
  '<WorkspaceScope key={i} profile={profile} suspended={!window.showHidden}><Activity mode={window.showHidden?"visible":"hidden"}><ThreadBody embedded entityId={\'h\'+i}/></Activity></WorkspaceScope>',
)
swap(
  'runtimes:[],runtimeRegistry:{profiles:[]}',
  'runtimes:[{profile,connected:true}],runtimeRegistry:{profiles:[profile]},runtimeReadCache:()=>null,readRuntimeEffect:()=>{},refreshRuntime:async()=>{},pendingMessages:()=>[]',
)
swap(
  "connection:{address:'http://runtime',token:'token'},request",
  'connection:profile.connection,request',
)
const cut = 'await page.addScriptTag({ content: built.outputFiles[0].text })'
if (!s.includes(cut)) throw Error('missing cut')
s =
  s.slice(0, s.indexOf(cut) + cut.length) +
  `
  await page.locator('textarea[data-task-id="parent"]').waitFor()
  await page.waitForTimeout(1500)
  console.log(JSON.stringify(await page.evaluate(async () => {
    window.hiddenRenders = 0; window.chatRenders = 0
    for (let i = 0; i < 30; i++) {
      window.setTask('parent', (t) => ({ ...t, messages: t.messages.map((m) => m.id === 'p2' ? { ...m, text: m.text + ' token' } : m) }))
      await new Promise((r) => requestAnimationFrame(r))
    }
    await new Promise((r) => setTimeout(r, 1500))
    return { hiddenRenders: window.hiddenRenders, chatRenders: window.chatRenders }
  })))
} finally { await browser.close() }
`
process.stdout.write(s)
