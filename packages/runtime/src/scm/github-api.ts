import { z } from 'zod'

export type GithubJSON = (args: string[]) => Promise<unknown>
export type GithubLocation = {
  nameWithOwner: string
  url: string
  host: string
  repository: string
  path: string
}

export function githubApi(
  json: GithubJSON,
  repo: GithubLocation,
  path: string,
  method = 'GET',
  fields: string[] = [],
) {
  return json([
    'api',
    '--hostname',
    repo.host,
    `${repo.path}/${path}`,
    '--method',
    method,
    ...fields,
  ])
}

export async function githubGraphql(
  json: GithubJSON,
  repo: GithubLocation,
  query: string,
  fields: string[],
) {
  const result = await json([
    'api',
    '--hostname',
    repo.host,
    'graphql',
    '-f',
    `query=${query}`,
    ...fields,
  ])
  const envelope = z
    .object({ errors: z.array(z.object({ message: z.string() })).optional() })
    .parse(result)
  if (envelope.errors?.length)
    throw new Error(envelope.errors.map((error) => error.message).join('; '))
  return result
}
