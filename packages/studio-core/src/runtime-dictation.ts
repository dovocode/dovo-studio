import { useMemo } from 'react'
import {
  dictationStatusSchema,
  runtimeDictationResultSchema,
  responses,
  type DesktopDictationBridge,
  type DictationLanguage,
} from '@dovo/protocol'
import type { WorkspaceRequest } from './workspace/context'

/** Batch audio stays on this device until Finish. No automatic fallback to another computer. */
export function runtimeDictationBridge(
  request: WorkspaceRequest,
  taskId: string,
): DesktopDictationBridge {
  const sessions = new Map<
    string,
    { chunks: Uint8Array[]; bytes: number; language: DictationLanguage; cancelled: boolean }
  >()
  return {
    status: () => request('/api/dictation/status', {}, dictationStatusSchema),
    install: async (id) => {
      await request('/api/dictation/install', { id }, dictationStatusSchema)
    },
    start: async (id, language) => {
      if (sessions.size) throw new Error('Finish the current recording first.')
      const session = { chunks: [] as Uint8Array[], bytes: 0, language, cancelled: false }
      sessions.set(id, session)
      try {
        const status = await request('/api/dictation/status', {}, dictationStatusSchema)
        if (!status.engine || !status.model)
          throw new Error('Download the speech model on this computer in Speech settings first.')
        if (session.cancelled || sessions.get(id) !== session)
          throw new Error('Recording was cancelled.')
      } catch (cause) {
        if (sessions.get(id) === session) sessions.delete(id)
        throw cause
      }
    },
    feed: async (id, pcm) => {
      const session = sessions.get(id)
      if (!session || session.cancelled) throw new Error('Recording was cancelled.')
      session.bytes += pcm.byteLength
      if (session.bytes > 9600000) throw new Error('Record at most five minutes.')
      session.chunks.push(new Uint8Array(pcm))
    },
    finish: async (id) => {
      const session = sessions.get(id)
      if (!session || session.cancelled) throw new Error('Recording was cancelled.')
      let binary = ''
      for (const chunk of session.chunks)
        for (let at = 0; at < chunk.length; at += 8192)
          binary += String.fromCharCode(...chunk.subarray(at, at + 8192))
      session.chunks = []
      try {
        const result = await request(
          '/api/dictation/transcribe',
          { id, taskId, language: session.language, format: 'pcm', data: btoa(binary) },
          runtimeDictationResultSchema,
        )
        if (session.cancelled) throw new Error('Recording was cancelled.')
        return result.text
      } finally {
        sessions.delete(id)
      }
    },
    subscribe: () => () => {},
    cancel: async (id) => {
      const session = sessions.get(id)
      if (session) {
        session.cancelled = true
        session.chunks = []
        sessions.delete(id)
      }
      await request('/api/dictation/cancel', { id }, responses.ok)
    },
  }
}

export function useRuntimeDictationBridge(
  request: WorkspaceRequest,
  taskId: string,
  scope: string,
) {
  return useMemo(() => runtimeDictationBridge(request, taskId), [request, taskId, scope])
}
