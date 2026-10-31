import { screenshotData } from '@dovo/protocol'
import { useAttachments } from '../chat/composer/use-attachments'

export function useScreenshotAttachment(taskId: string) {
  const attachments = useAttachments({ id: taskId })
  return {
    editor: attachments.editor,
    error: attachments.error,
    busy: attachments.busy,
    attach: async (image: string, signal?: AbortSignal) =>
      attachments.upload(
        [
          new File(
            [Uint8Array.from(atob(screenshotData(image)), (char) => char.charCodeAt(0))],
            `screenshot-${Date.now()}.png`,
            { type: 'image/png' },
          ),
        ],
        undefined,
        false,
        signal,
      ),
  }
}
