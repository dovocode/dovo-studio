import { useEffect, useRef, useState } from 'react'
import { File, Paths } from 'expo-file-system'
import { randomUUID } from 'expo-crypto'
import { screenshotData } from '@dovo/protocol'
import { useAttachmentPicker } from '../composer/attachment-picker'

export function useScreenshotAttachment(taskId: string) {
  const picker = useAttachmentPicker(taskId)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const locked = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const attach = async (image: string) => {
    if (locked.current || picker.busy) return
    locked.current = true
    setWorking(true)
    setError('')
    let file: File | undefined
    try {
      const data = screenshotData(image)
      file = new File(Paths.cache, `screenshot-${randomUUID()}.png`)
      await file.write(data, { encoding: 'base64' })
      if (mounted.current)
        await picker.upload([
          { uri: file.uri, name: `screenshot-${Date.now()}.png`, mimeType: 'image/png' },
        ])
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (file?.exists) file.delete()
      locked.current = false
      if (mounted.current) setWorking(false)
    }
  }
  return {
    attach,
    editor: picker.editor,
    error: error || picker.error,
    busy: working || picker.busy,
  }
}
