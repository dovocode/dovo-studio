import { runInNewContext } from 'node:vm'
import { expect, it, vi } from 'vite-plus/test'
import { pdfPreviewHTML } from './pdf-preview'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve()
}
function viewer(bridgeId?: string) {
  const elements = new Map<
    string,
    { textContent: string; disabled: boolean; onclick?: () => void }
  >()
  for (const id of ['previous', 'next', 'smaller', 'larger', 'page', 'error'])
    elements.set(id, { textContent: '', disabled: false })
  const drawImage = vi.fn<(...args: unknown[]) => void>()
  const canvas = { width: 0, height: 0, style: {}, getContext: () => ({ drawImage }) }
  const lookups: Array<{
    number: number
    result: ReturnType<typeof deferred<ReturnType<typeof pdfPage>>>
  }> = []
  const documentPDF = {
    numPages: 3,
    getPage: (number: number) => {
      const result = deferred<ReturnType<typeof pdfPage>>()
      lookups.push({ number, result })
      return result.promise
    },
  }
  const listeners = new Map<string, (event?: unknown) => void>()
  const postMessage = vi.fn<(...args: unknown[]) => void>()
  const parent = { postMessage }
  const scrollTo = vi.fn<(...args: number[]) => void>()
  const script = pdfPreviewHTML('nonce', '/pdf')
    .split('<script type="module" nonce="nonce">')[1]
    .split('</script>')[0]
    .replace(/^import .*;$/m, '')
  const loaded: Promise<void> = runInNewContext(`(async()=>{${script}})()`, {
    document: {
      getElementById: (id: string) => (id === 'pdf' ? canvas : elements.get(id)),
      createElement: () => ({ width: 0, height: 0, getContext: () => ({}) }),
    },
    getDocument: () => ({ promise: Promise.resolve(documentPDF) }),
    GlobalWorkerOptions: {},
    innerWidth: 800,
    location: { hash: bridgeId ? `#dovo-pdf=${bridgeId}` : '' },
    URLSearchParams,
    window: { parent },
    scrollX: 0,
    scrollY: 0,
    scrollTo,
    addEventListener: (type: string, handler: (event?: unknown) => void) =>
      listeners.set(type, handler),
    setTimeout: bridgeId ? (callback: () => void) => callback() : setTimeout,
    clearTimeout,
  })
  const element = (id: string) => {
    const value = elements.get(id)
    if (!value) throw new Error('missing element')
    return value
  }
  return { loaded, lookups, canvas, drawImage, element, listeners, postMessage, parent, scrollTo }
}
function pdfPage() {
  const finished = deferred<void>()
  const cleanup = vi.fn<() => void>()
  const render = vi.fn<() => { promise: Promise<void> }>(() => ({ promise: finished.promise }))
  return {
    finished,
    cleanup,
    render,
    getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
  }
}

it('waits for restore before rendering, clamps the page, and reports only after commit', async () => {
  const id = '11111111-1111-4111-8111-111111111111'
  const f = viewer(id)
  await settle()
  expect(f.postMessage).toHaveBeenCalledOnce()
  f.listeners.get('resize')?.()
  f.element('next').onclick?.()
  f.element('larger').onclick?.()
  await settle()
  expect(f.lookups).toHaveLength(0)
  expect(f.drawImage).not.toHaveBeenCalled()
  expect(f.postMessage).toHaveBeenCalledOnce()
  const state = { page: 8, zoom: 1.25, scrollTop: 200, scrollLeft: 25 }
  f.listeners.get('message')?.({
    source: {},
    data: { channel: 'dovo-pdf', id, type: 'restore', state },
  })
  await settle()
  expect(f.lookups).toHaveLength(0)
  f.listeners.get('message')?.({
    source: f.parent,
    data: { channel: 'dovo-pdf', id, type: 'restore', state },
  })
  await settle()
  expect(f.lookups).toHaveLength(1)
  expect(f.lookups[0].number).toBe(3)
  const page = pdfPage()
  f.lookups[0].result.resolve(page)
  await settle()
  f.listeners.get('resize')?.()
  f.element('next').onclick?.()
  f.element('smaller').onclick?.()
  expect(f.postMessage).toHaveBeenCalledOnce()
  page.finished.resolve()
  await f.loaded
  expect(f.lookups).toHaveLength(1)
  expect(f.scrollTo).toHaveBeenCalledWith(25, 200)
  expect(f.element('page').textContent).toBe('Page 3 of 3')
  expect(f.postMessage).toHaveBeenCalledTimes(2)
  expect(f.postMessage.mock.calls[1][0]).toMatchObject({
    type: 'state',
    state: { page: 3, zoom: 1.25 },
  })
})

