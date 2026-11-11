import { useLayoutEffect, useState, useRef } from 'react'

export type NativeTooltipRegion = {
  x: number
  y: number
  width: number
  height: number
  radius: number
}
type Notify = (visible: boolean, regions: NativeTooltipRegion[]) => Promise<void>
let notify: Notify | undefined
let popup: Window | null = null
let users = 0
const dismiss = new Set<() => void>()
let stopMirror: (() => void) | undefined
let prepared: Promise<HTMLElement | undefined> | undefined

/** Desktop enables this only for trusted Studio windows. Web clients keep DOM portals. */
export function configureNativeTooltips(
  visible: Notify,
  onDismiss?: (listener: () => void) => () => void,
) {
  notify = visible
  onDismiss?.(() => {
    for (const close of dismiss) close()
  })
}

function mirrorDocument(target: Document) {
  const styles = () => {
    const head = target.createDocumentFragment()
    const loaded: Promise<void>[] = []
    for (const node of document.head.querySelectorAll('style, link[rel="stylesheet"]')) {
      const copy = node.cloneNode(true)
      if (copy instanceof HTMLLinkElement && node instanceof HTMLLinkElement) copy.href = node.href
      if (copy instanceof HTMLLinkElement)
        loaded.push(
          new Promise<void>((resolve, reject) => {
            copy.addEventListener('load', () => resolve(), { once: true })
            copy.addEventListener(
              'error',
              () => reject(Error(`Could not load tooltip styles: ${copy.href}`)),
              { once: true },
            )
          }),
        )
      head.append(copy)
    }
    const clear = target.createElement('style')
    clear.textContent =
      'html,body{margin:0!important;width:100%!important;height:100%!important;background:transparent!important;overflow:hidden!important;pointer-events:none!important}'
    head.append(clear)
    target.head.replaceChildren(head)
    return Promise.all(loaded)
  }
  const theme = () => {
    for (const attribute of [...target.documentElement.attributes])
      target.documentElement.removeAttribute(attribute.name)
    for (const attribute of document.documentElement.attributes)
      target.documentElement.setAttribute(attribute.name, attribute.value)
    target.body.className = document.body.className
    target.body.style.cssText = document.body.style.cssText
  }
  const ready = styles()
  theme()
  // Reuse the stylesheet tree across hovers. Only theme/HMR changes need another copy.
  const observer = new MutationObserver((records) => {
    const stylesheet = (node: Node) =>
      node instanceof Element &&
      (node.matches('style, link[rel="stylesheet"]') ||
        !!node.querySelector('style, link[rel="stylesheet"]'))
    if (
      records.some(
        (record) =>
          (record.target instanceof Element &&
            !!record.target.closest('style, link[rel="stylesheet"]')) ||
          record.target.parentElement?.closest('style') ||
          [...record.addedNodes, ...record.removedNodes].some(stylesheet),
      )
    )
      void styles().catch((error) => console.error('Could not update tooltip styles.', error))
    if (
      records.some(
        (record) => record.target === document.documentElement || record.target === document.body,
      )
    )
      theme()
  })
  observer.observe(document.head, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
  })
  observer.observe(document.documentElement, { attributes: true })
  observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] })
  return { ready, stop: () => observer.disconnect() }
}

export function useNativeTooltipContainer(open: boolean, close: () => void) {
  const [container, setContainer] = useState<HTMLElement>()
  const enabled = !!notify
  const closeRef = useRef(close)
  closeRef.current = close
  useLayoutEffect(() => {
    if (!open || !notify) return
    if (!popup || popup.closed) {
      stopMirror?.()
      popup = window.open('about:blank', 'dovo-native-tooltip')
      const opened = popup
      prepared = opened
        ? notify(false, [])
            .then(async () => {
              if (opened.closed || popup !== opened) return
              const mirror = mirrorDocument(opened.document)
              stopMirror = mirror.stop
              await mirror.ready
              if (opened.closed || popup !== opened) return
              return opened.document.body
            })
            .catch((error) => {
              if (popup === opened) {
                stopMirror?.()
                opened.close()
                popup = null
                prepared = undefined
              }
              throw error
            })
        : undefined
    }
    if (!popup) {
      console.error('Could not create the native tooltip layer.')
      return
    }
    let alive = true
    users++
    const dismissTooltip = () => closeRef.current()
    dismiss.add(dismissTooltip)
    const report = () => {
      const regions = [...(popup?.document.querySelectorAll<HTMLElement>('.studio-tooltip') ?? [])]
        .filter((element) => element.dataset.state !== 'closed')
        .map((element) => {
          // The content animates with scale(). Its Popper wrapper has the final bounds.
          const wrapper = element.parentElement
          const rect = wrapper?.hasAttribute('data-radix-popper-content-wrapper')
            ? wrapper.getBoundingClientRect()
            : element.getBoundingClientRect()
          return {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            radius: Math.min(
              parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0,
              rect.width / 2,
              rect.height / 2,
            ),
          }
        })
      void notify?.(!!users, regions).catch((error) =>
        console.error('Could not update the native tooltip layer.', error),
      )
    }
    // Mount and position the actual React tooltip before exposing its native window.
    let frame: number | undefined
    const resize = new ResizeObserver(report)
    const layout = new MutationObserver(() => {
      for (const element of popup?.document.querySelectorAll('.studio-tooltip') ?? [])
        resize.observe(element)
      report()
    })
    void prepared
      ?.then((body) => {
        if (!alive || !body) return
        setContainer(body)
        layout.observe(body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['style', 'class', 'data-state'],
        })
        frame = requestAnimationFrame(report)
      })
      .catch((error) => console.error('Could not prepare the native tooltip layer.', error))
    window.addEventListener('resize', report)
    return () => {
      alive = false
      if (frame !== undefined) cancelAnimationFrame(frame)
      layout.disconnect()
      resize.disconnect()
      window.removeEventListener('resize', report)
      users--
      dismiss.delete(dismissTooltip)
      report()
      setContainer(undefined)
    }
  }, [enabled, open])
  return { enabled, container: open ? container : undefined }
}
