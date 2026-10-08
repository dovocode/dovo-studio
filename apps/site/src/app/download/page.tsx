import type { Metadata } from 'next'
import Link from 'next/link'
import { serverGuide } from '../../components/site-links'
import { MobileAvailability } from '../../components/mobile-availability'
import { ServerQuickStart } from '../../components/server-quick-start'
import { ReleaseDownloads } from '../../components/release-downloads'

export const metadata: Metadata = {
  alternates: { canonical: '/download/' },
  title: 'Download',
  description:
    'Download Dovo Studio for macOS, Windows or Linux, set up a Stable or Nightly server, and follow mobile development.',
}

export default function Download() {
  return (
    <div className="wrap page-content">
      <p className="eyebrow">YOUR NEXT WORKSPACE</p>
      <h1>Start on your computer.</h1>
      <p className="page-intro">
        Install Dovo Studio, connect your agents and bring your first project. The desktop app
        includes the runtime.
      </p>
      <ReleaseDownloads />
      <MobileAvailability />
      <ServerQuickStart />
      <p className="download-note">
        Server archives are also available for macOS ARM64 and Windows x64/ARM64.{' '}
        <a href={serverGuide}>Other server installation options ↗</a>
      </p>
      <div className="callout">
        <strong>First time here?</strong>
        <p>
          Our getting-started guide walks through agents, projects and connecting another device.
        </p>
        <Link className="text-link" href="/docs/">
          Get set up <span aria-hidden="true">→</span>
        </Link>
      </div>
    </div>
  )
}
