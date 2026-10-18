/** Runs only inside the offline browser/WebView document. */
export function imageEditorRuntime(source: string) {
  type Point = { x: number; y: number }
  type Tool = 'pen' | 'highlighter' | 'arrow' | 'rectangle' | 'crop'
  type Step = { tool: Tool; points: Point[]; color: string; size: number }
  const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
  const canvas = document.querySelector('canvas')!
  const ctx = canvas.getContext('2d')!
  const base = document.createElement('canvas')
  const baseContext = base.getContext('2d')!
  const stage = element('stage')
  const color = element<HTMLInputElement>('color')
  const size = element<HTMLInputElement>('size')
  const undo = element<HTMLButtonElement>('undo'),
    redo = element<HTMLButtonElement>('redo'),
    reset = element<HTMLButtonElement>('reset')
  let tool: Tool = 'pen',
    steps: Step[] = [],
    future: Step[] = [],
    draft: Step | null = null,
    pointer: number | null = null,
    loaded = false,
    finished = false
  const image = new Image()
  const send = (result: { type: string; data?: string }) => {
    if (finished) return
    finished = true
    const payload = { channel: 'dovo-image-editor', ...result }
    const bridge = (
      window as Window & { ReactNativeWebView?: { postMessage: (data: string) => void } }
    ).ReactNativeWebView
    if (bridge) bridge.postMessage(JSON.stringify(payload))
    else window.parent.postMessage(payload, '*')
  }
  const rect = (step: Step) => {
    const a = step.points[0],
      b = step.points[step.points.length - 1]
    return {
      x: Math.floor(Math.min(a.x, b.x)),
      y: Math.floor(Math.min(a.y, b.y)),
      width: Math.max(1, Math.round(Math.abs(b.x - a.x))),
      height: Math.max(1, Math.round(Math.abs(b.y - a.y))),
    }
  }
  const draw = (context: CanvasRenderingContext2D, step: Step) => {
    const a = step.points[0],
      b = step.points[step.points.length - 1]
    context.save()
    context.strokeStyle = step.color
    context.fillStyle = step.color
    context.lineWidth = step.size
    context.lineCap = 'round'
    context.lineJoin = 'round'
    if (step.tool === 'crop') {
      const r = rect(step)
      context.strokeStyle = '#67e8f9'
      context.lineWidth = 2
      context.setLineDash([8, 5])
      context.strokeRect(r.x, r.y, r.width, r.height)
    } else if (step.tool === 'rectangle') {
      const r = rect(step)
      context.strokeRect(r.x, r.y, r.width, r.height)
    } else {
      if (step.tool === 'highlighter') {
        context.globalAlpha = 0.3
        context.lineWidth = step.size * 3
      }
      context.beginPath()
      context.moveTo(a.x, a.y)
      for (const p of step.points) context.lineTo(p.x, p.y)
      if (step.points.length === 1) context.lineTo(a.x + 0.01, a.y)
      context.stroke()
      if (step.tool === 'arrow') {
        const angle = Math.atan2(b.y - a.y, b.x - a.x),
          head = Math.max(16, step.size * 4)
        context.beginPath()
        context.moveTo(b.x, b.y)
        context.lineTo(b.x - head * Math.cos(angle - 0.5), b.y - head * Math.sin(angle - 0.5))
        context.moveTo(b.x, b.y)
        context.lineTo(b.x - head * Math.cos(angle + 0.5), b.y - head * Math.sin(angle + 0.5))
        context.stroke()
      }
    }
    context.restore()
  }
  const fit = () => {
    const scale = Math.min(
      (stage.clientWidth - 20) / canvas.width,
      (stage.clientHeight - 20) / canvas.height,
      1,
    )
    canvas.style.width = `${Math.max(1, canvas.width * scale)}px`
    canvas.style.height = `${Math.max(1, canvas.height * scale)}px`
  }
  const preview = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(base, 0, 0)
    if (draft) draw(ctx, draft)
  }
  const render = () => {
    base.width = image.naturalWidth
    base.height = image.naturalHeight
    baseContext.drawImage(image, 0, 0)
    for (const step of steps) {
      if (step.tool === 'crop') {
        const r = rect(step),
          cropped = document.createElement('canvas')
        cropped.width = r.width
        cropped.height = r.height
        cropped
          .getContext('2d')!
          .drawImage(base, r.x, r.y, r.width, r.height, 0, 0, r.width, r.height)
        base.width = r.width
        base.height = r.height
        baseContext.drawImage(cropped, 0, 0)
      } else draw(baseContext, step)
    }
    canvas.width = base.width
    canvas.height = base.height
    preview()
    fit()
    undo.disabled = !steps.length
    redo.disabled = !future.length
    reset.disabled = !steps.length
  }
  const point = (event: PointerEvent) => {
    const r = canvas.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(canvas.width, ((event.clientX - r.left) * canvas.width) / r.width)),
      y: Math.max(0, Math.min(canvas.height, ((event.clientY - r.top) * canvas.height) / r.height)),
    }
  }
  canvas.onpointerdown = (event) => {
    if (!loaded || pointer !== null) return
    event.preventDefault()
    pointer = event.pointerId
    canvas.setPointerCapture(pointer)
    draft = { tool, points: [point(event)], color: color.value, size: Number(size.value) }
    preview()
  }
  canvas.onpointermove = (event) => {
    if (event.pointerId !== pointer || !draft) return
    const p = point(event)
    if (tool === 'pen' || tool === 'highlighter') draft.points.push(p)
    else draft.points = [draft.points[0], p]
    preview()
  }
  canvas.onpointerup = (event) => {
    if (event.pointerId !== pointer || !draft) return
    if (tool !== 'pen' && tool !== 'highlighter') draft.points = [draft.points[0], point(event)]
    if (tool !== 'crop' || (rect(draft).width >= 8 && rect(draft).height >= 8)) {
      steps.push(draft)
      future = []
    }
    draft = null
    pointer = null
    render()
  }
  canvas.onpointercancel = () => {
    draft = null
    pointer = null
    preview()
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-tool]'))
    button.onclick = () => {
      tool = button.dataset.tool as Tool
      for (const other of document.querySelectorAll('[data-tool]'))
        other.setAttribute('aria-pressed', String(other === button))
      element('hint').textContent =
        tool === 'crop'
          ? 'Drag a rectangle to crop. Undo restores the previous image.'
          : 'Draw on the image. Changes stay here until you attach it.'
    }
  undo.onclick = () => {
    const step = steps.pop()
    if (step) {
      future.push(step)
      render()
    }
  }
  redo.onclick = () => {
    const step = future.pop()
    if (step) {
      steps.push(step)
      render()
    }
  }
  reset.onclick = () => {
    steps = []
    future = []
    render()
  }
  element('cancel').onclick = () => send({ type: 'cancel' })
  element('original').onclick = () => send({ type: 'original' })
  element('attach').onclick = () => {
    if (!loaded) return
    try {
      send(
        steps.length ? { type: 'edited', data: base.toDataURL('image/png') } : { type: 'original' },
      )
    } catch {
      element('error').textContent =
        'Could not export this image. Try a smaller image or use the original.'
    }
  }
  document.onkeydown = (event) => {
    if (event.key === 'Escape') send({ type: 'cancel' })
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      ;(event.shiftKey ? redo : undo).click()
    }
  }
  image.onload = () => {
    loaded = true
    render()
    element<HTMLButtonElement>('attach').disabled = false
  }
  image.onerror = () => {
    element('error').textContent =
      'Could not open this image. Use the original or choose another file.'
  }
  new ResizeObserver(fit).observe(stage)
  image.src = source
}