it('discards stale page lookups and commits canvas and label together after rendering', async () => {
  const f = viewer()
  await settle()
  f.element('next').onclick?.()
  const stale = pdfPage()
  f.lookups[0].result.resolve(stale)
  await settle()
  expect(stale.render).not.toHaveBeenCalled()
  expect(stale.cleanup).toHaveBeenCalledOnce()
  expect(f.lookups[1].number).toBe(2)
  const current = pdfPage()
  f.lookups[1].result.resolve(current)
  await settle()
  expect(f.drawImage).not.toHaveBeenCalled()
  expect(f.element('page').textContent).toBe('')
  current.finished.resolve()
  await f.loaded
  await settle()
  expect(f.drawImage).toHaveBeenCalledOnce()
  expect(f.element('page').textContent).toBe('Page 2 of 3')
  expect(f.element('previous').disabled).toBe(false)
  expect(current.cleanup).toHaveBeenCalledOnce()
})

it('discards a stale render and clears a failed current render after successful navigation and zoom', async () => {
  const f = viewer()
  await settle()
  const stale = pdfPage()
  f.lookups[0].result.resolve(stale)
  await settle()
  f.element('next').onclick?.()
  stale.finished.resolve()
  await settle()
  expect(f.drawImage).not.toHaveBeenCalled()
  const failed = pdfPage()
  f.lookups[1].result.resolve(failed)
  await settle()
  failed.finished.reject(new Error('render failed'))
  await settle()
  expect(f.element('error').textContent).toContain('render failed')
  expect(failed.cleanup).toHaveBeenCalledOnce()
  f.element('larger').onclick?.()
  await settle()
  const recovered = pdfPage()
  f.lookups[2].result.resolve(recovered)
  await settle()
  recovered.finished.resolve()
  await settle()
  expect(f.element('page').textContent).toBe('Page 2 of 3')
  expect(f.element('error').textContent).toBe('')
  expect(f.drawImage).toHaveBeenCalledOnce()
  expect(f.canvas.width).toBeGreaterThan(776)
})

it('retries the next page after failure without skipping the last committed page', async () => {
  const f = viewer()
  await settle()
  const first = pdfPage()
  f.lookups[0].result.resolve(first)
  await settle()
  first.finished.resolve()
  await f.loaded
  f.element('next').onclick?.()
  await settle()
  f.lookups[1].result.reject(new Error('temporary lookup failure'))
  await settle()
  expect(f.element('page').textContent).toBe('Page 1 of 3')
  f.element('next').onclick?.()
  await settle()
  expect(f.lookups[2].number).toBe(2)
  const second = pdfPage()
  f.lookups[2].result.resolve(second)
  await settle()
  second.finished.resolve()
  await settle()
  expect(f.element('page').textContent).toBe('Page 2 of 3')
  expect(f.element('error').textContent).toBe('')
})

it('allows recovery after the first restored page fails without reporting default state', async () => {
  const id = '11111111-1111-4111-8111-111111111111'
  const f = viewer(id)
  await settle()
  f.listeners.get('message')?.({
    source: f.parent,
    data: {
      channel: 'dovo-pdf',
      id,
      type: 'restore',
      state: { page: 2, zoom: 1.25, scrollTop: 120, scrollLeft: 0 },
    },
  })
  await settle()
  expect(f.lookups[0].number).toBe(2)
  const failed = pdfPage()
  f.lookups[0].result.resolve(failed)
  await settle()
  failed.finished.reject(new Error('temporary render failure'))
  await f.loaded
  await settle()
  expect(f.element('error').textContent).toContain('temporary render failure')
  expect(f.postMessage).toHaveBeenCalledOnce()
  f.element('larger').onclick?.()
  await settle()
  expect(f.lookups).toHaveLength(2)
  expect(f.lookups[1].number).toBe(2)
  const recovered = pdfPage()
  f.lookups[1].result.resolve(recovered)
  await settle()
  recovered.finished.resolve()
  await settle()
  expect(f.element('page').textContent).toBe('Page 2 of 3')
  expect(f.element('error').textContent).toBe('')
  expect(f.scrollTo).toHaveBeenCalledWith(0, 120)
  expect(f.postMessage).toHaveBeenLastCalledWith(
    expect.objectContaining({
      type: 'state',
      state: { page: 2, zoom: 1.5, scrollTop: 0, scrollLeft: 0 },
    }),
    '*',
  )
})
