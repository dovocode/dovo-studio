import { useRef, useState } from 'react'
import {
  pullChangesRevisionPending,
  type PullDetail,
  type PullRevisionComparison,
} from '@dovo/protocol'

type Comparison<T> =
  | { status: 'closed' }
  | { status: 'loading' }
  | { status: 'ready'; value: T }
  | { status: 'failed'; error: string }

export function useComparison<T>(load: () => Promise<T>, scope = '') {
  const [current, setCurrent] = useState<{ scope: string; state: Comparison<T> }>()
  const state: Comparison<T> = current?.scope === scope ? current.state : { status: 'closed' }
  const setState = (state: Comparison<T>) => setCurrent({ scope, state })
  const attempt = useRef(0)
  const loaded = useRef<{ scope: string; value: T } | undefined>(undefined)
  return {
    state,
    close: () => {
      attempt.current++
      setState({ status: 'closed' })
    },
    open: async () => {
      const id = ++attempt.current
      if (loaded.current?.scope === scope) {
        setState({ status: 'ready', value: loaded.current.value })
        return
      }
      setState({ status: 'loading' })
      try {
        const value = await load()
        if (id === attempt.current) {
          loaded.current = { scope, value }
          setState({ status: 'ready', value })
        }
      } catch (cause) {
        if (id === attempt.current)
          setState({
            status: 'failed',
            error: cause instanceof Error ? cause.message : String(cause),
          })
      }
    },
  }
}

export function usePullRevisionComparison({
  detail,
  previous,
  supported,
  scope,
  load,
  switchRevision,
}: {
  detail: PullDetail | null
  previous: PullDetail | null
  supported: boolean
  scope: string
  load: (previousHead: string, head: string, destination: string) => Promise<PullRevisionComparison>
  switchRevision: () => void
}) {
  const [last, setLast] = useState<{ destination: string; previousHead: string; head: string }>()
  const head = detail?.pull.headSha
  const destination = detail?.destination
  const previousHead =
    pullChangesRevisionPending(detail, previous) && previous?.pull.headSha !== head
      ? previous?.pull.headSha
      : last?.head === head && last?.destination === destination
        ? last?.previousHead
        : undefined
  const available = !!(
    supported &&
    detail?.pull.provider === 'github' &&
    destination &&
    previousHead &&
    head &&
    previousHead !== head
  )
  const comparison = useComparison(
    async () => {
      if (!previousHead || !head || !destination)
        throw new Error('Open the pull request changes first.')
      return load(previousHead, head, destination)
    },
    JSON.stringify([scope, destination, previousHead, head]),
  )
  const acceptHead = () => {
    if (destination && previousHead && head) setLast({ destination, previousHead, head })
    switchRevision()
  }
  return {
    available,
    visible: available && comparison.state.status !== 'closed',
    state: comparison.state,
    close: comparison.close,
    switchRevision: acceptHead,
    open: () => {
      acceptHead()
      void comparison.open()
    },
  }
}
