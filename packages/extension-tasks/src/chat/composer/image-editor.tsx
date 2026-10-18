import { useEffect, useRef, useState } from 'react'
import { imageEditorDocument, parseImageEditorResult } from '@dovo/studio-core'
import { Dialog, DialogContent, DialogTitle } from '@dovo/studio-ui'
import { attachmentImageFormat, isAnimatedAttachmentImage } from '@dovo/protocol'

export function useImageEditor() {
  const [document, setDocument] = useState<string | null>(null)
  const pending = useRef<((file: File | null) => void) | null>(null)
  const mounted = useRef(true)
  const original = useRef<File | null>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const finish = (file: File | null) => {
    const resolve = pending.current
    pending.current = null
    original.current = null
    setDocument(null)
    resolve?.(file)
  }
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      pending.current?.(null)
      pending.current = null
    }
  }, [])
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || !original.current) return
      const result = parseImageEditorResult(event.data)
      if (!result) return
      if (result.type === 'cancel') finish(null)
      else if (result.type === 'original') finish(original.current)
      else if (result.type === 'edited') {
        const bytes = Uint8Array.from(atob(result.data.split(',')[1]), (char) => char.charCodeAt(0))
        finish(
          new File(
            [bytes],
            `${original.current.name.replace(/\.[^.]+$/, '').slice(0, 220)}-edited.png`,
            { type: 'image/png' },
          ),
        )
      }
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [])
  const edit = async (file: File): Promise<File | null> => {
    const format = attachmentImageFormat(file.name, file.type)
    if (!format || format === 'heic') return file
    if (
      (format === 'png' || format === 'webp') &&
      isAnimatedAttachmentImage(new Uint8Array(await file.arrayBuffer()), format)
    )
      return file
    if (pending.current) throw new Error('Finish editing the current image first.')
    const source = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () =>
        typeof reader.result === 'string'
          ? resolve(reader.result)
          : reject(new Error('Could not read this image.'))
      reader.onerror = () => reject(reader.error ?? new Error('Could not read this image.'))
      reader.readAsDataURL(file)
    })
    const mime = format === 'jpeg' ? 'image/jpeg' : `image/${format}`
    const html = imageEditorDocument(`data:${mime};base64,${source.split(',')[1]}`)
    if (!mounted.current) return null
    return new Promise((resolve) => {
      original.current = file
      pending.current = resolve
      setDocument(html)
    })
  }
  return {
    edit,
    editor: (
      <Dialog
        open={document !== null}
        onOpenChange={(open) => {
          if (!open) finish(null)
        }}
      >
        <DialogContent className="h-[min(850px,90dvh)] w-[min(1100px,95vw)] max-w-none overflow-hidden p-0 gap-0 [&>button]:hidden">
          <DialogTitle className="sr-only">Edit image attachment</DialogTitle>
          {document && (
            <iframe
              ref={frame}
              title="Image editor"
              sandbox="allow-scripts"
              srcDoc={document}
              className="h-full w-full border-0"
            />
          )}
        </DialogContent>
      </Dialog>
    ),
  }
}
