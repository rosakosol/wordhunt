import { Redis } from "@upstash/redis";

/**
 * Upstash REST client. Supports standard Upstash names and Vercel KV-style env names.
 */
export function getRedis() {
  const url = (
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.KV_REST_API_URL ||
    ""
  ).trim();
  const token = (
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.KV_REST_API_TOKEN ||
    ""
  ).trim();
  if (!url || !token) return null;
  return new Redis({ url, token });
}
