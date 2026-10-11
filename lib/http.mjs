import { BridgeError } from './wechat.mjs';
export function identity(request) {
  const id = request.headers.get('oai-authenticated-user-id');
  const email = request.headers.get('oai-authenticated-user-email');
  if (!id || !email) throw new BridgeError('sign_in_required', 401);
  return id;
}
export function sameOrigin(request) {
  const origin = request.headers.get('origin');
  if (origin !== new URL(request.url).origin || request.headers.get('x-bridge-action') !== 'owner-ui' || request.headers.get('content-type')?.split(';')[0] !== 'application/json') throw new BridgeError('same_origin_required', 403);
}
export function json(data, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' } });
}
export function failure(error) {
  return json({ error: error instanceof BridgeError ? error.code : 'service_unavailable' }, error instanceof BridgeError ? error.status : 503);
}
export async function readSmallJson(request) {
  const data = await request.text();
  if (data.length > 8192) throw new BridgeError('request_too_large', 413);
  try { return JSON.parse(data); } catch { throw new BridgeError('invalid_json'); }
}
export function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) throw new BridgeError('invalid_arguments');
}
