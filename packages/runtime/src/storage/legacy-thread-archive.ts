import { ThreadHistoryChangedError } from '@dovo/protocol'
import { HttpError } from '../errors.js'
import type { ThreadReplicationJournal } from './thread-replication-journal.js'

/** Read existing copies for recovery. Never publish, exchange or execute their records. */
export class LegacyThreadArchive {
  constructor(private journal: ThreadReplicationJournal) {}

  read(ownerRuntimeId: string, threadId: string, before?: string) {
    try {
      const task = this.journal.page(ownerRuntimeId, threadId, before)
      if (!task) throw new HttpError(404, 'Stored thread archive not found')
      return { task }
    } catch (error) {
      if (error instanceof ThreadHistoryChangedError) throw new HttpError(409, error.message)
      throw error
    }
  }
}
