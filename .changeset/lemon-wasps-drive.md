---
"richter": patch
---

`buildLimiter` now rejects a `timeout` that is not a positive integer as soon as you call it. Before, it threw only when a limiter used that timeout, so a factory whose limiters all set their own `timeout` accepted any value.
