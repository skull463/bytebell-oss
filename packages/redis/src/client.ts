import { Redis } from "ioredis";
import { getConfigValue } from "@bb/config";
import { Config } from "@bb/types";
import { RedisConfigError, RedisConnectError, RedisNotConnectedError } from "@bb/errors";

export interface PingResult {
  ok: boolean;
  latencyMs: number;
}

export interface RedisConnectionOptions {
  host: string;
  port: number;
  password: string | undefined;
  username: string | undefined;
  db: number;
  tls: object | undefined;
  maxRetriesPerRequest: null;
  enableReadyCheck: false;
}

let client: Redis | null = null;
let connecting: Promise<void> | null = null;

export async function connectRedis(): Promise<void> {
  if (client !== null) {
    return;
  }
  if (connecting !== null) {
    return connecting;
  }
  connecting = doConnect().finally(() => {
    connecting = null;
  });
  return connecting;
}

async function doConnect(): Promise<void> {
  const url = getConfigValue(Config.RedisUrl);
  if (url.length === 0) {
    throw new RedisConfigError("bytebell set redis <url>");
  }
  const next = new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
  });
  try {
    await next.connect();
  } catch (cause: unknown) {
    next.disconnect();
    throw new RedisConnectError(url, cause);
  }
  client = next;
}

export async function closeRedis(): Promise<void> {
  if (client === null) {
    return;
  }
  const c = client;
  client = null;
  await c.quit();
}

export async function pingRedis(): Promise<PingResult> {
  const c = _getRedis();
  const start = performance.now();
  try {
    await c.ping();
    return { ok: true, latencyMs: Math.round(performance.now() - start) };
  } catch {
    return { ok: false, latencyMs: Math.round(performance.now() - start) };
  }
}

export function getRedisConnection(): RedisConnectionOptions {
  const url = getConfigValue(Config.RedisUrl);
  if (url.length === 0) {
    throw new RedisConfigError("bytebell set redis <url>");
  }
  const parsed = new URL(url);
  const port = parsed.port.length > 0 ? Number(parsed.port) : 6379;
  const dbPath = parsed.pathname.length > 1 ? parsed.pathname.slice(1) : "";
  return {
    host: parsed.hostname,
    port,
    password: parsed.password.length > 0 ? decodeURIComponent(parsed.password) : undefined,
    username: parsed.username.length > 0 ? decodeURIComponent(parsed.username) : undefined,
    db: dbPath.length > 0 ? Number(dbPath) : 0,
    tls: parsed.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
}

export function _getRedis(): Redis {
  if (client === null) {
    throw new RedisNotConnectedError();
  }
  return client;
}

export function __resetForTests(): void {
  client = null;
  connecting = null;
}
