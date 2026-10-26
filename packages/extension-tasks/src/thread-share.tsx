import { useEffect } from 'react'
import { watchRuntimeTask } from '@dovo/protocol'
import { useCachedTask, useWorkspace } from '@dovo/studio-core'
import { ChatThread } from './chat/thread/chat-thread'
import { ChatImageEditProvider } from './chat/composer/chat-image-edit'

/** Dedicated presentation surface: no composer, navigation, approvals or task mutations. */
export function ThreadShare({ taskId, runtimeId }: { taskId: string; runtimeId: string }) {
  const { workspace, connection, connected, activeRuntimeId } = useWorkspace()
  const selectedRuntime = activeRuntimeId === runtimeId
  const summary = selectedRuntime ? workspace.tasks.find((task) => task.id === taskId) : undefined
  const { task, loaded, error } = useCachedTask(summary)
  useEffect(
    () => (connection && selectedRuntime ? watchRuntimeTask(connection, taskId) : undefined),
    [connection, taskId, selectedRuntime],
  )
  return (
    <section
      inert
      className="flex h-screen min-h-0 flex-col bg-background text-foreground"
      data-thread-share-ready={selectedRuntime && task && loaded ? '' : undefined}
    >
      <header className="shrink-0 border-b px-6 py-4 text-lg font-medium">
        {selectedRuntime ? task?.title || 'Thread' : 'Thread'}
      </header>
      {selectedRuntime && task && loaded ? (
        <ChatImageEditProvider disabled>
          <ChatThread
            task={{
              ...task,
              historyBefore: task.historyBefore,
              historyRevision: task.historyRevision,
            }}
          />
        </ChatImageEditProvider>
      ) : (
        <p role="status" className="p-6">
          {error || (connected ? 'Loading conversation…' : 'Connecting to the thread’s computer…')}
        </p>
      )}
    </section>
  )
}
