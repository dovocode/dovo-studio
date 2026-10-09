import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { repository } from '../components/site-links'
import './globals.css'
import { SiteEffects } from '../components/site-effects'

export const metadata: Metadata = {
  metadataBase: new URL('https://dovo.studio'),
  title: { default: 'Dovo Studio — A workspace for coding agents', template: '%s · Dovo Studio' },
  description:
    'Bring coding agents, projects, Git and automations together. Run Dovo Studio on your computer and connect from desktop or web. iPhone is work in progress; Android is coming soon.',
  applicationName: 'Dovo Studio',
  icons: { icon: '/dovo-logo.png', apple: '/dovo-logo.png' },
  openGraph: {
    title: 'Dovo Studio',
    description: 'Build big. Own the process.',
    type: 'website',
    siteName: 'Dovo Studio',
    images: [{ url: '/dovo-logo.png', width: 96, height: 96, alt: 'Dovo Studio' }],
  },
  twitter: {
    card: 'summary',
    title: 'Dovo Studio',
    description: 'A personal workspace for coding agents, projects and automations.',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SiteEffects />
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <header className="site-header wrap">
          <Link href="/" className="brand" aria-label="Dovo Studio home">
            <Image src="/dovo-logo.png" width={32} height={32} alt="" />
            <span>
              Dovo <span className="brand-muted">Studio</span>
            </span>
          </Link>
          <nav aria-label="Main navigation">
            <Link className="product-nav" href="/#features">
              Product
            </Link>
            <Link href="/docs/">Docs</Link>
            <a href={repository}>
              GitHub <span aria-hidden="true">↗</span>
            </a>
            <Link className="button button-small" href="/download/">
              Download <span aria-hidden="true">↓</span>
            </Link>
          </nav>
        </header>
        <main id="main">{children}</main>
        <footer className="site-footer wrap">
          <div>
            <strong>Dovo Studio</strong>
            <p>Your agents. Your code. Your rules.</p>
          </div>
          <nav aria-label="Footer navigation">
            <Link href="/download/">Downloads</Link>
            <Link href="/docs/">Getting started</Link>
            <a href={repository}>Source code ↗</a>
          </nav>
        </footer>
      </body>
    </html>
  )
}
