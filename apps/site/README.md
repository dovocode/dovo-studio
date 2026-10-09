# Dovo Studio brand site

The public product website, separate from the runtime-connected application in `apps/web`. Built
with Next.js 16.4 App Router and exported as static HTML. No runtime, credentials or external API
calls are needed to build or serve it.

From the repository root:

```sh
pnpm dev:site
pnpm --filter @dovo/site typecheck
pnpm --filter @dovo/site build
pnpm test:site:browser
```

Development runs on http://localhost:3001. Deploy `apps/site/out` to any static host after building.
The host should serve directory indexes and `404.html` for missing routes. The site assumes it is
served from the domain root.

Routes: `/`, `/download/`, `/docs/`. Download links use the latest stable GitHub release rather than
hardcoding versioned asset filenames. The Nightly channel loads the newest published nightly from
the public GitHub releases API in the browser, with a link to browse releases if lookup fails. The
iPhone app is marked work in progress and Android is marked coming soon. The iPhone guide describes
local builds, not an App Store release. Detailed guides link to the repository documentation so
there is one maintained full manual. The homepage uses real screenshots of the production workbench
with an isolated demo runtime. The site uses the same graphite, pearl-white and ice-blue palette as
the app, with bold typography, actual product screenshots, an interactive product tour and
expandable FAQs. Entrance and scroll animations respect reduced-motion preferences; all content
remains available without JavaScript.

The homepage WebGL fleet animation grows from 1 to 4 to 16 to 64 to 256 possible agents, with
luminous runtime constellations, traveling delegation signals and pointer-driven depth. The final
coming-soon stage puts Do above the fleet as its coordinating agent. Cross-runtime orchestration and
Do remain clearly marked coming soon. Playback starts in view, pauses offscreen or in hidden tabs,
and stops after one cycle; pause, replay and stage selection remain available. Reduced motion
renders a static scene. Pixel density is capped for mobile, and frames stop when paused. The entire
flow fits on phone screens. If WebGL is unavailable or its context is lost, the existing HTML/SVG
visualization remains available; restored contexts rebuild the GPU scene. No new dependencies or
external assets are required.

Stable and Nightly Linux setup commands are shown directly on the homepage, downloads and docs,
including service installation, pairing, and the separate Nightly launcher name. Commands use the
maintained `scripts/install-linux-server.sh`; HTTP LAN/VPN access and device pairing stay supported.

To refresh the committed screenshots after changing the app:

```sh
pnpm --filter @dovo/desktop... --filter @dovo/api... -r build
node scripts/capture-site-screenshots.mjs
```

The capture script starts a temporary runtime, seeds a demo project and uses the actual compiled
workbench. It cleans up that runtime and does not connect to your personal workspace.

Brand assets come from the existing shared Dovo logo. Canonical URLs, sitemap and robots metadata
use `https://dovo.studio`.
