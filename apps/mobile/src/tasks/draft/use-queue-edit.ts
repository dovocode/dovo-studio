import { useEffect, useRef, useState } from 'react'
import { runClientEffect } from '@dovo/client-runtime'
import { drafts } from './runtime-drafts'
import type { QueueEdit } from './queue-edit'

export function useQueueEdit(runtimeId: string, taskId: string) {
  const key = `dovo.queue-edit.${encodeURIComponent(runtimeId)}.${taskId}`
  const [view, setView] = useState<{ key: string; edit?: QueueEdit }>()
  const [failure, setFailure] = useState<{ key: string; message: string }>()
  const current = useRef<{ key: string; edit?: QueueEdit }>(undefined)
  const mounted = useRef<string | undefined>(undefined)
  const report = (error: unknown, operation: 'load' | 'save') => {
    if (mounted.current === key)
      setFailure({
        key,
        message: `Could not ${operation} the queued message edit. ${String(error)}`,
      })
  }
  useEffect(() => {
    let disposed = false
    let received = false
    mounted.current = key
    setFailure(undefined)
    const publish = (edit: QueueEdit | undefined) => {
      current.current = { key, edit }
      setView(current.current)
    }
    const unsubscribe = drafts.subscribeQueueEdit(key, (edit) => {
      received = true
      publish(edit)
    })
    void runClientEffect(drafts.readRecordEffect(key)).then(
      (record) => {
        if (!disposed && !received) publish(record?.queueEdit)
      },
      (error) => {
        if (!disposed) report(error, 'load')
      },
    )
    return () => {
      disposed = true
      current.current = undefined
      mounted.current = undefined
      unsubscribe()
    }
  }, [key])
  const updateEffect = (update: (edit: QueueEdit | undefined) => QueueEdit | undefined) =>
    drafts.updateQueueEditEffect(key, update)
  return {
    key,
    ready: view?.key === key,
    edit: view?.key === key ? view.edit : undefined,
    active: () => mounted.current === key,
    current: () => (current.current?.key === key ? current.current.edit : undefined),
    error: failure?.key === key ? failure.message : '',
    updateEffect,
    update: (change: Parameters<typeof updateEffect>[0]) => {
      void runClientEffect(updateEffect(change)).then(
        () => {
          if (mounted.current === key) setFailure(undefined)
        },
        (error) => report(error, 'save'),
      )
    },
  }
}
