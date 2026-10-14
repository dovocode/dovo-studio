import { createDetailDrafts, detailDraftKey, useDetailDraft } from '../runtime/state/detail-drafts'
import { useRuntime } from '../runtime/connection/provider'
import { WorkScreen } from '../scm/work/work'
const selections = createDetailDrafts<{ repositoryId: string }>()
export default function IssuesScreen() {
  const { profiles } = useRuntime()
  const { draft, setField } = useDetailDraft(
    selections,
    detailDraftKey(
      null,
      'issues-selection',
      profiles
        .map((profile) => [profile.id, profile.connection] as const)
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
    () => ({ repositoryId: '' }),
  )
  const { repositoryId } = draft
  const setRepository = (value: string) => setField('repositoryId', value)
  return <WorkScreen mode="issues" repositoryId={repositoryId} onRepositoryChange={setRepository} />
}
