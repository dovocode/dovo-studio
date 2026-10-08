import type { Metadata } from 'next'
import Link from 'next/link'
import { mobileGuide, serverGuide } from '../../components/site-links'
import { ReleaseDownloads } from '../../components/release-downloads'

export const metadata: Metadata = {
  alternates: { canonical: '/download/' },
  title: 'Download',
  description:
    'Download Dovo Studio for macOS, Windows or Linux, and learn how to connect an iPhone or standalone runtime.',
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
      <section className="secondary-grid">
        <article>
          <p className="eyebrow">ON THE GO</p>
          <h2>Take the work with you.</h2>
          <p>
            The native iPhone app connects to the same runtime. Installation currently follows the
            local iPhone build guide; you’ll need a Mac and Apple signing setup.
          </p>
          <a className="text-link" href={mobileGuide}>
            iPhone installation guide ↗
          </a>
        </article>
        <article>
          <p className="eyebrow">ON YOUR OWN HOST</p>
          <h2>A runtime that stays available.</h2>
          <p>
            Run a standalone runtime on your computer or server. Server archives support macOS
            ARM64, Linux x64/ARM64 and Windows x64/ARM64.
          </p>
          <a className="text-link" href={serverGuide}>
            Set up a standalone server ↗
          </a>
        </article>
      </section>
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
