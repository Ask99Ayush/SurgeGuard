-- Admit the next visitors in FIFO order, bounded by a token bucket and an optional
-- active-token cap. Fenced by the worker leader lock: a worker that lost the lock
-- cannot admit anyone, even if it still believes it is leader.
-- ARGV: prefix, lock_token, now_ms, rate_per_s, burst, max_active, ttl_ms, jti_1..jti_n
-- Returns: {count, vid_1, joined_at_1, vid_2, joined_at_2, ...} or {-1} (not leader) / {-2} (paused)
local p = ARGV[1]
local lock_token = ARGV[2]
local now = tonumber(ARGV[3])
local rate = tonumber(ARGV[4])
local burst = tonumber(ARGV[5])
local max_active = tonumber(ARGV[6])
local ttl = tonumber(ARGV[7])
local jti_count = #ARGV - 7

if redis.call('GET', p .. ':worker:leader') ~= lock_token then
  return {-1}
end
if redis.call('EXISTS', p .. ':paused') == 1 then
  return {-2}
end

local bucket = redis.call('HMGET', p .. ':bucket', 'tokens', 'ts')
local tokens = tonumber(bucket[1])
local ts = tonumber(bucket[2])
if not tokens or not ts then
  tokens = burst
  ts = now
end
local elapsed = math.max(0, now - ts) / 1000.0
tokens = math.min(burst, tokens + elapsed * rate)

local allowed = math.floor(tokens)
if allowed > jti_count then
  allowed = jti_count
end
if max_active > 0 then
  local active = redis.call('ZCOUNT', p .. ':admitted', '(' .. now, '+inf')
  local room = max_active - active
  if room < allowed then
    allowed = math.max(0, room)
  end
end

local result = {0}
local admitted = 0
while admitted < allowed do
  local popped = redis.call('ZPOPMIN', p .. ':queue')
  if #popped == 0 then
    break
  end
  local vid = popped[1]
  local vkey = p .. ':v:' .. vid
  redis.call('ZREM', p .. ':hb', vid)
  if redis.call('HGET', vkey, 'state') == 'waiting' then
    admitted = admitted + 1
    local jti = ARGV[7 + admitted]
    local exp = now + ttl
    redis.call('HSET', vkey, 'state', 'admitted', 'admitted_at', now, 'jti', jti,
      'exp', exp, 'updated_at', now)
    redis.call('ZADD', p .. ':admitted', exp, vid)
    redis.call('ZADD', p .. ':idx:admitted', now, vid)
    redis.call('ZADD', p .. ':admit_log', now, jti)
    table.insert(result, vid)
    table.insert(result, redis.call('HGET', vkey, 'joined_at') or tostring(now))
  end
end

redis.call('HSET', p .. ':bucket', 'tokens', tostring(tokens - admitted), 'ts', now)
if admitted > 0 then
  redis.call('HINCRBY', p .. ':stats', 'admitted', admitted)
end
redis.call('ZREMRANGEBYSCORE', p .. ':admit_log', '-inf', now - 3600000)
result[1] = admitted
return result
