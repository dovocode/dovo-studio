import type { Metadata } from 'next'
import Link from 'next/link'
import { WorkspacePreview } from '../components/workspace-preview'

export const metadata: Metadata = { alternates: { canonical: '/' } }

export default function Home() {
  return (
    <>
      <section className="hero wrap">
        <p className="eyebrow">
          <span className="status-dot" /> BUILT FOR PEOPLE WHO BUILD
        </p>
        <h1>
          Your agents.
          <br />
          Your projects.
          <br />
          <span>Your workspace.</span>
        </h1>
        <p className="hero-description">
          Bring coding agents, Git and automations into one calm workspace. Run it on your computer.
          Pick up the work from desktop, web or iPhone.
        </p>
        <div className="actions">
          <Link href="/download/" className="button">
            Get Dovo Studio <span aria-hidden="true">↓</span>
          </Link>
          <Link href="/docs/" className="text-link">
            Find your way around <span aria-hidden="true">↗</span>
          </Link>
        </div>
        <p className="hero-note">macOS, Windows & Linux · Your runtime, your data</p>
      </section>
      <div className="wrap">
        <WorkspacePreview />
      </div>
      <section className="platform-strip wrap" aria-label="Supported coding agents">
        <span>WORK WITH YOUR AGENTS</span>
        <strong>Codex</strong>
        <strong>Claude</strong>
        <strong>OpenCode</strong>
        <strong>ACP agents</strong>
      </section>
      <section className="section wrap">
        <div className="section-heading">
          <p className="eyebrow">LESS SWITCHING. MORE BUILDING.</p>
          <h2>
            The whole loop,
            <br />
            in one place.
          </h2>
          <p>From the first idea to the final diff, keep the context close to the work.</p>
        </div>
        <div className="feature-grid">
          <article className="feature-card">
            <span className="feature-symbol" aria-hidden="true">
              ⌘
            </span>
            <h3>Room for every thread</h3>
            <p>
              Run agents against your projects. Follow streamed progress, answer questions and
              review approvals without losing the conversation.
            </p>
            <span className="feature-tag">Agents & threads</span>
          </article>
          <article className="feature-card">
            <span className="feature-symbol" aria-hidden="true">
              ⑂
            </span>
            <h3>Stay close to the code</h3>
            <p>
              Review diffs, work with branches and worktrees, browse pull requests and open a real
              terminal on your host.
            </p>
            <span className="feature-tag">Git & terminals</span>
          </article>
          <article className="feature-card">
            <span className="feature-symbol" aria-hidden="true">
              ◷
            </span>
            <h3>Give repeat work a rhythm</h3>
            <p>
              Build automations with schedules, webhooks and task runs. Keep human review in the
              loop where it matters.
            </p>
            <span className="feature-tag">Jobs & automations</span>
          </article>
        </div>
      </section>
      <section className="ownership wrap">
        <div>
          <p className="eyebrow">LOCAL AT THE CORE</p>
          <h2>
            A workspace that
            <br />
            stays yours.
          </h2>
          <p>
            Your runtime keeps projects, agent credentials and workspace data on your computer or
            server. Connect directly over your LAN, Tailscale or NetBird, with optional HTTPS.
          </p>
          <Link className="text-link" href="/docs/">
            How it fits together <span aria-hidden="true">↗</span>
          </Link>
        </div>
        <div
          className="connection-map"
          aria-label="Desktop, web and iPhone connect directly to your runtime"
        >
          <div className="map-clients">
            <span>Desktop</span>
            <span>Web</span>
            <span>iPhone</span>
          </div>
          <div className="map-line" aria-hidden="true" />
          <div className="map-host">
            <span className="status-dot" />
            <strong>Your runtime</strong>
            <small>Projects · Agents · Workspace data</small>
          </div>
          <p>
            Direct connection. Pairing required.
            <br />
            No Dovo account needed.
          </p>
        </div>
      </section>
      <section className="closing wrap">
        <p className="eyebrow">MAKE SPACE FOR YOUR NEXT IDEA</p>
        <h2>Let’s get to work.</h2>
        <Link href="/download/" className="button">
          Download Dovo Studio <span aria-hidden="true">↓</span>
        </Link>
      </section>
    </>
  )
}
