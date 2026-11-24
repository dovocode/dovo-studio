# Open a thread again in Studio for web

Open a thread, then save or copy the address from your browser. Back and Forward return to threads
and workspace sections. Reloading or opening the address in another tab restores the thread on its
owning computer. If that computer is offline and this browser has a saved copy of the thread, Studio
opens the saved copy.

Pair this browser with the owning computer before opening its threads. A thread address contains the
thread ID and a computer identity. Earlier runtimes that do not provide a computer identity use the
browser's saved pairing ID, which works in that browser profile. Links do not contain pairing codes
or device tokens. If a browser is missing the pairing, Studio opens **Devices & runtime** so you can
pair the correct computer. Use thread sharing when you want to grant another person access to a
shared copy.

The browser asks before Back or Forward would discard unsaved settings edits. A saved composer draft
stays with its thread.

When you open a linked thread from a PR, Back returns to the same PR and detail tab in that browser.
The browser history entry keeps the selection with its original computer pairing. If the pairing
changes, Back opens the PR list.

Run `pnpm test:web-workbench-history:browser` to check this flow against two disposable runtimes in
managed Chromium.
