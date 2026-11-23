---
category: Fixed
clients: server
---

The server accepts a thread handoff retry once cancellation finishes checking the destination and
settling source ownership. Concurrent cancellation requests share the same check.
