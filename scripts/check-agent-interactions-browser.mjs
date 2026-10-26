import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite-plus'
import tailwindcss from '@tailwindcss/vite'
import { chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const react = createRequire(`${root}/packages/studio-ui/package.json`)
const browser = await chromium.launch({ headless: true })
const cssServer = await createServer({
  configFile: false,
  root,
  plugins: [tailwindcss()],
  server: { middlewareMode: true },
  logLevel: 'error',
})
let css
try {
  css = (await cssServer.transformRequest('/packages/studio-ui/src/styles.css?direct')).code
} finally {
  await cssServer.close()
}
const native = `
const css=style=>Object.assign({},...(Array.isArray(style)?style:[style]).flat().filter(Boolean));
export const View=({children,style,accessibilityLabel})=><div style={css(style)} aria-label={accessibilityLabel}>{children}</div>;
export const ScrollView=({children,style,contentContainerStyle,accessibilityLabel})=><div style={{...css(style),overflowY:'auto',flexShrink:1}} aria-label={accessibilityLabel}><div style={css(contentContainerStyle)}>{children}</div></div>;
export const Pressable=({children,onPress,disabled,style,accessibilityRole,accessibilityLabel,accessibilityState})=><button style={css(style)} role={accessibilityRole} aria-label={accessibilityLabel} aria-expanded={accessibilityState?.expanded} aria-checked={accessibilityState?.checked} disabled={disabled} onClick={onPress}>{children}</button>;
export const Keyboard={dismiss:()=>{}};
export const Text=({children,style,accessibilityRole,numberOfLines})=><span role={accessibilityRole} style={{...css(style),...(numberOfLines===1?{overflow:'hidden',whiteSpace:'nowrap',textOverflow:'ellipsis'}:{})}}>{children}</span>;
export const Icon=()=>null;
export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;
export const Field=({label,value,onChangeText,editable})=><input aria-label={label} value={value} disabled={!editable} onChange={event=>onChangeText(event.target.value)}/>;
export const useTheme=()=>({styles:{card:{padding:12,border:'1px solid #555',borderRadius:8},text:{},muted:{},row:{display:'flex'},error:{color:'red'}},colors:{muted:'#aaa',accent:'#6af',success:'green',surface:'#222',border:'#555'}});
`
try {
  for (const mobile of [false, true]) {
    const mocks = {
      '@dovo/studio-core/state': "export {useState as useApplicationState} from 'react';",
      '../../runtime/state/application-state':
        "export {useState as useApplicationState} from 'react';",
      expo: `export const requireOptionalNativeModule=()=>({configure:async()=>{},getDraft:async()=>window.notificationDraft??null,clearDraft:async()=>{window.clearedDraft=true;window.notificationDraft=null}});`,
      'react-native': native,
      '../../ui/content/text': native,
      '../../../ui/content/text': native,
      '../../ui/controls/action': native,
      '../../ui/controls/field': native,
      '../../../ui/controls/icon': native,
      '../../ui/theme': native,
      '../../../ui/theme': native,
    }
    const built = await build({
      stdin: {
        resolveDir: root,
        loader: 'tsx',
        contents: `
import {useState} from 'react';import {createRoot} from 'react-dom/client';import {decode,questionPromptSchema,nativeTodos} from '@dovo/protocol';
import {QuestionForm} from '${root}/${mobile ? 'apps/mobile/src/tasks/composer' : 'packages/studio-ui/src'}/question-form';
import {NativeTodos} from '${root}/${mobile ? 'apps/mobile/src/tasks/conversation/components' : 'packages/extension-tasks/src/chat/thread'}/native-todos';
const prompt=decode(questionPromptSchema,{title:'Choose a direction',blocking:false,questions:[{id:'choice',header:'Approach',question:'Which approach?',options:[{value:'small',label:'Small change',description:'Keep it focused'},{value:'large',label:'Larger change'}],custom:true},{id:'checks',header:'Checks',question:'Which checks?',multiple:true,custom:false,options:[{value:'types',label:'Typecheck'},{value:'browser',label:'Browser'}]}]});
function App(){const[status,setStatus]=useState('running');window.taskStatus=setStatus;const[connected,setConnected]=useState(true),[request,setRequest]=useState({id:'question',taskId:'general',prompt,createdAt:''}),[items,setItems]=useState(Array.from({length:100},(_,i)=>({id:'step-'+i,text:'Step '+(i+1),status:i===0?'completed':i===1?'in-progress':'pending'})));window.nativeChecklist=(provider,payload,name)=>setItems(nativeTodos(name,payload,provider,[],'root'));window.connect=setConnected;window.items=setItems;window.reset=()=>setRequest({id:'question-'+Date.now(),taskId:'general',prompt,createdAt:''});return <div style={{display:'flex',flexDirection:'column',height:'100vh',minHeight:0}}><div style={{flex:'1 1 auto',minHeight:0,overflow:'auto'}}>Conversation content</div><div style={{flexShrink:0}}><NativeTodos task={{id:'general',status,nativeTodos:items}}/>{request&&<QuestionForm ${mobile ? 'runtimeId="host"' : ''} key={request.id} request={request} connected={connected} onAnswer={async answers=>{window.submissions.push(answers);if(window.fail)throw Error('Connection failed');setRequest(null)}}/>}<textarea aria-label="Message thread" defaultValue="Retained draft" style={{height:40,width:'100%'}}/></div></div>};window.submissions=[];window.fail=false;createRoot(document.getElementById('app')).render(<App/>);`,
      },
      bundle: true,
      write: false,
      format: 'iife',
      platform: 'browser',
      jsx: 'automatic',
      conditions: ['development'],
      define: { 'process.env.NODE_ENV': '"development"' },
      alias: {
        react: react.resolve('react'),
        'react-dom': `${root}/packages/studio-ui/node_modules/react-dom`,
        'react/jsx-runtime': react.resolve('react/jsx-runtime'),
        '@dovo/protocol': `${root}/packages/protocol/src/index.ts`,
      },
      plugins: [
        {
          name: 'native-adapters',
          setup(builder) {
            builder.onResolve({ filter: /.*/ }, ({ path }) =>
              Object.hasOwn(mocks, path) ? { path, namespace: 'fixture' } : undefined,
            )
            builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
              contents: mocks[path],
              loader: 'tsx',
              resolveDir: `${root}/packages/studio-ui`,
            }))
          },
        },
      ],
    })
    const page = await browser.newPage({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1080, height: 800 },
    })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setContent(
      '<html class="dark"><head></head><body style="margin:0"><div id="app"></div></body></html>',
    )
    await page.addStyleTag({ content: css })
    await page.addScriptTag({ content: built.outputFiles[0].text })
    await page.getByText('Choose a direction', { exact: true }).waitFor()
    const summary = page.getByRole('button', { name: /Checklist/ })
    await summary.click()
    const checklist = page.getByLabel('Checklist items')
    assert.equal(
      await checklist.evaluate((el) => el.clientHeight <= 192 && el.scrollHeight > el.clientHeight),
      true,
    )
    await checklist.evaluate((el) => {
      el.scrollTop = el.scrollHeight
    })
    if (!mobile) {
      const frames = await checklist.evaluate(async (el) => {
        const sizes = []
        for (let i = 0; i < 60; i++) {
          await new Promise(requestAnimationFrame)
          sizes.push([el.clientWidth, el.scrollWidth, el.scrollHeight, el.scrollTop])
        }
        return sizes
      })
      assert.equal(
        new Set(frames.map((frame) => JSON.stringify(frame))).size,
        1,
        'Animated checklist keeps scrollbar geometry and position stable',
      )
      assert.equal(frames[0][0], frames[0][1], 'Checklist has no horizontal overflow')
    }
    assert.equal(
      await page.getByRole('textbox', { name: 'Message thread' }).inputValue(),
      'Retained draft',
    )
    assert.equal(
      await page.getByRole('button', { name: 'Send answers', exact: true }).isVisible(),
      true,
    )
    await page.getByRole('button', { name: 'Send answers', exact: true }).click()
    await page.getByRole('alert').waitFor()
    assert.equal(await page.evaluate(() => window.submissions.length), 0)
    const choice = mobile
      ? page.getByRole('radio', { name: 'Small change. Keep it focused', exact: true })
      : page.getByRole('button', { name: /Small change/ })
    await choice.click()
    const checks = (label) =>
      mobile
        ? page.getByRole('checkbox', { name: label, exact: true })
        : page.getByRole('button', { name: label, exact: true })
    await checks('Typecheck').click()
    await checks('Browser').click()
    await page.evaluate(() => window.connect(false))
    await page.getByText('Reconnect to answer', { exact: true }).waitFor()
    assert.equal(
      await page.getByRole('button', { name: 'Send answers', exact: true }).isDisabled(),
      true,
    )
    await page.evaluate(() => {
      window.connect(true)
      window.fail = true
    })
    await page.getByRole('button', { name: 'Send answers', exact: true }).click()
    await page.getByText('Error: Connection failed', { exact: true }).waitFor()
    await page.evaluate(() => {
      window.fail = false
    })
    await page
      .getByRole('textbox', { name: 'Answer: Approach', exact: true })
      .fill('Custom direction')
    await page.getByRole('button', { name: 'Send answers', exact: true }).click()
    await page.getByText('Choose a direction', { exact: true }).waitFor({ state: 'hidden' })
    assert.deepEqual(await page.evaluate(() => window.submissions.at(-1)), {
      choice: ['Custom direction'],
      checks: ['types', 'browser'],
    })
    assert.equal(
      await page.getByRole('textbox', { name: 'Message thread' }).inputValue(),
      'Retained draft',
    )
    if (mobile) {
      await page.evaluate(() => {
        window.notificationDraft = { fieldId: 'choice', value: 'Retained notification answer' }
        window.reset()
      })
      await page
        .getByText('Your notification answer was not confirmed. Review it and send again.')
        .waitFor()
      assert.equal(
        await page.getByRole('textbox', { name: 'Answer: Approach', exact: true }).inputValue(),
        'Retained notification answer',
      )
    } else await page.evaluate(() => window.reset())
    await page.getByRole('button', { name: 'Decline', exact: true }).click()
    await page.getByText('Choose a direction', { exact: true }).waitFor({ state: 'hidden' })
    assert.equal(await page.evaluate(() => window.submissions.at(-1)), null)
    await page.evaluate(() => window.items([{ text: 'Finished', status: 'completed' }]))
    await page.getByText(/Checklist.*1 of 1 done/).waitFor()
    assert.equal(await page.getByText('Finished', { exact: true }).count(), 1)
    for (const [provider, name, payload] of [
      [
        'opencode',
        'todo.updated',
        {
          properties: {
            sessionID: 'root',
            todos: [{ content: 'OpenCode native step', status: 'in_progress' }],
          },
        },
      ],
      [
        'acp',
        'plan',
        {
          sessionId: 'root',
          update: {
            sessionUpdate: 'plan',
            entries: [{ content: 'ACP native step', status: 'in_progress', priority: 'medium' }],
          },
        },
      ],
      [
        'vibe',
        'vibe/effect',
        {
          entry: {
            sessionId: 'root',
            type: 'effect',
            detail: { kind: 'todo' },
            state: {
              status: 'completed',
              output: {
                todos: [{ id: 'one', content: 'Vibe native step', status: 'in_progress' }],
              },
            },
          },
        },
      ],
    ]) {
      await page.evaluate(
        ({ provider, name, payload }) => window.nativeChecklist(provider, payload, name),
        { provider, name, payload },
      )
      await page
        .getByText(
          payload.properties?.todos[0]?.content ??
            payload.update?.entries[0]?.content ??
            'Vibe native step',
          { exact: true },
        )
        .waitFor()
      await page.getByText(/Checklist.*0 of 1 done/).waitFor()
    }
    await page.evaluate(() => window.taskStatus('done'))
    await page.getByText(/Checklist.*Unfinished/).waitFor()
    await page.getByText(/Work stopped with 1 item left/).waitFor()
    assert.equal(await page.locator('.animate-spin').count(), 0)
    await page.evaluate(() => window.taskStatus('running'))
    await page.getByText(/Work stopped/).waitFor({ state: 'hidden' })
    await page.evaluate(() => window.taskStatus('failed'))
    await page.getByText(/Checklist.*Unfinished/).waitFor()
    await page.evaluate(() => window.items([{ text: 'Done', status: 'completed' }]))
    await page.getByText(/Checklist.*1 of 1 done/).waitFor()
    await page.getByText(/Checklist.*Unfinished/).waitFor({ state: 'hidden' })
    await page.evaluate(() => window.items([]))
    await summary.waitFor({ state: 'hidden' })
    assert.deepEqual(errors, [])
    console.log(
      `${mobile ? 'Mobile (browser adapters)' : 'Desktop'}: questions, custom/multiple answers, retry, offline, decline, retained draft, shared checklist updates and bounded scrolling passed.`,
    )
    await page.close()
  }
} finally {
  await browser.close()
}
