import assert from 'node:assert/strict'
import { bundleBrowser, chromium } from './browser/harness.mjs'
const root = new URL('../', import.meta.url).pathname.replace(/\/$/, '')
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root + '/packages/studio-ui',
      loader: 'tsx',
      contents: `
    import {createRoot} from 'react-dom/client';
    import {PullLinkedThreads} from '${root}/packages/extension-scm/src/pulls/detail/linked-threads';
    const root=createRoot(document.getElementById('app'));window.opens=[];
    const link={number:7,url:'https://github.com/o/r/pull/7',repositoryUrl:'https://github.com/o/r',title:'Fix'};
    const profile=id=>({id,name:'Computer '+id,connection:{address:'http://'+id+'.local',token:'device'}});
    window.workspace={activeRuntimeId:'a',workspace:{tasks:[{id:'same',title:'Source thread',example:false,pullRequest:link}]},runtimes:[{profile:profile('a'),connected:true},{profile:profile('b'),connected:false,snapshot:{workspace:{tasks:[{id:'same',title:'Review thread',example:false,linkedPullRequests:[link]},{id:'example',title:'Example',example:true,pullRequest:link},{id:'other',title:'Unrelated',example:false,pullRequest:{...link,url:'https://github.com/other/r/pull/7'}}]}}}]};
    window.render=url=>root.render(url?<PullLinkedThreads pull={{...link,url}}/>:null);window.render(link.url);
  `,
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    alias: {
      react: root + '/packages/studio-ui/node_modules/react',
      'react-dom': root + '/packages/studio-ui/node_modules/react-dom',
    },
  },
  [
    {
      path: '../list/add-to-thread',
      importer: root + '/packages/extension-scm/src/pulls/detail/',
      contents:
        'export const AddPullsToThread=({onClose})=><button onClick={onClose}>Close thread picker</button>;',
    },
    {
      path: '@dovo/studio-core',
      contents: `export const useWorkspace=()=>window.workspace;export const useStudioHost=()=>({openThread:target=>window.opens.push(target)});`,
    },
    {
      path: '@dovo/studio-ui',
      contents: `export const Button=({children,size,variant,...props})=><button {...props}>{children}</button>;`,
    },
  ],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 700 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.getByRole('heading', { name: 'Linked threads · 2' }).waitFor()
  await page.getByRole('button', { name: /Review thread/ }).click()
  assert.deepEqual(await page.evaluate(() => window.opens), [
    { runtimeId: 'b', threadId: 'same', title: 'Review thread' },
  ])
  assert.match(await page.getByRole('button', { name: /Review thread/ }).textContent(), /Offline/)
  await page.getByRole('button', { name: 'Link thread', exact: true }).click()
  await page.getByRole('button', { name: 'Close thread picker', exact: true }).click()
  await page.evaluate(() => window.render('https://github.com/o/r/pull/8'))
  await page.getByRole('heading', { name: 'Linked threads · 0' }).waitFor()
  assert.deepEqual(errors, [])
  console.log(
    'PR reverse links: source/additional associations, cross-computer routing, cached offline threads, example exclusion and empty states verified at mobile width.',
  )
} finally {
  await browser.close()
}
