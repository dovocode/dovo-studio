import { Button, Card } from '@dovo/web-ui'
import type { Metadata } from 'next'
import Link from 'next/link'
import { WorkspaceScreenshot } from '../components/workspace-screenshots'
import { MobileAvailability } from '../components/mobile-availability'
import { ServerQuickStart } from '../components/server-quick-start'
import { ProductTour } from '../components/product-tour'
import { AgentFleet } from '../components/agent-fleet'
import { FeatureShowcase } from '../components/feature-showcase'
import { agentProviders } from '../components/feature-catalog'
import { repository } from '../components/site-links'

export const metadata: Metadata = { alternates: { canonical: '/' } }

export default function Home() {
  return (
    <>
      <div className="hero-stage">
        <section className="hero wrap">
          <div className="hero-copy">
            <p className="eyebrow">
              <span className="status-dot" /> THE WORKSPACE FOR CODING AGENTS
            </p>
            <h1>
              Your agents.
              <br />
              <span>One workspace.</span>
            </h1>
          </div>
          <div className="hero-aside">
            <p className="hero-description">
              Run coding agents on your own computers. Keep conversations, code review, browser
              previews and automations together, from the first idea to the final diff.
            </p>
            <div className="actions">
              <Button asChild size="touch">
                <Link href="/download/">
                  Get Dovo Studio <span aria-hidden="true">↓</span>
                </Link>
              </Button>
              <a href="#product" className="hero-explore">
                Explore the workspace <span aria-hidden="true">↗</span>
              </a>
            </div>
            <p className="hero-note">macOS / Windows / Linux</p>
            <div className="hero-principles" aria-label="Built around your control">
              <span>Run locally</span>
              <span>Choose your agents</span>
              <span>Own your data</span>
            </div>
          </div>
        </section>
        <div className="wrap hero-preview">
          <div className="preview-toolbar">
            <span>
              <i /> <i /> <i />
            </span>
            <span>Dovo Studio / Workbench</span>
            <span className="preview-live">● Demo workspace</span>
          </div>
          <WorkspaceScreenshot />
          <div className="preview-caption">
            <span>IDEA → AGENT → REVIEW → SHIP</span>
            <span>One workspace. Every step of the build.</span>
          </div>
        </div>
      </div>
      <section className="agent-directory wrap" aria-labelledby="agents-heading">
        <div>
          <p className="eyebrow" id="agents-heading">
            YOUR AGENTS. YOUR CHOICE.
          </p>
          <a className="text-link" href={`${repository}/blob/main/docs/agent-providers.md`}>
            Provider setup <span aria-hidden="true">↗</span>
          </a>
        </div>
        <ul>
          {agentProviders.map((provider) => (
            <li key={provider}>{provider}</li>
          ))}
        </ul>
        <p>
          Install and authenticate providers on your runtime host. Models, tools and permissions
          vary by provider.
        </p>
      </section>
      <section className="workflow-strip wrap" aria-label="From idea to release">
        <a href="#product">
          <span>01 / START</span>
          <strong>Give the work a thread.</strong>
          <p>Choose a project and agent. Keep questions and decisions in context.</p>
        </a>
        <a href="#capabilities">
          <span>02 / BUILD</span>
          <strong>See the result take shape.</strong>
          <p>Inspect the app, test on devices and save useful artifacts.</p>
        </a>
        <a href={`${repository}/blob/main/docs/file-review.md`}>
          <span>03 / REVIEW</span>
          <strong>Decide what ships.</strong>
          <p>Follow related changes, track viewed files and review the final diff.</p>
        </a>
      </section>
      <section className="section wrap" id="features">
        <div className="section-heading">
          <p className="eyebrow">01 / THE WORKSPACE</p>
          <h2>
            All the context.
            <br />
            All the momentum.
          </h2>
          <p>From the first idea to the final diff, keep the context close to the work.</p>
        </div>
        <div className="feature-grid">
          <Card asChild>
            <article className="feature-card">
              <div className="feature-top" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-8l-6 4v-4H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />
                  <path d="m7 9 3 3-3 3m6 0h4" />
                </svg>
                <span>01</span>
              </div>
              <h3>Give your agents direction.</h3>
              <p>
                Run agents against your projects. Follow streamed progress, answer questions and
                review approvals without losing the conversation.
              </p>
              <span className="feature-tag">Agents & threads</span>
            </article>
          </Card>
          <Card asChild>
            <article className="feature-card">
              <div className="feature-top" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="6" cy="5" r="3" />
                  <circle cx="6" cy="19" r="3" />
                  <circle cx="18" cy="5" r="3" />
                  <path d="M6 8v8m12-8a8 8 0 0 1-8 8H6" />
                </svg>
                <span>02</span>
              </div>
              <h3>Own the final diff.</h3>
              <p>
                Review diffs, work with branches and worktrees, browse pull requests and open a real
                terminal on your host.
              </p>
              <span className="feature-tag">Git & terminals</span>
            </article>
          </Card>
          <Card asChild>
            <article className="feature-card">
              <div className="feature-top" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="2" y="9" width="6" height="6" rx="1" />
                  <rect x="16" y="2" width="6" height="6" rx="1" />
                  <rect x="16" y="16" width="6" height="6" rx="1" />
                  <path d="M8 12h4m0 0V5h4m-4 7v7h4" />
                </svg>
                <span>03</span>
              </div>
              <h3>Put busywork on autopilot.</h3>
              <p>
                Build automations with schedules, webhooks and task runs. Keep human review in the
                loop where it matters.
              </p>
              <span className="feature-tag">Jobs & automations</span>
            </article>
          </Card>
        </div>
        <ProductTour />
        <div className="automation-showcase">
          <p className="eyebrow">02 / AUTOMATIONS</p>
          <h3>Build the flow. Keep a human in the loop.</h3>
          <p>Connect schedules, agent tasks and review steps in the actual automation editor.</p>
          <WorkspaceScreenshot automation />
        </div>
      </section>
      <FeatureShowcase />
      <AgentFleet />
      <section className="ownership wrap">
        <div>
          <p className="eyebrow">03 / LOCAL AT THE CORE</p>
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
          <p className="eyebrow">04 / THE DETAILS</p>
          <h2>
            Clear answers.
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
              Yes. Work with Codex, Claude, OpenCode, Cursor, GitHub Copilot, Hermes, Grok Build,
              Muse Code, Mistral Vibe and compatible ACP agents. Capabilities vary by provider.
              Agent credentials stay with your runtime; provider subscriptions and usage are managed
              with your chosen provider.
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
        <p className="eyebrow">YOUR NEXT CHAPTER STARTS HERE</p>
        <h2>
          Big ideas deserve
          <br />
          <span>a better workspace.</span>
        </h2>
        <p>Open your project. Pick your agent. Get to work.</p>
        <Button asChild size="touch">
          <Link href="/download/">
            Download Dovo Studio <span aria-hidden="true">↓</span>
          </Link>
        </Button>
      </section>
    </>
  )
}
