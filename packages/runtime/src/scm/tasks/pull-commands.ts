import { parse } from 'shell-quote'
import { pullReferencesInText, type ForgeProvider } from '@dovo/protocol'

// Ignore heredoc contents: documentation carried by a command is not executed shell code.
const heredoc =
  /<<-?[ \t]*(['"]?)(\w+)\1[^\n]*\n(?:(?:[\s\S]*?\n)?[ \t]*\2[ \t]*(?=\n|$)|[\s\S]*$)/g
const executable = (value = '') => value.split(/[\\/]/).at(-1) ?? ''

function commands(input: string, depth = 0): string[][] {
  if (depth > 3 || input.length > 262144) return []
  try {
    const script = input
      .replace(/\\\r?\n/g, '')
      .replace(heredoc, '<<')
      .replace(/'[^']*'|"(?:\\[\s\S]|[^"\\])*"|(?<=^|[\s;&|(])#[^\n]*/gm, (value) =>
        value.startsWith('#') ? '' : value,
      )
    const segments: string[][] = [[]]
    // shell-quote treats an inline # as a comment; shell command names do not.
    const quotedHashes = script.replace(
      /'[^']*'|"(?:\\[\s\S]|[^"\\])*"|(\S)#/g,
      (match, prefix: string | undefined) => (prefix ? `${prefix}\\#` : match),
    )
    for (const token of parse(quotedHashes.replace(/\r?\n/g, ';'), () => '')) {
      if (typeof token === 'string') segments.at(-1)!.push(token)
      else if ('op' in token && /^(?:&&|\|\||[;|&()])$/.test(token.op)) segments.push([])
    }
    return segments.flatMap((segment) => {
      let index = 0
      while (/^[A-Za-z_][\w]*=/.test(segment[index] ?? '')) index++
      if (executable(segment[index]) === 'env') {
        index++
        while (/^[A-Za-z_][\w]*=/.test(segment[index] ?? '')) index++
      }
      if (['command', 'time'].includes(segment[index] ?? '')) index++
      if (executable(segment[index]) === 'timeout') {
        index++
        if (segment[index] === '--') index++
        if (!/^\d+(?:\.\d+)?[smhd]?$/.test(segment[index] ?? '')) return []
        index++
      }
      const argv = segment.slice(index)
      if (/^(?:ba|z|da|k)?sh$/.test(executable(argv[0]))) {
        const flag = argv.findIndex((word, i) => i > 0 && /^-[a-z]*c[a-z]*$/.test(word))
        return flag > 0 && argv[flag + 1] ? commands(argv[flag + 1]!, depth + 1) : []
      }
      return argv.length ? [argv] : []
    })
  } catch {
    // Incomplete or unsupported shell input is not evidence of a PR mutation.
    return []
  }
}
export type PullCommand = {
  provider: ForgeProvider
  action: 'create' | 'merge' | 'close'
  target?: string
  repository?: string
}
function mutation(argv: string[]): PullCommand | undefined {
  const bin = executable(argv[0])
  const provider = bin === 'gh' ? 'github' : bin === 'glab' ? 'gitlab' : undefined
  if (!provider) return
  let index = 1
  while (['-R', '--repo', '--hostname'].includes(argv[index] ?? '')) index += 2
  const group = argv[index++]
  const action = argv[index++]
  if (
    !(
      (bin === 'gh' && (group === 'pr' || (group === 'stack' && action === 'merge'))) ||
      (bin === 'glab' && group === 'mr')
    ) ||
    (action !== 'create' && action !== 'merge' && action !== 'close')
  )
    return
  const first = argv[index]
  const repoIndex = argv.findIndex((word) => word === '-R' || word === '--repo')
  const repository =
    repoIndex >= 0 ? argv[repoIndex + 1] : argv.find((word) => word.startsWith('--repo='))?.slice(7)
  return {
    provider,
    action,
    repository,
    target: first && !first.startsWith('-') ? first : undefined,
  }
}
export function pullCommands(input: string): PullCommand[] {
  return commands(input).flatMap((argv) => {
    const command = mutation(argv)
    return command ? [command] : []
  })
}

/** T3's conservative rule: URL-only output lines, matching create CLI, no list/API output,
 * no URLs already named by another command, and no more URLs than create commands. */
export function createdPulls(input: string, output: string) {
  const creates = pullCommands(input).filter((command) => command.action === 'create')
  if (!creates.length || output.length > 2_000_000) return []
  const other = commands(input).filter((argv) => mutation(argv)?.action !== 'create')
  if (
    other.some((argv) =>
      /^(?:gh (?:pr (?:list|status)|search prs|api)|glab (?:mr list|api))\b/.test(argv.join(' ')),
    )
  )
    return []
  const candidates = new Map<string, { number: number; url: string }>()
  for (const line of output.split(/\r?\n/)) {
    const text = line.trim()
    if (!/^https?:\/\/\S+$/.test(text)) continue
    const reference = pullReferencesInText(text)[0]
    if (!reference) continue
    const group = /\/-\/merge_requests\//.test(reference.url)
      ? 'gitlab'
      : /\/pull\//.test(reference.url)
        ? 'github'
        : undefined
    if (!creates.some((command) => command.provider === group)) continue
    const named = new RegExp(`(?:^|[\\s#/=("'])${reference.number}(?=$|[\\s);&|/"'])`)
    if (other.some((argv) => named.test(argv.join(' ')))) continue
    candidates.set(reference.url, reference)
  }
  return candidates.size > creates.length ? [] : [...candidates.values()]
}

export function commandInput(value: unknown): string {
  if (typeof value === 'string') {
    if (!value.trimStart().startsWith('{')) return value
    try {
      return commandInput(JSON.parse(value))
    } catch {
      return ''
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  if ('command' in value && typeof value.command === 'string') return value.command
  if ('cmd' in value && typeof value.cmd === 'string') return value.cmd
  return ''
}
export function commandOutput(value: unknown, depth = 0): string {
  if (depth > 4) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map((entry) => commandOutput(entry, depth + 1)).join('\n')
  if (!value || typeof value !== 'object') return ''
  for (const key of ['text', 'stdout', 'content', 'output'])
    if (key in value) return commandOutput(Reflect.get(value, key), depth + 1)
  return ''
}
