import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { Bridge, CONSENT_VERSION } from '../lib/bridge.mjs';
import { Store } from '../db/store.mjs';
import { TencentClient, API_BASE, BridgeError, allowedBase, selectContext, TEST_TEXT } from '../lib/wechat.mjs';
import { handleMcp, MCP_TOOLS } from '../lib/mcp.mjs';
import { sameOrigin } from '../lib/http.mjs';
import { registerStatusTool } from '../lib/webmcp.mjs';
import { prepareBriefNotice, validateNoticeTime, NOTICE_COOLDOWN, NOTICE_DAILY_CAP, NOTIFICATION_TOPICS, NOTIFICATION_INTENTS } from '../lib/notifications.mjs';
import { INBOUND_INTERVAL, INBOUND_LEASE, INBOUND_AUTHORITY, ownerTextBatch } from '../lib/inbound.mjs';
import { parseInboundJson } from '../lib/wechat.mjs';
function setup() {
  const sqlite = new DatabaseSync(':memory:');
  // Apply the same migration SQL shipped to Sites.
  for (const path of readdirSync(new URL('../drizzle/', import.meta.url)).filter(p => p.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL('../drizzle/' + path, import.meta.url), 'utf8'));
  const db = { prepare(sql) {
    const stmt = sqlite.prepare(sql); let args = [];
    return { bind(...v) { args = v; return this; }, async first() { return stmt.get(...args) || null; }, async all() { return { results: stmt.all(...args) }; }, batchRun() { return { meta: { changes: Number(stmt.run(...args).changes) } }; }, async run() { return this.batchRun(); } };
  }, async batch(statements) { sqlite.exec('BEGIN'); try { const results = statements.map(s => s.batchRun()); sqlite.exec('COMMIT'); return results; } catch (error) { sqlite.exec('ROLLBACK'); throw error; } } };
  const store = new Store(db); let now = 1000000; let sends = 0; let qrs = 0;
  const client = {
    async qr() { qrs++; return { qrcode: 'test-qr-id', qrcode_img_content: 'https://example.invalid/qr-fixture' }; },
    async poll() { return { status: 'confirmed', bot_token: 'fixture-bot-secret', ilink_bot_id: 'bot-fixture', ilink_user_id: 'owner-wechat', baseurl: API_BASE }; },
    async updates() { return { ret: 0, get_updates_buf: 'fixture-cursor', msgs: [{ from_user_id: 'owner-wechat', to_user_id: 'bot-fixture', message_type: 1, context_token: 'fixture-context-secret', item_list: [{ text_item: { text: 'must-not-persist' } }] }] }; },
    async send() { sends++; return true; },
  };
  const bridge = new Bridge(store, client, () => now);
  return { bridge, client, store, advance(ms) { now += ms; }, count: () => ({ sends, qrs }), sqlite };
}
async function connected(s) { const flow = await s.bridge.begin('owner', CONSENT_VERSION); await s.bridge.poll('owner', flow.flow_id); return flow; }
async function ready(s) { await connected(s); await s.bridge.refresh('owner'); }

