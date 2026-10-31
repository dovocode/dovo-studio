export type PdfViewState = {
  page: number
  zoom: number
  scrollTop: number
  scrollLeft: number
}

export type PdfViewerMessage =
  | { channel: 'dovo-pdf'; id: string; type: 'ready' }
  | { channel: 'dovo-pdf'; id: string; type: 'state'; state: PdfViewState }

export function parsePdfViewState(value: unknown): PdfViewState | undefined {
  if (!value || typeof value !== 'object') return
  const state = value as Record<string, unknown>
  if (
    typeof state.page !== 'number' ||
    !Number.isSafeInteger(state.page) ||
    state.page < 1 ||
    typeof state.zoom !== 'number' ||
    !Number.isFinite(state.zoom) ||
    state.zoom < 0.5 ||
    state.zoom > 3 ||
    typeof state.scrollTop !== 'number' ||
    !Number.isFinite(state.scrollTop) ||
    state.scrollTop < 0 ||
    state.scrollTop > 10000000 ||
    typeof state.scrollLeft !== 'number' ||
    !Number.isFinite(state.scrollLeft) ||
    state.scrollLeft < 0 ||
    state.scrollLeft > 10000000
  )
    return
  return {
    page: state.page,
    zoom: state.zoom,
    scrollTop: state.scrollTop,
    scrollLeft: state.scrollLeft,
  }
}

export function parsePdfViewerMessage(value: unknown, id: string): PdfViewerMessage | undefined {
  if (!value || typeof value !== 'object') return
  const message = value as Record<string, unknown>
  if (message.channel !== 'dovo-pdf' || message.id !== id) return
  if (message.type === 'ready') return { channel: 'dovo-pdf', id, type: 'ready' }
  const state = parsePdfViewState(message.state)
  if (message.type === 'state' && state) return { channel: 'dovo-pdf', id, type: 'state', state }
}
