import { designTokens } from '@dovo/design'
import { clearGlassMaps, createDisplacementMap, createSpecularMap } from './optics'

const selector = [
  ".studio-navigation[aria-label='Main navigation']",
  ".studio-navigation[aria-label='Main navigation'] .studio-navigation-item[aria-current='page']",
  '.studio-composer:not(.dovo-dialog-content *)',
  '[data-fixed-material]',
].join(',')
const ns = 'http://www.w3.org/2000/svg'
let nextId = 0

type Surface = { version: number; geometry: string; filter?: SVGFilterElement; timer?: number }

function svgNode<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | number>,
  parent: SVGElement,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(ns, tag)
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value))
  parent.append(node)
  return node
}

const owners = new Map<symbol, boolean>()
let stopController: (() => void) | undefined
let controllerContrast: boolean | undefined

/** Share one controller across appearance hooks and release it after the last owner leaves. */
export function startLiquidGlass(highContrast: boolean): () => void {
  const owner = Symbol('liquid-glass-owner')
  owners.set(owner, highContrast)
  updateController()
  return () => {
    if (!owners.delete(owner)) return
    updateController()
  }
}

function updateController() {
  if (owners.size === 0) {
    stopController?.()
    stopController = undefined
    controllerContrast = undefined
    return
  }
  const highContrast = Array.from(owners.values()).some(Boolean)
  if (stopController && controllerContrast === highContrast) return
  stopController?.()
  controllerContrast = highContrast
  stopController = createController(highContrast)
}

