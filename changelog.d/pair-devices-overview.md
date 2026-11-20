---
category: Fixed
clients: server
---

`pnpm pair devices` and the other pairing commands read the runtime overview instead of the full
snapshot, so they no longer download conversation history. They still work with older runtimes.
