import { useEffect, useState } from 'react'
import { runClientEffect } from '@dovo/client-runtime'
import { nativeSkillsSchema, type NativeSkill, type RuntimeConnection } from '@dovo/protocol'
import type { WorkspaceRequestEffect } from './workspace/context'

export function useNativeSkills(
  source: 'opencode' | 'antigravity' | false,
  taskId: string,
  connection: RuntimeConnection | null,
  request: WorkspaceRequestEffect,
) {
  const [lookup, setLookup] = useState<{
    taskId: string
    connection: RuntimeConnection
    source: Exclude<typeof source, false>
    skills: NativeSkill[]
  }>()
  useEffect(() => {
    setLookup(undefined)
    if (!source || !connection) return
    const controller = new AbortController()
    let next: ReturnType<typeof setTimeout> | undefined
    const refresh = async () => {
      try {
        const skills = await runClientEffect(
          request('/api/tasks/native-skills', { id: taskId }, nativeSkillsSchema),
          controller.signal,
        )
        if (!controller.signal.aborted) setLookup({ taskId, connection, source, skills })
      } catch {
        // Keep the last catalog through a transient provider error and retry while open.
      }
      if (!controller.signal.aborted) next = setTimeout(refresh, 5_000)
    }
    void refresh()
    return () => {
      controller.abort()
      clearTimeout(next)
    }
  }, [source, taskId, connection, request])
  return source &&
    lookup?.source === source &&
    lookup.taskId === taskId &&
    lookup.connection === connection
    ? lookup.skills
    : undefined
}
