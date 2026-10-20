import { Schema } from 'effect'
import {
  decode,
  maxValue,
  minValue,
  mutableArray,
  mutableStruct,
  runtimeIconSchema,
} from '@dovo/protocol'
import { Kind, OperationTypeNode, parse } from 'graphql'
import { parseGithubApiArgs } from '../scm/git/github-transport.js'

const text = maxValue(minValue(Schema.String, 1), 16384)
export const retrievalRequestSchema = mutableStruct({
  provider: Schema.Literals(['github', 'jira']),
  instance: maxValue(minValue(Schema.String, 1), 2048),
  reader: Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-f0-9]{64}$/))),
  project: Schema.optional(maxValue(Schema.String, 300)),
  args: maxValue(mutableArray(text), 100),
  input: Schema.optional(maxValue(Schema.String, 262144)),
  fresh: Schema.optional(Schema.Boolean),
  watch: Schema.optional(Schema.Boolean),
})
export type RetrievalRequest = typeof retrievalRequestSchema.Type
export const retrievalHostSchema = mutableStruct({
  id: text,
  role: runtimeIconSchema,
  enabled: Schema.optional(Schema.Boolean),
  pullCommunication: Schema.optional(Schema.Boolean),
})
export const retrievalResultSchema = mutableStruct({
  value: maxValue(Schema.String, 32 * 1024 * 1024),
  host: text,
  fetchedAt: Schema.Number,
  cached: Schema.Boolean,
})
export type RetrievalResult = typeof retrievalResultSchema.Type

export function githubRead(args: string[], input?: string) {
  const request = parseGithubApiArgs(args, input)
  if (!request.graphql) return request.method === 'GET'
  const query = request.fields.query
  if (typeof query !== 'string') return false
  try {
    const document = parse(query)
    return (
      document.definitions.some((d) => d.kind === Kind.OPERATION_DEFINITION) &&
      document.definitions.every(
        (d) =>
          d.kind === Kind.FRAGMENT_DEFINITION ||
          (d.kind === Kind.OPERATION_DEFINITION && d.operation === OperationTypeNode.QUERY),
      )
    )
  } catch {
    return false
  }
}

/** Only the CLI's structured read commands are eligible; never forward arbitrary CLI execution. */
export function jiraRead(args: string[]) {
  if (args[0] !== 'jira') return false
  const command = args.slice(1, 4).join(' ')
  const supported = [
    'workitem search',
    'workitem view',
    'workitem comment list',
    'board search',
    'board list-sprints',
    'sprint list-workitems',
  ]
  if (!supported.some((value) => command === value || command.startsWith(value + ' '))) return false
  const switches = new Set(['--json', '--paginate'])
  const fields = new Set([
    '--jql',
    '--limit',
    '--fields',
    '--key',
    '--order',
    '--project',
    '--order-by',
    '--id',
    '--state',
    '--board',
    '--sprint',
  ])
  for (let i = 2; i < args.length; i++) {
    const arg = args[i]!
    if (!arg.startsWith('-')) continue
    if (switches.has(arg)) continue
    if (!fields.has(arg) || args[i + 1] === undefined) return false
    if (arg === '--limit' && !/^[1-9]\d{0,4}$/.test(args[i + 1]!)) return false
    i++
  }
  return true
}
export function validateRead(value: unknown) {
  const request = decode(retrievalRequestSchema, value)
  if (request.provider === 'github') {
    const parsed = parseGithubApiArgs(request.args, request.input)
    if (
      !/^[a-zA-Z0-9.-]+(?::[0-9]+)?$/.test(request.instance) ||
      parsed.host !== request.instance ||
      !githubRead(request.args, request.input)
    )
      throw new Error('Only matching GitHub read requests may be shared')
    // GitHub endpoints must stay on the selected instance.
    if (/^[a-z]+:\/\//i.test(parsed.path) || parsed.path.startsWith('//'))
      throw new Error('Use a relative GitHub API endpoint')
  } else if (!request.project || !jiraRead(request.args))
    throw new Error('Only Jira read requests may be shared')
  return request
}
export const hostPriority = (role: typeof runtimeIconSchema.Type) =>
  role === 'server' || role === 'cloud' ? 0 : role === 'laptop' ? 2 : 1

/** Only content addressed by a full commit/object SHA gets a long window. Pull numbers,
 * branches, checks, comments and Jira searches remain mutable. */
export function retrievalFreshness(request: RetrievalRequest) {
  if (request.provider === 'github') {
    const path = parseGithubApiArgs(request.args, request.input).path
    if (
      /^repos\/[^/]+\/[^/]+\/(?:git\/(?:blobs|trees|commits)|commits)\/[a-f0-9]{40,64}(?:\?.*)?$/i.test(
        path,
      )
    )
      return 86400000
  }
  return request.watch ? 45000 : 15000
}
