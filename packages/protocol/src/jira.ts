import { z } from 'zod'
export const jiraBindingSchema = z.object({
  site: z.url({ protocol: /^https$/ }).refine((value) => {
    try {
      const url = new URL(value)
      return (
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        !url.port &&
        url.pathname === '/' &&
        url.hostname.endsWith('.atlassian.net')
      )
    } catch {
      return false
    }
  }, 'Use your Jira Cloud site URL, for example https://team.atlassian.net'),
  project: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9_]{1,49}$/, 'Enter the Jira project key'),
})
export type JiraBinding = z.infer<typeof jiraBindingSchema>

export const jiraProjectsSchema = z.object({
  site: jiraBindingSchema.shape.site,
  projects: z.array(z.object({ key: jiraBindingSchema.shape.project, name: z.string() })),
  truncated: z.boolean(),
})
export type JiraProjects = z.infer<typeof jiraProjectsSchema>

/** A Jira namespace is an independent issue source, not a Dovo code project. */
export const jiraSourceSchema = jiraBindingSchema.extend({
  id: z.string().min(1).max(200),
  name: z.string().trim().min(1).max(200).optional(),
})
export type JiraSource = z.infer<typeof jiraSourceSchema>
export const jiraIssueLinkSchema = z.object({
  sourceId: jiraSourceSchema.shape.id,
  issueId: z.string().min(1).max(300),
  repositoryId: z.string().min(1).max(200),
})
export type JiraIssueLink = z.infer<typeof jiraIssueLinkSchema>
