-- Read a visitor's status. For waiting visitors this is also the heartbeat.
-- ARGV: prefix, visitor_id, now_ms
-- Returns: {state, seq, rank, queue_len, jti, admitted_at, exp, joined_at}
local p = ARGV[1]
local vid = ARGV[2]
local now = tonumber(ARGV[3])
local vkey = p .. ':v:' .. vid

local state = redis.call('HGET', vkey, 'state')
if not state then
  return {'unknown'}
end

local rank = -1
if state == 'waiting' then
  local r = redis.call('ZRANK', p .. ':queue', vid)
  if r then
    rank = r
    redis.call('HSET', vkey, 'last_seen', now)
    redis.call('ZADD', p .. ':hb', now, vid)
  end
end

local h = redis.call('HMGET', vkey, 'seq', 'jti', 'admitted_at', 'exp', 'joined_at')
return {
  state,
  h[1] or '',
  tostring(rank),
  tostring(redis.call('ZCARD', p .. ':queue')),
  h[2] or '',
  h[3] or '',
  h[4] or '',
  h[5] or '',
}
