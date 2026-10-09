import type { Metadata } from 'next'
import Link from 'next/link'
import { WorkspaceScreenshot } from '../components/workspace-screenshots'
import { MobileAvailability } from '../components/mobile-availability'
import { ServerQuickStart } from '../components/server-quick-start'
import { ProductTour } from '../components/product-tour'

export const metadata: Metadata = { alternates: { canonical: '/' } }

export default function Home() {
  return (
    <>
      <div className="hero-stage">
        <section className="hero wrap">
          <p className="eyebrow">
            <span className="status-dot" /> FOR BUILDERS WHO WANT THE WHEEL
          </p>
          <h1>
            Build big.
            <br />
            <span>Own the process.</span>
          </h1>
          <p className="hero-description">
            Your agents. Your code. Your machine. Put coding agents, Git and automations in one
            workspace — and take your next idea all the way to shipped.
          </p>
          <div className="actions">
            <Link href="/download/" className="button">
              Get Dovo Studio <span aria-hidden="true">↓</span>
            </Link>
            <a href="#product" className="button button-secondary">
              Explore the workspace <span aria-hidden="true">↘</span>
            </a>
          </div>
          <p className="hero-note">macOS, Windows & Linux · Your runtime, your data</p>
        </section>
        <div className="wrap hero-preview">
          <div className="preview-toolbar">
            <span>
              <i /> <i /> <i />
            </span>
            <span>Dovo Studio / Your next big thing</span>
            <span className="preview-live">● Runtime connected</span>
          </div>
          <WorkspaceScreenshot />
          <div className="preview-caption">
            <span>IDEA → AGENT → REVIEW → SHIP</span>
            <span>Less tab chaos. More shipped work.</span>
          </div>
        </div>
      </div>
      <section className="platform-strip wrap" aria-label="Supported coding agents">
        <span>YOUR AGENTS. YOUR CHOICE.</span>
        <strong>Codex</strong>
        <strong>Claude</strong>
        <strong>OpenCode</strong>
        <strong>ACP agents</strong>
      </section>
      <section className="manifesto" aria-labelledby="manifesto-heading">
        <div className="wrap manifesto-inner">
          <p className="eyebrow">THE DOVO WAY</p>
          <h2 id="manifesto-heading">
            Let agents do the work.
            <br />
            <span>You call the shots.</span>
          </h2>
          <div className="manifesto-bottom">
            <p>
              Choose your agents. Review their work. Run it on your hardware. Dovo brings the pieces
              together so you can stay focused on what you’re building.
            </p>
            <a href="#product" className="manifesto-link">
              Take a look inside <span aria-hidden="true">↗</span>
            </a>
          </div>
        </div>
      </section>
      <section className="section wrap" id="features">
        <div className="section-heading">
          <p className="eyebrow">LESS SWITCHING. MORE BUILDING.</p>
          <h2>
            Cut the tab chaos.
            <br />
            Keep the momentum.
          </h2>
          <p>From the first idea to the final diff, keep the context close to the work.</p>
        </div>
        <div className="feature-grid">
          <article className="feature-card">
            <span className="feature-symbol" aria-hidden="true">
              ⌘
            </span>
            <h3>Give your agents direction.</h3>
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
            <h3>Own the final diff.</h3>
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
            <h3>Put busywork on autopilot.</h3>
            <p>
              Build automations with schedules, webhooks and task runs. Keep human review in the
              loop where it matters.
            </p>
            <span className="feature-tag">Jobs & automations</span>
          </article>
        </div>
        <ProductTour />
        <div className="automation-showcase">
          <p className="eyebrow">REPEAT THE WORKFLOW. KEEP THE JUDGMENT.</p>
          <h3>Build the flow. Keep a human in the loop.</h3>
          <p>Connect schedules, agent tasks and review steps in the actual automation editor.</p>
          <WorkspaceScreenshot automation />
        </div>
      </section>
      <section className="ownership wrap">
        <div>
          <p className="eyebrow">LOCAL AT THE CORE</p>
          <h2>
            Your machine.
            <br />
            Your rules.
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
          aria-label="Desktop and web connect directly to your runtime; iPhone is work in progress"
        >
          <div className="map-clients">
            <span>Desktop</span>
            <span>Web</span>
            <span>iPhone · WIP</span>
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
      <div className="wrap">
        <MobileAvailability />
        <ServerQuickStart />
      </div>
      <section className="faq section wrap" id="questions">
        <div>
          <p className="eyebrow">GOOD QUESTIONS</p>
          <h2>
            A little clarity.
            <br />
            Then, go build.
          </h2>
          <p>
            Everything else?{' '}
            <Link className="text-link" href="/docs/">
              Head to the docs ↗
            </Link>
          </p>
        </div>
        <div className="faq-list">
          <details>
            <summary>What is Dovo Studio?</summary>
            <p>
              A personal workspace that brings coding agent conversations, projects, Git, terminals
              and automations together. Run the runtime on your computer or server and connect from
              desktop or web.
            </p>
          </details>
          <details>
            <summary>Can I use my existing coding agents?</summary>
            <p>
              Yes. Work with Codex, Claude, OpenCode and compatible ACP agents. Agent credentials
              stay with your runtime; provider subscriptions and usage are managed with your chosen
              provider.
            </p>
          </details>
          <details>
            <summary>Do I need a Dovo account?</summary>
            <p>
              No. Connect directly to your runtime with a pairing code. Each paired device receives
              its own token. Your projects and workspace data stay on your computer or server.
            </p>
          </details>
          <details>
            <summary>Can I connect to a remote computer?</summary>
            <p>
              Yes. Run the runtime on your server and connect over your LAN, Tailscale or NetBird.
              HTTP is supported and HTTPS is optional. See the server setup above to get started.
            </p>
          </details>
          <details>
            <summary>Is there a mobile app?</summary>
            <p>
              The iPhone app is work in progress and currently requires a local build with a Mac and
              Xcode. Android is coming soon. Desktop downloads are available for macOS, Windows and
              Linux.
            </p>
          </details>
        </div>
      </section>
      <section className="closing wrap">
        <p className="eyebrow">ENOUGH TALK. LET’S BUILD.</p>
        <h2>
          Bring the idea.
          <br />
          <span>Make it happen.</span>
        </h2>
        <p>Open your project. Pick your agent. Get to work.</p>
        <Link href="/download/" className="button">
          Download Dovo Studio <span aria-hidden="true">↓</span>
        </Link>
      </section>
    </>
  )
}
