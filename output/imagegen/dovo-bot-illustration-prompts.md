# Bot illustrations

Generated with `gpt-image-2.6` through the installed `cliproxy-imagegen` skill on 2026-11-13. Both
requests used `1024x1024` and high quality. Both returned `1254x1254` images. These are separate
image deliverables. They are not imported into the app. The dark output had transparency; it was
composited onto `#151719` with Pillow for a clean dark background. The raw output is kept at
`.output/imagegen/dovo-bot-dark-raw.png`.

## Light

[Light Bot](dovo-bot-light.png)

Exact prompt:

> Create one refined Bot character illustration for Dovo Studio, a professional assistant app. This
> is ONLY a bot illustration, NOT a UI mockup, NO app screen, NO interface controls, NO typography,
> NO letters. A small friendly sculptural desktop robot with a softly rounded off-white ceramic
> body, rounded rectangular head, dark charcoal faceplate, two simple calm expressive eyes, tiny
> understated forest-teal detail. Mature premium product illustration, tactile matte ceramic,
> precise soft 3D rendering, restrained friendly personality rather than a toy or cartoon. The robot
> is the clear main subject, centered in a square composition, fully visible, subtle soft shadow,
> plenty of quiet negative space. An understated thin orbit with two very small abstract rounded
> pieces can suggest memory and ongoing work, but keep the scene minimal and uncluttered. LIGHT MODE
> version: seamless warm off-white background #F7F7F5, daylight studio lighting, warm neutral cream
> surfaces, soft natural ambient occlusion. No gradients as graphics, no neon, no glow, no glitter,
> no human, no watermark. This must work as a tasteful compact illustration inside both a desktop
> and mobile Bot creation form.

## Dark

[Dark Bot](dovo-bot-dark.png)

Exact prompt:

> Create one refined Bot character illustration for Dovo Studio, a professional assistant app. This
> is ONLY a bot illustration, NOT a UI mockup, NO app screen, NO interface controls, NO typography,
> NO letters. DARK MODE. Center a small friendly sculptural desktop robot, fully visible, on a
> seamless deep warm charcoal background #151719. Match this precise character design: a large
> gently tilted rounded rectangular head with softly rounded corners, a recessed dark charcoal
> faceplate, two simple friendly upward-curved ivory closed-eye smiles, small round desaturated
> forest-teal discs on the sides of the head. A short narrow neck joins a small pear-shaped matte
> graphite ceramic body with simple small rounded arms at its sides, no separate visible legs, a
> tiny horizontal muted teal pill on its chest. The head is about the same width as the body at its
> widest. A single very thin elliptical orbit crosses around the Bot waist, with exactly two small
> rounded square ceramic pieces on it: one little stacked-tile symbol at upper left, one checkmark
> tile at lower right. Keep these pieces small and secondary. The robot is the clear main subject in
> a square composition with plenty of quiet negative space. Tactile fine matte ceramic, premium
> precise soft 3D studio rendering, mature calm friendly personality rather than a toy or cartoon.
> Dark graphite body with soft neutral edge highlights so its shape reads clearly, dark faceplate,
> quiet ivory eyes, charcoal and muted teal orbit pieces. Gentle studio key light, faint natural rim
> light, realistic grounded soft shadow. No neon, no bright glow, no stars, no gradients as
> graphics, no glitter, no human, no watermark. This is the dark companion to a warm off-white
> ceramic Bot with the same face and orbit. Keep it tasteful as a compact illustration for both
> desktop and mobile.

The image-edit endpoint rejected the first dark-mode edit with HTTP 401. The dark image was
generated with the same model and a detailed description of the light character. It is a companion
illustration, not an exact recolor.
