-- Join (or resume) the queue. Idempotent for the same visitor id.
-- ARGV: prefix, visitor_id, now_ms, grace_ms, max_size, record_ttl_s
-- Returns: {state, seq, mode}  mode in new|existing|resumed|rejoined|none
local p = ARGV[1]
local vid = ARGV[2]
local now = tonumber(ARGV[3])
local grace = tonumber(ARGV[4])
local max_size = tonumber(ARGV[5])
local ttl = tonumber(ARGV[6])
local vkey = p .. ':v:' .. vid

local state = redis.call('HGET', vkey, 'state')
if state == 'waiting' then
  redis.call('HSET', vkey, 'last_seen', now)
  redis.call('ZADD', p .. ':hb', now, vid)
  return {'waiting', redis.call('HGET', vkey, 'seq'), 'existing'}
end
if state == 'admitted' or state == 'rejected' then
  return {state, redis.call('HGET', vkey, 'seq'), 'existing'}
end

if redis.call('ZCARD', p .. ':queue') >= max_size then
  return {'full', '0', 'none'}
end

local seq = nil
local mode = 'new'
local joined = now
if state == 'expired' then
  mode = 'rejoined'
  local reason = redis.call('HGET', vkey, 'expired_reason')
  local expired_at = tonumber(redis.call('HGET', vkey, 'expired_at') or '0')
  if reason == 'heartbeat' and (now - expired_at) <= grace then
    -- Within the grace window the visitor keeps their original place in line.
    seq = tonumber(redis.call('HGET', vkey, 'seq'))
    joined = tonumber(redis.call('HGET', vkey, 'joined_at') or now)
    mode = 'resumed'
  end
  redis.call('ZREM', p .. ':idx:expired', vid)
end
if not seq then
  seq = redis.call('INCR', p .. ':seq')
end

redis.call('DEL', vkey)
redis.call('HSET', vkey, 'state', 'waiting', 'seq', seq, 'joined_at', joined,
  'last_seen', now, 'updated_at', now)
redis.call('EXPIRE', vkey, ttl)
redis.call('ZADD', p .. ':queue', seq, vid)
redis.call('ZADD', p .. ':hb', now, vid)
redis.call('HINCRBY', p .. ':stats', 'joined', 1)
return {'waiting', tostring(seq), mode}
