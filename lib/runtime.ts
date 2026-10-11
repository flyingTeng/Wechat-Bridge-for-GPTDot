import { env } from 'cloudflare:workers';
import { Store } from '../db/store.mjs';
import { Bridge } from './bridge.mjs';
import { BridgeError } from './wechat.mjs';
export function bridge() {
  if (!env.DB) throw new BridgeError('storage_unavailable', 503);
  return new Bridge(new Store(env.DB));
}
