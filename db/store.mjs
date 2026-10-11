export class Store {
  constructor(db) { this.db = db; }
  get() { return this.db.prepare('SELECT * FROM binding WHERE id = 1').first(); }
  async runs(owner) { return (await this.db.prepare('SELECT * FROM test_runs WHERE owner_id = ? ORDER BY attempted_at').bind(owner).all()).results || []; }
  async reserve(owner, now, flow) {
    const result = await this.db.prepare(`INSERT INTO binding (id, owner_id, consent_version, consent_at, binding_generation, flow_id, qr_expires)
      VALUES (1, ?, 'wechat-test-v1', ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET consent_at = excluded.consent_at, binding_generation = excluded.binding_generation, qr_id = NULL, qr_payload = NULL, flow_id = excluded.flow_id, qr_expires = excluded.qr_expires
      WHERE binding.owner_id = excluded.owner_id AND binding.bot_token IS NULL AND (binding.qr_expires IS NULL OR binding.qr_expires <= ?)`)
      .bind(owner, now, flow, flow, now + 5 * 60 * 1000, now).run();
    return result.meta.changes === 1;
  }
  async fillQr(owner, flow, now, qr) {
    const result = await this.db.prepare('UPDATE binding SET qr_id = ?, qr_payload = ? WHERE id = 1 AND owner_id = ? AND flow_id = ? AND qr_expires > ? AND bot_token IS NULL').bind(qr.qrcode, qr.qrcode_img_content, owner, flow, now).run();
    return result.meta.changes === 1;
  }
  async cancelFlow(owner, flow) {
    await this.db.prepare('UPDATE binding SET qr_id = NULL, qr_payload = NULL, flow_id = NULL, qr_expires = NULL WHERE id = 1 AND owner_id = ? AND flow_id = ? AND bot_token IS NULL').bind(owner, flow).run();
  }
  async bind(owner, flow, now, data) {
    const r = await this.db.prepare(`UPDATE binding SET bot_token = ?, bot_id = ?, recipient_id = ?, base_url = ?, qr_id = NULL, qr_payload = NULL, flow_id = NULL, qr_expires = NULL WHERE id = 1 AND owner_id = ? AND flow_id = ? AND qr_expires > ? AND bot_token IS NULL`).bind(data.bot_token, data.ilink_bot_id, data.ilink_user_id, data.baseurl, owner, flow, now).run();
    return r.meta.changes === 1;
  }
  async context(owner, generation, cursor, token, at) {
    const result = await this.db.prepare('UPDATE binding SET cursor = ?, context_token = ?, context_at = CASE WHEN ? IS NOT NULL THEN ? ELSE context_at END WHERE id = 1 AND owner_id = ? AND binding_generation = ? AND bot_token IS NOT NULL AND context_token IS NULL').bind(cursor, token, token, at, owner, generation).run();
    return result.meta.changes === 1;
  }
  async claim(owner, generation, kind, clientId, at) {
    const r = await this.db.prepare("INSERT OR IGNORE INTO test_runs (kind, owner_id, binding_generation, client_id, state, attempted_at) SELECT ?, ?, ?, ?, 'sending', ? FROM binding WHERE id = 1 AND owner_id = ? AND binding_generation = ? AND bot_token IS NOT NULL AND context_token IS NOT NULL").bind(kind, owner, generation, clientId, at, owner, generation).run();
    return r.meta.changes === 1;
  }
  async finish(owner, kind, state, error = null) {
    await this.db.prepare('UPDATE test_runs SET state = ?, error_code = ? WHERE kind = ? AND owner_id = ?').bind(state, error, kind, owner).run();
  }
  async receipt(owner, kind, at) {
    await this.db.prepare("UPDATE test_runs SET confirmed_at = ? WHERE kind = ? AND owner_id = ? AND state IN ('accepted', 'uncertain', 'sending')").bind(at, kind, owner).run();
  }
  preferences(owner) { return this.db.prepare('SELECT enabled, binding_generation FROM notification_preferences WHERE owner_id = ?').bind(owner).first(); }
  async setNotifications(owner, generation, enabled, now) {
    const result = await this.db.prepare(`INSERT INTO notification_preferences (owner_id, binding_generation, enabled, updated_at)
      SELECT ?, ?, ?, ? FROM binding WHERE id = 1 AND owner_id = ? AND binding_generation = ? AND bot_token IS NOT NULL
      ON CONFLICT(owner_id) DO UPDATE SET binding_generation = excluded.binding_generation, enabled = excluded.enabled, updated_at = excluded.updated_at`)
      .bind(owner, generation, enabled ? 1 : 0, now, owner, generation).run();
    return result.meta.changes === 1;
  }
  notificationCounts(owner, dayStart) {
    return this.db.prepare('SELECT MAX(attempted_at) AS last_attempt, COUNT(CASE WHEN attempted_at >= ? THEN 1 END) AS today_count FROM brief_notices WHERE owner_id = ?').bind(dayStart, owner).first();
  }
  briefNotice(owner, hash) { return this.db.prepare('SELECT state, attempted_at, error_code, payload_hash FROM brief_notices WHERE owner_id = ? AND dedup_hash = ?').bind(owner, hash).first(); }
  async claimBriefNotice(owner, generation, keyHash, payloadHash, clientId, now, cutoff, dayStart, dailyCap) {
    const result = await this.db.prepare(`INSERT OR IGNORE INTO brief_notices (dedup_hash, payload_hash, owner_id, binding_generation, client_id, state, attempted_at)
      SELECT ?, ?, ?, ?, ?, 'sending', ? FROM binding b JOIN notification_preferences p ON p.owner_id = b.owner_id
      WHERE b.id = 1 AND b.owner_id = ? AND b.binding_generation = ? AND b.bot_token IS NOT NULL AND b.recipient_id IS NOT NULL AND b.context_token IS NOT NULL
      AND p.enabled = 1 AND p.binding_generation = b.binding_generation
      AND NOT EXISTS (SELECT 1 FROM brief_notices WHERE owner_id = ? AND attempted_at > ?)
      AND (SELECT COUNT(*) FROM brief_notices WHERE owner_id = ? AND attempted_at >= ?) < ?`)
      .bind(keyHash, payloadHash, owner, generation, clientId, now, owner, generation, owner, cutoff, owner, dayStart, dailyCap).run();
    return result.meta.changes === 1;
  }
  notificationConnectionActive(owner, generation) {
    return this.db.prepare(`SELECT 1 AS active FROM binding b JOIN notification_preferences p ON p.owner_id = b.owner_id
      WHERE b.id = 1 AND b.owner_id = ? AND b.binding_generation = ? AND b.bot_token IS NOT NULL AND p.enabled = 1 AND p.binding_generation = b.binding_generation`).bind(owner, generation).first();
  }
  async finishBriefNotice(owner, hash, state, error = null) {
    await this.db.prepare('UPDATE brief_notices SET state = ?, error_code = ? WHERE owner_id = ? AND dedup_hash = ?').bind(state, error, owner, hash).run();
  }
  inbound(owner) { return this.db.prepare('SELECT * FROM inbound_state WHERE owner_id = ?').bind(owner).first(); }
  async setInbound(owner, generation, enabled, cursor, now) {
    const kept = ['cursor', 'enabled_at', 'last_poll_at', 'pending_batch', 'pending_cursor', 'pending_keys', 'last_ack_batch'];
    const assignments = kept.map(key => `${key} = CASE WHEN inbound_state.binding_generation = excluded.binding_generation THEN inbound_state.${key} ELSE excluded.${key} END`).join(', ');
    const r = await this.db.prepare(`INSERT INTO inbound_state (owner_id, binding_generation, enabled, enabled_at, cursor)
      SELECT ?, ?, ?, ?, ? FROM binding WHERE id = 1 AND owner_id = ? AND binding_generation = ? AND bot_token IS NOT NULL
      ON CONFLICT(owner_id) DO UPDATE SET ${assignments},
      lease_id = CASE WHEN inbound_state.binding_generation = excluded.binding_generation AND excluded.enabled = 1 THEN inbound_state.lease_id ELSE NULL END,
      lease_expires = CASE WHEN inbound_state.binding_generation = excluded.binding_generation AND excluded.enabled = 1 THEN inbound_state.lease_expires ELSE NULL END,
      binding_generation = excluded.binding_generation, enabled = excluded.enabled, error_code = NULL`)
      .bind(owner, generation, enabled ? 1 : 0, now, cursor, owner, generation).run();
    return r.meta.changes === 1;
  }
  async claimInbound(owner, generation, lease, now, interval, duration, state) {
    const r = await this.db.prepare(`UPDATE inbound_state SET lease_id = ?, lease_expires = ?, last_poll_at = ?, error_code = NULL
      WHERE owner_id = ? AND binding_generation = ? AND enabled = 1
      AND cursor = ? AND pending_batch IS ?
      AND (lease_id IS NULL OR lease_expires <= ?) AND (last_poll_at IS NULL OR last_poll_at <= ?)
      AND EXISTS (SELECT 1 FROM binding WHERE id = 1 AND owner_id = ? AND binding_generation = ? AND bot_token IS NOT NULL)`)
      .bind(lease, now + duration, now, owner, generation, state.cursor, state.pending_batch, now, now - interval, owner, generation).run();
    return r.meta.changes === 1;
  }
  async inboundAcknowledged(owner, generation) {
    const r = await this.db.prepare('SELECT message_key, fingerprint FROM inbound_dedup WHERE owner_id = ? AND binding_generation = ?').bind(owner, generation).all();
    return r.results || [];
  }
  async stageInbound(owner, generation, lease, batch, cursor, keys, now) {
    const r = await this.db.prepare(`UPDATE inbound_state SET cursor = CASE WHEN ? IS NULL THEN ? ELSE cursor END,
      pending_batch = ?, pending_cursor = ?, pending_keys = ?, lease_id = NULL, lease_expires = NULL, error_code = NULL
      WHERE owner_id = ? AND binding_generation = ? AND enabled = 1 AND lease_id = ? AND lease_expires > ? AND pending_batch IS NULL
      AND EXISTS (SELECT 1 FROM binding WHERE id = 1 AND owner_id = ? AND binding_generation = ? AND bot_token IS NOT NULL)`)
      .bind(batch, cursor, batch, batch ? cursor : null, batch ? JSON.stringify(keys) : null, owner, generation, lease, now, owner, generation).run();
    return r.meta.changes === 1;
  }
  async releaseInbound(owner, generation, lease, error = null, batch = null, now = 0) {
    const r = await this.db.prepare(`UPDATE inbound_state SET lease_id = NULL, lease_expires = NULL, error_code = ?
      WHERE owner_id = ? AND binding_generation = ? AND lease_id = ? AND enabled = 1 AND (? IS NOT NULL OR lease_expires > ?)
      AND (? IS NULL OR pending_batch = ?)
      AND EXISTS (SELECT 1 FROM binding WHERE id = 1 AND owner_id = ? AND binding_generation = ? AND bot_token IS NOT NULL)`)
      .bind(error, owner, generation, lease, error, now, batch, batch, owner, generation).run();
    return r.meta.changes === 1;
  }
  async ackInbound(owner, generation, state, now) {
    const keys = JSON.parse(state.pending_keys); const batch = state.pending_batch;
    const gate = `owner_id = ? AND binding_generation = ? AND pending_batch = ? AND (lease_id IS NULL OR lease_expires <= ?)
      AND EXISTS (SELECT 1 FROM binding WHERE id = 1 AND owner_id = ? AND binding_generation = ? AND bot_token IS NOT NULL)`;
    const gateArgs = [owner, generation, batch, now, owner, generation];
    const statements = keys.map(item => this.db.prepare(`INSERT OR IGNORE INTO inbound_dedup (message_key, fingerprint, owner_id, binding_generation, acknowledged_at)
      SELECT ?, ?, ?, ?, ? FROM inbound_state WHERE ${gate}`).bind(item.key, item.fingerprint, owner, generation, now, ...gateArgs));
    statements.push(this.db.prepare(`UPDATE inbound_state SET cursor = pending_cursor, last_ack_batch = pending_batch,
      pending_batch = NULL, pending_cursor = NULL, pending_keys = NULL, lease_id = NULL, lease_expires = NULL WHERE ${gate}`).bind(...gateArgs));
    if (state.pending_cursor !== state.cursor) statements.push(this.db.prepare(`DELETE FROM inbound_dedup WHERE owner_id = ? AND acknowledged_at < ?
      AND EXISTS (SELECT 1 FROM inbound_state WHERE owner_id = ? AND binding_generation = ? AND last_ack_batch = ?)`)
      .bind(owner, now - 7 * 86400000, owner, generation, batch));
    const result = await this.db.batch(statements); return result[keys.length].meta.changes === 1;
  }
  async disconnect(owner) {
    await this.db.prepare('UPDATE binding SET binding_generation = NULL, bot_token = NULL, bot_id = NULL, recipient_id = NULL, base_url = NULL, context_token = NULL, context_at = NULL, cursor = NULL, qr_id = NULL, qr_payload = NULL, flow_id = NULL, qr_expires = NULL WHERE id = 1 AND owner_id = ?').bind(owner).run();
  }
}
