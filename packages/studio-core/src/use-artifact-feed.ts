import { useEffect, useRef, useState } from 'react'
import { Schema } from 'effect'
import {
  decode,
  artifactFeedQuerySchema,
  artifactFeedToolsSchema,
  artifactFeedPreviewResultSchema,
  artifactFeedStatusSchema,
  type AccountClient,
  type Artifact,
} from '@dovo/protocol'
import type { WorkspaceRequest } from './workspace/context'

export function useArtifactFeed({
  artifact,
  publicationId,
  origin,
  client,
  runtimeId,
  request,
  connected,
}: {
  artifact: Artifact
  publicationId: string
  origin: string
  client: AccountClient
  runtimeId: string | null
  request: WorkspaceRequest
  connected: boolean
}) {
  const [tools, setTools] = useState<(typeof artifactFeedToolsSchema.Type)['tools']>()
  const [selection, setSelection] = useState(''),
    [argumentsText, setArguments] = useState('{}'),
    [pointer, setPointer] = useState(''),
    [seconds, setSeconds] = useState(60)
  const [preview, setPreview] = useState<{ signature: string; previewId: string; data: unknown }>()
  const [status, setStatus] = useState<typeof artifactFeedStatusSchema.Type>({
    enabled: false,
    error: '',
  })
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const pending = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const scope = JSON.stringify([
    runtimeId,
    connected,
    client.sessionId(),
    artifact.taskId,
    artifact.id,
    artifact.revision,
    origin,
    publicationId,
  ])
  const current = useRef(scope)
  current.current = scope
  useEffect(() => {
    setTools(undefined)
    setSelection('')
    setPreview(undefined)
    setStatus({ enabled: false, error: '' })
    setError('')
  }, [scope])
  const signature = JSON.stringify([scope, selection, argumentsText, pointer, seconds])
  const currentInput = useRef(signature)
  currentInput.current = signature
  const plan = preview?.signature === signature ? preview : undefined
  const ref = { taskId: artifact.taskId, id: artifact.id, revision: artifact.revision }
  const target = tools && selection !== '' ? tools[Number(selection)] : undefined
  const check = () => {
    if (!mounted.current || !connected || current.current !== scope)
      throw new Error('Computer or account changed. Preview and approve again')
  }
  const act = async (work: () => Promise<void>) => {
    if (pending.current || !mounted.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      check()
      await work()
    } catch (cause) {
      if (mounted.current && current.current === scope)
        setError(cause instanceof Error ? cause.message : 'Feed operation failed')
    } finally {
      pending.current = false
      if (mounted.current) setBusy(false)
    }
  }
  const load = () =>
    act(async () => {
      const value = await request('/api/artifacts/feed/tools', ref, artifactFeedToolsSchema)
      check()
      const next = await request(
        '/api/artifacts/feed/status',
        { ...ref, publicationId },
        artifactFeedStatusSchema,
      )
      check()
      setTools(value.tools)
      setSelection(value.tools.length ? '0' : '')
      setStatus(next)
    })
  const read = () =>
    act(async () => {
      if (!target) throw new Error('Choose a read-only MCP tool')
      const args = decode(
        Schema.Record(Schema.String, Schema.Unknown),
        JSON.parse(argumentsText) as unknown,
      )
      const query = decode(artifactFeedQuerySchema, {
        server: target.server,
        tool: target.tool,
        arguments: args,
        pointer,
        seconds,
      })
      const value = await request(
        '/api/artifacts/feed/preview',
        { ...ref, query, consent: true },
        artifactFeedPreviewResultSchema,
      )
      check()
      if (currentInput.current !== signature) throw new Error('Query changed. Read a fresh preview')
      setPreview({ ...value, signature })
    })
  const enable = () =>
    act(async () => {
      if (!plan) throw new Error('Read and review a fresh preview first')
      if (currentInput.current !== plan.signature)
        throw new Error('Query changed. Read a fresh preview')
      const result = await client.enableArtifactFeed(
        publicationId,
        origin,
        seconds,
        plan.data,
        async (credential) => {
          check()
          if (currentInput.current !== plan.signature)
            throw new Error('Query changed. Read a fresh preview')
          await request(
            '/api/artifacts/feed/enable',
            { previewId: plan.previewId, credential, consent: true },
            artifactFeedStatusSchema,
          )
        },
      )
      check()
      setStatus({ enabled: true, error: '', generation: result.generation })
      setPreview(undefined)
    })
  const stop = () =>
    act(async () => {
      if (status.generation) await client.stopArtifactFeed(publicationId, origin, status.generation)
      check()
      setStatus(
        await request(
          '/api/artifacts/feed/stop',
          { ...ref, publicationId },
          artifactFeedStatusSchema,
        ),
      )
    })
  return {
    tools,
    selection,
    setSelection,
    argumentsText,
    setArguments,
    pointer,
    setPointer,
    seconds,
    setSeconds,
    plan,
    status,
    busy,
    error,
    load,
    read,
    enable,
    stop,
    target,
  }
}
