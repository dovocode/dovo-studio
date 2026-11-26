export type CopiedImages = { runtimeId: string; taskId: string; ids: string[] }

let copied: { marker: string; images: CopiedImages } | undefined

export function rememberCopiedMessageImages(value?: { marker: string; images: CopiedImages }) {
  copied = value
}

export function copiedMessageImages(marker: string) {
  return copied?.marker === marker ? copied.images : undefined
}
