import { expect, it } from 'vite-plus/test'
import { terminalFileLinks } from './terminal-file-links'
it('matches compiler paths, quoted spaces and Windows locations with accurate ranges', () => {
  const text =
    'Error at (src/app.ts:12:3), "folder with spaces/a.ts":4:2 and C:\\repo\\app.ts(7, 9)'
  expect(
    terminalFileLinks(text).map(({ path, line, column, start, end }) => ({
      path,
      line,
      column,
      text: text.slice(start, end),
    })),
  ).toEqual([
    { path: 'src/app.ts', line: 12, column: 3, text: 'src/app.ts:12:3' },
    { path: 'folder with spaces/a.ts', line: 4, column: 2, text: '"folder with spaces/a.ts":4:2' },
    { path: 'C:\\repo\\app.ts', line: 7, column: 9, text: 'C:\\repo\\app.ts(7, 9)' },
  ])
})
it('does not turn URLs, invalid line numbers and bare words into file links', () => {
  expect(
    terminalFileLinks(
      'https://host/app.ts:12:3 http://localhost:3000/src/app.ts:12:3 https://[::1]:3000/src/app.ts:12:3 file:///tmp/a.ts:2 Error:12 app.ts:0 app.ts:9007199254740992',
    ),
  ).toEqual([])
})
