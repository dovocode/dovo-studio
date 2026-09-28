import { useApplicationState } from '../runtime/state/application-state'
import { WorkScreen } from '../scm/work/work'
export default function IssuesScreen() {
  const [repositoryId, setRepository] = useApplicationState('')
  return <WorkScreen mode="issues" repositoryId={repositoryId} onRepositoryChange={setRepository} />
}
