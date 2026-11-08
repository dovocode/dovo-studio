import { jsonStateStorage } from '@dovo/durable-connections'
import {
  readWorkspaceDocument,
  writeWorkspaceDocument,
  updateWorkspaceDocument,
} from '../workspace/read-cache'

// These are explicitly shared preferences, independent of any one pairing's private cache.
const storage = (key: string) =>
  jsonStateStorage({
    read: () => readWorkspaceDocument(key),
    write: (value) => writeWorkspaceDocument(key, value),
    update: (change) => updateWorkspaceDocument(key, change),
  })
export const browserSharedStateStorage = storage('dovo.shared-state.v1')
export const browserThreadStateStorage = storage('dovo.shared-threads.v1')
