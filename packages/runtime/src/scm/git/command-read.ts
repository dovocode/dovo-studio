import type { CommandSettings } from '@dovo/protocol'
import { githubRead } from '../../retrieval/request.js'

const gitReads = new Set([
  'rev-parse',
  'rev-list',
  'status',
  'diff',
  'diff-files',
  'diff-index',
  'diff-tree',
  'show',
  'log',
  'ls-files',
  'ls-tree',
  'cat-file',
  'show-ref',
  'for-each-ref',
  'describe',
  'merge-base',
  'check-attr',
  'check-ignore',
])
const configReads = new Set([
  '--list',
  '-l',
  '--get',
  '--get-all',
  '--get-regexp',
  '--get-urlmatch',
])
const configFlags = new Set([
  '--null',
  '-z',
  '--show-origin',
  '--show-scope',
  '--name-only',
  '--includes',
  '--no-includes',
  '--local',
  '--global',
  '--system',
  '--worktree',
  '--fixed-value',
  '--all',
  '--regexp',
])
const configValues = new Set(['--file', '-f', '--blob', '--default', '--type'])

function configRead(options: string[]) {
  let read = ['list', 'get'].includes(options[0] ?? '')
  for (let index = 0; index < options.length; index++) {
    const option = options[index]!
    if (configValues.has(option)) {
      if (options[++index] === undefined) return false
    } else if (configReads.has(option)) read = true
    else if (
      option.startsWith('-') &&
      !configFlags.has(option) &&
      !/^--(?:file|blob|default|type)=/.test(option)
    )
      return false
  }
  return read
}

/** Conservative audit classification, never an execution or permission boundary.
 * Unknown commands remain recorded; failed reads are recorded by the caller too. */
export function cliRead(args: readonly string[], settings: Pick<CommandSettings, 'git' | 'gh'>) {
  const [executable, ...input] = args
  const name = executable
    ?.replaceAll('\\', '/')
    .split('/')
    .at(-1)
    ?.replace(/\.exe$/i, '')
  if (executable === settings.git || name === 'git') {
    let index = 0
    while (input[index]?.startsWith('-')) {
      const flag = input[index++]!
      if (['-c', '-C', '--git-dir', '--work-tree', '--namespace', '--config-env'].includes(flag))
        index++
      else if (
        ![
          '--literal-pathspecs',
          '--no-optional-locks',
          '--no-pager',
          '--no-replace-objects',
          '--bare',
        ].includes(flag) &&
        !/^--(?:git-dir|work-tree|namespace|config-env)=/.test(flag)
      )
        return false
    }
    const command = input[index++]
    const options = input.slice(index)
    if (gitReads.has(command ?? ''))
      return !options.some((arg) => arg === '--output' || arg.startsWith('--output='))
    if (command === 'branch')
      return !options.length || (options.length === 1 && options[0] === '--show-current')
    if (command === 'remote')
      return (
        !options.length ||
        (options[0] === 'get-url' &&
          options
            .slice(1)
            .every((arg) => !arg.startsWith('-') || ['--all', '--push', '--'].includes(arg)))
      )
    if (command === 'config') return configRead(options)
    return false
  }
  if (executable === settings.gh || name === 'gh') {
    if (input[0] === 'api') {
      try {
        return githubRead(input)
      } catch {
        // An unsupported flag/body is not evidence of a read. Preserve its audit.
        return false
      }
    }
    if (input.some((arg) => arg === '--web' || arg === '-w')) return false
    return (
      (['repo', 'pr', 'issue', 'run', 'workflow'].includes(input[0] ?? '') &&
        ['view', 'list'].includes(input[1] ?? '')) ||
      (input[0] === 'pr' && ['checks', 'diff', 'status'].includes(input[1] ?? '')) ||
      (input[0] === 'auth' && ['status', 'token'].includes(input[1] ?? ''))
    )
  }
  return false
}
