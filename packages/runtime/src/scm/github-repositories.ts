import { z } from 'zod'
import { githubRepositoryListRequestSchema, type GithubRepositoryPage } from '@dovo/protocol'
import type { GitService } from './git.js'
import { HttpError, errorMessage } from '../errors.js'

const repositoriesSchema = z.array(
  z.object({
    name: z.string(),
    full_name: z.string(),
    description: z.string().nullable(),
    private: z.boolean(),
  }),
)
export async function listGithubRepositories(
  git: GitService,
  value: unknown,
): Promise<GithubRepositoryPage> {
  const { page } = githubRepositoryListRequestSchema.parse(value)
  try {
    const result = await git.githubAccount([
      'api',
      '--hostname',
      'github.com',
      '--method',
      'GET',
      'user/repos',
      '-f',
      'affiliation=owner,collaborator,organization_member',
      '-f',
      'sort=full_name',
      '-f',
      'direction=asc',
      '-f',
      'per_page=100',
      '-f',
      `page=${page}`,
    ])
    const repositories = repositoriesSchema.parse(JSON.parse(result))
    return {
      repositories: repositories.map((repo) => ({
        name: repo.name,
        fullName: repo.full_name,
        description: repo.description ?? '',
        private: repo.private,
      })),
      nextPage: repositories.length === 100 ? page + 1 : null,
    }
  } catch (error) {
    throw new HttpError(
      400,
      `Could not list GitHub repositories. Check the configured GitHub CLI and run gh auth login --hostname github.com on the runtime host. ${errorMessage(error)}`,
    )
  }
}
