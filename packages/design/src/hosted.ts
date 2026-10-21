import { tokenStyles } from './tokens.js'

/** Trusted service chrome only. Never inject into a publisher's sandboxed artifact.
 * Controls are rendered by @dovo/web-ui, which also owns their utility CSS. */
export const hostedStyles = `${tokenStyles}
:root{color-scheme:dark;--bg:var(--dovo-background);--panel:var(--dovo-card);--surface:var(--dovo-card);--text:var(--dovo-foreground);--muted:var(--dovo-muted-foreground);--line:var(--dovo-border);--accent:var(--dovo-primary);font-family:var(--dovo-font-sans);font-size:16px;line-height:1.6;font-synthesis:none;-webkit-font-smoothing:antialiased}
:root[data-theme="light"]{color-scheme:light}
body{margin:0;background:var(--bg);color:var(--text)}a:not([data-slot="button"]){color:var(--dovo-primary);text-underline-offset:4px}a:not([data-slot="button"]):hover{text-decoration:underline}p{color:var(--dovo-muted-foreground);line-height:1.6;overflow-wrap:anywhere}h1,h2,h3{line-height:1.2;letter-spacing:-.025em;font-weight:600;overflow-wrap:anywhere}.muted,.meta,small{color:var(--dovo-muted-foreground);font-size:13px}code{font-family:var(--dovo-font-mono);overflow-wrap:anywhere}label{font-weight:500}hr{border:0;border-top:1px solid var(--line);margin:20px 0}button,input,a,textarea,select{-webkit-tap-highlight-color:transparent}@media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;animation:none!important;transition:none!important}}
`
