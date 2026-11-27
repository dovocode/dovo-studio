import {
  linearIssueActionsSchema,
  linearKeyResultSchema,
  type LinearIssueAction,
  type LinearIssueActions,
  type RuntimeProfile,
  type linearKeySourceSchema,
} from '@dovo/protocol'
import { useInterfaceText } from '../interface-language'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { LinearIssue, linearIssueQuerySchema, linearIssuesSchema } from '@dovo/protocol'

export function useLinearIssues(
  read: (input: typeof linearIssueQuerySchema.Type) => Promise<typeof linearIssuesSchema.Type>,
) {
  const [page, setPage] = useState<{ items: LinearIssue[]; next?: string }>({ items: [] })
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const current = useRef(0)
  const load = useCallback(
    async (search: string, cursor?: string) => {
      const request = ++current.current
      setBusy(true)
      setError('')
      if (!cursor) {
        setSearch(search)
        setPage({ items: [] })
      }
      try {
        const result = await read({ search, cursor })
        if (request === current.current)
          setPage((previous) => ({
            items: cursor
              ? [
                  ...new Map(
                    [...previous.items, ...result.items].map((issue) => [issue.id, issue]),
                  ).values(),
                ]
              : result.items,
            next: result.next,
          }))
      } catch (cause) {
        if (request === current.current)
          setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        if (request === current.current) setBusy(false)
      }
    },
    [read],
  )
  useEffect(() => {
    void load('')
    return () => {
      current.current++
    }
  }, [load])
  return {
    ...page,
    busy,
    error,
    go: (value: string) => load(value.trim()),
    more: () => page.next && load(search, page.next),
    updateStatus: (id: string, status: string) =>
      setPage((current) => ({
        ...current,
        items: current.items.map((item) => (item.id === id ? { ...item, status } : item)),
      })),
  }
}

export function useLinearIssueActions(
  readRuntime: (
    profile: RuntimeProfile,
    path: string,
    input: unknown,
    schema: typeof linearIssueActionsSchema,
  ) => Promise<LinearIssueActions>,
  profile: RuntimeProfile,
  issueId: string,
  selection: Pick<LinearIssueAction, 'connectionId' | 'repositoryId'>,
  createId: () => string,
  onStatus: (status: string) => void,
) {
  const { connectionId, repositoryId } = selection
  const [issue, setIssue] = useState<LinearIssueActions>()
  const [stateId, setStateId] = useState('')
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const pending = useRef(false)
  const commentAttempt = useRef<{ body: string; id: string } | undefined>(undefined)
  const read = useCallback(
    () =>
      readRuntime(
        profile,
        '/api/scm/linear/issues/actions/read',
        { issueId, connectionId, repositoryId },
        linearIssueActionsSchema,
      ),
    [readRuntime, profile, issueId, connectionId, repositoryId],
  )
  useEffect(() => {
    let active = true
    setBusy(true)
    setError('')
    void read()
      .then(
        (value) => {
          if (active) {
            setIssue(value)
            setStateId(value.state.id)
          }
        },
        (cause: unknown) => {
          if (active) setError(cause instanceof Error ? cause.message : String(cause))
        },
      )
      .finally(() => {
        if (active) setBusy(false)
      })
    return () => {
      active = false
    }
  }, [read])
  const submit = async (action: LinearIssueAction) => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      const value = await readRuntime(
        profile,
        '/api/scm/linear/issues/action',
        action,
        linearIssueActionsSchema,
      )
      setIssue(value)
      setStateId(value.state.id)
      onStatus(value.state.name)
      if (action.action === 'comment') {
        setComment('')
        commentAttempt.current = undefined
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  const target = issue
    ? { issueId, connectionId, repositoryId, sourceVersion: issue.sourceVersion }
    : undefined
  return {
    issue,
    stateId,
    setStateId,
    comment,
    setComment,
    busy,
    error,
    saveStatus: () => {
      if (issue && target && stateId !== issue.state.id)
        return submit({ ...target, action: 'set-status', expectedStateId: issue.state.id, stateId })
    },
    postComment: () => {
      const body = comment.trim()
      if (!target || !body || pending.current) return
      if (commentAttempt.current?.body !== body) commentAttempt.current = { body, id: createId() }
      return submit({ ...target, action: 'comment', body, commentId: commentAttempt.current.id })
    },
  }
}

export function useLinearKeySettings(
  source: typeof linearKeySourceSchema.Type | undefined,
  request: (
    path: string,
    input: unknown,
    schema: typeof linearKeyResultSchema,
  ) => Promise<typeof linearKeyResultSchema.Type>,
) {
  const uiText = useInterfaceText()
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const pending = useRef(false)
  const change = async (action: 'save' | 'remove') => {
    if (pending.current || (action === 'save' && !key.trim())) return
    pending.current = true
    setBusy(true)
    setMessage('')
    setError('')
    try {
      const result = await request(
        `/api/scm/linear/key/${action}`,
        action === 'save' ? { key } : {},
        linearKeyResultSchema,
      )
      setKey('')
      setMessage(
        action === 'save'
          ? uiText('Linear API key saved.')
          : result.source === 'environment'
            ? uiText('Saved key removed. The computer’s environment key is active.')
            : uiText('Linear API key removed.'),
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  return { source, key, setKey, busy, message, error, change }
}
