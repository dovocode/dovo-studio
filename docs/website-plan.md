# Dovo Studio: brand and documentation website plan

Planning baseline: 19 September 2026. Proposed launch path for the public website.

## Direction

Build one public website with two distinct experiences: a focused product story at `/`, and
practical, searchable documentation at `/docs`. Use one domain and deployment initially; keep the
authenticated web workbench in `apps/web` separate.

The primary audience is developers running coding agents against their own repositories, especially
independent developers and technical leads moving between a workstation and phone. The second
audience is the person operating that runtime and recovering connections or updating adapters.

Proposed positioning: **Keep coding agents and code review in one workspace.** Supporting copy: “Run
tasks on your own computers. Follow work, review changes, and respond from desktop, web, or phone.”
Show that workflow with actual product captures before introducing individual features.

Ground the story in the current implementation: host-owned execution and SQLite storage; Codex,
Claude, OpenCode and ACP adapters; tasks, approvals, queues and turn diffs; GitHub PR review; host
terminals; saved computers; and automation runs with review gates and retry. Describe provider/model
capabilities as conditional. A local runtime can call external model providers; “all data stays on
your device” would be inaccurate.

The [README](../README.md), [server guide](server-setup.md), [automation guide](automations.md), and
[Codex settings guide](codex-modes.md) are the starting content inventory. Current limits belong
beside their features: no cloud relay, runtime availability required for execution, read-only
checkpoint diffs, mobile editing limited to ordered automations, and platform-specific native
support.

## Jobs and navigation

| Experience | Reader's job                                    | First navigation                              | Successful next step                            |
| ---------- | ----------------------------------------------- | --------------------------------------------- | ----------------------------------------------- |
| Brand      | Understand Dovo, see its usefulness, assess fit | Product, Docs, Releases, Get started          | Choose a verified installation/setup path       |
| Docs       | Complete a task or solve a problem              | Search, grouped guides, current page contents | Reach a working state and know how to verify it |

Brand pages:

- `/`: concise headline, desktop + phone product image, and three workflow sections: start a task;
  review work and respond; continue on another computer or phone. Follow with a small architecture
  diagram, prerequisites/availability, and a short FAQ. Primary CTA: **Get started** → docs
  quickstart; secondary CTA: **See the workflow** → the first product section.
- `/releases`: dated, product-facing changes with platform/runtime requirements and links to the
  matching update instructions. Publish entries only for identified releases.
- `/about`: Dominic's product intent, who Dovo is for, and the confirmed support/contact route.
- `/privacy` and applicable legal/license information: publish reviewed facts about the website and
  product separately. Add a downloads page only when actual distribution channels are ready.

Docs navigation:

| Group              | Pages and questions to answer                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Start              | Overview and architecture; installation/platform matrix; first task; pair a phone or browser                                          |
| Work               | Projects and checkouts; task/chat controls; permissions and approvals; turn diffs; terminal; PR review                                |
| Agents and tools   | Harness setup and authentication; model/reasoning/speed/Daybreak; custom agents; project/agent MCP and skills                         |
| Automate           | First automation; schedules/webhooks; progress and review gates; retry/recovery; mobile editing limits                                |
| Run and connect    | Existing desktop workspace vs fresh server; CLI lifecycle; LAN/VPN/HTTPS; multiple computers; cache/offline behavior; updates/backups |
| Reference and help | CLI/environment reference; compatibility/limits; pairing/offline troubleshooting; provider errors; development/contributing           |

The quickstart offers two explicit paths: **Use this computer** and **Connect to an existing
runtime**. Each ends with a test task and a clear expected result. Keep the current
`server-setup.md` entry URL working when splitting that long guide. Server migration must retain the
existing data-directory warning; do not accidentally teach users to create a second empty workspace.

## Visual and interaction direction

Use the product's quiet native character: ink/graphite surfaces, restrained blue accent, readable
system typography, thin separators and deliberate spacing. Support light and dark reading themes.
Reserve translucency for a small navigation surface; keep documentation text on opaque backgrounds.

The homepage is screenshot-led with generous space and short paragraphs. Use captures from a
verified build with intentional fixture content, visible device context and clean empty/error
states. Avoid decorative terminal walls, invented testimonials and performance claims. Motion should
clarify one interaction, respect reduced motion and never block reading.

Docs use a compact sidebar, a 65–75-character reading column and an optional desktop contents rail.
On phones, navigation and search open independently; tables and code scroll inside their own bounds.
Headings have stable anchors; commands have copy controls and their required host/platform nearby.
Use 44-point mobile controls, visible keyboard focus, adequate contrast, and text that survives
zoom. Keep statuses and warnings meaningful through labels as well as color.

## Implementation path

Create `apps/site` for the website implementation. Reuse the workspace's pinned pnpm, React,
TypeScript, TanStack Start, Vite+ and Tailwind tooling. The existing web app already uses this
stack; a second framework or CMS is unnecessary for the initial content size.

