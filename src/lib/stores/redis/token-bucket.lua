-- KEYS[1]: state key. ARGV: refill rate, interval in ms, capacity, cost.
-- Returns { success, remaining, reset, now }, with success 1 for an allowed request and 0 for a
-- denial. Reads the clock with TIME, so every instance agrees on window boundaries. Redis 5 and later
-- replicate a script's writes rather than the script, which makes TIME safe to call before a write.
-- The arithmetic matches `transition` in src/lib/transitions/index.ts line for line.

local key = KEYS[1]
local refillRate = tonumber(ARGV[1])
local interval = tonumber(ARGV[2])
local capacity = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])
local time = redis.call("TIME")
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local state = redis.call("HMGET", key, "tokens", "refilledAt")
local storedTokens = tonumber(state[1])
local storedAt = tonumber(state[2])
local tokens = capacity
local refilledAt = now

if storedTokens and storedAt then
  local refills = math.max(0, math.floor((now - storedAt) / interval))
  tokens = math.min(capacity, storedTokens + refills * refillRate)
  refilledAt = storedAt + refills * interval
end

if tokens < cost then
  return { 0, tokens, refilledAt + math.ceil((cost - tokens) / refillRate) * interval, now }
end

local remaining = tokens - cost

if cost > 0 then
  redis.call("HSET", key, "tokens", remaining, "refilledAt", refilledAt)
  redis.call("PEXPIREAT", key, refilledAt + math.ceil((capacity - remaining) / refillRate) * interval)
end

return { 1, remaining, refilledAt + interval, now }
