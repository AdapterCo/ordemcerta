import type { Provider } from '@nestjs/common';
import { loadEnv, type Env } from '@ordemcerta/server';

export const ENV = Symbol('ENV');
export type AppEnv = Env;

let cached: Env | null = null;
export function getEnv(): Env {
  cached ??= loadEnv();
  return cached;
}

export const envProvider: Provider = { provide: ENV, useFactory: getEnv };
