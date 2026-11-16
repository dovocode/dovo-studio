import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  insertRelease,
  needsFragment,
  parseFragment,
  releaseSection,
  renderNotes,
} from './fragments.mjs'

const fragment = (header, body = 'Thread titles stay after a reconnect.') =>
  `---\n${header}\n---\n${body}\n`

await test('fragments parse category, ordered clients, pull number and joined lines', () => {
  assert.deepEqual(
    parseFragment(
      '123.md',
      fragment('category: Fixed\nclients: mobile, desktop', 'First line.\nSecond line.\n'),
    ),
    {
      fragment: {
        name: '123.md',
        category: 'Fixed',
        clients: ['desktop', 'mobile'],
        text: 'First line. Second line.',
        pull: 123,
      },
    },
  )
  assert.equal(
    parseFragment('fix-titles.md', fragment('category: Added\r\nclients: web')).fragment?.pull,
    undefined,
  )
})

await test('fragments report every format problem in plain words', () => {
  const problems = (name, text) => parseFragment(name, text).errors ?? []
  assert.match(problems('Fix_Titles.md', fragment('category: Fixed\nclients: web'))[0], /123\.md/)
  assert.match(problems('1.md', 'No header\n')[0], /header between two "---" lines/)
  const header = problems('1.md', fragment('category: Improved\nclients: tv, web\nowner: me'))
  assert.equal(header.length, 3)
  assert.ok(header.some((error) => error.includes('unknown header key "owner"')))
  assert.ok(header.some((error) => error.includes('category "Improved"')))
  assert.ok(header.some((error) => error.includes('client "tv"')))
  assert.match(problems('1.md', fragment('category: Fixed'))[0], /set "clients:"/)
  assert.match(problems('1.md', fragment('category: Fixed\nclients: web', ''))[0], /one to three/)
  assert.match(
    problems('1.md', fragment('category: Fixed\nclients: web', 'a\nb\nc\nd'))[0],
    /at most 3 lines/,
  )
  assert.match(
    problems('1.md', fragment('category: Fixed\nclients: web', '- A bullet'))[0],
    /without headings or list markers/,
  )
})

await test('notes group fragments by category in a fixed order and list pull requests first', () => {
  const parse = (name, header, body) => parseFragment(name, fragment(header, body)).fragment
  const notes = renderNotes([
    parse('slug.md', 'category: Fixed\nclients: server', 'Slug fix.'),
    parse('20.md', 'category: Fixed\nclients: web, mobile', 'Second fix.'),
    parse('3.md', 'category: Fixed\nclients: desktop', 'First fix.'),
    parse('5.md', 'category: Added\nclients: desktop, web, mobile, server', 'New thing.'),
  ])
  assert.equal(
    notes,
    [
      '### Added',
      '',
      '- Desktop, web, mobile, server: New thing. (#5)',
      '',
      '### Fixed',
      '',
      '- Desktop: First fix. (#3)',
      '- Web, mobile: Second fix. (#20)',
      '- Server: Slug fix.',
      '',
    ].join('\n'),
  )
  assert.equal(renderNotes([]), '')
})

await test('release sections insert above older releases and read back by version', () => {
  const first = insertRelease('', {
    version: '1.0.0',
    date: '2026-01-02',
    notes: '### Added\n\n- A',
  })
  assert.match(first, /^# Changelog\n/)
  const second = insertRelease(first, {
    version: '1.1.0',
    date: '2026-02-03',
    notes: '### Fixed\n\n- B\n',
  })
  assert.ok(second.indexOf('## 1.1.0 (2026-02-03)') < second.indexOf('## 1.0.0 (2026-01-02)'))
  assert.equal(releaseSection(second, '1.1.0'), '### Fixed\n\n- B\n')
  assert.equal(releaseSection(second, '1.0.0'), '### Added\n\n- A\n')
  assert.equal(releaseSection(second, '1.0'), '')
  assert.throws(
    () => insertRelease(second, { version: '1.0.0', date: '2026-03-04', notes: '- C' }),
    /already has a section for 1\.0\.0/,
  )
})

await test('only non-test, non-doc app and package files need a fragment', () => {
  for (const path of [
    'apps/desktop/src/main.ts',
    'packages/runtime/src/agents/tasks.ts',
    'apps/mobile/app.json',
  ])
    assert.equal(needsFragment(path), true, path)
  for (const path of [
    'apps/desktop/src/main.test.ts',
    'packages/studio-shell/src/task-notifications.browser.mjs',
    'packages/runtime/src/testing/integration.ts',
    'packages/runtime/fixtures/repo/file.ts',
    'apps/mobile/docs/bots.md',
    'packages/durable-connections/README.md',
    'apps/mobile/src/__tests__/thing.tsx',
    'scripts/check-thing.mjs',
    'apps/site/src/app/page.tsx',
    'apps/design-system/src/catalog.tsx',
    'apps/review-demo/src/index.ts',
    'docs/product-guide.md',
    'changelog.d/1.md',
  ])
    assert.equal(needsFragment(path), false, path)
})
