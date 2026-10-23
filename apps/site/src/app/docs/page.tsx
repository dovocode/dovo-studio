import type { Metadata } from 'next'
import Link from 'next/link'
import { ServerQuickStart } from '../../components/server-quick-start'
import { HomebrewInstall } from '../../components/homebrew-install'
import { featureCatalog } from '../../components/feature-catalog'
import {
  guide,
  serverGuide,
  mobileGuide,
  repository,
  selfHostingGuide,
} from '../../components/site-links'

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
      <ServerQuickStart />
      <div className="docs-layout">
        <nav className="docs-nav" aria-label="On this page">
          <span>GETTING STARTED</span>
          <a href="#server">Quick server setup</a>
          <a href="#install">01 · Install</a>
          <a href="#homebrew">Homebrew</a>
          <a href="#agents">02 · Connect agents</a>
          <a href="#project">03 · Add a project</a>
          <a href="#devices">04 · Pair a device</a>
          <a href="#custom-services">Custom Connect & artifact store</a>
          <a href="#more">Feature guides ↗</a>
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
          <HomebrewInstall />
          <section id="agents">
            <span className="step-number">02</span>
            <h2>Connect your coding agents.</h2>
            <p>
              Install and authenticate the agents you want to use on the runtime host, under the
              same operating-system account that runs Dovo. Choose from Codex, Claude, OpenCode,
              Cursor, GitHub Copilot, Hermes, Grok Build, Muse Code, Mistral Vibe and custom ACP
              agents. Setup and capabilities vary by provider.
            </p>
            <p>
              Open Settings to configure agents and reusable profiles. If your runtime is on another
              computer, agent tools and credentials belong on that computer.
            </p>
            <a className="text-link" href={`${repository}/blob/main/docs/agent-providers.md`}>
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
              The host must be running and reachable for live work. iPhone is work in progress;
              follow the <a href={mobileGuide}>local build instructions</a> to try it. Android is
              coming soon.
            </p>
          </section>
          <section id="custom-services">
            <p className="eyebrow">OPTIONAL · SELF-HOSTING</p>
            <h2>Your Connect. Your artifact store.</h2>
            <p>
              Connect handles internet connection signaling and the account directory. The artifact
              service stores only the saved versions you publish. Deploy them separately with their
              own hostnames and persistent volumes; add Dovo Auth for account sign-in and hosted
              sharing.
            </p>
            <ol className="custom-service-steps">
              <li>
                <strong>Deploy Connect and Auth.</strong> Build the supplied Docker services from
                the repository root. Configure your Connect origin, GitHub OAuth callback and Auth
                credentials, then enable WebSocket forwarding on your HTTPS reverse proxy.
              </li>
              <li>
                <strong>Connect the artifact store.</strong> Set the same artifact origin and
                generated service key on Connect and the artifact service. Set the Connect origin on
                the artifact service and preserve its private <code>/data</code> volume. Storage
                uses SQLite; no S3 bucket is needed.
              </li>
              <li>
                <strong>Choose your services in Settings.</strong> Open Dovo services in desktop
                Devices &amp; runtime or mobile Devices. Save your Dovo Connect URL, then sign in
                and enable Connect on your computers. Leave the Artifacts URL blank for discovery,
                or set it to require the same store configured on Connect. Accounts stay separate
                for each Connect server. Existing computers need Connect disabled and enabled again
                through LAN/VPN to change brokers.
              </li>
            </ol>
            <p>
              Keep existing databases and the explicit identity mapping when migrating accounts.
              Local runtime pairing stays account-free, with HTTP supported on LAN and VPN.
            </p>
            <a className="text-link" href={selfHostingGuide}>
              Custom Connect & artifact store setup commands ↗
            </a>
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
          <a href={selfHostingGuide}>
            <strong>Custom Connect & artifact store ↗</strong>
            <span>Docker deployment, shared sign-in, client configuration and data migration.</span>
          </a>
          <a href={`${repository}/blob/main/docs/releases-and-updates.md`}>
            <strong>Releases & updates ↗</strong>
            <span>Desktop updates and local iPhone installation.</span>
          </a>
          <a href={`${repository}/blob/main/CONTRIBUTING.md`}>
            <strong>Build from source ↗</strong>
            <span>Development setup and repository conventions.</span>
          </a>
          {featureCatalog.map((feature) => (
            <a key={feature.id} href={feature.guide}>
              <strong>{feature.category} ↗</strong>
              <span>
                {feature.title} {feature.detail}.
              </span>
            </a>
          ))}
        </div>
      </section>
    </div>
  )
}
