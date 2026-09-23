import { useApplicationState } from '../runtime/application-state'
import { WorkScreen } from '../scm/work'
export default function IssuesScreen() {
  const [repositoryId, setRepository] = useApplicationState('')
  return <WorkScreen mode="issues" repositoryId={repositoryId} onRepositoryChange={setRepository} />
}
