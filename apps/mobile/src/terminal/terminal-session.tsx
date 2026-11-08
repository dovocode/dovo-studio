// Web (and type-checking) entry. iOS and Android resolve terminal-session.native.tsx, which
// renders libghostty natively and falls back to this WebView renderer only when needed.
export { WebViewTerminalSession as TerminalSession } from './webview-terminal-session'
