import { createContext } from 'react'

export const InlineThreadInputContext = createContext<{
  questionId?: string
  approvalId?: string
  clearQuestion: () => void
  clearApproval: () => void
} | null>(null)
