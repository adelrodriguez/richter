---
"richter": patch
---

The denial cache of each limiter now holds at most 10,000 denials and forgets the oldest first, so callers who choose many identities cannot grow it without a limit. The memory store and the denial cache also remove expired entries when they are only read.