test('no authorization side effects without explicit current consent and owner identity', async () => {
  const s = setup();
  await assert.rejects(s.bridge.begin('', CONSENT_VERSION), { code: 'sign_in_required' });
  await assert.rejects(s.bridge.begin('owner', ''), { code: 'explicit_consent_required' });
  assert.equal(s.count().qrs, 0);
  const flow = await s.bridge.begin('owner', CONSENT_VERSION);
  assert.equal((await s.bridge.begin('owner', CONSENT_VERSION)).flow_id, flow.flow_id);
  assert.equal(s.count().qrs, 1);
  await assert.rejects(s.bridge.begin('other-user', CONSENT_VERSION), { code: 'owner_only' });
});
test('QR binding consumes flow, pins scanner, and keeps all secrets off status', async () => {
  const s = setup(); const flow = await connected(s);
  const row = await s.store.get();
  assert.equal(row.recipient_id, 'owner-wechat'); assert.equal(row.qr_id, null); assert.equal(row.qr_payload, null); assert.equal(row.flow_id, null);
  await assert.rejects(s.bridge.status('other-user'), { code: 'owner_only' });
  const publicData = JSON.stringify(await s.bridge.status('owner'));
  for (const value of ['fixture-bot-secret', 'owner-wechat', 'bot-fixture', flow.flow_id, 'test-qr-id']) assert.equal(publicData.includes(value), false);
});
test('QR expires and off-host token cannot be persisted', async () => {
  const s = setup(); const flow = await s.bridge.begin('owner', CONSENT_VERSION); s.advance(6 * 60000);
  await assert.rejects(s.bridge.poll('owner', flow.flow_id), { code: 'qr_expired' });
  const next = await s.bridge.begin('owner', CONSENT_VERSION);
  s.client.poll = async () => ({ status: 'confirmed', bot_token: 'fixture', ilink_bot_id: 'bot', ilink_user_id: 'scanner', baseurl: 'https://evil.invalid' });
  await assert.rejects(s.bridge.poll('owner', next.flow_id), { code: 'unsupported_tencent_host' });
  assert.equal((await s.store.get()).bot_token, null);
});
test('unknown redirects and extra verification fail closed', async () => {
  for (const status of ['scaned_but_redirect', 'binded_redirect', 'need_verifycode', 'verify_code_blocked']) {
    const s = setup(); const flow = await s.bridge.begin('owner', CONSENT_VERSION);
    s.client.poll = async () => ({ status, redirect_host: 'evil.invalid' });
    await assert.rejects(s.bridge.poll('owner', flow.flow_id)); assert.equal((await s.store.get()).bot_token, null);
  }
});
test('only scanner private user message may supply context', async () => {
  const row = { recipient_id: 'owner-wechat', bot_id: 'bot-fixture' };
  const msg = { from_user_id: 'owner-wechat', to_user_id: 'bot-fixture', message_type: 1, context_token: 'valid' };
  for (const mutation of [{ from_user_id: 'someone-else' }, { to_user_id: 'other-bot' }, { group_id: 'group' }, { message_type: 2 }]) assert.equal(selectContext([{ ...msg, ...mutation }], row), null);
  assert.equal(selectContext([msg], row), 'valid');
  const s = setup(); await ready(s); assert.equal((await s.store.get()).context_token, 'fixture-context-secret');
  const dump = JSON.stringify(await s.store.get()); assert.equal(dump.includes('must-not-persist'), false);
  const status = JSON.stringify(await s.bridge.status('owner')); assert.equal(status.includes('fixture-context-secret'), false); assert.equal(status.includes('fixture-cursor'), false);
});
test('missing context blocks sending and unknown kind is never accepted', async () => {
  const s = setup(); await connected(s);
  await assert.rejects(s.bridge.send('owner', 'immediate'), { code: 'first_message_required' });
  await assert.rejects(s.bridge.send('owner', 'arbitrary'), { code: 'invalid_test_kind' }); assert.equal(s.count().sends, 0);
});
test('immediate is once-only under concurrent requests; next-day needs receipt and 24h', async () => {
  const s = setup(); await ready(s);
  const results = await Promise.allSettled([s.bridge.send('owner', 'immediate'), s.bridge.send('owner', 'immediate')]);
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1); assert.equal(s.count().sends, 1);
  await assert.rejects(s.bridge.send('owner', 'next_day'), { code: 'confirm_first_delivery' });
  await s.bridge.receipt('owner', 'immediate');
  await assert.rejects(s.bridge.send('owner', 'next_day'), { code: 'wait_24_hours' });
  s.advance(24 * 3600000); await s.bridge.send('owner', 'next_day'); assert.equal(s.count().sends, 2);
  assert.equal((await s.bridge.status('owner')).tests[1].confirmed_at, null);
});
test('uncertain send is recorded, never automatically retried', async () => {
  const s = setup(); await ready(s);
  s.client.send = async () => { throw new BridgeError('tencent_network_uncertain', 502); };
  await assert.rejects(s.bridge.send('owner', 'immediate'), { code: 'tencent_network_uncertain' });
  await assert.rejects(s.bridge.send('owner', 'immediate'), { code: 'test_already_attempted' });
  assert.equal((await s.bridge.status('owner')).tests[0].state, 'uncertain');
});
test('disconnect removes tokens and QR values but preserves test audit state', async () => {
  const s = setup(); await ready(s); await s.bridge.send('owner', 'immediate'); await s.bridge.disconnect('owner');
  const row = await s.store.get(); for (const key of ['bot_token', 'recipient_id', 'context_token', 'qr_id', 'qr_payload']) assert.equal(row[key], null);
  assert.equal((await s.bridge.status('owner')).tests.length, 1);
  await assert.rejects(s.bridge.send('owner', 'next_day'), { code: 'not_connected' });
});
test('only exact HTTPS Tencent API origin is permitted', () => {
  assert.equal(allowedBase(API_BASE + '/'), API_BASE);
  for (const u of ['http://ilinkai.weixin.qq.com', 'https://ilinkai.weixin.qq.com.evil.invalid', 'https://evil.invalid@ilinkai.weixin.qq.com', API_BASE + '/path', API_BASE + ':444', API_BASE + '?token=foo']) assert.throws(() => allowedBase(u));
});
test('Tencent wire format has correct QR and authenticated headers and redacts remote errors', async () => {
  const calls = []; const client = new TencentClient(async (url, options) => { calls.push({ url, ...options }); return Response.json({ ret: 0 }); });
  await client.qr(); await client.poll('fixture/qr');
  await client.send({ base_url: API_BASE, bot_token: 'fixture', recipient_id: 'scanner', context_token: 'context' }, 'immediate', 'unique-id');
  assert.deepEqual(JSON.parse(calls[0].body), { local_token_list: [] }); assert.equal(calls[0].headers.Authorization, undefined); assert.equal(calls[0].headers.AuthorizationType, 'ilink_bot_token');
  assert.equal(calls[1].method, 'GET'); assert.equal(calls[1].headers.Authorization, undefined); assert.equal(calls[1].headers.AuthorizationType, undefined); assert.equal(calls[1].headers['X-WECHAT-UIN'], undefined);
  assert.equal(calls[2].redirect, 'manual'); assert.equal(calls[2].headers.Authorization, 'Bearer fixture');
  const sent = JSON.parse(calls[2].body); assert.equal(sent.msg.to_user_id, 'scanner'); assert.equal(sent.msg.context_token, 'context'); assert.equal(sent.msg.item_list[0].text_item.text, TEST_TEXT.immediate);
  const rejected = new TencentClient(async () => Response.json({ ret: -2, errmsg: 'secret-should-not-leak' }));
  await assert.rejects(rejected.qr(), e => e.message === 'tencent_rejected' && !e.message.includes('secret'));
});
test('CSRF checks require same origin and explicit JSON UI header', () => {
  const request = h => new Request('https://owner.example/api/bridge', { method: 'POST', headers: h });
  assert.throws(() => sameOrigin(request({})), { code: 'same_origin_required' });
  assert.throws(() => sameOrigin(request({ origin: 'https://evil.invalid', 'X-Bridge-Action': 'owner-ui', 'Content-Type': 'application/json' })));
  assert.doesNotThrow(() => sameOrigin(request({ origin: 'https://owner.example', 'X-Bridge-Action': 'owner-ui', 'Content-Type': 'application/json' })));
});
test('MCP initialization and discovery are public-safe; calls require trusted owner identity', async () => {
  const s = setup(); const request = (body, auth = true) => new Request('https://owner.example/mcp', { method: 'POST', headers: auth ? { 'oai-authenticated-user-id': 'owner', 'oai-authenticated-user-email': 'owner@example.invalid' } : {}, body: JSON.stringify({ jsonrpc: '2.0', id: 1, ...body }) });
  let response = await handleMcp(request({ method: 'initialize' }, false), () => s.bridge); assert.equal(response.status, 200); assert.equal((await response.json()).result.serverInfo.name, 'wechat-bridge-for-gptdot');
  response = await handleMcp(request({ method: 'tools/list' }, false), () => s.bridge); assert.equal((await response.json()).result.tools.length, 8);
  assert.equal(MCP_TOOLS.some(t => t.name.includes('login')), false);
  response = await handleMcp(request({ method: 'tools/call', params: { name: 'wechat_test_status' } }, false), () => s.bridge); assert.equal(response.status, 401);
  response = await handleMcp(request({ method: 'tools/call', params: { name: 'wechat_send_fixed_test', arguments: { kind: 'immediate', recipient: 'third-party' } } }), () => s.bridge);
  assert.equal((await response.json()).result.isError, true); assert.equal(s.count().sends, 0);
});
test('WebMCP status tool validates input, reads back state, and unregisters', async () => {
  let tool, signal;
  const cleanup = registerStatusTool({ modelContext: { registerTool(t, o) { tool = t; signal = o.signal; } } }, async () => ({ state: 'not_connected' }));
  assert.equal(tool.name, 'read_wechat_test_status'); assert.deepEqual(await tool.execute({}), { state: 'not_connected' });
  await assert.rejects(tool.execute({ token: 'anything' })); cleanup(); assert.equal(signal.aborted, true);
});

