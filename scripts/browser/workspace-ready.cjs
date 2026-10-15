// Self-contained so Electron/CDP scripts can embed the same predicate in a renderer.
function workspaceReady() {
  return !!document.querySelector('.studio-titlebar-status[data-online="true"]')
}

module.exports = { workspaceReady }
