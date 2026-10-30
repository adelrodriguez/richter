---
"richter": patch
---

Make `rateLimit` and the memory store faster. A limiter now times out its store calls with one shared timer, a key skips escaping when its identity has nothing to escape, and the memory store reads the clock once for each call.
