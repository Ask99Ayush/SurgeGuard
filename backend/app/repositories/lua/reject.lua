-- Admin action: reject a waiting or admitted visitor. Admitted visitors also get their
-- token revoked. Any other state is an invalid transition.
-- ARGV: prefix, visitor_id, now_ms, reason
-- Returns: {'ok', previous_state, jti, revoke_ttl_s} or {'invalid', current_state}
local p = ARGV[1]
local vid = ARGV[2]
local now = tonumber(ARGV[3])
local reason = ARGV[4]
local vkey = p .. ':v:' .. vid

local state = redis.call('HGET', vkey, 'state')
if state ~= 'waiting' and state ~= 'admitted' then
  return {'invalid', state or 'unknown'}
end

local jti = ''
local revoke_ttl = 0
if state == 'waiting' then
  redis.call('ZREM', p .. ':queue', vid)
  redis.call('ZREM', p .. ':hb', vid)
else
  jti = redis.call('HGET', vkey, 'jti') or ''
  local exp = tonumber(redis.call('HGET', vkey, 'exp') or now)
  revoke_ttl = math.max(1, math.ceil((exp - now) / 1000) + 1)
  if jti ~= '' then
    redis.call('SET', p .. ':revoked:' .. jti, '1', 'EX', revoke_ttl)
  end
  redis.call('ZREM', p .. ':admitted', vid)
  redis.call('ZREM', p .. ':idx:admitted', vid)
end

redis.call('HSET', vkey, 'state', 'rejected', 'rejected_at', now, 'reject_reason', reason,
  'updated_at', now)
redis.call('ZADD', p .. ':idx:rejected', now, vid)
redis.call('HINCRBY', p .. ':stats', 'rejected', 1)
return {'ok', state, jti, tostring(revoke_ttl)}