Prerender the public routes to static HTML. Enumerate all docs paths from a typed content manifest
and fail the build on missing pages; verify this against the repository's installed Start version
before committing the route layout. TanStack documents static prerendering and explicit page lists,
and the installed package exposes the relevant options.
([TanStack prerendering](https://tanstack.com/start/latest/docs/framework/react/guide/static-prerendering))

Keep canonical guide text in `docs/`, with an explicit publish manifest containing slug, title,
description and section order. Publish only listed files, excluding internal plans such as this one.
Reuse the existing Streamdown/GFM stack in static mode for prose, code, tables and safe links; add
only a small site wrapper, without importing the workbench or runtime providers. Reuse Markdown
policies and color values rather than extracting a new design-system package for two layouts.
([Streamdown static mode](https://streamdown.ai/docs/usage))

Add Pagefind as a pinned build dependency for documentation search. It indexes generated HTML and
ships a static browser search bundle, so search needs no runtime service. Index article content,
exclude repeated navigation, and load search on demand. Test symptom queries such as “pairing waits
for approval,” “phone offline,” and “update Codex.” ([Pagefind setup](https://pagefind.app/docs/))

Build order: validate content/routes → prerender → generate search index → check links/assets →
publish static output to the existing hosting account/CDN selected for the domain. Keep PR previews
out of search indexing. Production needs correct canonical URLs, social previews, sitemap, real
404s, redirects and HTTPS. No product credentials, pairing flow or runtime connection belongs in the
public site's build or browser bundle. Essential content and links must work before hydration.

Give the site its own CI target and preview artifact. Verify a filtered workspace install/build on a
clean host, including the root postinstall scripts; publishing documentation must not require Xcode,
an agent login, a live runtime or building the native applications.

## Content ownership and maintenance

- **Dominic:** positioning, visual approval, distribution/pricing/license decisions and release
  copy.
- **Feature author:** update the relevant guide in the same PR as behavior changes; verify command
  examples, platform caveats and screenshots against that change.
- **Release owner:** validate quickstarts on a clean workspace, publish the compatibility matrix,
  identify the source revision and confirm download/update destinations.

Migrate detailed user instructions out of the growing README into the docs navigation, retaining a
short repository overview, developer commands and links. Keep each procedure authoritative in one
file; the website renders it directly. Use a small metadata manifest rather than duplicating text.

Start with one documented supported version, showing its release or commit and review date. Preserve
release notes and Git history; add a version selector only when multiple versions are actively
supported. Provider model catalogs remain live product data, not a hardcoded marketing list. Show
compatibility notes where runtime and native app updates must happen together.

## Delivery phases and acceptance

| Phase                     | Deliverable                                                                                           | Acceptance                                                                                                                                                                                 |
| ------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Content and shape      | Route inventory; availability/claims audit; homepage and quickstart designs at phone + desktop widths | A new reader understands host vs client, chooses a setup path, and sees honest availability; domain/release assumptions are recorded                                                       |
| 2. Useful docs            | Static docs shell, search, quickstarts, server/connection recovery and migrated existing guides       | Fresh setup and existing-workspace connection both verified; search finds core symptoms; commands, anchors and redirects checked                                                           |
| 3. Brand and completeness | Homepage, about/release pages, reviewed legal content, remaining workflow guides, product captures    | Every feature claim has current evidence; every CTA has a working destination; no unavailable download or app-store claims                                                                 |
| 4. Launch                 | Preview review, accessibility/performance checks, production domain and deployment                    | Keyboard and VoiceOver flows pass; 320px viewport and 200% zoom have no page overflow; Markdown is readable; static HTML and deep links work; rollback to previous site artifact is tested |

Use the existing test/check commands for the site package and add focused route/link/search smoke
checks. Aim for mobile Lighthouse scores of at least 90 for performance and accessibility, with
manual keyboard/VoiceOver checks as a separate requirement. Set the initial compressed JavaScript
budget at 200 KB for a normal article, excluding lazy search and code highlighting; measure before
expanding the component stack. Visual review covers the homepage, long guide, troubleshooting page
and search.

## Assumptions to settle before publishing

- **Domain and hosting:** one public origin with `/docs` is recommended; no domain/account is
  assumed.
- **Distribution:** current packaging documents unsigned macOS Apple Silicon artifacts. iOS has a
  native build workflow; public App Store/TestFlight availability is unverified. Treat Windows/Linux
  desktop and Android distribution as unverified until tested and published.
- **Business and licensing:** no pricing, public source availability or open-source license is
  assumed. The packaging script currently declares `UNLICENSED`; confirm the intended offer before
  adding pricing, public repository or contribution CTAs.
- **Content scope:** English first, personal developer workflow first, with no claims of team access
  control, hosted execution, an extension marketplace or automatic checkpoint restore.
- **Analytics/support:** launch without new tracking or a support promise; add either only after its
  purpose, provider, contact route and privacy wording are agreed.

This plan requires no product API changes.
