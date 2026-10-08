Bundled JetBrains Mono **NL Nerd Font Mono**, regular and bold, from Nerd Fonts
[v3.4.0](https://github.com/ryanoasis/nerd-fonts/tree/v3.4.0/patched-fonts/JetBrainsMono/NoLigatures).
The Mono variant keeps patched icons within a terminal cell; NL disables ligatures.

Sources: `NoLigatures/Regular/JetBrainsMonoNLNerdFontMono-Regular.ttf` and
`NoLigatures/Bold/JetBrainsMonoNLNerdFontMono-Bold.ttf`. Converted losslessly to WOFF2 with
fonttools 4.61.1 (`TTFont`, `font.flavor = 'woff2'`, `font.save(...)`). No glyphs were removed. Each
face covers 11,756 characters, including the supplementary Nerd Font icon ranges. Original font
metadata and copyright records are retained. The license records also embed the full upstream
license texts so packaged web, desktop and mobile font files carry their notices. See OFL.txt and
NERD-FONTS-LICENSE.txt for upstream licenses.

Desktop/web load these files through the shared stylesheet. The mobile terminal build embeds the
same files as data URLs so the WebView works offline without file permissions or third-party font
requests. No font tooling is needed to build Dovo; the converted files are checked in.
