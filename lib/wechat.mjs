// Wire format follows Tencent/openclaw-weixin, package version 2.4.9.
export const API_BASE = 'https://ilinkai.weixin.qq.com';
export const CHANNEL_VERSION = '2.4.9';
export const TEST_TEXT = Object.freeze({
  immediate: '这是一条来自助手的微信连接测试消息。没有敏感内容，看到即可。',
  next_day: '这是来自助手的隔天微信连接测试消息。用于检查没有继续聊天时能否收到。',
});
export class BridgeError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
export function allowedBase(value) {
  try {
    const u = new URL(value);
    if (u.origin === API_BASE && (u.pathname === '/' || u.pathname === '') && !u.search && !u.hash && !u.username && !u.password) return API_BASE;
  } catch {}
  throw new BridgeError('unsupported_tencent_host', 502);
}
export function validateTestKind(value) {
  if (value !== 'immediate' && value !== 'next_day') throw new BridgeError('invalid_test_kind');
  return value;
}
export function headers(token, qrPoll = false) {
  const h = { 'iLink-App-Id': 'bot', 'iLink-App-ClientVersion': '132105' };
  if (!qrPoll) {
    h['Content-Type'] = 'application/json';
    h.AuthorizationType = 'ilink_bot_token';
    const n = new Uint32Array(1); crypto.getRandomValues(n);
    h['X-WECHAT-UIN'] = btoa(String(n[0]));
    if (token) h.Authorization = `Bearer ${token}`;
  }
  return h;
}
export function assertResult(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new BridgeError('invalid_tencent_response', 502);
  if ((data.ret !== undefined && data.ret !== 0) || (data.errcode !== undefined && data.errcode !== 0)) {
    throw new BridgeError(data.ret === -14 || data.errcode === -14 ? 'wechat_session_expired' : 'tencent_rejected', 502);
  }
  return data;
}
export function parseInboundJson(text) {
  return JSON.parse(text, (key, value, context) => {
    if (key === 'message_id' && typeof value === 'number') {
      if (context?.source && /^\d+$/.test(context.source)) return context.source;
      if (Number.isSafeInteger(value) && value >= 0) return String(value);
      return null;
    }
    return value;
  });
}
async function boundedInboundJson(response) {
  if (!response.body) throw new BridgeError('invalid_tencent_response', 502);
  const reader = response.body.getReader(); const decoder = new TextDecoder('utf-8', { fatal: true });
  let text = ''; let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 1024 * 1024) { await reader.cancel(); throw new BridgeError('inbound_response_too_large', 502); }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode(); return parseInboundJson(text);
  } finally { reader.releaseLock(); }
}
function assertSendAccepted(data) {
  // Tencent's sendMessage client permits an omitted ret. This is API-level
  // acceptance only, never a recipient receipt. Do not interpret other envelopes.
  const keys = new Set(['ret', 'errcode', 'errmsg', 'message_id']);
  if (Object.keys(data).some(key => !keys.has(key))
      || (data.errmsg !== undefined && typeof data.errmsg !== 'string')
      || (data.errmsg && data.ret !== 0 && data.errcode !== 0)
      // Wire IDs may be uint64 numbers. Their precision is irrelevant here:
      // this bridge does not use, store, log, or return the message ID.
      || (data.message_id !== undefined && typeof data.message_id !== 'string'
          && !(Number.isInteger(data.message_id) && data.message_id >= 0))) {
    throw new BridgeError('send_acceptance_unknown', 502);
  }
  return true;
}
export class TencentClient {
  constructor(fetcher = fetch) {
    // Native Workers fetch rejects an unrelated `this` receiver.
    // Invoke the captured function as a bare call, including injected transports.
    this.fetcher = (...args) => fetcher(...args);
  }
  async request(path, { token = null, body = null, poll = false, timeout = 38000, inbound = false } = {}) {
    // Never follow HTTP redirects while carrying authorization or QR identifiers.
    let response;
    try {
      response = await this.fetcher(API_BASE + path, { method: poll ? 'GET' : 'POST', headers: headers(token, poll), body: poll ? undefined : JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(timeout) });
    } catch (error) {
      const runtimeFailure = error instanceof TypeError && error.message.includes('Illegal invocation');
      const operation = path.startsWith('/ilink/bot/get_bot_qrcode') ? 'create_qr'
        : path.startsWith('/ilink/bot/get_qrcode_status') ? 'poll_qr'
        : path === '/ilink/bot/sendmessage' ? 'send_test' : 'read_context';
      const code = runtimeFailure ? 'bridge_runtime_error'
        : operation === 'create_qr' ? 'qr_request_unavailable' : 'tencent_network_uncertain';
      // Deliberately omit raw errors, URLs, bodies, identifiers, and credentials.
      console.error('wechat_transport_failure', { operation, code,
        category: error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'timeout' : 'request_failure' });
      throw new BridgeError(code, 502);
    }
    if (response.status >= 300 && response.status < 400) throw new BridgeError('tencent_redirect_rejected', 502);
    if (!response.ok) throw new BridgeError('tencent_http_error', 502);
    let data;
    try { data = inbound ? await boundedInboundJson(response) : await response.json(); } catch (error) { throw error instanceof BridgeError ? error : new BridgeError('invalid_tencent_response', 502); }
    return assertResult(data);
  }
  qr() { return this.request('/ilink/bot/get_bot_qrcode?bot_type=3', { body: { local_token_list: [] }, timeout: 15000 }); }
  poll(qrcode) { return this.request('/ilink/bot/get_qrcode_status?qrcode=' + encodeURIComponent(qrcode), { poll: true }); }
  updates(row) { return this.request('/ilink/bot/getupdates', { token: row.bot_token, body: { get_updates_buf: row.cursor || '', base_info: this.info() } }); }
  ownerTextUpdates(row, cursor) { allowedBase(row.base_url); return this.request('/ilink/bot/getupdates', { token: row.bot_token, body: { get_updates_buf: cursor, base_info: this.info() }, inbound: true }); }
  async send(row, kind, clientId) {
    allowedBase(row.base_url);
    const data = await this.request('/ilink/bot/sendmessage', { token: row.bot_token, body: { msg: {
      from_user_id: '', to_user_id: row.recipient_id, client_id: clientId, message_type: 2, message_state: 2,
      context_token: row.context_token, item_list: [{ type: 1, text_item: { text: TEST_TEXT[validateTestKind(kind)] } }],
    }, base_info: this.info() }, timeout: 15000 });
    return assertSendAccepted(data);
  }
  async sendApprovedNotice(row, text, clientId) {
    // Internal transport only; callers expose no arbitrary text or recipient.
    allowedBase(row.base_url);
    const data = await this.request('/ilink/bot/sendmessage', { token: row.bot_token, body: { msg: {
      from_user_id: '', to_user_id: row.recipient_id, client_id: clientId, message_type: 2, message_state: 2,
      context_token: row.context_token, item_list: [{ type: 1, text_item: { text } }],
    }, base_info: this.info() }, timeout: 15000 });
    return assertSendAccepted(data);
  }
  info() { return { channel_version: CHANNEL_VERSION, bot_agent: 'WeChatOwnerBridge/1.0' }; }
}
export function selectContext(messages, row) {
  if (!Array.isArray(messages)) return null;
  let selected = null;
  for (const msg of messages) {
    if (msg && !msg.group_id && msg.message_type === 1 && msg.from_user_id === row.recipient_id && (!msg.to_user_id || msg.to_user_id === row.bot_id) && typeof msg.context_token === 'string' && msg.context_token.length > 0 && msg.context_token.length < 16384) selected = msg.context_token;
  }
  return selected;
}
export function safeStatus(row, runs = [], now = Date.now()) {
  const bound = !!row?.bot_token;
  return {
    state: !row ? 'not_connected' : bound ? row.context_token ? 'ready_for_test' : 'awaiting_first_message' : row.qr_expires > now ? 'awaiting_scan' : 'not_connected',
    connected: bound,
    context_available: !!row?.context_token,
    context_recorded_at: row?.context_at || null,
    next_day_eligible_at: row?.context_at ? row.context_at + 24 * 3600 * 1000 : null,
    tests: runs.map(r => ({ kind: r.kind, current_connection: bound && r.binding_generation === row.binding_generation, state: r.state, attempted_at: r.attempted_at, confirmed_at: r.confirmed_at || null, error: r.error_code || null })),
    note: 'API acceptance is not a delivery receipt. Next-day delivery is unverified until you see the message.',
  };
}
