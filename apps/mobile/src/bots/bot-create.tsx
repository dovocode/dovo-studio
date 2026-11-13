import { useState, useEffect, useRef } from 'react'
import { randomUUID } from 'expo-crypto'
import { runClientEffect } from '@dovo/client-runtime'
import {
  botResultSchema,
  RuntimeRequestError,
  decode,
  taskSchema,
  resolveTaskDefaults,
} from '@dovo/protocol'
import { useRuntime } from '../runtime/connection/provider'
import { detailDraftKey } from '../runtime/state/detail-drafts'
import { BotEditor } from './bot-editor'
export function CreateBot({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const { profile, snapshot, connected, callEffect, refresh } = useRuntime()
  const owner = detailDraftKey(profile?.connection ?? null, 'new-bot')
  const currentOwner = useRef<string | undefined>(owner)
  currentOwner.current = owner
  useEffect(
    () => () => {
      currentOwner.current = undefined
    },
    [],
  )
  const [id] = useState(randomUUID)
  const [requestId] = useState(randomUUID)
  const [createdAt] = useState(() => new Date().toISOString())
  return (
    <BotEditor
      draftKey={detailDraftKey(profile?.connection ?? null, 'new-bot')}
      creating
      initial={{
        name: '',
        role: '',
        responsibilities: '',
        creation: { id, requestId, createdAt },
      }}
      unavailable={
        !connected
          ? 'Reconnect this computer to create a Bot.'
          : !snapshot?.botsSupported
            ? 'Update this runtime to create Bots.'
            : undefined
      }
      onClose={onClose}
      onSave={async (value, retain) => {
        const repository = snapshot?.workspace.repositories.find((repo) => repo.kind === 'scratch')
        if (!value.attempt && !repository)
          throw Error('This computer cannot safely start a Bot. Refresh its runtime and try again.')
        const createTask =
          value.attempt?.createTask ??
          decode(taskSchema, {
            ...resolveTaskDefaults(snapshot?.defaults, undefined),
            id: value.creation?.id ?? id,
            title: value.name,
            repositoryId: repository?.id ?? '',
            execution: 'main',
            worktreeFromOrigin: false,
            setupCommand: undefined,
            submodules: undefined,
            agentId: '',
            status: 'draft',
            createdAt: value.creation?.createdAt ?? createdAt,
            messages: [],
            files: [],
            draft: '',
            example: false,
          })
        const attempt = value.attempt ?? {
          requestId: value.creation?.requestId ?? requestId,
          createTask,
          role: value.role,
          responsibilities: value.responsibilities,
        }
        retain({ attempt })
        try {
          const result = await runClientEffect(
            callEffect('/api/bots/create', attempt, botResultSchema),
          )
          await refresh()
          if (currentOwner.current === owner) onCreated(result.id)
        } catch (error) {
          if (error instanceof RuntimeRequestError && error.mutationRejected === true) {
            retain({
              attempt: undefined,
              creation: {
                id: randomUUID(),
                requestId: randomUUID(),
                createdAt: new Date().toISOString(),
              },
            })
          }
          throw error
        }
      }}
    />
  )
}
