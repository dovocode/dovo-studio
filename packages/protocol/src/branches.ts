import { z } from 'zod'
export const branchesSchema = z.object({
  current: z.string(),
  revision: z.string(),
  branches: z.array(
    z.object({ name: z.string(), ref: z.string(), remote: z.boolean(), checkedOut: z.boolean() }),
  ),
})
export const switchBranchSchema = z.object({
  action: z.enum(['switch', 'create']),
  name: z.string().min(1).max(250),
  revision: z.string().min(1),
})
