import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
async function bundle(mobile) {
  const controls = `export const View=({children})=><div>{children}</div>;export const Text=({children,accessibilityRole})=><span role={accessibilityRole}>{children}</span>;export const SettingsAction=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;export const SettingsField=({label,value,onChangeText,editable})=><input aria-label={label} value={value} disabled={!editable} onChange={e=>onChangeText(e.target.value)}/>;export const SettingsChoice=()=>null;`
  const mocks = {
    '@dovo/studio-core': `export * from '@dovo/protocol';export const useWorkspace=()=>window.runtime;`,
    '@dovo/studio-core/state': `export {useState as useApplicationState} from 'react';`,
    '../runtime/connection/provider': `export const useRuntime=()=>window.runtime;`,
    '../runtime/state/application-state': `export {useState as useApplicationState} from 'react';`,
    '../../runtime/state/application-state': `export {useState as useApplicationState} from 'react';`,
    '@dovo/client-runtime': `import {Effect} from 'effect';export const runClientEffect=Effect.runPromise;`,
    '../ui/content/open-link': `export const useOpenAppLink=()=>()=>{};`,
    '../screens/settings-theme': `export const SettingsSheet=({children})=><section role="dialog">{children}</section>;export const useSettingsTheme=()=>({styles:{}});`,
    '../screens/settings-controls': controls,
    '../ui/content/text': controls,
    'react-native': controls,
  }
  const ui = `${root}/packages/studio-ui/src/components/ui`
  if (!mobile)
    mocks['@dovo/studio-ui'] =
      `export {Button} from '${ui}/button.tsx';export {Input} from '${ui}/input.tsx';export * from '${ui}/dialog.tsx';export * from '${ui}/select.tsx';`
  const source = mobile ? 'apps/mobile/src/resources' : 'packages/extension-agents/src/resources'
  const built = await build({
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
      import {createRoot} from 'react-dom/client';import {Effect} from 'effect';import {CatalogPicker} from '${root}/${source}/catalog-picker.tsx';
      window.calls=[];window.saved=[];window.single=[];window.fail=false;
      const revision='a'.repeat(40), skills=['review','ship'].map(name=>({name,description:'Description '+name,content:'Read scripts/check.sh',enabled:true,sourcePackage:true,sourceRevision:revision,sourceUrl:'https://skills.sh/owner/repo/'+name}));
      const request=async(path,input)=>{window.calls.push({path,input});if(path.endsWith('/preview'))return {source:'owner/repo',revision,skills};if(path.endsWith('/package/import'))return {source:'owner/repo',revision,skills:skills.filter(skill=>input.skills.includes(skill.name))};if(path.endsWith('/import'))return skills[0];return {entries:[{id:'review',name:'Review',source:'owner/repo',url:'https://skills.sh/owner/repo/review',installs:120,supported:true}]}};
      window.runtime={request,call:request,callEffect:(...args)=>Effect.tryPromise({try:()=>request(...args),catch:error=>error})};
      createRoot(document.getElementById('app')).render(<CatalogPicker kind="skill" scope="Project" onClose={()=>{}} onServer={()=>{}} onSkill={skill=>window.single.push(skill)} onSelect={skill=>window.single.push(skill.value)} onSkills={async skills=>{if(window.fail)throw new Error('Save failed');window.saved.push(skills)}}/>);
    `,
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    alias: {
      react: `${root}/packages/studio-ui/node_modules/react`,
      'react-dom': `${root}/packages/studio-ui/node_modules/react-dom`,
      '@dovo/protocol': `${root}/packages/protocol/src/index.ts`,
    },
    nodePaths: [`${root}/packages/studio-ui/node_modules`],
    plugins: [
      {
        name: 'boundaries',
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, ({ path }) =>
            Object.hasOwn(mocks, path) ? { path, namespace: 'mock' } : undefined,
          )
          builder.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({
            contents: mocks[path],
            loader: 'tsx',
            resolveDir: `${root}/packages/studio-ui`,
          }))
        },
      },
    ],
  })
  return built.outputFiles[0].text
}
const browser = await chromium.launch()
try {
  for (const mobile of [false, true]) {
    const page = await browser.newPage({ viewport: { width: mobile ? 390 : 900, height: 760 } })
    page.setDefaultTimeout(8000)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setContent('<div id="app"></div>')
    await page.addScriptTag({ content: await bundle(mobile) })
    await page.getByRole('textbox').fill('review')
    await page
      .getByRole('button', {
        name: mobile ? 'Install package from owner/repo' : 'Install package',
        exact: true,
      })
      .click()
    await page.getByText('Description ship', { exact: true }).waitFor()
    if (mobile) await page.getByRole('button', { name: 'Selected ship', exact: true }).click()
    else await page.getByRole('checkbox', { name: /ship/ }).uncheck()
    await page.evaluate(() => {
      window.fail = true
    })
    await page.getByRole('button', { name: 'Install 1 skill', exact: true }).click()
    await page.getByText('Save failed', { exact: true }).waitFor()
    assert.equal(await page.getByRole('dialog').count(), 1)
    assert.equal(await page.evaluate(() => window.saved.length), 0)
    await page.evaluate(() => {
      window.fail = false
    })
    await page.getByRole('button', { name: 'Install 1 skill', exact: true }).click()
    await page.waitForFunction(() => window.saved.length === 1)
    const imported = await page.evaluate(() =>
      window.calls.filter((call) => call.path.endsWith('/package/import')),
    )
    assert.deepEqual(imported.at(-1).input, {
      source: 'owner/repo',
      skill: 'review',
      revision: 'a'.repeat(40),
      skills: ['review'],
    })
    assert.deepEqual(await page.evaluate(() => window.saved[0].map((skill) => skill.name)), [
      'review',
    ])
    await page
      .getByRole('button', { name: mobile ? 'Search results' : 'Back to results', exact: true })
      .click()
    await page
      .getByRole('button', { name: mobile ? 'Import Review' : 'Import skill', exact: true })
      .click()
    await page.waitForFunction(() => window.single.length === 1)
    assert.deepEqual(errors, [])
    await page.close()
  }
  console.log(
    'Skill packages: desktop/mobile preview, selection, pinned install, save failure/retry and single-skill import passed.',
  )
} finally {
  await browser.close()
}
