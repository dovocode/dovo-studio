# Dovo Studio app icon

A pearl glass D with a terminal/play-shaped counter on charcoal. The full-bleed variant is used for
iOS; the transparent squircle variant is used for macOS. Both were generated using the built-in
image generation tool, then resized into platform assets with `sips`/`iconutil`.

Regenerate export sizes on macOS with `node scripts/generate-app-icons.mjs`. Source PNGs stay here;
exported assets are committed so builds do not require image generation or macOS export tools.

Generation prompt:

> Create a production app icon for Dovo Studio, a premium developer workspace for coding agents,
> threads, devices and pull requests. Single square image, full-bleed opaque charcoal-black
> background. Center one bold geometric capital D symbol built from a continuous softly rounded
> substantial ribbon, with a precise negative-space triangular play/terminal-like notch in its inner
> counter. Pearl-white frosted glass with restrained ice-blue edge reflection; subtle depth and soft
> lighting, simple silhouette legible at 24px. Mark occupies about 62 percent of the canvas.
> Centered front-facing orthographic composition. No wordmark, objects, border, mockup, decorative
> sparkles or additional concepts.

macOS adaptation prompt:

> Preserve the pearl glass D mark, lighting and proportions. Put the charcoal background inside a
> rounded macOS app-icon squircle occupying 90 percent of the canvas, with a subtle rim and soft
> shadow, and a genuinely transparent outer margin. Centered front view; no new symbols or text.
