import { expect, it } from 'vite-plus/test'
import { createdPulls, pullCommands, commandInput, commandOutput } from './pull-commands'
const url = (number = 7) => `https://github.com/o/r/pull/${number}`

it.each([
  'gh pr create --fill',
  '/bin/zsh -lc "git push && gh pr create --fill"',
  "cat > /tmp/body <<'EOF'\nexample gh pr list\nEOF\ngh pr create --body-file /tmp/body",
  '# explanation\ngh pr create --fill',
  'timeout 60 gh pr create --fill',
  'GH_PROMPT_DISABLED=1 gh pr create --fill',
])('recognizes actual create commands: %s', (input) => {
  expect(createdPulls(input, `${url()}\n`)).toEqual([{ number: 7, url: url() }])
})
it.each([
  'echo "gh pr create; gh pr create"',
  'gh pr view 7',
  'sqlite3 audit.db "select \'gh pr create\'"',
  "cat <<'EOF'\ngh pr create\nEOF",
  'gh pr create#typo; gh pr view 7',
  'gh pr list && gh pr create --fill',
  'gh api repos/o/r/pulls && gh pr create --fill',
])('does not link quoted, carried or ambiguous output: %s', (input) => {
  expect(createdPulls(input, url())).toEqual([])
})
it('separates previously read PRs from new stacked PRs, including PR #1', () => {
  expect(createdPulls('gh pr view 120 && gh pr create --fill', `${url(120)}\n${url(1)}`)).toEqual([
    { number: 1, url: url(1) },
  ])
  expect(createdPulls('gh pr create --fill', `${url(7)}\n${url(8)}`)).toEqual([])
  expect(
    createdPulls('gh pr create --fill && gh pr create --fill', `${url(7)}\n${url(8)}`),
  ).toHaveLength(2)
  expect(createdPulls('gh pr create --fill', `Created: ${url()}`)).toEqual([])
})
it('recognizes GitLab creates and explicit merge/close commands with repository scope', () => {
  const gitlab = 'https://gitlab.example/o/r/-/merge_requests/3'
  expect(createdPulls('glab mr create --fill --yes', gitlab)).toEqual([{ number: 3, url: gitlab }])
  expect(createdPulls('gh pr create --fill', gitlab)).toEqual([])
  expect(pullCommands('gh -R o/r pr merge 7 --auto; glab mr close 3 --repo other/r')).toEqual([
    { provider: 'github', action: 'merge', target: '7', repository: 'o/r' },
    { provider: 'gitlab', action: 'close', target: '3', repository: 'other/r' },
  ])
})
it('normalizes shell input and textual tool results without treating other tools as commands', () => {
  expect(commandInput({ command: 'gh pr merge 7' })).toBe('gh pr merge 7')
  expect(commandInput('{"cmd":"gh pr close 7"}')).toBe('gh pr close 7')
  expect(commandInput({ query: 'gh pr create' })).toBe('')
  expect(commandOutput([{ type: 'text', text: url() }])).toBe(url())
})
