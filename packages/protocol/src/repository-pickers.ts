import { z } from 'zod'

export const directoryRequestSchema = z.object({
  path: z
    .string()
    .max(4096)
    .refine((value) => !value.includes('\0'), 'Invalid path')
    .default(''),
  hidden: z.boolean().default(false),
  query: z.string().trim().max(200).default(''),
  offset: z.number().int().min(0).max(1_000_000).default(0),
})
export const directoryPageSchema = z.object({
  path: z.string(),
  parent: z.string().nullable(),
  home: z.string().optional(),
  breadcrumbs: z.array(z.object({ name: z.string(), path: z.string() })).optional(),
  total: z.number().int().nonnegative().optional(),
  entries: z.array(z.object({ name: z.string(), path: z.string() })),
  nextOffset: z.number().int().nonnegative().nullable(),
})
export type DirectoryPage = z.infer<typeof directoryPageSchema>

export const githubRepositoryListRequestSchema = z.object({
  page: z.number().int().min(1).max(10000).default(1),
})
export const githubRepositoryChoiceSchema = z.object({
  name: z.string(),
  fullName: z.string(),
  description: z.string(),
  private: z.boolean(),
})
export const githubRepositoryPageSchema = z.object({
  repositories: z.array(githubRepositoryChoiceSchema),
  nextPage: z.number().int().positive().nullable(),
})
export type GithubRepositoryChoice = z.infer<typeof githubRepositoryChoiceSchema>
export type GithubRepositoryPage = z.infer<typeof githubRepositoryPageSchema>
