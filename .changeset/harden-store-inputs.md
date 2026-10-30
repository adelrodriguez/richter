---
"richter": patch
---

Reject periods longer than 2^50 ms, and token buckets that take longer than that to refill completely. A Redis store wrote the state before the expiry failed, so the state never expired. The Redis stores also reject a reply with numbers that no script returns, such as `NaN`, instead of treating it as a success.
