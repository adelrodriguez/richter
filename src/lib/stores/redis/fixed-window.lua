-- KEYS[1]: state key. ARGV: limit, window size in ms, cost.
-- Returns { success, remaining, reset, now }, with success 1 for an allowed request and 0 for a
-- denial. Reads the clock with TIME, so every instance agrees on window boundaries. Redis 5 and later
-- replicate a script's writes rather than the script, which makes TIME safe to call before a write.
-- The arithmetic matches `transition` in src/lib/transitions/index.ts line for line.

local key = KEYS[1]
local limit = tonumber(ARGV[1])
local size = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])
local time = redis.call("TIME")
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local window = math.floor(now / size)
local reset = (window + 1) * size
local state = redis.call("HMGET", key, "window", "count")
local count = 0

if tonumber(state[1]) == window then
  count = tonumber(state[2]) or 0
end

if count + cost > limit then
  return { 0, limit - count, reset, now }
end

if cost > 0 then
  redis.call("HSET", key, "window", window, "count", count + cost)
  redis.call("PEXPIREAT", key, reset)
end

return { 1, limit - count - cost, reset, now }
