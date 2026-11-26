import { useEffect, useState } from 'react'
import { runClientEffect } from '@dovo/client-runtime'
import { nativeSkillsSchema, type NativeSkill, type RuntimeConnection } from '@dovo/protocol'
import type { WorkspaceRequestEffect } from './workspace/context'

export function useNativeSkills(
  enabled: boolean,
  taskId: string,
  connection: RuntimeConnection | null,
  request: WorkspaceRequestEffect,
) {
  const [lookup, setLookup] = useState<{
    taskId: string
    connection: RuntimeConnection
    skills: NativeSkill[]
  }>()
  useEffect(() => {
    setLookup(undefined)
    if (!enabled || !connection) return
    const controller = new AbortController()
    let next: ReturnType<typeof setTimeout> | undefined
    const refresh = async () => {
      try {
        const skills = await runClientEffect(
          request('/api/tasks/native-skills', { id: taskId }, nativeSkillsSchema),
          controller.signal,
        )
        if (!controller.signal.aborted) setLookup({ taskId, connection, skills })
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
  }, [enabled, taskId, connection, request])
  return enabled && lookup?.taskId === taskId && lookup.connection === connection
    ? lookup.skills
    : undefined
}
