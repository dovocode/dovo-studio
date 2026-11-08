import { Worker } from 'node:worker_threads'
import type { WebContents, WebFrameMain } from 'electron'
import type { BrowserFindResult } from '@dovo/protocol'

type Match = [number, number]
type Query = { text: string; regex: boolean; matchCase: boolean }
type FrameMatches = { frame: WebFrameMain; matches: Match[] }

/** Page text is untrusted; even pathological regexes run off the UI and main-process threads. */
export function matchBrowserText(texts: string[], query: Query) {
  const worker = new Worker(
    String.raw`const {parentPort,workerData}=require('node:worker_threads');
     try {
       const {texts,query}=workerData;
       const pattern=query.regex?query.text:query.text.replace(/[.*+?^{}()|[\]\\$]/g,'\\$&');
       const expression=new RegExp(pattern,query.matchCase?'gmu':'gimu');
       let remaining=10000;
       const matches=texts.map(text=>{
         expression.lastIndex=0;
         const found=[];
         let match;
         while(remaining && (match=expression.exec(text))) {
           if(!match[0].length){expression.lastIndex+=text.codePointAt(expression.lastIndex)>0xffff?2:1;continue}
           found.push([match.index,match.index+match[0].length]);remaining--;
         }
         return found;
       });
       parentPort.postMessage({matches,limited:remaining===0});
     } catch(error) { parentPort.postMessage({error:error.message}) }`,
    { eval: true, workerData: { texts, query } },
  )
  let finish: (result: { matches?: Match[][]; limited?: boolean; error?: string }) => void
  const result = new Promise<{ matches?: Match[][]; limited?: boolean; error?: string }>(
    (resolve) => {
      finish = resolve
      worker.once('message', resolve)
      worker.once('error', (error) =>
        resolve({ error: error instanceof Error ? error.message : String(error) }),
      )
      worker.once('exit', () => resolve({ error: 'Search cancelled.' }))
    },
  )
  const timer = setTimeout(() => {
    finish({ error: 'This expression took too long. Try a simpler pattern.' })
    void worker.terminate()
  }, 1000)
  return {
    result: result.finally(() => {
      clearTimeout(timer)
      void worker.terminate()
    }),
    cancel: () => {
      finish({ error: 'Search cancelled.' })
      void worker.terminate()
    },
  }
}

/** Self-contained DOM operations, also exercised in managed Chromium. No page HTML is rewritten. */
export function browserFindDocument(
  command: 'collect' | 'clear' | { matches: Match[]; active: number },
) {
  const key = '__dovoApplyBrowserFind'
  if (command !== 'collect') {
    const apply: unknown = Reflect.get(window, key)
    if (typeof apply === 'function') apply(command)
    return
  }
  const previous: unknown = Reflect.get(window, key)
  if (typeof previous === 'function') previous('clear')
  const sheet = new CSSStyleSheet()
  sheet.replaceSync(
    '::highlight(dovo-find){background:#ffe083;color:#161616}::highlight(dovo-find-active){background:#ff9632;color:#161616}',
  )
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
  const roots: (Document | ShadowRoot)[] = [document]
  let text = ''
  const nodes: { node: Text; start: number; end: number }[] = []
  const visit = (node: Node) => {
    if (text.length > 2 * 1024 * 1024) return
    if (node instanceof Text) {
      if (node.data) {
        nodes.push({ node, start: text.length, end: text.length + node.length })
        text += node.data
      }
      return
    }
    let block = false
    if (node instanceof Element) {
      if (node.matches('script,style,noscript,template,head')) return
      const style = getComputedStyle(node)
      if (style.display === 'none' || style.visibility === 'hidden') return
      block = /^(block|flex|grid|table|list-item)/.test(style.display) || node.tagName === 'BR'
      if (block && text && !text.endsWith('\n')) text += '\n'
      if (node.shadowRoot) {
        roots.push(node.shadowRoot)
        node.shadowRoot.adoptedStyleSheets = [...node.shadowRoot.adoptedStyleSheets, sheet]
        visit(node.shadowRoot)
      }
    }
    for (const child of node.childNodes) visit(child)
    if (block && text && !text.endsWith('\n')) text += '\n'
  }
  if (document.body) visit(document.body)
  let previousActive: Range | undefined
  Reflect.set(window, key, (update: 'clear' | { matches: Match[]; active: number }) => {
    CSS.highlights.delete('dovo-find')
    CSS.highlights.delete('dovo-find-active')
    if (update === 'clear') {
      previousActive = undefined
      for (const root of roots)
        root.adoptedStyleSheets = root.adoptedStyleSheets.filter((value) => value !== sheet)
      Reflect.deleteProperty(window, key)
      return
    }
    const ranges: Range[] = []
    let active: Range | undefined
    let cursor = 0
    for (const [index, [start, end]] of update.matches.entries()) {
      while (cursor < nodes.length && nodes[cursor].end <= start) cursor++
      const first = nodes[cursor]
      let lastIndex = cursor
      while (lastIndex < nodes.length && nodes[lastIndex].end < end) lastIndex++
      const last = nodes[lastIndex]
      if (!first || !last || !first.node.isConnected || !last.node.isConnected) continue
      const range = new Range()
      range.setStart(first.node, Math.max(0, Math.min(first.node.length, start - first.start)))
      range.setEnd(last.node, Math.max(0, Math.min(last.node.length, end - last.start)))
      ranges.push(range)
      if (index === update.active) active = range
    }
    CSS.highlights.set('dovo-find', new Highlight(...ranges))
    if (active) {
      CSS.highlights.set('dovo-find-active', new Highlight(active))
      if (
        !previousActive ||
        previousActive.compareBoundaryPoints(Range.START_TO_START, active) !== 0
      ) {
        active.startContainer.parentElement?.scrollIntoView({ block: 'center', inline: 'nearest' })
        for (
          let parent = active.startContainer.parentElement;
          parent;
          parent = parent.parentElement
        ) {
          const rect = active.getBoundingClientRect()
          const bounds = parent.getBoundingClientRect()
          const style = getComputedStyle(parent)
          if (/(auto|scroll)/.test(style.overflowY) && parent.scrollHeight > parent.clientHeight)
            parent.scrollTop += rect.top - bounds.top - parent.clientHeight / 2
          if (/(auto|scroll)/.test(style.overflowX) && parent.scrollWidth > parent.clientWidth)
            parent.scrollLeft += rect.left - bounds.left - parent.clientWidth / 2
        }
        const rect = active.getBoundingClientRect()
        window.scrollBy({
          top: rect.top - innerHeight / 2,
          left: rect.left < 0 || rect.right > innerWidth ? rect.left - innerWidth / 2 : 0,
        })
      }
    }
    previousActive = active
  })
  return text
}

