import { useState } from 'react'
import { WorkScreen } from '../scm/work'

export default function IssuesScreen() {
  const [repositoryId, setRepository] = useState('')
  return <WorkScreen mode="issues" repositoryId={repositoryId} onRepositoryChange={setRepository} />
}
