/** Hosted chrome only; message primitives and markdown styles are shared with Studio. */
export const sharedThreadStyles = `
.shared-conversation{max-width:860px;margin:auto;padding:24px}
.sharing-empty{max-width:560px;margin:64px auto;display:grid;gap:20px}
.sharing-meta{font-size:11px;color:var(--muted-foreground);padding:12px 24px}
.shared-thread-shell{height:100dvh;display:flex;flex-direction:column;overflow:hidden}
.shared-thread-shell .site-header{min-height:56px}
.shared-thread-workspace{display:flex;flex:1;flex-direction:column;min-height:0}
.shared-thread-workspace>[role="log"]{min-width:0;isolation:isolate}
.sharing-message-text{font-size:14px}
.sharing-message-text p{color:inherit;line-height:inherit}
.sharing-message-text :is(ul,ol){list-style:revert}
.sharing-message-text pre{margin:0;padding:12px;max-height:400px;overflow:auto}
.sharing-message-text pre code{white-space:pre;overflow-wrap:normal}
.sharing-message-text [data-streamdown="code-block-header"]{grid-column:1/-1;display:flex;align-items:center;color:var(--muted-foreground)}
.sharing-table{overflow:auto!important;max-height:400px}
.sharing-table table{width:100%;border-collapse:collapse}
.sharing-message-time{opacity:0;transition:opacity .15s}
.group\\/message:hover .sharing-message-time,.group\\/message:focus-within .sharing-message-time{opacity:1}
.sharing-suggestion{flex-shrink:0;padding:12px 16px max(12px,env(safe-area-inset-bottom));border-top:1px solid var(--line);background:var(--bg)}
.sharing-composer{max-width:44rem;margin:auto;display:grid;gap:6px}
.sharing-composer h2{font-size:12px;font-weight:500;line-height:1.4;letter-spacing:0}
.sharing-composer-hint{font-size:11px;line-height:1.5}
.sharing-composer form{display:grid;gap:8px;border:1px solid var(--line);background:var(--panel);border-radius:12px;padding:10px}
.sharing-composer textarea{min-height:48px;max-height:25dvh;resize:vertical;border:0;background:transparent;box-shadow:none;padding:0;font-size:14px}
.sharing-composer-actions{display:flex;align-items:center;justify-content:space-between;gap:8px}
.sharing-name{min-width:0;max-width:240px;flex:1}
.sharing-name input{height:28px;min-height:28px;border:0;box-shadow:none;background:transparent;font-size:12px;padding:0}
.sharing-composer .sharing-meta{padding:0;font-size:10px}
@media(hover:none){.sharing-message-time{opacity:1}}
@media(max-width:640px){
  .shared-conversation{padding:16px}.sharing-empty{margin:32px 0}
  .shared-thread-shell .brand{font-size:16px;gap:6px}
  .shared-thread-shell .brand-divider,.shared-thread-shell .brand-product{display:none}
  .shared-thread-shell .artifact-title{order:initial;flex-basis:auto;padding:0;gap:8px}
  .shared-thread-shell .artifact-title h1{font-size:13px;flex:1}
  .shared-thread-shell .sharing-encryption{font-size:10px;padding:3px 6px}
  .sharing-suggestion{padding-top:8px}.sharing-composer-hint{display:none}
}
`
