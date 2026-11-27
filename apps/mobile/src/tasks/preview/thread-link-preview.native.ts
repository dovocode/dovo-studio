import { lazy } from 'react'

export const ThreadLinkPreview = lazy(() =>
  import('./local-browser-preview').then(({ LocalBrowserPreview }) => ({
    default: LocalBrowserPreview,
  })),
)
