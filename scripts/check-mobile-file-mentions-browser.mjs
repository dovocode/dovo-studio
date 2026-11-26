import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const mobile = root + 'apps/mobile/'
const built = await bundleBrowser(
  {
    absWorkingDir: root,
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
import React, {useState} from 'react';
import {Effect} from 'effect';
import {createRoot} from 'react-dom/client';
import {FileMentions} from '${mobile}src/tasks/conversation/components/file-mentions.tsx';
window.requests=[];
const call=(path,input)=>new Promise((resolve,reject)=>window.requests.push({path,input,resolve,reject}));
const readEffect=(path,input)=>Effect.promise(signal=>new Promise((resolve,reject)=>window.requests.push({path,input,resolve,reject,signal})));
function App(){
  const [state,setState]=useState({text:'@file:old',provider:'codex',taskId:'task1',activeId:'runtime1',connected:true,connection:{address:'http://one',token:'token'},agents:[],call,readEffect});
  window.update=changes=>setState(previous=>({...previous,...changes}));
  window.runtime=state;
  return <FileMentions provider={state.provider} taskId={state.taskId} repositoryId={state.repositoryId} agents={state.agents} text={state.text} caret={state.text.length} resources={{skills:[{name:'enabled',description:'Review changes',enabled:true},{name:'disabled',description:'Review security',enabled:false},{name:'review-empty',enabled:true}],mcpServers:[{name:'review-server',enabled:true}]}} onChange={text=>window.update({text})} onSideChat={state.sidechat ? text=>window.sidechat=text : undefined}/>;
}
createRoot(document.getElementById('app')).render(<App/>);`,
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    alias: {
      react: root + 'packages/studio-ui/node_modules/react',
      '@dovo/protocol': root + 'packages/protocol/src/index.ts',
    },
    nodePaths: [root + 'packages/studio-ui/node_modules'],
  },
  [
    {
      path: '../../../bots/bot-avatar',
      importer: mobile,
      contents: 'export const BotAvatar=()=>null;',
    },
    {
      path: 'react-native',
      contents: `import React from 'react';export const View=({children,style})=><div style={{display:'flex',...style}}>{children}</div>;export const ScrollView=({children,accessibilityLabel})=><div aria-label={accessibilityLabel}>{children}</div>;export const Pressable=({children,accessibilityLabel,onPress})=><button aria-label={accessibilityLabel} onClick={onPress}>{children}</button>;`,
    },
    {
      path: 'react-native-svg',
      contents: `import React from 'react';export default ({accessible, ...props})=><svg {...props}/>;export const Path=props=><path {...props}/>;`,
    },
    {
      path: '../ui/theme',
      importer: mobile + 'src/agents/',
      contents: "export const useTheme=()=>({colors:{muted:'#888'}});",
    },
    {
      path: '../../../runtime/connection/provider',
      importer: mobile,
      contents: 'export const useRuntime=()=>({overviews:[],...window.runtime});',
    },
    {
      path: '../../../ui/content/text',
      importer: mobile,
      contents:
        "import React from 'react';export const Text=({children})=><span>{children}</span>;",
    },
    {
      path: '../../../ui/theme',
      importer: mobile,
      contents: 'export const useTheme=()=>({colors:{}});',
    },
  ],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(5000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const waitRequests = (count) =>
    page.waitForFunction((expected) => window.requests.length >= expected, count)
  const update = (changes) => page.evaluate((value) => window.update(value), changes)
  const resolve = (index, file) =>
    page.evaluate(({ index, file }) => window.requests[index].resolve({ files: [file] }), {
      index,
      file,
    })
  const visible = (file) => page.getByRole('button', { name: `Mention file ${file}` })

  await waitRequests(1)
  await update({ text: '@file:new' })
  await waitRequests(2)
  await resolve(1, 'new.ts')
  await visible('new.ts').waitFor()
  await resolve(0, 'old.ts')
  await page.waitForTimeout(50)
  assert.equal(await visible('old.ts').count(), 0)
  assert.equal(await visible('new.ts').count(), 1)
  await update({ text: '@file:different' })
  await page.waitForFunction(() => !document.querySelector('[aria-label="Mention file new.ts"]'))

  for (const [changes, stale] of [
    [{ text: 'dismissed' }, 'dismissed.ts'],
    [{ connected: false }, 'disconnected.ts'],
    [{ taskId: 'task2' }, 'task.ts'],
    [{ activeId: 'runtime2', connection: { address: 'http://two', token: 'other' } }, 'runtime.ts'],
    [{ connection: { address: 'http://three', token: 'other' } }, 'connection.ts'],
  ]) {
    await update({ text: 'reset' })
    await page.waitForTimeout(20)
    await update({ text: '@file:pending', connected: true })
    const index = await page.evaluate(() => window.requests.length)
    await waitRequests(index + 1)
    await update(changes)
    await resolve(index, stale)
    await page.waitForTimeout(50)
    assert.equal(await visible(stale).count(), 0, `${JSON.stringify(stale)} must not appear`)
  }
  await update({ text: '$review' })
  const enabled = page.getByRole('button', { name: 'Mention skill enabled' })
  const disabled = page.getByRole('button', { name: 'Mention skill disabled' })
  const empty = page.getByRole('button', { name: 'Mention skill review-empty' })
  await enabled.waitFor()
  assert.equal(await enabled.locator('span').nth(1).innerText(), 'Skill · Review changes')
  assert.equal(
    await disabled.locator('span').nth(1).innerText(),
    'Skill · this message only · Review security',
  )
  assert.equal(await empty.locator('span').nth(1).innerText(), 'Skill')
  await page.clock.install()
  const nativeCount = () =>
    page.evaluate(
      () => window.requests.filter(({ path }) => path === '/api/tasks/native-skills').length,
    )
  const replyWithSkills = (names) =>
    page.evaluate((names) => window.requests.at(-1).resolve(names.map((name) => ({ name }))), names)
  const nativeSkill = (name) => page.getByRole('button', { name: `Mention skill ${name}` })
  const startNative = await page.evaluate(() => window.requests.length)
  await update({
    text: '$',
    provider: 'opencode',
    snapshot: { nativeSkillMentionsSupported: true, workspace: { tasks: [] } },
  })
  await waitRequests(startNative + 1)
  await replyWithSkills(['first-native'])
  await nativeSkill('first-native').waitFor()
  await page.clock.runFor(5_000)
  await waitRequests(startNative + 2)
  await replyWithSkills(['updated-native'])
  await nativeSkill('updated-native').waitFor()
  assert.equal(await nativeSkill('first-native').count(), 0)
  await page.clock.runFor(5_000)
  await waitRequests(startNative + 3)
  await update({ text: 'closed' })
  await page.waitForFunction(() => window.requests.at(-1).signal?.aborted)
  await replyWithSkills(['late-native'])
  await page.clock.runFor(10_000)
  assert.equal(await nativeCount(), 3)
  assert.equal(await nativeSkill('late-native').count(), 0)
  await update({ text: '@review', snapshot: undefined })
  const server = page.getByRole('button', { name: 'Mention MCP server review-server' })
  await server.waitFor()
  assert.equal(await server.locator('span').nth(1).innerText(), 'MCP server')
  assert.equal(await page.getByRole('button', { name: /^Mention file / }).count(), 0)
  assert.deepEqual(errors, [])
  await update({ text: '/sidechat', sidechat: true })
  await page.getByRole('button', { name: 'Command sidechat: Start an agent side chat' }).click()
  assert.equal(await page.evaluate(() => window.sidechat), '')
  await update({ text: 'Question\n/sidechat' })
  await page.getByRole('button', { name: 'Command sidechat: Start an agent side chat' }).click()
  assert.equal(await page.evaluate(() => window.sidechat), 'Question\n')
  await update({ text: '/sidechat', sidechat: false })
  assert.equal(
    await page.getByRole('button', { name: 'Command sidechat: Start an agent side chat' }).count(),
    0,
  )
  for (const provider of ['claude', 'codex']) {
    await update({ text: '/go', provider })
    await page
      .getByRole('button', { name: 'Command goal: Set, view or clear a native agent goal' })
      .click()
    assert.equal(await page.evaluate(() => window.runtime.text), '/goal ')
  }
  await update({ text: '/go', provider: 'acp' })
  assert.equal(await page.getByRole('button', { name: /^Command goal:/ }).count(), 0)
  await update({ text: '@gpt', snapshot: { modelMentionsSupported: true } })
  await page.waitForFunction(() =>
    window.requests.some((request) => request.path === '/api/agents/model-mentions'),
  )
  await page.evaluate(() =>
    window.requests
      .findLast((request) => request.path === '/api/agents/model-mentions')
      .resolve({
        models: [
          {
            reference: 'model:harness%3Acodex/gpt-exact',
            name: 'GPT Exact',
            provider: 'Codex',
            model: 'gpt-exact',
          },
        ],
        unavailable: [],
      }),
  )
  await page
    .getByRole('button', { name: 'Mention model model:harness%3Acodex/gpt-exact', exact: true })
    .click()
  assert.equal(await page.evaluate(() => window.runtime.text), '`model:harness%3Acodex/gpt-exact` ')
  assert.equal(await page.evaluate(() => window.runtime.provider), 'acp')
  await page.evaluate(() => {
    const task = {
      id: 'same',
      title: 'Release helper',
      repositoryId: '',
      agentId: '',
      createdAt: '2026-11-01T00:00:00Z',
      status: 'review',
      messages: [],
      files: [],
      bot: { role: 'Releases', state: 'active' },
    }
    const thread = { ...task, bot: undefined, id: 'notes', title: 'Release notes' }
    window.update({
      text: '@Release',
      repositoryId: 'project',
      agents: [{ id: 'release-agent', name: 'Release agent', provider: 'claude' }],
      snapshot: { runtimeId: 'mac', modelMentionsSupported: true },
      overviews: ['mac', 'linux'].map((id) => ({
        profile: {
          id,
          name: id,
          nameIsCustom: true,
          connection: { address: 'http://' + id, token: 'paired' },
        },
        snapshot: { runtimeId: id, workspace: { tasks: id === 'linux' ? [task, thread] : [task] } },
      })),
    })
  })
  const bots = page.getByRole('button', { name: /^Mention Bot Release helper:/ })
  const agent = page.getByRole('button', { name: 'Mention agent Release agent', exact: true })
  const thread = page.getByRole('button', { name: 'Mention thread Release notes: Thread · linux' })
  await bots.first().waitFor()
  assert.equal(await bots.count(), 2)
  assert.equal(await thread.count(), 0)
  const picker = page.getByLabel('Agent, Bot, model and MCP server suggestions')
  assert.equal(
    await picker.getByRole('button').first().getAttribute('aria-label'),
    'Mention agent Release agent',
  )
  assert.equal(await agent.locator('svg').getAttribute('fill'), '#d97757')
  await agent.click()
  assert.equal(
    await page.evaluate(() => window.runtime.text),
    '@Release agent (`agent:mac/project/release-agent`) ',
  )
  await update({ text: '@Release' })
  await page
    .getByRole('button', { name: 'Mention Bot Release helper: Bot · mac', exact: true })
    .click()
  assert.equal(
    await page.evaluate(() => window.runtime.text),
    '@Release helper (`studio:mac:thread:same`) ',
  )
  assert.equal(
    await page.evaluate(() =>
      window.requests.some((request) => request.path === '/api/tasks/message'),
    ),
    false,
  )
  await update({ text: '@thread:Release' })
  await thread.waitFor()
  assert.equal(await bots.count(), 0)
  assert.equal(await agent.count(), 0)
  await thread.click()
  assert.equal(
    await page.evaluate(() => window.runtime.text),
    '[Release notes](dovo://thread?runtimeId=linux&threadId=notes) ',
  )
  await update({ text: '@file' })
  await page.waitForFunction(() =>
    window.requests.some(
      (request) => request.path === '/api/tasks/files' && request.input.query === '',
    ),
  )
  await page.evaluate(() =>
    window.requests
      .findLast((request) => request.path === '/api/tasks/files' && request.input.query === '')
      .resolve({ files: ['docs/Release notes.md'] }),
  )
  await visible('docs/Release notes.md').click()
  assert.equal(await page.evaluate(() => window.runtime.text), '@file:"docs/Release notes.md" ')
  // A partial file listing says so, even when nothing matched.
  await update({ text: '@file:huge' })
  await page.waitForFunction(() =>
    window.requests.some(
      (request) => request.path === '/api/tasks/files' && request.input.query === 'huge',
    ),
  )
  await page.evaluate(() =>
    window.requests
      .findLast((request) => request.path === '/api/tasks/files' && request.input.query === 'huge')
      .resolve({ files: [], truncated: true }),
  )
  await page.getByText(/more files than file search covers/).waitFor()
  assert.deepEqual(
    await page.evaluate(() => {
      const queries = window.requests
        .filter((request) => request.path === '/api/tasks/files')
        .map((request) => request.input.query)
      return queries.filter(
        (query) => !['old', 'new', 'different', 'pending', '', 'huge'].includes(query),
      )
    }),
    [],
  )
  assert.equal(
    await page.evaluate(() =>
      window.requests.some(
        (request) =>
          request.path === '/api/agents/model-mentions' &&
          (request.input.query.startsWith('thread:') || request.input.query === 'file'),
      ),
    ),
    false,
  )
  assert.deepEqual(errors, [])
  console.log(
    'Mobile file, agent, Bot, thread and resource mentions, request races, and native goal insertion passed',
  )
} finally {
  await browser.close()
}
