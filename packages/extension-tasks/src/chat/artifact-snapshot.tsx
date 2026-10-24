import { useEffect, useRef, useState } from 'react'
import {
  artifactOwnerKey,
  artifactSnapshotSchema,
  type ArtifactMetadata,
  type RuntimeProfile,
} from '@dovo/protocol'
import { useWorkspace } from '@dovo/studio-core'
import { ArtifactThumbnail } from './artifact-presentation'

export function ArtifactSnapshot({
  profile,
  artifact,
  connected,
  refreshKey,
}: {
  profile: RuntimeProfile
  artifact: ArtifactMetadata
  connected: boolean
  refreshKey: number
}) {
  const { readRuntime } = useWorkspace()
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const identity = JSON.stringify([
    artifactOwnerKey(profile),
    artifact.taskId,
    artifact.id,
    artifact.revision,
  ])
  const [snapshot, setSnapshot] = useState<{
    identity: string
    preview?: typeof artifactSnapshotSchema.Type
    error?: string
  }>()
  const current = snapshot?.identity === identity ? snapshot : undefined
  const preview = current?.preview
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
    if (!visible || !connected) return
    let stopped = false
    // Keep the same revision visible during refresh; another owner/revision never reuses it.
    setSnapshot((previous) =>
      previous?.identity === identity ? { ...previous, error: undefined } : undefined,
    )
    void readRuntime(
      profile,
      '/api/artifacts/snapshot',
      { taskId: artifact.taskId, id: artifact.id, revision: artifact.revision },
      artifactSnapshotSchema,
    )
      .then((result) => {
        if (!stopped) setSnapshot({ identity, preview: result })
      })
      .catch((cause: unknown) => {
        if (!stopped)
          setSnapshot((previous) => ({
            identity,
            preview: previous?.identity === identity ? previous.preview : undefined,
            error: String(cause),
          }))
      })
    return () => {
      stopped = true
    }
  }, [
    visible,
    connected,
    refreshKey,
    identity,
    readRuntime,
    profile,
    artifact.id,
    artifact.taskId,
    artifact.revision,
  ])
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
      {(!connected || current?.error) && (
        <span
          title={connected ? current?.error : undefined}
          className="absolute bottom-1 right-2 rounded bg-background/90 px-2 text-[10px] text-muted-foreground"
        >
          {!connected ? 'Computer offline' : 'Snapshot unavailable'}
        </span>
      )}
    </div>
  )
}
