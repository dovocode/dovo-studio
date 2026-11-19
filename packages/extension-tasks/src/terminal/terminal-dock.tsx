import { useLayoutEffect, useRef, useState, type ComponentProps } from 'react'
import { createPortal } from 'react-dom'
import { TerminalPane } from './terminal-pane'

type TerminalDockProps = ComponentProps<typeof TerminalPane> & {
  target: HTMLElement | null
}

/** Move the terminal's container without remounting its renderer or reconnecting its sessions. */
export function TerminalDock({ target, visible = true, dock, ...pane }: TerminalDockProps) {
  const [host] = useState(() => {
    if (typeof document === 'undefined') return null
    const element = document.createElement('div')
    element.className = 'h-full min-h-0 min-w-0'
    return element
  })
  const focus = useRef<HTMLElement | null>(null)

  useLayoutEffect(() => {
    if (!host) return
    if (!target) {
      host.remove()
      return
    }
    target.appendChild(host)
    const previous = focus.current
    focus.current = null
    if (previous?.isConnected && host.contains(previous)) previous.focus({ preventScroll: true })
  }, [host, target])

  useLayoutEffect(() => () => host?.remove(), [host])

  return (
    host &&
    createPortal(
      <TerminalPane
        {...pane}
        visible={visible && !!target}
        dock={
          dock && {
            side: dock.side,
            onMove: () => {
              const active = host.ownerDocument.activeElement
              if (active instanceof HTMLElement && host.contains(active)) focus.current = active
              dock.onMove()
            },
          }
        }
      />,
      host,
    )
  )
}