test('concurrent QR requests reserve one flow before contacting Tencent', async () => {
  const s = setup(); let resolveQr; let count = 0;
  s.client.qr = async () => { count++; return await new Promise(resolve => { resolveQr = resolve; }); };
  const one = s.bridge.begin('owner', CONSENT_VERSION);
  await new Promise(resolve => setTimeout(resolve, 0));
  await assert.rejects(s.bridge.begin('owner', CONSENT_VERSION), { code: 'qr_preparing' });
  resolveQr({ qrcode: 'fixture-qr', qrcode_img_content: 'fixture-payload' }); await one;
  assert.equal(count, 1);
});
test('late context fetch cannot restore a disconnected or newly rebound connection', async () => {
  const s = setup(); await connected(s); let resolveUpdates;
  s.client.updates = async () => await new Promise(resolve => { resolveUpdates = resolve; });
  const refresh = s.bridge.refresh('owner'); await new Promise(resolve => setTimeout(resolve, 0));
  await s.bridge.disconnect('owner'); await connected(s);
  resolveUpdates({ msgs: [{ from_user_id: 'owner-wechat', message_type: 1, context_token: 'stale-context' }], get_updates_buf: 'stale-cursor' });
  await refresh; const row = await s.store.get(); assert.equal(row.context_token, null); assert.equal(row.cursor, null);
});
test('first context is frozen and later refresh does not read messages', async () => {
  const s = setup(); await ready(s); const first = await s.store.get();
  s.client.updates = async () => { throw new Error('must not fetch again'); };
  s.advance(3600000); await s.bridge.refresh('owner');
  const second = await s.store.get(); assert.equal(first.context_at, second.context_at); assert.equal(first.context_token, second.context_token);
});
test('remote QR expiry clears the flow and a new one can start immediately', async () => {
  const s = setup(); const first = await s.bridge.begin('owner', CONSENT_VERSION);
  s.client.poll = async () => ({ status: 'expired' });
  await assert.rejects(s.bridge.poll('owner', first.flow_id), { code: 'qr_expired' });
  const second = await s.bridge.begin('owner', CONSENT_VERSION); assert.notEqual(second.flow_id, first.flow_id); assert.equal(s.count().qrs, 2);
});
test('atomic send claim rejects a disconnected binding generation', async () => {
  const s = setup(); await ready(s); const first = await s.store.get(); await s.bridge.disconnect('owner');
  assert.equal(await s.store.claim('owner', first.binding_generation, 'immediate', 'late-send', 1), false);
  await connected(s); await s.bridge.refresh('owner');
  assert.equal(await s.store.claim('owner', first.binding_generation, 'immediate', 'old-binding-send', 1), false);
});
test('owner can attest actual receipt after a timeout without retrying the message', async () => {
  const s = setup(); await ready(s); s.client.send = async () => { throw new BridgeError('tencent_network_uncertain'); };
  await assert.rejects(s.bridge.send('owner', 'immediate'));
  const result = await s.bridge.receipt('owner', 'immediate'); assert.ok(result.tests[0].confirmed_at); assert.equal(result.tests[0].state, 'uncertain');
});
test('next-day cannot reuse a receipt from a disconnected previous binding', async () => {
  const s = setup(); await ready(s); await s.bridge.send('owner', 'immediate'); await s.bridge.receipt('owner', 'immediate');
  await s.bridge.disconnect('owner'); await ready(s); s.advance(24 * 3600000);
  await assert.rejects(s.bridge.send('owner', 'next_day'), { code: 'confirm_first_delivery' });
  assert.equal((await s.bridge.status('owner')).tests[0].current_connection, false);
  assert.equal(s.count().sends, 1);
});
test('transport is called without the client object as its native receiver', async () => {
  const client = new TencentClient(function () {
    assert.equal(this, undefined);
    return Promise.resolve(Response.json({ ret: 0, qrcode: 'fixture', qrcode_img_content: 'fixture' }));
  });
  assert.equal((await client.qr()).qrcode, 'fixture');
});
test('QR transport failure is distinguished from uncertain message delivery', async () => {
  const client = new TencentClient(async () => { throw new TypeError('fixture connection failed'); });
  await assert.rejects(client.qr(), { code: 'qr_request_unavailable' });
  await assert.rejects(client.send({ base_url: API_BASE, bot_token: 'fixture', recipient_id: 'fixture', context_token: 'fixture' }, 'immediate', 'fixture-id'), { code: 'tencent_network_uncertain' });
});
test('native receiver errors do not masquerade as Tencent network errors', async () => {
  const client = new TencentClient(async () => { throw new TypeError('Illegal invocation: fixture'); });
  await assert.rejects(client.qr(), { code: 'bridge_runtime_error' });
});
test('redirects are returned manually and rejected without a second request', async () => {
  let calls = 0;
  const client = new TencentClient(async (url, options) => {
    calls++; assert.equal(options.redirect, 'manual');
    return new Response(null, { status: 302, headers: { Location: 'https://untrusted.invalid/?secret=fixture' } });
  });
  await assert.rejects(client.qr(), { code: 'tencent_redirect_rejected' }); assert.equal(calls, 1);
});

