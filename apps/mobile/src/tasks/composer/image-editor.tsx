import { useEffect, useRef, useState } from 'react'
import { File, Paths } from 'expo-file-system'
import { randomUUID } from 'expo-crypto'
import WebView from 'react-native-webview'
import { imageEditorDocument, parseImageEditorResult } from '@dovo/client-runtime'
import { attachmentImageFormat, isAnimatedAttachmentImage } from '@dovo/protocol'
import { SafeModal } from '../../ui/layout/safe-modal'
import type { AttachmentAsset } from './attachment-picker'

export function useImageEditor() {
  const [html, setHtml] = useState<string | null>(null)
  const pending = useRef<((asset: AttachmentAsset | null) => void) | null>(null)
  const rejectPending = useRef<((error: Error) => void) | null>(null)
  const mounted = useRef(true)
  const original = useRef<AttachmentAsset | null>(null)
  const finish = (asset: AttachmentAsset | null) => {
    const resolve = pending.current
    pending.current = null
    rejectPending.current = null
    original.current = null
    setHtml(null)
    resolve?.(asset)
  }
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      pending.current?.(null)
      pending.current = null
    }
  }, [])
  const fail = (error: Error) => {
    const reject = rejectPending.current
    pending.current = null
    rejectPending.current = null
    original.current = null
    setHtml(null)
    reject?.(error)
  }
  const edit = async (asset: AttachmentAsset): Promise<AttachmentAsset | null> => {
    const format = attachmentImageFormat(asset.name, asset.mimeType ?? '')
    if (!format || format === 'heic') return asset
    const file = new File(asset.uri)
    if (
      (format === 'png' || format === 'webp') &&
      isAnimatedAttachmentImage(await file.bytes(), format)
    )
      return asset
    if (pending.current) throw new Error('Finish editing the current image first.')
    const mime = format === 'jpeg' ? 'image/jpeg' : `image/${format}`
    const document = imageEditorDocument(`data:${mime};base64,${await file.base64()}`)
    if (!mounted.current) return null
    return new Promise((resolve, reject) => {
      rejectPending.current = reject
      pending.current = resolve
      original.current = asset
      setHtml(document)
    })
  }
  return {
    edit,
    editor: html ? (
      <SafeModal visible animationType="slide" onRequestClose={() => finish(null)}>
        <WebView
          source={{ html }}
          originWhitelist={['*']}
          onShouldStartLoadWithRequest={(request) => request.url === 'about:blank'}
          scrollEnabled={false}
          bounces={false}
          style={{ flex: 1, backgroundColor: '#18181b' }}
          onError={() => fail(new Error('Could not open the image editor. Please try again.'))}
          onMessage={({ nativeEvent }) => {
            let message: unknown
            try {
              message = JSON.parse(nativeEvent.data)
            } catch {
              return
            }
            const result = parseImageEditorResult(message)
            if (!result || !original.current) return
            if (result.type === 'cancel') finish(null)
            else if (result.type === 'original') finish(original.current)
            else if (result.type === 'edited') {
              const name = original.current.name
              void (async () => {
                const file = new File(Paths.cache, `edited-${randomUUID()}.png`)
                try {
                  await file.write(result.data.split(',')[1], { encoding: 'base64' })
                } catch (error) {
                  if (file.exists) file.delete()
                  throw error
                }
                if (!mounted.current || !pending.current) {
                  file.delete()
                  return
                }
                finish({
                  uri: file.uri,
                  name: `${name.replace(/\.[^.]+$/, '').slice(0, 220)}-edited.png`,
                  mimeType: 'image/png',
                })
              })().catch((error: unknown) =>
                fail(error instanceof Error ? error : new Error(String(error))),
              )
            }
          }}
        />
      </SafeModal>
    ) : null,
  }
}
