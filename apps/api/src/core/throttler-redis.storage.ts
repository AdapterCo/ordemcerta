import { Injectable } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import { RedisService } from './services';

const SCRIPT = `
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
local blocked = redis.call('PTTL', KEYS[2])
if blocked <= 0 and hits > tonumber(ARGV[2]) and tonumber(ARGV[3]) > 0 then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  blocked = tonumber(ARGV[3])
end
return {hits, ttl, blocked}
`;

/** Rate limit distribuído (várias instâncias da API) por IP/usuário/tenant. */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redis: RedisService) {}

  async increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string) {
    const k = `rl:${throttlerName}:${key}`;
    try {
      const [hits, pttl, blocked] = (await this.redis.client.eval(SCRIPT, 2, k, `${k}:blk`, ttl, limit, blockDuration)) as [number, number, number];
      return {
        totalHits: hits,
        timeToExpire: Math.ceil(Math.max(pttl, 0) / 1000),
        isBlocked: blocked > 0,
        timeToBlockExpire: Math.ceil(Math.max(blocked, 0) / 1000),
      };
    } catch {
      // Redis indisponível: não bloqueia a operação (falha aberta para rate limit; auth tem bloqueio progressivo no banco).
      return { totalHits: 0, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 };
    }
  }
}
