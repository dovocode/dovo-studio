import type { Metadata } from 'next'
import Link from 'next/link'
import { guide, serverGuide, mobileGuide, repository } from '../../components/site-links'

export const metadata: Metadata = {
  alternates: { canonical: '/docs/' },
  title: 'Getting started',
  description:
    'Install Dovo Studio, configure coding agents, add a project and pair your devices with your own runtime.',
}

export default function Docs() {
  return (
    <div className="wrap page-content docs-page">
      <p className="eyebrow">A LITTLE DIRECTION</p>
      <h1>
        From download
        <br />
        to your first thread.
      </h1>
      <p className="page-intro">
        Start with the desktop app. Add the agents you already use, choose a project and give the
        work a place to live.
      </p>
      <div className="docs-layout">
        <nav className="docs-nav" aria-label="On this page">
          <span>GETTING STARTED</span>
          <a href="#install">01 · Install</a>
          <a href="#agents">02 · Connect agents</a>
          <a href="#project">03 · Add a project</a>
          <a href="#devices">04 · Pair a device</a>
          <a href="#more">More guides ↗</a>
        </nav>
        <div className="docs-steps">
          <section id="install">
            <span className="step-number">01</span>
            <h2>Install the desktop app.</h2>
            <p>
              <Link href="/download/">Download the release for your computer</Link>, install it and
              open Dovo Studio. The desktop app includes a runtime that owns your projects, agent
              sessions and workspace data.
            </p>
            <p>
              You can also connect to an existing runtime. To run one independently, follow the{' '}
              <a href={serverGuide}>server setup guide</a>.
            </p>
          </section>
          <section id="agents">
            <span className="step-number">02</span>
            <h2>Connect your coding agents.</h2>
            <p>
              Install and authenticate the agents you want to use on the runtime host, under the
              same operating-system account that runs Dovo. Dovo supports Codex, Claude, OpenCode
              and ACP agents.
            </p>
            <p>
              Open Settings to configure agents and reusable profiles. If your runtime is on another
              computer, agent tools and credentials belong on that computer.
            </p>
            <a className="text-link" href={guide}>
              Agent setup and provider instructions ↗
            </a>
          </section>
          <section id="project">
            <span className="step-number">03</span>
            <h2>Add a project. Start a thread.</h2>
            <p>
              Add an existing folder or use the GitHub repository flow. Choose the project when
              creating a thread, select an agent and send your first message to start the work.
            </p>
            <p>
              Follow the conversation as it runs. Answer questions, review requested approvals and
              inspect the Git changes before deciding what to keep.
            </p>
          </section>
          <section id="devices">
            <span className="step-number">04</span>
            <h2>Connect another device.</h2>
            <p>
              Your desktop, web and iPhone clients can connect to the same runtime. Get a pairing
              code from the host and pair using its reachable address.
            </p>
            <div className="docs-note">
              <strong>Use the network that works for you.</strong>
              <p>
                HTTP is supported on LAN and VPN connections, including Tailscale and NetBird. HTTPS
                is optional. Pairing codes and device tokens are required; a Dovo account is not.
              </p>
            </div>
            <p>
              The host must be running and reachable for live work. For iPhone installation, follow
              the <a href={mobileGuide}>local build instructions</a>.
            </p>
          </section>
        </div>
      </div>
      <section id="more" className="more-guides">
        <p className="eyebrow">KEEP EXPLORING</p>
        <h2>A guide for the next step.</h2>
        <div className="guide-grid">
          <a href={guide}>
            <strong>Product guide ↗</strong>
            <span>Threads, source control, agents and automations.</span>
          </a>
          <a href={serverGuide}>
            <strong>Server & networking ↗</strong>
            <span>Standalone hosts, services and pairing.</span>
          </a>
          <a href={`${repository}/blob/main/docs/releases-and-updates.md`}>
            <strong>Releases & updates ↗</strong>
            <span>Desktop updates and local iPhone installation.</span>
          </a>
          <a href={`${repository}/blob/main/CONTRIBUTING.md`}>
            <strong>Build from source ↗</strong>
            <span>Development setup and repository conventions.</span>
          </a>
        </div>
      </section>
    </div>
  )
}
