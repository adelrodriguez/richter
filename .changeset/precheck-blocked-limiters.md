---
"richter": minor
---

`rateLimit` with several limiters now checks every limiter's remembered denials before any limiter spends. When a later limiter is blocked in this process, the request is denied without a store call, and earlier limiters spend nothing.
