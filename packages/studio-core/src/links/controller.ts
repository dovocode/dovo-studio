import { useState, useSyncExternalStore, useEffect } from 'react'
import { previewUrl } from '@dovo/protocol'
import type { LinkOrigin, LinkTarget } from './targets'

export type LinkAction = {
  id: string
  label: string
  kind: 'details' | 'browser' | 'external' | 'copy' | 'thread'
  disabled?: boolean
  signal?: AbortSignal
  /** Mutations can fail and retry in the chooser; destinations run after dismissal. */
  keepOpen?: boolean
  run: () => unknown
}
export type LinkOptions = {
  origin?: LinkOrigin
  signal?: AbortSignal
  /** Let an owning thread render details in its existing preview surface. */
  details?: (target: LinkTarget) => boolean
  browser?: (url: string) => unknown
  actions?: LinkAction[]
}
export type LinkRequest = {
  url: string
  origin?: LinkOrigin
  signal?: AbortSignal
  actions: LinkAction[]
  onError: (error: unknown) => void
}
export type LinkPresentation = {
  request: LinkRequest
  busy: boolean
  closing: boolean
  error: string
}

/** One presentation and one execution per owner, including native dismissal callbacks. */
export class LinkController {
  private active?: {
    request: LinkRequest
    action?: LinkAction
    dismissed: boolean
    cancelled: boolean
    running: boolean
    release: () => void
  }
  private snapshot: LinkPresentation | null = null
  private listeners = new Set<() => void>()
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  getSnapshot = () => this.snapshot
  private update(value: LinkPresentation | null) {
    this.snapshot = value
    for (const listener of this.listeners) listener()
  }
  open(request: LinkRequest) {
    if (this.active || request.signal?.aborted) return
    previewUrl(request.url)
    const signals = [request.signal, ...request.actions.map((action) => action.signal)].filter(
      (signal): signal is AbortSignal => !!signal,
    )
    if (signals.some((signal) => signal.aborted)) return
    const cancel = () => this.cancel(request)
    for (const signal of signals) signal.addEventListener('abort', cancel, { once: true })
    this.active = {
      request,
      dismissed: false,
      cancelled: false,
      running: false,
      release: () => {
        for (const signal of signals) signal.removeEventListener('abort', cancel)
      },
    }
    this.update({ request, busy: false, closing: false, error: '' })
  }
  private release(request: LinkRequest) {
    if (this.active?.request !== request) return
    this.active.release()
    this.active = undefined
    this.update(null)
  }
  /** Keep native presenters mounted until they acknowledge dismissal. */
  cancel(request = this.active?.request) {
    const active = this.active
    if (!active || active.request !== request) return
    active.cancelled = true
    active.action = undefined
    if (active.dismissed) {
      if (!active.running) this.release(active.request)
    } else this.update({ request: active.request, busy: true, closing: true, error: '' })
  }
  dispose = () => {
    if (this.active) this.release(this.active.request)
  }
  select(request: LinkRequest, id: string, dismiss: () => void) {
    const active = this.active
    const action = request.actions.find((action) => action.id === id)
    if (
      !active ||
      active.request !== request ||
      active.dismissed ||
      active.cancelled ||
      active.running ||
      this.snapshot?.busy ||
      !action ||
      action.disabled ||
      action.signal?.aborted
    )
      return
    this.update({ request, busy: true, closing: false, error: '' })
    if (!action.keepOpen) {
      active.action = action
      dismiss()
      return
    }
    active.running = true
    void Promise.resolve()
      .then(() => {
        if (this.active === active && !active.cancelled) return action.run()
      })
      .then(
        () => {
          active.running = false
          if (this.active !== active) return
          if (active.dismissed) this.release(request)
          else if (!active.cancelled) dismiss()
        },
        (error: unknown) => {
          active.running = false
          if (this.active !== active) return
          if (active.dismissed) this.release(request)
          else if (!active.cancelled)
            this.update({
              request,
              busy: false,
              closing: false,
              error: error instanceof Error ? error.message : String(error),
            })
        },
      )
  }
  dismissed(request: LinkRequest) {
    const active = this.active
    if (!active || active.request !== request || active.dismissed) return
    active.dismissed = true
    this.update(null)
    if (
      active.cancelled ||
      !active.action ||
      request.signal?.aborted ||
      active.action.signal?.aborted
    ) {
      if (!active.running) this.release(request)
      return
    }
    active.running = true
    const action = active.action
    const report = (error: unknown) => {
      try {
        if (this.active === active && !active.cancelled) request.onError(error)
      } catch (reportError) {
        console.error(reportError)
      } finally {
        this.release(request)
      }
    }
    try {
      // Call synchronously to preserve browser user activation for explicit external opening.
      const result = action.run()
      void Promise.resolve(result).then(() => this.release(request), report)
    } catch (error) {
      report(error)
    }
  }
}
export function useLinkController() {
  const [controller] = useState(() => new LinkController())
  const pending = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  )
  useEffect(() => controller.dispose, [controller])
  return { controller, pending }
}
export function linkActions(
  url: string,
  targets: readonly LinkTarget[],
  adapters: {
    details: (target: LinkTarget) => unknown
    browser?: (url: string) => unknown
    external: (url: string) => unknown
    copy?: (url: string) => unknown
  },
  extra: readonly LinkAction[] = [],
): LinkAction[] {
  return [
    ...targets.map((target, index): LinkAction => ({
      id: `details:${index}`,
      kind: 'details',
      label: `${target.kind === 'pull' ? 'Open PR details' : target.kind === 'pipeline' ? 'Open pipeline details' : 'Open issue details'}${targets.length > 1 ? ` · ${target.label}` : ''}`,
      run: () => adapters.details(target),
    })),
    ...(adapters.browser
      ? [
          {
            id: 'browser',
            kind: 'browser' as const,
            label: 'Open in Dovo browser',
            run: () => adapters.browser?.(url),
          },
        ]
      : []),
    {
      id: 'external',
      kind: 'external',
      label: 'Open in external browser',
      run: () => adapters.external(url),
    },
    ...(adapters.copy
      ? [{ id: 'copy', kind: 'copy' as const, label: 'Copy link', run: () => adapters.copy?.(url) }]
      : []),
    ...extra,
  ]
}
