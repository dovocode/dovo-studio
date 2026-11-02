# Native terminal fonts

`JetBrainsMonoNLNerdFontMono-{Regular,Bold}.ttf` are lossless TrueType conversions of
`packages/studio-ui/src/assets/fonts/jetbrains-mono-nerd-{regular,bold}.woff2`, the files the
WebView terminal embeds for the "JetBrains Mono Nerd Font" preference. Android's `Typeface` cannot
load WOFF2, so the native libghostty renderer needs TTF files. Licenses: `OFL.txt` and
`NERD-FONTS-LICENSE.txt` (copied unchanged; the font names are not modified).

Regenerate with fontTools + brotli:

```sh
python3 -m venv /tmp/fonttools && /tmp/fonttools/bin/pip install fonttools brotli
/tmp/fonttools/bin/python -I -c "
from fontTools.ttLib import TTFont
for w, s in (('regular', 'Regular'), ('bold', 'Bold')):
    f = TTFont(f'packages/studio-ui/src/assets/fonts/jetbrains-mono-nerd-{w}.woff2'); f.flavor = None
    f.save(f'packages/terminal/src/native/fonts/JetBrainsMonoNLNerdFontMono-{s}.ttf')"
```

The expo-font config plugin registers them (UIAppFonts on iOS, `assets/fonts/` on Android).
`../terminal-font.ts` maps the preference to the CoreText family (`JetBrainsMonoNL Nerd Font Mono`)
or Android asset stem (`JetBrainsMonoNLNerdFontMono`) passed through the `fontFamily` prop from
`patches/expo-libghostty@0.8.1.patch` (repo root).
