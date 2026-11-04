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
local start = window * size
local state = redis.call("HMGET", key, "window", "current", "previous")
local stored = tonumber(state[1])
local current = 0
local previous = 0

if stored == window then
  current = tonumber(state[2]) or 0
  previous = tonumber(state[3]) or 0
elseif stored == window - 1 then
  previous = tonumber(state[2]) or 0
end

local used = math.floor(previous * (size - (now - start)) / size) + current

if used + cost > limit then
  local room = limit - current - cost
  local reset

  if room >= 0 then
    reset = math.min(start + math.floor(size * (previous - room - 1) / previous) + 1, start + size)
  else
    local nextRoom = limit - cost
    reset = math.min(start + size + math.floor(size * (current - nextRoom - 1) / current) + 1, start + 2 * size)
  end

  return { 0, math.max(0, limit - used), reset, now }
end

if cost > 0 then
  redis.call("HSET", key, "window", window, "current", current + cost, "previous", previous)
  redis.call("PEXPIREAT", key, start + 2 * size)
end

return { 1, limit - used - cost, start + size, now }
