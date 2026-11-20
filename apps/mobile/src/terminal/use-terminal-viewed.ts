import { useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import { responses } from '@dovo/protocol'
import { useNavigation } from '../shell/navigation'
import { useRuntime } from '../runtime/connection/provider'

export function useTerminalViewed(id: string, visible: boolean, covered: boolean) {
  const { focused } = useNavigation()
  const { call, snapshot, connection, connected, activeId, profile } = useRuntime()
  const terminal = snapshot?.terminals.find((entry) => entry.id === id)
  const turn = terminal?.turn ?? 0
  const revision = terminal?.seenRevision ?? 0
  const unread = turn > (terminal?.seenTurn ?? 0)
  const [active, setActive] = useState(AppState.currentState === 'active')
  const [error, setError] = useState('')
  const attempted = useRef('')
  const key = JSON.stringify([connection?.address, connection?.token, activeId, id, turn])
  const viewing =
    active && focused && visible && connected && !!activeId && activeId === profile?.id
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => setActive(state === 'active'))
    return () => listener.remove()
  }, [])
  useEffect(() => {
    if (!viewing) {
      attempted.current = ''
      setError('')
      return
    }
    if (covered || !turn || !snapshot?.terminalTurnsSupported || attempted.current === key) return
    attempted.current = key
    setError('')
    if (!unread) return
    let current = true
    void call(
      '/api/terminals/update',
      { id, view: { turn, expectedRevision: revision, seen: true } },
      responses.terminal,
    ).catch((cause: unknown) => {
      if (current) setError(String(cause))
    })
    return () => {
      current = false
    }
  }, [viewing, covered, key, turn, unread, revision, id, call, snapshot?.terminalTurnsSupported])
  return error
}
