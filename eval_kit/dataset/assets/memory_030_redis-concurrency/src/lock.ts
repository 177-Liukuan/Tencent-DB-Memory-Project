export async function releaseLock(redis: any, key: string): Promise<void> {
  await redis.del(key);
}
