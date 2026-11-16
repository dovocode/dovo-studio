---
category: Security
clients: desktop, web, mobile, server
---

A sandboxed agent can no longer make Git or a harness on your computer run its code. Dovo stops the
sandbox if the checkout's Git folders change, and its own Git commands there skip hooks and
submodules. Harness settings are read-only in the sandbox, and agent hooks run in the container.
