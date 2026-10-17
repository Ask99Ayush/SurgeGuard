-- Cleanup: expire waiting visitors whose heartbeat stopped and admitted visitors whose
-- token lifetime ended. Safe to run repeatedly and concurrently.
-- ARGV: prefix, now_ms, heartbeat_timeout_ms, limit, terminal_index_size
-- Returns: {expired_heartbeat, expired_token}
local p = ARGV[1]
local now = tonumber(ARGV[2])
local timeout = tonumber(ARGV[3])
local limit = tonumber(ARGV[4])
local keep = tonumber(ARGV[5])

local hb_count = 0
local stale = redis.call('ZRANGEBYSCORE', p .. ':hb', '-inf', now - timeout, 'LIMIT', 0, limit)
for _, vid in ipairs(stale) do
  local vkey = p .. ':v:' .. vid
  redis.call('ZREM', p .. ':hb', vid)
  if redis.call('HGET', vkey, 'state') == 'waiting' then
    redis.call('ZREM', p .. ':queue', vid)
    redis.call('HSET', vkey, 'state', 'expired', 'expired_reason', 'heartbeat',
      'expired_at', now, 'updated_at', now)
    redis.call('ZADD', p .. ':idx:expired', now, vid)
    hb_count = hb_count + 1
  end
end

local tok_count = 0
local done = redis.call('ZRANGEBYSCORE', p .. ':admitted', '-inf', now, 'LIMIT', 0, limit)
for _, vid in ipairs(done) do
  local vkey = p .. ':v:' .. vid
  redis.call('ZREM', p .. ':admitted', vid)
  redis.call('ZREM', p .. ':idx:admitted', vid)
  if redis.call('HGET', vkey, 'state') == 'admitted' then
    redis.call('HSET', vkey, 'state', 'expired', 'expired_reason', 'token_expired',
      'expired_at', now, 'updated_at', now)
    redis.call('ZADD', p .. ':idx:expired', now, vid)
    tok_count = tok_count + 1
  end
end

if hb_count + tok_count > 0 then
  redis.call('HINCRBY', p .. ':stats', 'expired', hb_count + tok_count)
end
redis.call('ZREMRANGEBYRANK', p .. ':idx:expired', 0, -(keep + 1))
redis.call('ZREMRANGEBYRANK', p .. ':idx:rejected', 0, -(keep + 1))
return {hb_count, tok_count}
