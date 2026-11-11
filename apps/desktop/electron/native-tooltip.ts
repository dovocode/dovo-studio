import { BrowserWindow, type HandlerDetails, type WindowOpenHandlerResponse } from 'electron'
import { Schema } from 'effect'
import { decode } from '@dovo/protocol'
import { studioContents } from './studio-window.js'
import { trustedRendererUrl } from './renderer-trust.js'

const tooltips = new WeakMap<BrowserWindow, BrowserWindow>()
const shapes = new WeakMap<BrowserWindow, string>()
const ready = new WeakMap<BrowserWindow, Promise<void>>()
const coordinate = Schema.Number.pipe(
  Schema.check(Schema.isFinite(), Schema.isBetween({ minimum: -100000, maximum: 100000 })),
)
const size = Schema.Number.pipe(
  Schema.check(Schema.isFinite(), Schema.isBetween({ minimum: 0, maximum: 100000 })),
)
const regionsSchema = Schema.Array(
  Schema.Struct({ x: coordinate, y: coordinate, width: size, height: size, radius: size }),
).pipe(Schema.check(Schema.isMaxLength(8)))

/** Limit the painted native window, too. X11 without a compositor paints transparent
 * pixels black. Shaping the window leaves the live page exposed on those desktops. */
function tooltipShape(regions: typeof regionsSchema.Type, zoom: number) {
  return regions.flatMap((region) => {
    const x = Math.round(region.x * zoom),
      y = Math.round(region.y * zoom)
    const width = Math.round(region.width * zoom),
      height = Math.round(region.height * zoom)
    if (width < 1 || height < 1) return []
    const radius = Math.min(
      Math.round(region.radius * zoom),
      Math.floor(width / 2),
      Math.floor(height / 2),
    )
    const rects: Electron.Rectangle[] = []
    if (height > 2 * radius) rects.push({ x, y: y + radius, width, height: height - 2 * radius })
    for (let row = 0; row < radius; row++) {
      const inset = Math.ceil(radius - Math.sqrt(radius * radius - (radius - row - 0.5) ** 2))
      if (width > 2 * inset)
        rects.push(
          { x: x + inset, y: y + row, width: width - 2 * inset, height: 1 },
          { x: x + inset, y: y + height - row - 1, width: width - 2 * inset, height: 1 },
        )
    }
    return rects
  })
}

/** Passive UI must never sit in the page's input path. A native child window can
 * ignore mouse events, unlike a WebContentsView. Its document shares the UI origin. */
export function nativeTooltipWindow(
  owner: BrowserWindow,
  details: HandlerDetails,
  rendererPath: string,
): WindowOpenHandlerResponse | undefined {
  if (details.frameName !== 'dovo-native-tooltip') return
  if (
    details.url !== 'about:blank' ||
    // File renderers omit the referrer. Website tabs never use this handler.
    (details.referrer.url !== '' &&
      !trustedRendererUrl(details.referrer.url, rendererPath, process.env.VITE_DEV_SERVER_URL)) ||
    tooltips.has(owner) ||
    !trustedRendererUrl(
      studioContents(owner).getURL(),
      rendererPath,
      process.env.VITE_DEV_SERVER_URL,
    )
  )
    return { action: 'deny' }
  return {
    action: 'allow',
    overrideBrowserWindowOptions: {
      ...owner.getContentBounds(),
      parent: owner,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      resizable: false,
      webPreferences: {
        preload: undefined,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        zoomFactor: studioContents(owner).getZoomFactor(),
      },
    },
    createWindow: (options) => {
      const tooltip = new BrowserWindow(options)
      tooltip.setIgnoreMouseEvents(true, { forward: true })
      const ownerView = owner.contentView
      const ownerContents = studioContents(owner)
      const tooltipContents = tooltip.webContents
      if (tooltipContents.opener !== ownerContents.mainFrame) {
        queueMicrotask(() => {
          if (!tooltip.isDestroyed()) tooltip.destroy()
        })
        return tooltipContents
      }
      tooltips.set(owner, tooltip)
      ready.set(
        tooltip,
        new Promise<void>((resolve) => {
          tooltipContents.once('did-finish-load', () => resolve())
          tooltip.once('closed', () => resolve())
        }),
      )
      const fit = () => {
        if (!tooltip.isDestroyed()) tooltip.setBounds(owner.getContentBounds())
      }
      owner.on('move', fit)
      owner.on('resize', fit)
      ownerView.on('bounds-changed', fit)
      const close = () => {
        if (!tooltip.isDestroyed()) tooltip.destroy()
      }
      tooltipContents.once('render-process-gone', close)
      owner.once('closed', close)
      const navigation = (
        event: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>,
      ) => {
        if (event.isMainFrame && !event.isSameDocument) close()
      }
      ownerContents.once('destroyed', close)
      ownerContents.on('did-start-navigation', navigation)
      ownerContents.on('render-process-gone', close)
      const dismiss = (_event: Electron.Event, input: Electron.Input) => {
        if (input.type === 'keyDown' && input.key === 'Escape') dismissNativeTooltip(owner)
      }
      ownerContents.on('before-input-event', dismiss)
      tooltip.once('closed', () => {
        if (tooltips.get(owner) === tooltip) tooltips.delete(owner)
        owner.off('move', fit)
        owner.off('resize', fit)
        ownerView.off('bounds-changed', fit)
        owner.off('closed', close)
        ownerContents.off('destroyed', close)
        ownerContents.off('did-start-navigation', navigation)
        ownerContents.off('render-process-gone', close)
        ownerContents.off('before-input-event', dismiss)
      })
      tooltipContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      tooltipContents.on('will-navigate', (event) => event.preventDefault())
      tooltipContents.on('will-redirect', (event) => event.preventDefault())
      return tooltipContents
    },
  }
}

export async function setNativeTooltipVisible(
  owner: BrowserWindow,
  visible: boolean,
  rawRegions: unknown,
) {
  const regions = decode(regionsSchema, rawRegions)
  const tooltip = tooltips.get(owner)
  if (!tooltip || tooltip.isDestroyed()) return
  // window.open returns the initial empty document before about:blank commits.
  // Let the renderer prepare its portal only after that document is stable.
  await ready.get(tooltip)
  if (tooltip.isDestroyed() || tooltips.get(owner) !== tooltip || owner.isDestroyed()) return
  if (
    visible &&
    regions.some((region) => region.width > 0 && region.height > 0) &&
    owner.isVisible() &&
    !owner.isMinimized()
  ) {
    const zoom = studioContents(owner).getZoomFactor()
    tooltip.webContents.setZoomFactor(zoom)
    if (process.platform !== 'darwin') {
      const shape = tooltipShape(regions, zoom)
      if (!shape.length) {
        tooltip.hide()
        return
      }
      const signature = JSON.stringify(shape)
      if (shapes.get(tooltip) !== signature) {
        tooltip.setShape(shape)
        shapes.set(tooltip, signature)
      }
    }
    if (!tooltip.isVisible()) tooltip.showInactive()
  } else if (tooltip.isVisible()) tooltip.hide()
}

export function dismissNativeTooltip(owner: BrowserWindow) {
  const tooltip = tooltips.get(owner)
  if (tooltip && !tooltip.isDestroyed() && tooltip.isVisible())
    studioContents(owner).send('window:tooltip-dismiss')
}