const FIXTURE_NOTICE_TEXT = '这是一条本地固定通知测试。';
test('both send transports accept supported success objects without requiring ret', async () => {
  const row = { base_url: API_BASE, bot_token: 'fixture', recipient_id: 'fixture-owner', context_token: 'fixture-context' };
  for (const body of [{}, { errcode: 0 }, { errmsg: '' }, { message_id: '18446744073709551615' }, { message_id: 123 }, { ret: 0 }, { ret: 0, errcode: 0, errmsg: '' }]) {
    for (const method of ['send', 'sendApprovedNotice']) {
      let attempts = 0;
      const client = new TencentClient(async () => { attempts++; return Response.json(body); });
      const result = await client[method](row, method === 'send' ? 'immediate' : FIXTURE_NOTICE_TEXT, 'fixture');
      assert.equal(result, true); assert.equal(attempts, 1);
    }
  }
});
test('missing-ret compatibility does not accept malformed, unknown or error responses', async () => {
  const row = { base_url: API_BASE, bot_token: 'fixture', recipient_id: 'fixture-owner', context_token: 'fixture-context' };
  const cases = [
    [() => Response.json({ ret: -14 }), 'wechat_session_expired'],
    [() => Response.json({ errcode: -14 }), 'wechat_session_expired'],
    ...[{ ret: -2 }, { ret: '0' }, { ret: null }, { errcode: '0' }, { ret: 0, errcode: 2 }].map(body => [() => Response.json(body), 'tencent_rejected']),
    ...[null, [], 'ok'].map(body => [() => Response.json(body), 'invalid_tencent_response']),
    [() => new Response(''), 'invalid_tencent_response'],
    [() => new Response('not-json'), 'invalid_tencent_response'],
    [() => new Response('{}', { status: 500 }), 'tencent_http_error'],
    ...[{ base_resp: { ret: -2 } }, { ret: 0, base_resp: { ret: -2 } }, { error: 'fixture-secret' }, { errmsg: 'fixture-secret' }, { errmsg: {} }, { message_id: {} }, { message_id: -1 }, { message_id: 1.5 }].map(body => [() => Response.json(body), 'send_acceptance_unknown']),
  ];
  for (const [response, code] of cases) for (const method of ['send', 'sendApprovedNotice']) {
    let attempts = 0;
    const client = new TencentClient(async () => { attempts++; return response(); });
    await assert.rejects(client[method](row, method === 'send' ? 'immediate' : FIXTURE_NOTICE_TEXT, 'fixture'), error => error.code === code && !error.message.includes('fixture-secret'));
    assert.equal(attempts, 1);
  }
});
test('unused numeric uint64 response IDs do not cause false unknown acceptance', async () => {
  const row = { base_url: API_BASE, bot_token: 'fixture', recipient_id: 'fixture-owner', context_token: 'fixture-context' };
  for (const method of ['send', 'sendApprovedNotice']) {
    let attempts = 0;
    const client = new TencentClient(async () => { attempts++; return new Response('{"message_id":18446744073709551615}', { headers: { 'Content-Type': 'application/json' } }); });
    assert.equal(await client[method](row, method === 'send' ? 'immediate' : FIXTURE_NOTICE_TEXT, 'fixture'), true);
    assert.equal(attempts, 1);
  }
});
const brief = (dedup_key = 'fixture-brief', extra = {}) => ({ dedup_key, topic: 'paper_reading', intent: 'ready', ...extra });
// Dates below are synthetic test fixtures, unrelated to any personal event.
async function notificationsReady(s, at = Date.parse('2030-01-15T03:00:00Z')) {
  s.advance(at - 1000000); await ready(s); await s.bridge.setNotifications('owner', true);
}
test('notifications default off and owner setting never calls Tencent or changes original context', async () => {
  const s = setup(); await ready(s); const original = await s.store.get();
  assert.equal((await s.bridge.status('owner')).notifications.enabled, false);
  s.client.updates = async () => { throw new Error('Must not read inbound data'); };
  assert.equal((await s.bridge.setNotifications('owner', true)).enabled, true);
  assert.equal((await s.bridge.setNotifications('owner', false)).enabled, false);
  assert.deepEqual(await s.store.get(), original); assert.equal(s.count().sends, 0);
  for (const invalid of [undefined, 1, 'true', null, {}]) await assert.rejects(s.bridge.setNotifications('owner', invalid), { code: 'invalid_arguments' });
  await assert.rejects(s.bridge.setNotifications('other', true), { code: 'owner_only' });
  await assert.rejects(s.bridge.setNotifications('', true), { code: 'sign_in_required' });
});
test('every brief template uses enum-only body with no arbitrary fields or prototype keys', () => {
  for (const topic of Object.keys(NOTIFICATION_TOPICS)) for (const intent of Object.keys(NOTIFICATION_INTENTS)) {
    const result = prepareBriefNotice(brief('fixture', { topic, intent }));
    assert.ok(result.text.startsWith('助手找你：')); assert.ok(result.text.endsWith('详细内容请回助手的 ChatGPT 对话查看。'));
    assert.ok(result.text.includes(NOTIFICATION_TOPICS[topic])); assert.equal(result.eventAt, null);
  }
  for (const extra of [{ text: 'secret' }, { recipient: 'other' }, { url: 'https://x.invalid' }, { attachment: 'x' }, { topic: '__proto__' }, { topic: ['paper_reading'] }, { intent: 'constructor' }, { intent: ['ready'] }, { dedup_key: '' }, { dedup_key: '秘密姓名' }, { dedup_key: 'a'.repeat(81) }]) assert.throws(() => prepareBriefNotice(brief('fixture', extra)));
});
test('notification dates are strict paired Beijing dates, never implicit schedules', () => {
  const valid = prepareBriefNotice(brief('fixture', { event_date: '2028-02-29', event_time: '15:00' }));
  assert.equal(new Date(valid.eventAt).toISOString(), '2028-02-29T07:00:00.000Z');
  assert.ok(valid.text.includes('2028-02-29 15:00（北京时间）'));
  for (const extra of [{ event_date: '2030-01-15' }, { event_time: '15:00' }, { event_date: '2030-02-29', event_time: '15:00' }, { event_date: '2030-04-31', event_time: '15:00' }, { event_date: '2030-01-15', event_time: '24:00' }, { event_date: '2030-01-15', event_time: '15:60' }, { event_date: '2030-1-11', event_time: '15:00' }, { event_date: null, event_time: null }, { event_date: '2030-01-15', event_time: '15:00Z' }]) assert.throws(() => prepareBriefNotice(brief('fixture', extra)), { code: 'invalid_event_time' });
  assert.throws(() => validateNoticeTime(100, 100), { code: 'notification_event_expired' });
  assert.throws(() => validateNoticeTime(32 * 86400000, 0), { code: 'notification_event_too_far' });
});
test('disabled and disconnected notifications fail without claiming or sending', async () => {
  const s = setup(); await ready(s); let calls = 0; s.client.sendApprovedNotice = async () => { calls++; };
  await assert.rejects(s.bridge.sendBriefNotice('owner', brief()), { code: 'notifications_disabled' });
  assert.equal(s.sqlite.prepare('SELECT COUNT(*) AS n FROM brief_notices').get().n, 0);
  await s.bridge.disconnect('owner');
  await assert.rejects(s.bridge.sendBriefNotice('owner', brief()), { code: 'not_connected' }); assert.equal(calls, 0);
});
test('brief notices send to pinned owner and store only hashed key/payload plus safe outcome', async () => {
  const s = setup(); await notificationsReady(s); const original = await s.store.get(); const calls = [];
  s.client.sendApprovedNotice = async (row, text, clientId) => { calls.push({row, text, clientId}); return true; };
  const result = await s.bridge.sendBriefNotice('owner', brief('fixture-key-never-return'));
  assert.equal(result.state, 'accepted'); assert.equal(result.already_attempted, false);
  assert.equal(calls[0].row.recipient_id, 'owner-wechat'); assert.equal(calls[0].text, prepareBriefNotice(brief()).text);
  const stored = JSON.stringify(s.sqlite.prepare('SELECT * FROM brief_notices').all());
  const publicData = JSON.stringify([result, await s.bridge.status('owner')]);
  for (const hidden of ['fixture-key-never-return', calls[0].text, 'fixture-bot-secret', 'fixture-context-secret']) { assert.equal(stored.includes(hidden), false); assert.equal(publicData.includes(hidden), false); }
  assert.deepEqual(await s.store.get(), original);
});
test('same notice is permanent across replay, disable, expiry and reconnect', async () => {
  const s = setup(); await notificationsReady(s); let calls = 0;
  s.client.sendApprovedNotice = async () => { calls++; throw new BridgeError('send_acceptance_unknown'); };
  const input = brief('permanent', { event_date: '2030-01-15', event_time: '15:00' });
  const result = await s.bridge.sendBriefNotice('owner', input); assert.equal(result.state, 'uncertain');
  await s.bridge.setNotifications('owner', false); s.advance(10 * 3600000);
  assert.equal((await s.bridge.sendBriefNotice('owner', input)).already_attempted, true);
  await s.bridge.disconnect('owner'); await connected(s); await s.bridge.refresh('owner');
  assert.equal((await s.bridge.status('owner')).notifications.enabled, false);
  assert.equal((await s.bridge.sendBriefNotice('owner', input)).already_attempted, true); assert.equal(calls, 1);
  await assert.rejects(s.bridge.sendBriefNotice('owner', brief('permanent', { topic: 'schedule' })), { code: 'dedup_key_conflict' });
});
test('concurrent brief attempts atomically enforce dedup and cooldown', async () => {
  const s = setup(); await notificationsReady(s); let calls = 0; s.client.sendApprovedNotice = async () => { calls++; return true; };
  const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => s.bridge.sendBriefNotice('owner', brief('parallel-' + i))));
  assert.equal(calls, 1); assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.ok(results.filter(r => r.status === 'rejected').every(r => r.reason.code === 'notification_rate_limited'));
  assert.equal((await s.bridge.status('owner')).notifications.attempts_today, 1);
});
test('cooldown permits exact ten-minute boundary and counts uncertain sends', async () => {
  const s = setup(); await notificationsReady(s); let calls = 0; s.client.sendApprovedNotice = async () => { calls++; throw new BridgeError('tencent_network_uncertain'); };
  await s.bridge.sendBriefNotice('owner', brief('cooldown-a')); s.advance(NOTICE_COOLDOWN - 1);
  await assert.rejects(s.bridge.sendBriefNotice('owner', brief('cooldown-b')), { code: 'notification_rate_limited' });
  s.advance(1); assert.equal((await s.bridge.sendBriefNotice('owner', brief('cooldown-b'))).state, 'uncertain'); assert.equal(calls, 2);
});
test('daily cap is Beijing-based and cannot be reset by toggling or reconnecting', async () => {
  const s = setup(); await notificationsReady(s); let calls = 0; s.client.sendApprovedNotice = async () => { calls++; return true; };
  for (let i = 0; i < NOTICE_DAILY_CAP; i++) { await s.bridge.sendBriefNotice('owner', brief('day-' + i)); s.advance(NOTICE_COOLDOWN); }
  await s.bridge.setNotifications('owner', false); await s.bridge.setNotifications('owner', true);
  await s.bridge.disconnect('owner'); await connected(s); await s.bridge.refresh('owner'); await s.bridge.setNotifications('owner', true);
  await assert.rejects(s.bridge.sendBriefNotice('owner', brief('day-extra')), { code: 'notification_rate_limited' });
  s.advance(Date.parse('2030-01-15T16:00:00Z') - Date.parse('2030-01-15T04:00:00Z'));
  assert.equal((await s.bridge.status('owner')).notifications.attempts_today, 0);
  assert.equal((await s.bridge.sendBriefNotice('owner', brief('next-day'))).state, 'accepted'); assert.equal(calls, 7);
});
test('past events fail before claim and crossing event time after claim sends nothing', async () => {
  const s = setup(); await notificationsReady(s, Date.parse('2030-01-15T06:59:59.999Z')); let calls = 0; s.client.sendApprovedNotice = async () => { calls++; return true; };
  await assert.rejects(s.bridge.sendBriefNotice('owner', brief('past', { event_date: '2030-01-15', event_time: '14:59' })), { code: 'notification_event_expired' });
  const claim = s.store.claimBriefNotice.bind(s.store); s.store.claimBriefNotice = async (...args) => { const r = await claim(...args); s.advance(1); return r; };
  const result = await s.bridge.sendBriefNotice('owner', brief('crossing', { event_date: '2030-01-15', event_time: '15:00' }));
  assert.equal(result.state, 'not_sent'); assert.equal(result.error, 'notification_event_expired'); assert.equal(calls, 0);
});
test('disable or disconnect during claim blocks transport and retains permanent attempt', async () => {
  for (const disconnect of [false, true]) {
    const s = setup(); await notificationsReady(s); let calls = 0; s.client.sendApprovedNotice = async () => { calls++; return true; };
    const claim = s.store.claimBriefNotice.bind(s.store);
    s.store.claimBriefNotice = async (...args) => { const r = await claim(...args); if (disconnect) await s.bridge.disconnect('owner'); else await s.bridge.setNotifications('owner', false); return r; };
    const result = await s.bridge.sendBriefNotice('owner', brief()); assert.equal(result.state, 'not_sent'); assert.equal(result.error, 'notification_cancelled'); assert.equal(calls, 0);
    assert.equal((await s.bridge.sendBriefNotice('owner', brief())).already_attempted, true);
  }
});
test('stale generation cannot enable preferences or claim a brief notice', async () => {
  const s = setup(); await notificationsReady(s); const old = await s.store.get(); await s.bridge.disconnect('owner'); await connected(s); await s.bridge.refresh('owner');
  assert.equal(await s.store.setNotifications('owner', old.binding_generation, true, 1), false);
  assert.equal(await s.store.claimBriefNotice('owner', old.binding_generation, 'hash', 'payload', 'client', 1, 0, 0, 6), false);
  assert.equal((await s.bridge.status('owner')).notifications.enabled, false);
});
test('MCP notifications enforce owner, origin, arguments and advertise only bounded templates', async () => {
  const s = setup(); await ready(s); let calls = 0; s.client.sendApprovedNotice = async () => { calls++; return true; };
  const request = (name, args, who = 'owner', origin = null) => new Request('https://owner.example/mcp', { method: 'POST', headers: { ...(who ? { 'oai-authenticated-user-id': who, 'oai-authenticated-user-email': 'fixture@example.invalid' } : {}), ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
  for (const name of ['wechat_notifications_set_enabled', 'wechat_send_brief_notice']) {
    const args = name.endsWith('enabled') ? { enabled: true } : brief();
    assert.equal((await handleMcp(request(name, args, ''), () => s.bridge)).status, 401);
    assert.equal((await handleMcp(request(name, args, 'other'), () => s.bridge)).status, 403);
    assert.equal((await handleMcp(request(name, args, 'owner', 'https://evil.invalid'), () => s.bridge)).status, 403);
    const invalid = await (await handleMcp(request(name, { ...args, text: 'override' }), () => s.bridge)).json(); assert.equal(invalid.result.isError, true);
  }
  const enabled = await (await handleMcp(request('wechat_notifications_set_enabled', { enabled: true }), () => s.bridge)).json();
  assert.equal(JSON.parse(enabled.result.content[0].text).enabled, true); assert.equal(calls, 0);
  const descriptor = MCP_TOOLS.find(t => t.name === 'wechat_send_brief_notice'); assert.equal(descriptor.inputSchema.additionalProperties, false); assert.equal(descriptor.inputSchema.properties.topic.enum.length, 6);
});
test('event expiry during the final connection check blocks dispatch', async () => {
  const s = setup(); await notificationsReady(s, Date.parse('2030-01-15T06:59:59.999Z')); let calls = 0; s.client.sendApprovedNotice = async () => { calls++; return true; };
  const active = s.store.notificationConnectionActive.bind(s.store);
  s.store.notificationConnectionActive = async (...args) => { const r = await active(...args); s.advance(1); return r; };
  const result = await s.bridge.sendBriefNotice('owner', brief('late-active', { event_date: '2030-01-15', event_time: '15:00' }));
  assert.equal(result.state, 'not_sent'); assert.equal(result.error, 'notification_event_expired'); assert.equal(calls, 0);
});
test('same-key concurrent calls issue only one request and preserve sending claim after storage failure', async () => {
  const s = setup(); await notificationsReady(s); let calls = 0; s.client.sendApprovedNotice = async () => { calls++; return true; };
  const results = await Promise.all(Array.from({ length: 5 }, () => s.bridge.sendBriefNotice('owner', brief())));
  assert.equal(calls, 1); assert.equal(results.filter(r => !r.already_attempted).length, 1);
  s.advance(NOTICE_COOLDOWN);
  s.store.finishBriefNotice = async () => { throw new Error('fixture-store-unavailable'); };
  await assert.rejects(s.bridge.sendBriefNotice('owner', brief('persistent-claim')));
  const again = await s.bridge.sendBriefNotice('owner', brief('persistent-claim'));
  assert.equal(again.state, 'sending'); assert.equal(again.already_attempted, true); assert.equal(calls, 2);
});
const inboundMessage = (id = '1', text = 'fixture owner message', extra = {}) => ({ from_user_id: 'owner-wechat', to_user_id: 'bot-fixture', message_type: 1, message_state: 2, message_id: id, create_time_ms: Date.parse('2030-01-15T03:30:00Z'), item_list: [{ type: 1, text_item: { text } }], ...extra });
async function inboundReady(s) { s.advance(Date.parse('2030-01-15T04:00:00Z') - 1000000); await ready(s); await s.bridge.setInbound('owner', true); }
test('inbound defaults off and enabling changes neither original context nor outbound setting', async () => {
  const s = setup(); await ready(s); await s.bridge.setNotifications('owner', true); const original = await s.store.get();
  assert.equal((await s.bridge.status('owner')).inbound.enabled, false);
  s.client.ownerTextUpdates = async () => { throw new Error('Enabling must not poll'); };
  assert.equal((await s.bridge.setInbound('owner', true)).enabled, true);
  assert.deepEqual(await s.store.get(), original); assert.equal((await s.bridge.status('owner')).notifications.enabled, true);
  assert.equal((await s.bridge.setInbound('owner', false)).enabled, false);
  for (const bad of [undefined, null, 'true', 1]) await assert.rejects(s.bridge.setInbound('owner', bad), { code: 'invalid_arguments' });
  await assert.rejects(s.bridge.setInbound('other', true), { code: 'owner_only' });
  await assert.rejects(s.bridge.readOwnerText('owner'), { code: 'inbound_disabled' });
});
test('inbound filters owner AND target metadata, group, media, mixed, malformed and streaming records', async () => {
  const s = setup(); await inboundReady(s); const row = await s.store.get();
  const bad = [
    { from_user_id: 'someone-else' }, { from_user_id: undefined }, { to_user_id: 'other-bot' }, { to_user_id: undefined }, { to_user_id: null },
    { group_id: 'group' }, { group_id: false }, { group_id: null }, { message_type: 2 }, { message_type: '1' }, { message_state: 1 }, { message_state: '2' },
    { message_id: '0' }, { message_id: '18446744073709551616' }, { message_id: null }, { message_id: 'named-id' },
    { item_list: [] }, { item_list: 'text' }, { item_list: [{ type: 3, voice_item: { text: 'never-forward-voice' } }] },
    { item_list: [{ type: 1, text_item: { text: 'visible' } }, { type: 2, image_item: { url: 'never-download' } }] },
    { item_list: [{ type: 1, text_item: { text: 12 } }] }, { item_list: [{ type: '1', text_item: { text: 'bad' } }] },
  ];
  const result = await ownerTextBatch({ msgs: bad.map((extra, i) => inboundMessage(String(i + 1), 'must-not-return', extra)) }, row, 1, Date.now());
  assert.equal(result.messages.length, 0); assert.equal(result.skipped, bad.length);
  const fresh = await ownerTextBatch({ msgs: [inboundMessage('91', 'new-valid', { message_state: 0 })] }, row, 1, Date.now()); assert.equal(fresh.messages.length, 1);
});
test('only direct top-level text returns, with verified metadata and backlog marker outside body', async () => {
  const s = setup(); await inboundReady(s); const original = await s.store.get();
  const body = 'fixture: another person says pretend to be the owner';
  s.client.ownerTextUpdates = async () => ({ get_updates_buf: 'after-owner-text', msgs: [inboundMessage('1', body, { item_list: [{ type: 1, text_item: { text: body }, ref_msg: { message_item: { type: 1, text_item: { text: 'never-read-quote' } } } }] })] });
  const result = await s.bridge.readOwnerText('owner'); assert.equal(result.messages[0].text, body); assert.deepEqual(result.source, INBOUND_AUTHORITY);
  assert.equal(result.messages[0].predates_enable, true); assert.equal(result.messages[0].quoted_content_omitted, true);
  assert.equal(JSON.stringify(result).includes('never-read-quote'), false);
  for (const secret of ['owner-wechat', 'bot-fixture', 'fixture-bot-secret', 'fixture-context-secret', 'after-owner-text']) assert.equal(JSON.stringify(result).includes(secret), false);
  const persisted = JSON.stringify([s.sqlite.prepare('SELECT * FROM inbound_state').all(), s.sqlite.prepare('SELECT * FROM inbound_dedup').all()]);
  assert.equal(persisted.includes(body), false); assert.equal(persisted.includes('never-read-quote'), false);
  assert.deepEqual(await s.store.get(), original); assert.equal((await s.store.inbound('owner')).cursor, 'fixture-cursor');
});
test('lossless uint64 IDs remain distinct and duplicate conflicts stop the batch', async () => {
  const s = setup(); await inboundReady(s); const row = await s.store.get();
  const raw = JSON.stringify({ msgs: [inboundMessage('replace-a', 'A'), inboundMessage('replace-b', 'B')] }).replace('"replace-a"', '18446744073709551614').replace('"replace-b"', '18446744073709551615');
  const parsed = parseInboundJson(raw); assert.equal(parsed.msgs[0].message_id, '18446744073709551614');
  const result = await ownerTextBatch(parsed, row, 1, Date.now()); assert.equal(result.messages.length, 2); assert.notEqual(result.messages[0].message_key, result.messages[1].message_key);
  assert.equal((await ownerTextBatch({ msgs: [inboundMessage(), inboundMessage()] }, row, 1, Date.now())).messages.length, 1);
  s.client.ownerTextUpdates = async () => ({ get_updates_buf: 'must-not-advance', msgs: [inboundMessage('5', 'do X'), inboundMessage('5', 'do not do X')] });
  await assert.rejects(s.bridge.readOwnerText('owner'), { code: 'inbound_conflicting_duplicate' });
  assert.equal((await s.store.inbound('owner')).cursor, 'fixture-cursor'); assert.equal((await s.store.inbound('owner')).pending_batch, null);
});
test('ACK transaction advances only independent cursor and repeat ACK is idempotent', async () => {
  const s = setup(); await inboundReady(s); const original = await s.store.get();
  s.client.ownerTextUpdates = async () => ({ get_updates_buf: 'cursor-2', msgs: [inboundMessage()] });
  const batch = await s.bridge.readOwnerText('owner');
  assert.equal((await s.store.inbound('owner')).cursor, 'fixture-cursor');
  const replies = await Promise.all([s.bridge.ackOwnerText('owner', batch.batch_id), s.bridge.ackOwnerText('owner', batch.batch_id)]);
  assert.ok(replies.every(r => r.acknowledged));
  assert.equal((await s.store.inbound('owner')).cursor, 'cursor-2'); assert.equal((await s.store.inbound('owner')).pending_batch, null);
  assert.equal(s.sqlite.prepare('SELECT COUNT(*) AS n FROM inbound_dedup').get().n, 1); assert.deepEqual(await s.store.get(), original);
  assert.equal((await s.bridge.ackOwnerText('owner', batch.batch_id)).already_acknowledged, true);
});
test('hourly guard applies through toggles, empty polls and pending ACK', async () => {
  const s = setup(); await inboundReady(s); let calls = 0;
  s.client.ownerTextUpdates = async () => { calls++; return { msgs: [inboundMessage()], get_updates_buf: 'cursor-2' }; };
  const batch = await s.bridge.readOwnerText('owner');
  await s.bridge.setInbound('owner', false); await s.bridge.setInbound('owner', true);
  assert.equal((await s.bridge.readOwnerText('owner')).state, 'awaiting_ack'); assert.equal(calls, 1);
  await s.bridge.ackOwnerText('owner', batch.batch_id); s.advance(INBOUND_INTERVAL - 1);
  assert.equal((await s.bridge.readOwnerText('owner')).state, 'not_due'); assert.equal(calls, 1);
  s.advance(1); assert.equal((await s.bridge.readOwnerText('owner')).state, 'no_matching_text'); assert.equal(calls, 2);
});
test('unacked delivery is replayed from original cursor without body cache, no premature advancement', async () => {
  const s = setup(); await inboundReady(s); const cursors = [];
  s.client.ownerTextUpdates = async (row, cursor) => { cursors.push(cursor); return { msgs: [inboundMessage()], get_updates_buf: 'cursor-2' }; };
  const first = await s.bridge.readOwnerText('owner'); s.advance(INBOUND_INTERVAL);
  const replay = await s.bridge.readOwnerText('owner');
  assert.equal(replay.replay, true); assert.equal(replay.batch_id, first.batch_id); assert.deepEqual(replay.messages, first.messages);
  assert.deepEqual(cursors, ['fixture-cursor', 'fixture-cursor']);
  await s.bridge.ackOwnerText('owner', replay.batch_id); assert.equal((await s.store.inbound('owner')).cursor, 'cursor-2');
});
test('provider replay gaps and transport failures preserve cursor and pending batch', async () => {
  const s = setup(); await inboundReady(s);
  s.client.ownerTextUpdates = async () => ({ msgs: [inboundMessage()], get_updates_buf: 'cursor-2' });
  const first = await s.bridge.readOwnerText('owner'); s.advance(INBOUND_INTERVAL);
  s.client.ownerTextUpdates = async () => ({ msgs: [], get_updates_buf: 'cursor-3' });
  await assert.rejects(s.bridge.readOwnerText('owner'), { code: 'inbound_replay_unavailable' });
  const state = await s.store.inbound('owner'); assert.equal(state.pending_batch, first.batch_id); assert.equal(state.cursor, 'fixture-cursor'); assert.equal(state.lease_id, null);
  s.advance(INBOUND_INTERVAL); s.client.ownerTextUpdates = async () => { throw new Error('fixture-secret-raw-error'); };
  await assert.rejects(s.bridge.readOwnerText('owner'), e => e.code === 'inbound_read_failed' && !e.message.includes('secret'));
  assert.equal((await s.store.inbound('owner')).cursor, 'fixture-cursor');
});
test('concurrent consumers and ACK during a poll are blocked by one lease', async () => {
  const s = setup(); await inboundReady(s); let resolve; let calls = 0;
  s.client.ownerTextUpdates = async () => { calls++; return new Promise(r => { resolve = r; }); };
  const first = s.bridge.readOwnerText('owner'); while (!resolve) await new Promise(r => setImmediate(r));
  await assert.rejects(s.bridge.readOwnerText('owner'), e => ['inbound_poll_in_progress', 'inbound_poll_not_available'].includes(e.code));
  resolve({ msgs: [inboundMessage()], get_updates_buf: 'cursor-2' }); const batch = await first; s.advance(INBOUND_INTERVAL);
  resolve = null; const second = s.bridge.readOwnerText('owner'); while (!resolve) await new Promise(r => setImmediate(r));
  await assert.rejects(s.bridge.ackOwnerText('owner', batch.batch_id), { code: 'inbound_poll_in_progress' });
  resolve({ msgs: [inboundMessage()], get_updates_buf: 'cursor-2' }); await second; assert.equal(calls, 2);
});
test('disable and rebind revoke in-flight body return and old ACK capability', async () => {
  for (const rebind of [false, true]) {
    const s = setup(); await inboundReady(s); let resolve;
    s.client.ownerTextUpdates = async () => new Promise(r => { resolve = r; });
    const pending = s.bridge.readOwnerText('owner'); while (!resolve) await new Promise(r => setImmediate(r));
    if (rebind) { await s.bridge.disconnect('owner'); await connected(s); await s.bridge.refresh('owner'); }
    else { await s.bridge.setInbound('owner', false); await s.bridge.setInbound('owner', true); }
    resolve({ msgs: [inboundMessage('5', 'must-not-return-after-stop')], get_updates_buf: 'late' });
    await assert.rejects(pending, { code: 'inbound_disabled_or_connection_changed' });
    assert.equal((await s.store.inbound('owner')).cursor, 'fixture-cursor');
  }
  const s = setup(); await inboundReady(s); s.client.ownerTextUpdates = async () => ({ msgs: [inboundMessage()], get_updates_buf: 'cursor-2' });
  const batch = await s.bridge.readOwnerText('owner'); await s.bridge.disconnect('owner'); await connected(s); await s.bridge.refresh('owner');
  await assert.rejects(s.bridge.ackOwnerText('owner', batch.batch_id), { code: 'inbound_batch_not_found' });
  assert.equal((await s.bridge.status('owner')).inbound.enabled, false);
});
test('oversize output is split without loss and cursor holds until all parts acknowledged', async () => {
  const s = setup(); await inboundReady(s); const text = 'a'.repeat(1999) + '😀' + 'z'.repeat(41000);
  s.client.ownerTextUpdates = async () => ({ msgs: [inboundMessage('90', text)], get_updates_buf: 'after-long-message' });
  const first = await s.bridge.readOwnerText('owner'); assert.equal(first.messages.length, 20); assert.equal(first.partial, true);
  assert.ok(first.messages.every(m => m.text.length <= 2000)); assert.ok(first.messages[1].text.startsWith('😀'));
  await s.bridge.ackOwnerText('owner', first.batch_id); assert.equal((await s.store.inbound('owner')).cursor, 'fixture-cursor');
  s.advance(INBOUND_INTERVAL); const rest = await s.bridge.readOwnerText('owner'); assert.equal(rest.partial, false);
  assert.equal([...first.messages, ...rest.messages].map(m => m.text).join(''), text);
  await s.bridge.ackOwnerText('owner', rest.batch_id); assert.equal((await s.store.inbound('owner')).cursor, 'after-long-message');
});
test('malformed cursor or oversized schema never advances retrieval, expired lease never releases text', async () => {
  for (const data of [{ msgs: 'bad' }, { msgs: [], get_updates_buf: {} }, { msgs: Array(501).fill(null) }]) {
    const s = setup(); await inboundReady(s); s.client.ownerTextUpdates = async () => data;
    await assert.rejects(s.bridge.readOwnerText('owner')); assert.equal((await s.store.inbound('owner')).cursor, 'fixture-cursor');
  }
  const s = setup(); await inboundReady(s); s.client.ownerTextUpdates = async () => { s.advance(INBOUND_LEASE); return { msgs: [inboundMessage()], get_updates_buf: 'late' }; };
  await assert.rejects(s.bridge.readOwnerText('owner'), { code: 'inbound_disabled_or_connection_changed' });
  assert.equal((await s.store.inbound('owner')).cursor, 'fixture-cursor');
});
test('deleted and malformed deletion markers never forward text', async () => {
  const s = setup(); await inboundReady(s); const row = await s.store.get();
  const markers = [1, -1, null, '0', false];
  const data = await ownerTextBatch({ msgs: markers.map((delete_time_ms, i) => inboundMessage(String(i + 1), 'discard', { delete_time_ms })).concat(inboundMessage('50', 'keep', { delete_time_ms: 0 })) }, row, 1, Date.now());
  assert.equal(data.skipped, markers.length); assert.equal(data.messages.length, 1); assert.equal(data.messages[0].text, 'keep');
});
test('changed unacked replay content or timestamp is rejected without cursor advancement', async () => {
  for (const metadataOnly of [false, true]) {
    const s = setup(); await inboundReady(s); let message = inboundMessage();
    s.client.ownerTextUpdates = async () => ({ msgs: [message], get_updates_buf: 'new-cursor' });
    const batch = await s.bridge.readOwnerText('owner'); s.advance(INBOUND_INTERVAL);
    message = metadataOnly ? inboundMessage('1', 'fixture owner message', { update_time_ms: 42 }) : inboundMessage('1', 'changed instruction');
    await assert.rejects(s.bridge.readOwnerText('owner'), { code: 'inbound_replay_changed' });
    const state = await s.store.inbound('owner'); assert.equal(state.pending_batch, batch.batch_id); assert.equal(state.cursor, 'fixture-cursor');
  }
});
test('ACKed long-message prefix fingerprints prevent mixed-version continuation', async () => {
  const s = setup(); await inboundReady(s); let body = 'a'.repeat(45000);
  s.client.ownerTextUpdates = async () => ({ msgs: [inboundMessage('9', body)], get_updates_buf: 'after-long' });
  const first = await s.bridge.readOwnerText('owner'); assert.equal(first.messages.length, 20); assert.equal(first.incomplete_message_in_batch, true);
  assert.equal(JSON.stringify(first).includes('fingerprint'), false);
  await s.bridge.ackOwnerText('owner', first.batch_id);
  const rows = s.sqlite.prepare('SELECT fingerprint FROM inbound_dedup').all(); assert.equal(rows.length, 20); assert.ok(rows.every(r => /^[a-f0-9]{64}$/.test(r.fingerprint)));
  s.advance(INBOUND_INTERVAL); body = 'b' + body.slice(1);
  await assert.rejects(s.bridge.readOwnerText('owner'), { code: 'inbound_replay_changed' });
  assert.equal((await s.store.inbound('owner')).cursor, 'fixture-cursor'); assert.equal((await s.store.inbound('owner')).pending_batch, null);
});
test('ACK database failure rolls back both dedup and cursor atomically', async () => {
  const s = setup(); await inboundReady(s);
  s.client.ownerTextUpdates = async () => ({ msgs: [inboundMessage()], get_updates_buf: 'after-ack' });
  const first = await s.bridge.readOwnerText('owner');
  s.sqlite.exec("CREATE TRIGGER fixture_ack_failure BEFORE UPDATE OF last_ack_batch ON inbound_state WHEN NEW.last_ack_batch IS NOT NULL BEGIN SELECT RAISE(ABORT, 'fixture failure'); END");
  await assert.rejects(s.bridge.ackOwnerText('owner', first.batch_id));
  assert.equal(s.sqlite.prepare('SELECT COUNT(*) AS n FROM inbound_dedup').get().n, 0);
  assert.equal((await s.store.inbound('owner')).cursor, 'fixture-cursor'); assert.equal((await s.store.inbound('owner')).pending_batch, first.batch_id);
  s.sqlite.exec('DROP TRIGGER fixture_ack_failure'); assert.equal((await s.bridge.ackOwnerText('owner', first.batch_id)).acknowledged, true);
});
test('inbound tools require owner, origin and exact arguments before reading', async () => {
  const s = setup(); await inboundReady(s); let calls = 0; s.client.ownerTextUpdates = async () => { calls++; return {}; };
  const request = (name, args, who = 'owner', origin = null) => new Request('https://owner.example/mcp', { method: 'POST', headers: { ...(who ? { 'oai-authenticated-user-id': who, 'oai-authenticated-user-email': 'fixture@example.invalid' } : {}), ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
  for (const [name, args] of [['wechat_inbound_set_enabled', { enabled: true }], ['wechat_read_owner_text', {}], ['wechat_ack_owner_text', { batch_id: crypto.randomUUID() }]]) {
    assert.equal((await handleMcp(request(name, args, ''), () => s.bridge)).status, 401);
    assert.equal((await handleMcp(request(name, args, 'other'), () => s.bridge)).status, 403);
    assert.equal((await handleMcp(request(name, args, 'owner', 'https://evil.invalid'), () => s.bridge)).status, 403);
    for (const override of [{ recipient: 'other' }, { cursor: '' }, { force: true }, { interval_seconds: 0 }, { message_id: '1' }]) {
      const result = await (await handleMcp(request(name, { ...args, ...override }), () => s.bridge)).json(); assert.equal(result.result.isError, true);
    }
  }
  assert.equal(calls, 0);
});
test('bounded inbound parser rejects invalid and oversized data without changing text', async () => {
  const row = { base_url: API_BASE, bot_token: 'fixture-only' };
  for (const body of ['null', '{broken', new Uint8Array([0xff]), ' '.repeat(1024 * 1024 + 1)]) {
    const client = new TencentClient(async () => new Response(body));
    await assert.rejects(client.ownerTextUpdates(row, 'cursor'), e => ['invalid_tencent_response', 'inbound_response_too_large'].includes(e.code));
  }
  const text = 'literal "message_id":18446744073709551615';
  const wire = JSON.stringify({ msgs: [inboundMessage('replace-number', text)] }).replace('"replace-number"', '18446744073709551615');
  const client = new TencentClient(async () => new Response(wire)); const parsed = await client.ownerTextUpdates(row, 'cursor');
  assert.equal(parsed.msgs[0].message_id, '18446744073709551615'); assert.equal(parsed.msgs[0].item_list[0].text_item.text, text);
});
test('stale pre-ACK snapshots cannot claim an old cursor and dedup prunes only on progress', async () => {
  const s = setup(); await inboundReady(s); let body = 'a'.repeat(45000);
  s.client.ownerTextUpdates = async () => ({ msgs: [inboundMessage('9', body)], get_updates_buf: 'after-long' });
  const first = await s.bridge.readOwnerText('owner'); const stale = await s.store.inbound('owner'); const row = await s.store.get();
  await s.bridge.ackOwnerText('owner', first.batch_id); s.advance(8 * 86400000);
  assert.equal(await s.store.claimInbound('owner', row.binding_generation, 'stale-lease', Date.parse('2030-01-23T04:00:00Z'), INBOUND_INTERVAL, INBOUND_LEASE, stale), false);
  assert.equal(s.sqlite.prepare('SELECT COUNT(*) AS n FROM inbound_dedup').get().n, 20);
  const rest = await s.bridge.readOwnerText('owner'); assert.equal(rest.messages.length, 3);
  await s.bridge.ackOwnerText('owner', rest.batch_id);
  assert.equal(s.sqlite.prepare('SELECT COUNT(*) AS n FROM inbound_dedup').get().n, 3);
  assert.equal((await s.store.inbound('owner')).cursor, 'after-long');
});

test('public candidate exposes only the eight bounded tools and no personal schedule sender', async () => {
  const s = setup();
  assert.equal(typeof s.bridge.sendSchedule, 'undefined');
  assert.equal(MCP_TOOLS.length, 8);
  assert.equal(MCP_TOOLS.some(tool => tool.name === 'wechat_send_approved_schedule'), false);
  assert.equal(Object.hasOwn(await s.bridge.status('owner'), 'schedule_notice'), false);
  const request = new Request('https://owner.example/mcp', {
    method: 'POST', headers: { 'oai-authenticated-user-id': 'owner', 'oai-authenticated-user-email': 'owner@example.invalid' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'wechat_send_approved_schedule', arguments: {} } }),
  });
  const result = await (await handleMcp(request, () => s.bridge)).json();
  assert.equal(result.error.code, -32602);
  assert.equal(s.count().sends, 0);
});
