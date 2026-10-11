import { BridgeError, TencentClient, allowedBase, safeStatus, selectContext, validateTestKind } from './wechat.mjs';
import { beijingDayStart, NOTICE_COOLDOWN, NOTICE_DAILY_CAP, noticeHash, prepareBriefNotice, safeBriefNotice, validateNoticeTime } from './notifications.mjs';
import { InboundReceiver, safeInboundStatus } from './inbound.mjs';
export const CONSENT_VERSION = 'wechat-test-v1';
export class Bridge {
  constructor(store, client = new TencentClient(), clock = () => Date.now()) { this.store = store; this.client = client; this.clock = clock; }
  async row(owner) {
    if (!owner) throw new BridgeError('sign_in_required', 401);
    const row = await this.store.get();
    if (row && row.owner_id !== owner) throw new BridgeError('owner_only', 403);
    return row;
  }
  async status(owner) { const row = await this.row(owner); return { ...safeStatus(row, await this.store.runs(owner), this.clock()), notifications: await this.notificationStatus(owner, row), inbound: safeInboundStatus(await this.store.inbound(owner), row, this.clock()) }; }
  async setInbound(owner, enabled) { return new InboundReceiver(this.store, this.client, this.clock).set(owner, await this.row(owner), enabled); }
  async readOwnerText(owner) { return new InboundReceiver(this.store, this.client, this.clock).read(owner, await this.row(owner)); }
  async ackOwnerText(owner, batch) { return new InboundReceiver(this.store, this.client, this.clock).ack(owner, await this.row(owner), batch); }
  async notificationStatus(owner, row) {
    const now = this.clock(); const prefs = await this.store.preferences(owner); const counts = await this.store.notificationCounts(owner, beijingDayStart(now));
    return { enabled: !!row?.bot_token && prefs?.enabled === 1 && prefs.binding_generation === row.binding_generation,
      cooldown_seconds: NOTICE_COOLDOWN / 1000, daily_limit: NOTICE_DAILY_CAP, attempts_today: counts?.today_count || 0,
      next_allowed_at: Math.max(counts?.last_attempt == null ? now : counts.last_attempt + NOTICE_COOLDOWN, (counts?.today_count || 0) >= NOTICE_DAILY_CAP ? beijingDayStart(now) + 86400000 : now) };
  }
  async setNotifications(owner, enabled) {
    const row = await this.row(owner);
    if (typeof enabled !== 'boolean') throw new BridgeError('invalid_arguments');
    if (!row?.bot_token || !row.binding_generation) throw new BridgeError('not_connected', 409);
    if (enabled && !row.context_token) throw new BridgeError('first_message_required', 409);
    if (!(await this.store.setNotifications(owner, row.binding_generation, enabled, this.clock()))) throw new BridgeError('connection_changed', 409);
    return this.notificationStatus(owner, row);
  }
  async sendBriefNotice(owner, input) {
    const row = await this.row(owner);
    const prepared = prepareBriefNotice(input);
    const keyHash = await noticeHash(input.dedup_key); const payloadHash = await noticeHash(prepared.canonical);
    const recorded = await this.store.briefNotice(owner, keyHash);
    const replay = existing => {
      if (existing.payload_hash !== payloadHash) throw new BridgeError('dedup_key_conflict', 409);
      return { ...safeBriefNotice(existing), already_attempted: true };
    };
    if (recorded) return replay(recorded);
    if (!row?.bot_token || !row.binding_generation || !row.recipient_id) throw new BridgeError('not_connected', 409);
    if (!row.context_token) throw new BridgeError('first_message_required', 409);
    validateNoticeTime(prepared.eventAt, this.clock());
    const settings = await this.notificationStatus(owner, row);
    if (!settings.enabled) throw new BridgeError('notifications_disabled', 409);
    const clientId = 'bridge-brief-' + crypto.randomUUID(); const now = this.clock();
    if (!(await this.store.claimBriefNotice(owner, row.binding_generation, keyHash, payloadHash, clientId, now, now - NOTICE_COOLDOWN, beijingDayStart(now), NOTICE_DAILY_CAP))) {
      const existing = await this.store.briefNotice(owner, keyHash); if (existing) return replay(existing);
      if (!(await this.store.notificationConnectionActive(owner, row.binding_generation))) throw new BridgeError('notifications_disabled_or_connection_changed', 409);
      throw new BridgeError('notification_rate_limited', 429);
    }
    try {
      if (!(await this.store.notificationConnectionActive(owner, row.binding_generation))) throw new BridgeError('notification_cancelled', 409);
      validateNoticeTime(prepared.eventAt, this.clock());
      await this.client.sendApprovedNotice(row, prepared.text, clientId);
      await this.store.finishBriefNotice(owner, keyHash, 'accepted');
    } catch (e) {
      const code = e instanceof BridgeError ? e.code : 'send_outcome_unknown';
      const state = ['notification_cancelled', 'notification_event_expired', 'notification_event_too_far'].includes(code) ? 'not_sent'
        : ['tencent_rejected', 'wechat_session_expired', 'tencent_redirect_rejected'].includes(code) ? 'rejected' : 'uncertain';
      await this.store.finishBriefNotice(owner, keyHash, state, code);
      return { ...safeBriefNotice(await this.store.briefNotice(owner, keyHash)), already_attempted: false };
    }
    return { ...safeBriefNotice(await this.store.briefNotice(owner, keyHash)), already_attempted: false };
  }
  async begin(owner, consent) {
    const row = await this.row(owner);
    if (consent !== CONSENT_VERSION) throw new BridgeError('explicit_consent_required', 403);
    if (row?.bot_token) throw new BridgeError('already_connected', 409);
    const activeFlow = r => {
      if (!r.qr_payload) throw new BridgeError('qr_preparing', 409);
      return { flow_id: r.flow_id, qr_payload: r.qr_payload, expires_at: r.qr_expires };
    };
    if (row?.qr_expires > this.clock()) return activeFlow(row);
    const flow = crypto.randomUUID();
    if (!(await this.store.reserve(owner, this.clock(), flow))) {
      const current = await this.row(owner);
      if (current?.bot_token) throw new BridgeError('already_connected', 409);
      return activeFlow(current);
    }
    try {
      const qr = await this.client.qr();
      if (typeof qr.qrcode !== 'string' || !qr.qrcode || qr.qrcode.length > 4096 || typeof qr.qrcode_img_content !== 'string' || !qr.qrcode_img_content || qr.qrcode_img_content.length > 4096) throw new BridgeError('invalid_qr_response', 502);
      if (!(await this.store.fillQr(owner, flow, this.clock(), qr))) throw new BridgeError('qr_expired', 409);
      return activeFlow(await this.row(owner));
    } catch (error) {
      await this.store.cancelFlow(owner, flow);
      throw error;
    }
  }

