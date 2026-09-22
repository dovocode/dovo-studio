import { z } from 'zod'
import { forgeBindingSchema } from './forges.js'

// Only repository roots on github.com are accepted, never credentials, refs or arbitrary remotes.
export const githubRepositorySchema = z
  .string()
  .trim()
  .max(500)
  .transform((value, ctx) => {
    const slug = value
      .replace(/^https:\/\/github\.com\//i, '')
      .replace(/\/$/, '')
      .replace(/\.git$/, '')
    const parts = slug.split('/')
    const [owner, name] = parts
    if (
      parts.length !== 2 ||
      !owner ||
      !/^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(owner) ||
      !name ||
      !/^[a-z\d._-]+$/i.test(name) ||
      name === '.' ||
      name === '..'
    ) {
      ctx.addIssue({ code: 'custom', message: 'Enter owner/repo or https://github.com/owner/repo' })
      return z.NEVER
    }
    return { name, url: `https://github.com/${owner}/${name}.git` }
  })

const name = z.string().trim().min(1, 'Enter a repository name').max(200)
// Preserve paths returned by the folder picker, including legal trailing whitespace.
const path = z
  .string()
  .min(1, 'Enter a path on the runtime host')
  .max(4096)
  .refine((value) => !value.includes('\0'), 'Invalid path')

export const addRepositorySchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('local'), name, path }),
  z.object({ source: z.literal('forge'), name, directory: path, forge: forgeBindingSchema }),
  z.object({
    source: z.literal('github'),
    name,
    repository: githubRepositorySchema,
    directory: path,
  }),
])

export const REPOSITORY_CLONE_TIMEOUT_MS = 300_000
