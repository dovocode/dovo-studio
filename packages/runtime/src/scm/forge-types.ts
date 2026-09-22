import type { z } from 'zod'
import type {
  ForgeRepository,
  ForgeRepositoryPage,
  PullAction,
  PullActionResult,
  PullCreate,
  PullDetail,
  PullPage,
  pullLineCommentSchema,
} from '@dovo/protocol'

export interface ForgeAdapter {
  repository(): Promise<ForgeRepository>
  repositories(page: number): Promise<ForgeRepositoryPage>
  list(state: 'open' | 'closed' | 'all', page: number): Promise<PullPage>
  detail(number: number): Promise<PullDetail>
  comment(input: z.infer<typeof pullLineCommentSchema>): Promise<{ url: string }>
  create(input: PullCreate): Promise<PullActionResult>
  act(input: PullAction): Promise<PullActionResult>
}
