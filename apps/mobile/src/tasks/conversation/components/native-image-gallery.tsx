import type { ComponentType } from 'react'
import type { NativeImageGalleryProps } from './native-image-gallery.types'
// Android and web keep the shared preview. iOS uses the optional native module.
export const NativeImageGallery: ComponentType<NativeImageGalleryProps> | null = null