/** Owns the optical maps and observers for the lifetime of one appearance controller. */
function createController(highContrast: boolean): () => void {
  if (typeof window.matchMedia !== 'function' || typeof ResizeObserver === 'undefined')
    return () => {}
  const reduced = window.matchMedia('(prefers-reduced-transparency: reduce)')
  const forced = window.matchMedia('(forced-colors: active)')
  const chromium =
    /Chrome\/|Chromium\//.test(navigator.userAgent) &&
    !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent)
  let active = false
  let disposed = false
  const surfaces = new Map<HTMLElement, Surface>()
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('aria-hidden', 'true')
  svg.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none'
  const defs = svgNode('defs', {}, svg)
  document.body.append(svg)

  function clearSurface(element: HTMLElement, surface: Surface) {
    surface.version++
    if (surface.timer !== undefined) window.clearTimeout(surface.timer)
    surface.timer = undefined
    surface.geometry = ''
    surface.filter?.remove()
    surface.filter = undefined
    element.removeAttribute('data-studio-glass')
    element.style.removeProperty('--studio-glass-refraction')
  }

  async function render(element: HTMLElement, surface: Surface) {
    const width = element.offsetWidth
    const height = element.offsetHeight
    if (!width || !height) {
      clearSurface(element, surface)
      return
    }
    const radius = Math.min(
      Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0,
      width / 2,
      height / 2,
    )
    const bezel = Math.max(6, Math.min(width * 0.4, height * 0.4, designTokens.glass.bezel))
    const geometryKey = [width, height, radius, bezel].join(':')
    if (geometryKey === surface.geometry) return
    const version = ++surface.version
    const geometry = { width, height, radius, bezel, surface: 'squircle' as const }
    const map = createDisplacementMap({
      ...geometry,
      ior: designTokens.glass.ior,
      thickness: bezel * designTokens.glass.thickness,
    })
    const specular = createSpecularMap(geometry)
    if (!map.url || !specular) {
      surface.geometry = ''
      return
    }
    try {
      await Promise.all(
        [map.url, specular].map((url) => {
          const image = new Image()
          image.src = url
          return image.decode()
        }),
      )
    } catch (error) {
      if (active && surface.version === version) {
        surface.geometry = ''
        console.warn('Could not decode liquid glass maps', error)
      }
      return
    }
    if (!active || disposed || surface.version !== version || !element.isConnected) return
    const id = `studio-glass-${++nextId}`
    const filter = svgNode(
      'filter',
      {
        id,
        x: 0,
        y: 0,
        width,
        height,
        filterUnits: 'userSpaceOnUse',
        'color-interpolation-filters': 'sRGB',
      },
      defs,
    )
    svgNode(
      'feGaussianBlur',
      { in: 'SourceGraphic', stdDeviation: designTokens.glass.blur, result: 'blur' },
      filter,
    )
    svgNode(
      'feImage',
      { href: map.url, x: 0, y: 0, width, height, preserveAspectRatio: 'none', result: 'map' },
      filter,
    )
    const matrices = [
      '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0',
      '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0',
      '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0',
    ]
    ;['r', 'g', 'b'].forEach((channel, index) => {
      svgNode(
        'feDisplacementMap',
        {
          in: 'blur',
          in2: 'map',
          scale: map.scale * (1 - index * designTokens.glass.dispersion),
          xChannelSelector: 'R',
          yChannelSelector: 'G',
          result: `d${channel}`,
        },
        filter,
      )
      svgNode(
        'feColorMatrix',
        { in: `d${channel}`, type: 'matrix', values: matrices[index], result: channel },
        filter,
      )
    })
    svgNode('feBlend', { in: 'r', in2: 'g', mode: 'screen', result: 'rg' }, filter)
    svgNode('feBlend', { in: 'rg', in2: 'b', mode: 'screen', result: 'refracted' }, filter)
    svgNode(
      'feColorMatrix',
      {
        in: 'refracted',
        type: 'saturate',
        values: designTokens.glass.saturation,
        result: 'saturated',
      },
      filter,
    )
    svgNode(
      'feImage',
      {
        href: specular,
        x: 0,
        y: 0,
        width,
        height,
        preserveAspectRatio: 'none',
        result: 'specularMap',
      },
      filter,
    )
    const transfer = svgNode(
      'feComponentTransfer',
      { in: 'specularMap', result: 'specular' },
      filter,
    )
    svgNode('feFuncA', { type: 'linear', slope: designTokens.glass.specular }, transfer)
    svgNode('feComposite', { in: 'specular', in2: 'saturated', operator: 'over' }, filter)
    const old = surface.filter
    surface.geometry = geometryKey
    surface.filter = filter
    element.style.setProperty('--studio-glass-refraction', `url(#${id})`)
    element.setAttribute('data-studio-glass', '')
    old?.remove()
  }

  function schedule(element: HTMLElement, surface: Surface) {
    if (surface.timer !== undefined) window.clearTimeout(surface.timer)
    // Invalidate pending decodes as soon as a resize arrives.
    surface.version++
    surface.timer = window.setTimeout(() => {
      surface.timer = undefined
      void render(element, surface)
    }, 80)
  }
  const resize = new ResizeObserver((entries) => {
    for (const { target } of entries) {
      if (!(target instanceof HTMLElement)) continue
      const surface = surfaces.get(target)
      if (surface) schedule(target, surface)
    }
  })
  function add(element: Element) {
    if (!(element instanceof HTMLElement) || surfaces.has(element)) return
    const surface: Surface = { version: 0, geometry: '' }
    surfaces.set(element, surface)
    resize.observe(element)
  }
  function remove(element: HTMLElement, surface: Surface) {
    resize.unobserve(element)
    clearSurface(element, surface)
    surfaces.delete(element)
  }
  function discover(root: Element) {
    if (root.matches(selector)) add(root)
    root.querySelectorAll(selector).forEach(add)
  }
  const mutations = new MutationObserver((records) => {
    // Inline review panes can arrive with a new turn. Ignore streamed text, but
    // discover material containers mounted or removed inside the conversation.
    const relevant = records.filter((record) => {
      if (
        !(record.target instanceof Element && record.target.closest('.studio-conversation-content'))
      )
        return true
      if (record.type === 'attributes')
        return (
          record.target instanceof HTMLElement &&
          (surfaces.has(record.target) ||
            record.target.matches(selector) ||
            !!record.target.querySelector(selector))
        )
      return [...record.addedNodes, ...record.removedNodes].some(
        (node) =>
          node instanceof Element && (node.matches(selector) || !!node.querySelector(selector)),
      )
    })
    for (const record of relevant) {
      if (record.type === 'attributes' && record.target instanceof HTMLElement) {
        const element = record.target
        const surface = surfaces.get(element)
        if (element.isConnected && element.matches(selector)) {
          if (surface) schedule(element, surface)
          else add(element)
        } else if (surface) {
          remove(element, surface)
        }
        // Selection can live on the row around a card. Update its descendants too.
        for (const [child, childSurface] of surfaces) {
          if (element.contains(child) && !child.matches(selector)) remove(child, childSurface)
        }
        if (element.isConnected) discover(element)
        continue
      }
      for (const node of record.addedNodes) {
        if (node instanceof Element && node !== svg && !svg.contains(node)) discover(node)
      }
    }
    if (
      !relevant.some((record) =>
        Array.from(record.removedNodes).some(
          (node) => node instanceof Element && node !== svg && !svg.contains(node),
        ),
      )
    )
      return
    for (const [element, surface] of surfaces) {
      if (!element.isConnected) remove(element, surface)
    }
  })
  function update() {
    const enabled = chromium && !highContrast && !reduced.matches && !forced.matches
    if (enabled === active) return
    active = enabled
    if (active) {
      discover(document.body)
      mutations.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [
          'class',
          'data-highlighted',
          'data-active',
          'aria-current',
          'aria-pressed',
        ],
      })
    } else {
      mutations.disconnect()
      resize.disconnect()
      for (const [element, surface] of surfaces) clearSurface(element, surface)
      surfaces.clear()
      clearGlassMaps()
    }
  }
  reduced.addEventListener('change', update)
  forced.addEventListener('change', update)
  update()
  return () => {
    disposed = true
    reduced.removeEventListener('change', update)
    forced.removeEventListener('change', update)
    active = false
    mutations.disconnect()
    resize.disconnect()
    for (const [element, surface] of surfaces) clearSurface(element, surface)
    surfaces.clear()
    clearGlassMaps()
    svg.remove()
  }
}