export function createBrowserFind(contents: WebContents) {
  let version = 0
  let query: Query | undefined
  let frames: FrameMatches[] = []
  let active = 0
  let pending: ReturnType<typeof matchBrowserText> | undefined
  let state: BrowserFindResult = { active: 0, total: 0 }
  const run = (frame: WebFrameMain, command: Parameters<typeof browserFindDocument>[0]) =>
    frame.executeJavaScript(`(${browserFindDocument.toString()})(${JSON.stringify(command)})`)
  const clear = () => {
    version++
    pending?.cancel()
    pending = undefined
    query = undefined
    state = { active: 0, total: 0 }
    const previous = frames
    frames = []
    for (const { frame } of previous)
      if (!frame.detached)
        void run(frame, 'clear').catch((error: unknown) => {
          if (!frame.detached) console.error('Could not clear page search', error)
        })
  }
  const apply = async (revision: number) => {
    let offset = 0
    for (const { frame, matches } of frames) {
      if (version !== revision) return
      if (!frame.detached) await run(frame, { matches, active: active - offset })
      offset += matches.length
    }
  }
  const perform = async (
    next: Query,
    direction: 'next' | 'previous' | undefined,
    revision: number,
  ): Promise<BrowserFindResult> => {
    if (version !== revision || contents.isDestroyed()) return state
    if (!next.text) {
      clear()
      return state
    }
    if (
      !direction ||
      !query ||
      query.text !== next.text ||
      query.regex !== next.regex ||
      query.matchCase !== next.matchCase
    ) {
      query = next
      const collected: { frame: WebFrameMain; text: string }[] = []
      try {
        const sources = contents.mainFrame.framesInSubtree
        frames = sources.map((frame) => ({ frame, matches: [] }))
        for (const frame of sources) {
          if (version !== revision) return state
          if (frame.detached) continue
          const text: unknown = await run(frame, 'collect')
          if (typeof text !== 'string' || text.length > 2 * 1024 * 1024)
            throw new Error('This page is too large to search.')
          collected.push({ frame, text })
          if (collected.reduce((sum, item) => sum + item.text.length, 0) > 2 * 1024 * 1024)
            throw new Error('This page is too large to search.')
        }
        if (version !== revision) return state
        frames = collected.map(({ frame }) => ({ frame, matches: [] }))
        pending = matchBrowserText(
          collected.map(({ text }) => text),
          next,
        )
        const result = await pending.result
        if (version !== revision) return state
        if (result.error) {
          state = { active: 0, total: 0, error: result.error }
          return state
        }
        frames = collected.map(({ frame }, index) => ({
          frame,
          matches: result.matches?.[index] ?? [],
        }))
        active = 0
        state = {
          active: 0,
          total: frames.reduce((sum, frame) => sum + frame.matches.length, 0),
          limited: result.limited,
        }
      } catch (error) {
        if (version === revision)
          state = {
            active: 0,
            total: 0,
            error: error instanceof Error ? error.message : String(error),
          }
        return state
      }
    } else if (state.total) {
      active = (active + (direction === 'previous' ? -1 : 1) + state.total) % state.total
    }
    if (version !== revision) return state
    try {
      await apply(revision)
    } catch (error) {
      if (version === revision)
        state = { ...state, error: error instanceof Error ? error.message : String(error) }
    }
    if (version === revision) state = { ...state, active: state.total ? active + 1 : 0 }
    return state
  }
  // Serialize DOM snapshots/applications; a superseded worker is cancelled immediately.
  let queue: Promise<unknown> = Promise.resolve()
  const search = (next: Query, direction?: 'next' | 'previous') => {
    const revision = ++version
    pending?.cancel()
    const operation = queue.then(() => perform(next, direction, revision))
    queue = operation.catch(() => undefined)
    return operation
  }
  contents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
    if (mainFrame && !inPlace) clear()
  })
  contents.once('destroyed', clear)
  return { search, clear }
}
