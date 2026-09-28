import { requireOptionalNativeModule } from 'expo'
import { Share } from 'react-native'

type ClipboardModule = {
  setStringAsync(text: string, options: { inputFormat?: 'plainText' | 'html' }): Promise<boolean>
}
// Optional: an app build made before the clipboard module was added still works, through the
// system share sheet (which offers Copy) instead of failing at startup.
const clipboard = requireOptionalNativeModule<ClipboardModule>('ExpoClipboard')

/** Copies plain text. Resolves 'shared' when this build has no clipboard module and the share
 * sheet was shown instead, so callers only claim "Copied" when it is true. */
export async function copyText(text: string): Promise<'copied' | 'shared'> {
  if (clipboard) {
    await clipboard.setStringAsync(text, { inputFormat: 'plainText' })
    return 'copied'
  }
  await Share.share({ message: text })
  return 'shared'
}

export async function shareText(text: string) {
  await Share.share({ message: text })
}
