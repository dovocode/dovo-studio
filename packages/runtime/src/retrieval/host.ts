import { homedir } from 'node:os'
import type { Services } from '../services.js'
import { HttpError } from '../errors.js'
import { GithubApiError } from '../scm/git/github-transport.js'
import { JiraWork } from '../scm/forges/providers/jira.js'
import { retrievalLocal } from './context.js'
import { validateRead, type RetrievalRequest, type RetrievalResult } from './request.js'

/** Re-resolve and verify credentials on the executor before touching its cache. No caller token,
 * checkout path, executable or environment is accepted in this protocol. */
type HostServices = Pick<Services, 'git' | 'forges' | 'store' | 'commands' | 'retrieval'>
export async function serveRetrieval(s: HostServices, input: unknown, uncached = false) {
  if (s.retrieval.status().enabled === false)
    throw new HttpError(409, 'Shared retrieval is disabled on this computer')
  const request = validateRead(input)
  return retrievalLocal(async () => {
    if (request.provider === 'jira') return jira(s, request, uncached)
    const connections = s.forges
      .list()
      .filter((c) => c.provider === 'github' && new URL(c.baseUrl).host === request.instance)
    for (const connection of connections) {
      let account
      try {
        const token = await s.forges.githubToken(connection.id, homedir())
        if (!token) continue
        const candidate = { host: request.instance, token, env: connection.cliEnv }
        if ((await s.git.retrievalReader(candidate)) === request.reader) account = candidate
      } catch {
        // A missing/unavailable profile is ineligible. Never retry an executed provider request.
        continue
      }
      if (account)
        return result(s, request, uncached, () =>
          s.git.githubAccount(
            request.args,
            { timeout: 60000, maxBuffer: 32 * 1024 * 1024 },
            undefined,
            account,
            request.watch ?? false,
            request.input,
          ),
        )
    }
    const account = await s.git.githubCredential(homedir(), request.instance)
    if ((await s.git.retrievalReader(account)) !== request.reader)
      throw new HttpError(409, 'No matching GitHub reader on this computer')
    return result(s, request, uncached, () =>
      s.git.githubAccount(
        request.args,
        { timeout: 60000, maxBuffer: 32 * 1024 * 1024 },
        undefined,
        account,
        request.watch ?? false,
        request.input,
      ),
    )
  })
}
async function jira(s: HostServices, request: RetrievalRequest, uncached: boolean) {
  const source = s.store
    .get()
    .jiraSources?.find(
      (source) =>
        new URL(source.site).origin === request.instance && source.project === request.project,
    )
  if (!source) throw new HttpError(404, 'No matching Jira source on this computer')
  const provider = new JiraWork(s.commands.get().acli, source, undefined, homedir(), () => {
    const current = s.store.get().jiraSources?.find((value) => value.id === source.id)
    if (!current || current.site !== source.site || current.project !== source.project)
      throw new HttpError(409, 'Jira source changed')
  })
  try {
    if ((await provider.retrievalReader()) !== request.reader)
      throw new HttpError(409, 'No matching Jira reader on this computer')
    await provider.assertAccount()
    const response = await result(s, request, uncached, () => provider.sharedRead(request.args))
    await provider.assertAccount()
    return response
  } finally {
    await provider.close()
  }
}

async function result(
  s: HostServices,
  request: RetrievalRequest,
  uncached: boolean,
  load: () => Promise<string>,
): Promise<RetrievalResult> {
  const guarded = async () => {
    try {
      return await load()
    } catch (error) {
      if (error instanceof GithubApiError) throw new HttpError(error.status, error.message)
      throw error
    }
  }
  return uncached
    ? {
        value: await guarded(),
        fetchedAt: Date.now(),
        host: s.retrieval.status().id,
        cached: false,
      }
    : s.retrieval.serve(request, guarded)
}
