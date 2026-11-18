import { isAbsolute, resolve } from 'node:path'
import { parse } from 'shell-quote'
import { gitRemoteIdentity, mutableStruct, maxValue, mutableArray } from '@dovo/protocol'
import { Schema } from 'effect'
import type { HookTool } from '../../agents/execution/hook-events.js'
import type { GitService } from '../git/git.js'
import { commandInput, commandOutput } from './pull-commands.js'

const receiptSchema = mutableStruct({
  repositoryIdentity: maxValue(Schema.String, 2048),
  branch: maxValue(Schema.String, 300),
  sha: Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-f0-9]{40}$/))),
  cwd: maxValue(Schema.String, 4096),
  turnId: Schema.String,
  recordedAt: Schema.String,
})
export const externalGitReceiptsSchema = maxValue(mutableArray(receiptSchema), 40)
export type ExternalGitReceipt = Schema.Schema.Type<typeof receiptSchema>

type GitOperation = { cwd: string; operation: 'push' | 'commit' }

function gitOperation(input: string, cwd: string, depth = 0): GitOperation | undefined {
  if (depth > 2 || !input || input.length > 32768) return
  const commands: string[][] = [[]]
  // Accept simple commands and conjunctions. Commands in pipelines, substitutions,
  // assignments and conditional branches cannot be mapped to one successful push.
  if (/[$`\r\n]/.test(input)) return
  let parsed: ReturnType<typeof parse>
  try {
    parsed = parse(input)
  } catch {
    return
  }
  for (const part of parsed) {
    if (typeof part === 'string') commands.at(-1)!.push(part)
    else if ('op' in part && part.op === '&&') commands.push([])
    else return
  }
  const checkoutCommands = commands.slice(0, -1)
  for (const [bin, path, ...rest] of checkoutCommands) {
    if (bin === 'git' && /^(?:add|commit)$/.test(path ?? '')) continue
    if (bin !== 'cd' || rest.length || !path || path.startsWith('-') || path.startsWith('~')) return
    cwd = resolve(cwd, path)
  }
  const [bin, ...args] = commands.at(-1)!
  if (bin && /(?:^|\/)(?:bash|sh|zsh)$/.test(bin) && /^-[a-z]*c[a-z]*$/.test(args[0] ?? '')) {
    if (args.length === 2) return gitOperation(args[1]!, cwd, depth + 1)
    return
  }
  if (bin !== 'git') return
  while (args[0] === '-C') {
    const path = args[1]
    if (!path || path.startsWith('~')) return
    cwd = resolve(cwd, path)
    args.splice(0, 2)
  }
  if (args[0] === 'commit' && !args.includes('--dry-run')) return { cwd, operation: 'commit' }
  if (
    args[0] !== 'push' ||
    args.some(
      (arg) =>
        /^-[a-zA-Z]*[nd][a-zA-Z]*$/.test(arg) ||
        /^(?:--dry-run|--delete|--mirror|--tags|--repo|--receive-pack|--exec)(?:=|$)/.test(arg),
    )
  )
    return
  return { cwd, operation: 'push' }
}

type RefUpdate = { source: string; branch: string; newPrefix?: string }
type PushReport = { repositoryIdentity: string; updates: RefUpdate[] }

function pushReports(output: string): PushReport[] {
  const reports: PushReport[] = []
  let current: PushReport | undefined
  if (output.length > 200_000) return reports
  for (const line of output.split(/\r?\n/)) {
    const destination = /^To (\S+)\s*$/.exec(line)
    if (destination) {
      const repositoryIdentity = gitRemoteIdentity(destination[1]!)
      current = repositoryIdentity ? { repositoryIdentity, updates: [] } : undefined
      if (current) reports.push(current)
      continue
    }
    if (!current) continue
    // Porcelain names full refs. The default format shortens them.
    const porcelain = /^[ *+]\t(HEAD|refs\/heads\/[^:\t]+):refs\/heads\/([^\t]+)\t(.+)$/.exec(line)
    const human =
      /^ [ +*] (\S+|\[new branch\])[ \t]+([^\s:]+) -> ([^\s:]+)(?: \(forced update\))?$/.exec(line)
    if (!porcelain && !human) continue
    const source = porcelain?.[1] ?? (human![2] === 'HEAD' ? 'HEAD' : `refs/heads/${human![2]}`)
    const branch = porcelain?.[2] ?? human![3]!
    const summary = porcelain?.[3] ?? human![1]!
    const revision = /^[a-f0-9]+\.{2,3}([a-f0-9]{4,40})(?:\s|$)/.exec(summary)?.[1]
    if (!revision && summary !== '[new branch]') continue
    if (branch.length > 300) continue
    current.updates.push({ source, branch, newPrefix: revision })
  }
  return reports
}

function gitOutput(value: unknown, depth = 0): string {
  if (typeof value === 'string') return value
  if (depth > 4 || !value || typeof value !== 'object') return ''
  if (Array.isArray(value)) return value.map((entry) => gitOutput(entry, depth + 1)).join('\n')
  if ('stdout' in value || 'stderr' in value)
    return [
      gitOutput(Reflect.get(value, 'stdout'), depth + 1),
      gitOutput(Reflect.get(value, 'stderr'), depth + 1),
    ].join('\n')
  return commandOutput(value)
}

/** Match the completed command's Git report to local refs and a configured push destination. */
export async function verifiedGitUpdates(
  git: GitService,
  turnId: string,
  runDirectory: string,
  tool: HookTool,
): Promise<ExternalGitReceipt[]> {
  if (tool.kind !== 'command' || !/^(?:completed|success|succeeded|done)$/i.test(tool.status))
    return []
  const input = tool.input
  if (!isAbsolute(runDirectory)) return []
  const workingDirectory = tool.cwd ? resolve(runDirectory, tool.cwd) : runDirectory
  const command = gitOperation(commandInput(input), workingDirectory)
  if (!command || command.cwd.length > 4096) return []
  const { cwd, operation } = command
  const output = gitOutput(tool.output)
  const reports = operation === 'push' ? pushReports(output) : []
  const commit =
    operation === 'commit'
      ? /^\[([^\s\]]+)(?: \(root-commit\))? ([a-f0-9]{4,40})\] /m.exec(output)
      : undefined
  if (!commit && !reports.some((report) => report.updates.length)) return []

  const checkout = (await git.command(cwd, ['rev-parse', '--show-toplevel'])).trim()
  if (!isAbsolute(checkout) || checkout.length > 4096) return []
  const remotes = (await git.command(cwd, ['remote'])).trim().split(/\r?\n/).filter(Boolean)
  const destinations = new Map<string, string[]>()
  for (const remote of remotes) {
    const urls = await git.command(cwd, ['remote', 'get-url', '--push', '--all', '--', remote])
    for (const url of urls.split(/\r?\n/)) {
      const identity = gitRemoteIdentity(url)
      if (identity) destinations.set(identity, [...(destinations.get(identity) ?? []), remote])
    }
  }

  const receipts: ExternalGitReceipt[] = []
  const recordedAt = new Date().toISOString()
  if (commit) {
    const branch = commit[1]!
    if (branch === 'detached' || branch.length > 300) return []
    const head = (await git.command(cwd, ['symbolic-ref', '--short', 'HEAD'])).trim()
    if (branch !== head) return []
    const sha = (await git.command(cwd, ['rev-parse', '--verify', 'HEAD'])).trim()
    if (!/^[a-f0-9]{40}$/.test(sha) || !sha.startsWith(commit[2]!)) return []
    // An unattached local commit is evidence only for a unique configured destination.
    if (destinations.size !== 1) return []
    const [repositoryIdentity] = destinations.keys()
    return repositoryIdentity && repositoryIdentity.length <= 2048
      ? [{ repositoryIdentity, branch, sha, cwd: checkout, turnId, recordedAt }]
      : []
  }
  const refs = new Map(
    (
      await git.command(cwd, [
        'for-each-ref',
        '--format=%(refname)%09%(objectname)',
        'refs/heads',
        'refs/remotes',
      ])
    )
      .trim()
      .split(/\r?\n/)
      .map((line) => {
        const [ref, sha] = line.split('\t')
        return [ref, sha]
      }),
  )
  if (reports.some(({ updates }) => updates.some(({ source }) => source === 'HEAD')))
    refs.set('HEAD', (await git.command(cwd, ['rev-parse', '--verify', 'HEAD'])).trim())
  for (const { repositoryIdentity, updates } of reports) {
    const matching = destinations.get(repositoryIdentity)
    if (!matching?.length || repositoryIdentity.length > 2048) continue
    for (const update of updates) {
      const sha = refs.get(update.source)
      if (!sha || !/^[a-f0-9]{40}$/.test(sha)) continue
      if (update.newPrefix && !sha.startsWith(update.newPrefix)) continue
      // New-branch reports omit the SHA. Require the destination tracking ref to agree.
      if (!matching.some((remote) => refs.get(`refs/remotes/${remote}/${update.branch}`) === sha))
        continue
      receipts.push({
        repositoryIdentity,
        branch: update.branch,
        sha,
        cwd: checkout,
        turnId,
        recordedAt,
      })
    }
  }
  return receipts
}
