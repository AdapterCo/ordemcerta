import 'reflect-metadata';
import { createApp } from './bootstrap';
import { getEnv } from './core/env.provider';

async function main() {
  const app = await createApp();
  await app.listen(getEnv().API_PORT, '0.0.0.0');
}

void main();
