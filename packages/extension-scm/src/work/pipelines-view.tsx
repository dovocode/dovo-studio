import {
  decodeWorkTarget,
  WorkspaceRuntimeScope,
  useWorkspace,
  type StudioViewProps,
} from '@dovo/studio-core'
import { WorkContent } from './content'
import { PipelinesView } from './work-view'

export default function PipelineView(props: StudioViewProps) {
  if (!props.preview) return <PipelinesView {...props} />
  const target = decodeWorkTarget(props.entityId)
  if (!target?.runtimeId || !target.repositoryId || !target.id)
    return <p role="status">This pipeline source is unavailable.</p>
  return (
    <WorkspaceRuntimeScope runtimeId={target.runtimeId}>
      <PipelinePreview
        repositoryId={target.repositoryId}
        id={target.id}
        url={target.url}
        onClose={props.onClose}
      />
    </WorkspaceRuntimeScope>
  )
}

function PipelinePreview({
  repositoryId,
  id,
  url,
  onClose,
}: {
  repositoryId: string
  id: string
  url?: string
  onClose?: () => void
}) {
  const { workspace, request, connected } = useWorkspace()
  const repository = workspace.repositories.find((item) => item.id === repositoryId)
  if (!repository) return <p role="status">This project is no longer available.</p>
  return (
    <WorkContent
      mode="pipelines"
      preview
      repositoryId={repositoryId}
      repositoryName={repository.name}
      collectionHeader={null}
      branch={repository.branch}
      initialSelected={id}
      initialSourceURL={url}
      connected={connected}
      request={request}
      onBack={onClose}
    />
  )
}