  async poll(owner, flow) {
    const row = await this.row(owner);
    if (row?.bot_token) return { state: 'confirmed' };
    if (!flow || row?.flow_id !== flow || row.qr_expires <= this.clock()) throw new BridgeError('qr_expired', 409);
    const data = await this.client.poll(row.qr_id);
    if (data.status === 'confirmed') {
      for (const key of ['bot_token', 'ilink_bot_id', 'ilink_user_id']) if (typeof data[key] !== 'string' || !data[key] || data[key].length > 16384) throw new BridgeError('incomplete_binding', 502);
      data.baseurl = allowedBase(data.baseurl);
      if (!(await this.store.bind(owner, flow, this.clock(), data))) throw new BridgeError('qr_expired', 409);
      return { state: 'confirmed' };
    }
    if (data.status === 'scaned_but_redirect' || data.status === 'binded_redirect') throw new BridgeError('unsupported_tencent_redirect', 409);
    if (data.status === 'need_verifycode' || data.status === 'verify_code_blocked') throw new BridgeError('verification_requires_supported_flow', 409);
    if (data.status === 'expired') { await this.store.cancelFlow(owner, flow); throw new BridgeError('qr_expired', 409); }
    return { state: data.status === 'scaned' ? 'scanned' : 'waiting' };
  }
  async refresh(owner) {
    const row = await this.row(owner);
    if (!row?.bot_token) throw new BridgeError('not_connected', 409);
    // Preserve the original context for the entire immediate/next-day experiment.
    if (row.context_token) return this.status(owner);
    allowedBase(row.base_url);
    const data = await this.client.updates(row);
    const token = selectContext(data.msgs, row);
    const cursor = typeof data.get_updates_buf === 'string' && data.get_updates_buf.length > 0 && data.get_updates_buf.length < 65536 ? data.get_updates_buf : row.cursor || '';
    await this.store.context(owner, row.binding_generation, cursor, token, this.clock());
    return this.status(owner);
  }
  async send(owner, input) {
    const kind = validateTestKind(input);
    const row = await this.row(owner);
    if (!row?.bot_token) throw new BridgeError('not_connected', 409);
    if (!row.context_token) throw new BridgeError('first_message_required', 409);
    if (kind === 'next_day') {
      const runs = await this.store.runs(owner);
      if (!runs.some(r => r.kind === 'immediate' && r.confirmed_at && r.binding_generation === row.binding_generation)) throw new BridgeError('confirm_first_delivery', 409);
      if (this.clock() - row.context_at < 24 * 3600 * 1000) throw new BridgeError('wait_24_hours', 409);
    }
    const clientId = 'bridge-test-' + crypto.randomUUID();
    if (!(await this.store.claim(owner, row.binding_generation, kind, clientId, this.clock()))) throw new BridgeError('test_already_attempted', 409);
    try {
      await this.client.send(row, kind, clientId);
      await this.store.finish(owner, kind, 'accepted');
    } catch (e) {
      const code = e instanceof BridgeError ? e.code : 'send_outcome_unknown';
      await this.store.finish(owner, kind, code === 'tencent_rejected' || code === 'wechat_session_expired' ? 'rejected' : 'uncertain', code);
      throw new BridgeError(code, 502);
    }
    return this.status(owner);
  }
  async receipt(owner, kind) { await this.row(owner); await this.store.receipt(owner, validateTestKind(kind), this.clock()); return this.status(owner); }
  async disconnect(owner) { await this.row(owner); await this.store.disconnect(owner); return this.status(owner); }
}
