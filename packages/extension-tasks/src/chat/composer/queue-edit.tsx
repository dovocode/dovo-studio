import { createContext, useContext } from 'react'
import type { Task } from '@dovo/protocol'
export const QueueEditContext = createContext<{
  editingId?: string
  begin: (message: Task['messages'][number]) => void
} | null>(null)
export const useQueueEdit = () => useContext(QueueEditContext)
