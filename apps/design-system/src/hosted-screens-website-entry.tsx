import { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import Layout, { metadata as rootMetadata } from '../../site/src/app/layout'
import Home from '../../site/src/app/page'
import Docs, { metadata as docsMetadata } from '../../site/src/app/docs/page'
import Download, { metadata as downloadMetadata } from '../../site/src/app/download/page'
import Privacy, { metadata as privacyMetadata } from '../../site/src/app/privacy/page'
import NotFound from '../../site/src/app/not-found'

const route = document.documentElement.dataset.catalogRoute
const Page =
  route === 'docs'
    ? Docs
    : route === 'download'
      ? Download
      : route === 'privacy'
        ? Privacy
        : route === 'not-found'
          ? NotFound
          : Home
const pageMetadata =
  route === 'docs'
    ? docsMetadata
    : route === 'download'
      ? downloadMetadata
      : route === 'privacy'
        ? privacyMetadata
        : undefined
const rootTitle = rootMetadata.title
const title =
  typeof pageMetadata?.title === 'string'
    ? `${pageMetadata.title} · Dovo Studio`
    : typeof rootTitle === 'object' && rootTitle !== null && 'default' in rootTitle
      ? rootTitle.default
      : 'Dovo Studio'
declare const __dovoCatalogCss: string
const initialTheme = document.documentElement.dataset.theme ?? 'dark'
function Website() {
  useEffect(() => {
    document.documentElement.dataset.theme = initialTheme
  }, [])
  return (
    <Layout>
      <title>{title}</title>
      <style>{__dovoCatalogCss}</style>
      <Page />
    </Layout>
  )
}
createRoot(document).render(<Website />)
