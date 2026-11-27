---
category: Fixed
clients: server
---

Keep fork creation from racing with source archival or deletion. Retry a committed fork after its
source is gone, and keep deleted forks from reappearing.
