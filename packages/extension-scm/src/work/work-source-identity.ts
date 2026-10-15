import { pullRepositoryKey } from '@dovo/protocol'
import type { JiraSource } from '@dovo/studio-core'
import type { WorkSource } from './work-sources'

/** The same Jira project on several computers is one list source; its reader can change. */
const jiraRemoteKey = (jira: Pick<JiraSource, 'site' | 'project'>) =>
  JSON.stringify(['jira', new URL(jira.site).origin, jira.project])

/** Filtering follows the remote source; details and writes remain pinned to their owner. */
export const workRemoteKey = (source: WorkSource): string =>
  source.jira
    ? jiraRemoteKey(source.jira)
    : source.repository
      ? pullRepositoryKey(source.repository, source.key)
      : source.key
export const matchesWorkSource = (source: WorkSource, key: string): boolean =>
  !key || source.key === key || workRemoteKey(source) === key
