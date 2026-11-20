type Size = { cols: number; rows: number }
type Viewer = { size?: Size; activity: number }
type Terminal = { viewers: Set<Viewer>; active?: Viewer; applied?: Size }

/** One live socket attached to a terminal. */
export type TerminalViewer = {
  /** Record the viewer's grid. Only the active viewer changes the terminal size. */
  resize(cols: number, rows: number): void
  /** Typing gives this viewer control of the terminal size. */
  input(): void
  leave(): void
}

/**
 * Decide which attached socket controls each terminal's grid.
 *
 * A lone viewer behaves as before: each resize applies. With several viewers, the active viewer
 * sets the size and the others only observe, so opening or rotating a phone leaves the desktop
 * grid alone. The first viewer is active. Typing makes a viewer active and applies its last size.
 * When the active viewer leaves, the most recently active remaining viewer takes over. Clients
 * keep the existing protocol: there is no message to claim or release control.
 */
export function createTerminalViewers(apply: (terminalId: string, size: Size) => void) {
  const terminals = new Map<string, Terminal>()
  let clock = 0
  const sync = (terminalId: string, terminal: Terminal) => {
    const size = terminal.active?.size
    if (!size) return
    if (terminal.applied?.cols === size.cols && terminal.applied.rows === size.rows) return
    apply(terminalId, size)
    terminal.applied = size
  }
  return {
    join(terminalId: string): TerminalViewer {
      let terminal = terminals.get(terminalId)
      if (!terminal) {
        terminal = { viewers: new Set() }
        terminals.set(terminalId, terminal)
      }
      const viewer: Viewer = { activity: ++clock }
      terminal.viewers.add(viewer)
      terminal.active ??= viewer
      const current = terminal
      return {
        resize(cols, rows) {
          viewer.size = { cols, rows }
          // A viewer that has left, or an observer, only records its size.
          if (current.active !== viewer) return
          // The terminal may have changed size through an earlier viewer. Always apply the
          // active viewer's explicit request, as a lone client expects.
          apply(terminalId, viewer.size)
          current.applied = viewer.size
        },
        input() {
          if (!current.viewers.has(viewer)) return
          viewer.activity = ++clock
          if (current.active === viewer) return
          current.active = viewer
          sync(terminalId, current)
        },
        leave() {
          if (!current.viewers.delete(viewer)) return
          if (!current.viewers.size) {
            if (terminals.get(terminalId) === current) terminals.delete(terminalId)
            return
          }
          if (current.active !== viewer) return
          let next: Viewer | undefined
          for (const candidate of current.viewers)
            if (!next || candidate.activity > next.activity) next = candidate
          current.active = next
          sync(terminalId, current)
        },
      }
    },
  }
}
