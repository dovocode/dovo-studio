import { requireOptionalNativeModule } from 'expo'
import { randomUUID } from 'expo-crypto'
import { Share } from 'react-native'
import { rememberCopiedMessageImages, type CopiedImages } from './copied-message-images'

type ClipboardModule = {
  setStringAsync(text: string, options: { inputFormat?: 'plainText' | 'html' }): Promise<boolean>
}
// Optional: an app build made before the clipboard module was added still works, through the
// system share sheet (which offers Copy) instead of failing at startup.
const clipboard = requireOptionalNativeModule<ClipboardModule>('ExpoClipboard')
const composer = requireOptionalNativeModule<{
  copyWithImages?: (text: string, marker: string) => Promise<void>
}>('DovoComposerInput')
/** Copies plain text. Resolves 'shared' when this build has no clipboard module and the share
 * sheet was shown instead, so callers only claim "Copied" when it is true. */
export async function copyText(text: string, images?: CopiedImages): Promise<'copied' | 'shared'> {
  if (images?.ids.length && composer?.copyWithImages) {
    const marker = randomUUID()
    await composer.copyWithImages(text, marker)
    rememberCopiedMessageImages({ marker, images })
    return 'copied'
  }
  rememberCopiedMessageImages()
  if (clipboard) {
    if (await clipboard.setStringAsync(text, { inputFormat: 'plainText' })) return 'copied'
    throw new Error('Could not copy to the clipboard. Try again or use Share.')
  }
  await Share.share({ message: text })
  return 'shared'
}

export async function shareText(text: string) {
  await Share.share({ message: text })
}
