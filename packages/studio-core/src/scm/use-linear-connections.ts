import {
  linearConnectionsSchema,
  randomUUID,
  type LinearConnectionCommand,
  type LinearConnections,
} from '@dovo/protocol'
import { useEffect, useRef, useState } from 'react'
import type { WorkspaceRequest } from '../workspace/context'

export function useLinearConnections(snapshot: LinearConnections, request: WorkspaceRequest) {
  const [ack, setAck] = useState<{ before: LinearConnections; after: LinearConnections }>()
  const state = ack?.before === snapshot ? ack.after : snapshot
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [edit, setEdit] = useState<{ id: string; revision: string }>()
  const createId = useRef<string | undefined>(undefined)
  const [project, setProject] = useState('')
  const [projectRevision, setProjectRevision] = useState<string>()
  const [connectionId, setConnectionId] = useState('')
  const [team, setTeam] = useState('')
  const alive = useRef(true)
  const inFlight = useRef(false)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const change = async (command: LinearConnectionCommand) => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError('')
    try {
      const after = await request(
        '/api/scm/linear/key/connections',
        command,
        linearConnectionsSchema,
      )
      if (!alive.current) return
      setAck({ before: snapshot, after })
      if (command.action === 'save' || command.action === 'remove') {
        createId.current = undefined
        selectConnection('')
      } else {
        setProjectRevision(
          after.bindings.find((binding) => binding.repositoryId === project)?.revision,
        )
      }
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      inFlight.current = false
      if (alive.current) setBusy(false)
    }
  }
  function selectConnection(id: string) {
    const item = state.connections.find((connection) => connection.id === id)
    setEdit(item && { id: item.id, revision: item.revision })
    setName(item?.name ?? '')
    setApiKey('')
  }
  function selectProject(id: string) {
    const binding = state.bindings.find((binding) => binding.repositoryId === id)
    setProject(id)
    setProjectRevision(binding?.revision)
    setConnectionId(binding?.connectionId ?? '')
    setTeam(binding?.team ?? '')
  }
  return {
    state,
    busy,
    error,
    name,
    setName,
    apiKey,
    setApiKey,
    edit,
    selectConnection,
    project,
    projectRevision,
    selectProject,
    connectionId,
    setConnectionId,
    team,
    setTeam,
    save: () =>
      change({
        action: 'save',
        id: edit?.id ?? (createId.current ??= randomUUID()),
        name: name.trim(),
        key: apiKey,
        expectedRevision: edit?.revision,
      }),
    remove: () =>
      edit && change({ action: 'remove', id: edit.id, expectedRevision: edit.revision }),
    bind: () =>
      change({
        action: 'bind',
        repositoryId: project,
        connectionId,
        team: team.trim(),
        expectedRevision: projectRevision,
      }),
    unbind: () =>
      projectRevision &&
      change({ action: 'unbind', repositoryId: project, expectedRevision: projectRevision }),
  }
}
