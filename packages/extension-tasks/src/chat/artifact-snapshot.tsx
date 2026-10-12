import { useEffect, useRef, useState } from 'react'
import { artifactSnapshotSchema, type ArtifactMetadata, type RuntimeProfile } from '@dovo/protocol'
import { useWorkspace } from '@dovo/studio-core'
import { ArtifactThumbnail } from './artifact-presentation'

export function ArtifactSnapshot({
  profile,
  artifact,
}: {
  profile: RuntimeProfile
  artifact: ArtifactMetadata
}) {
  const { readRuntime } = useWorkspace()
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [preview, setPreview] = useState<typeof artifactSnapshotSchema.Type>()
  const [error, setError] = useState('')
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '100px' },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!visible) return
    let stopped = false
    setPreview(undefined)
    setError('')
    void readRuntime(
      profile,
      '/api/artifacts/snapshot',
      { taskId: artifact.taskId, id: artifact.id, revision: artifact.revision },
      artifactSnapshotSchema,
    )
      .then((result) => {
        if (!stopped) setPreview(result)
      })
      .catch((cause: unknown) => {
        if (!stopped) setError(String(cause))
      })
    return () => {
      stopped = true
    }
  }, [visible, readRuntime, profile, artifact.id, artifact.taskId, artifact.revision])
  return (
    <div ref={ref} className="relative h-36 overflow-hidden border-b" aria-hidden="true">
      {preview?.image ? (
        <img src={preview.image} alt="" className="h-full w-full object-cover object-top" />
      ) : preview?.excerpt ? (
        <pre className="h-full overflow-hidden whitespace-pre-wrap bg-background p-4 text-[10px] leading-relaxed text-muted-foreground">
          {preview.excerpt}
        </pre>
      ) : (
        <ArtifactThumbnail format={artifact.format} />
      )}
      {error && (
        <span
          title={error}
          className="absolute bottom-1 right-2 rounded bg-background/90 px-2 text-[10px] text-muted-foreground"
        >
          Snapshot unavailable
        </span>
      )}
    </div>
  )
}
