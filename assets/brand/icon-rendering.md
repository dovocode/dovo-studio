# App icon renders

The built-in imagegen tool edited the existing Dovo mark. The original sources remain unchanged; the
icon exporter now reads `dovo-icon-v2.png` and `dovo-mac-icon-v2.png`.

Mobile source: `assets/brand/dovo-icon-v2.png`. Desktop source: `assets/brand/dovo-mac-icon-v2.png`.
Exported assets are `apps/mobile/assets/icon.png`, `apps/desktop/build/icon.png`, and
`apps/desktop/build/icon.icns`.

## Mobile prompt

Polish this existing Dovo Studio app icon. Preserve the distinctive rounded folded D shape and
triangular negative space, silver-white metal with subtle icy blue accents, upright orientation.
Render with cleaner elegant satin surfaces, less glare and balanced highlights, precise silhouette,
high legibility at small size. Center the D occupying 70 percent width and height on a perfectly
uniform very dark charcoal full-bleed square background. No vignette, no external rounded-square
tile, no text, no symbols added. Production 1024x1024 iOS and Android app icon; OS applies the
corner mask.

## Desktop prompt

Edit the existing Dovo Studio macOS app icon into a cleaner, more refined modern macOS icon.
Preserve the silver-white folded rounded D mark with the triangular cutout, its upright orientation,
and the square centered layout. Replace the overly shiny thick double chrome border and puffy glossy
frame with a single smooth matte charcoal rounded-square tile with a restrained soft edge highlight
and subtle shadow. Make the D slightly larger and more clearly legible, retaining delicate icy blue
edge reflections, soft satin shading and precise edges. Fully transparent background outside the
rounded-square tile, with generous even transparent optical margins of 10 percent. No extra borders,
no text, no watermark. Production macOS Dock icon, 1024 by 1024.

`node scripts/generate-app-icons.mjs` exports 1024px PNGs and macOS ICNS sizes from the retained
high-resolution renders. Mobile PNGs are opaque; desktop PNGs preserve transparency.
