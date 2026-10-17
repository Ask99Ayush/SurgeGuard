-- Leader lock: acquire if free, renew if we already hold it.
-- KEYS[1]: lock key. ARGV: token, ttl_ms
-- Returns 1 if the caller holds the lock afterwards, else 0.
local current = redis.call('GET', KEYS[1])
if current == false then
  redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
  return 1
end
if current == ARGV[1] then
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
  return 1
end
return 0
