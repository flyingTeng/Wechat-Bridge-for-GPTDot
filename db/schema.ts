import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const binding = sqliteTable('binding', {
  id: integer('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  consentVersion: text('consent_version').notNull(),
  bindingGeneration: text('binding_generation'),
  consentAt: integer('consent_at').notNull(),
  botToken: text('bot_token'), botId: text('bot_id'), recipientId: text('recipient_id'), baseUrl: text('base_url'),
  contextToken: text('context_token'), contextAt: integer('context_at'), cursor: text('cursor'),
  qrId: text('qr_id'), qrPayload: text('qr_payload'), flowId: text('flow_id'), qrExpires: integer('qr_expires'),
});
export const testRuns = sqliteTable('test_runs', {
  kind: text('kind').primaryKey(), ownerId: text('owner_id').notNull(),
  bindingGeneration: text('binding_generation'),
  clientId: text('client_id').notNull(), state: text('state').notNull(), attemptedAt: integer('attempted_at').notNull(),
  confirmedAt: integer('confirmed_at'), errorCode: text('error_code'),
});

export const ownerNotices = sqliteTable('owner_notices', {
  noticeKey: text('notice_key').primaryKey(),
  ownerId: text('owner_id').notNull(),
  bindingGeneration: text('binding_generation').notNull(),
  clientId: text('client_id').notNull(),
  state: text('state').notNull(),
  attemptedAt: integer('attempted_at').notNull(),
  errorCode: text('error_code'),
});
export const notificationPreferences = sqliteTable('notification_preferences', {
  ownerId: text('owner_id').primaryKey(), bindingGeneration: text('binding_generation').notNull(),
  enabled: integer('enabled').notNull().default(0), updatedAt: integer('updated_at').notNull(),
});
export const briefNotices = sqliteTable('brief_notices', {
  dedupHash: text('dedup_hash').primaryKey(), payloadHash: text('payload_hash').notNull(),
  ownerId: text('owner_id').notNull(), bindingGeneration: text('binding_generation').notNull(),
  clientId: text('client_id').notNull(), state: text('state').notNull(),
  attemptedAt: integer('attempted_at').notNull(), errorCode: text('error_code'),
});
export const inboundState = sqliteTable('inbound_state', {
  ownerId: text('owner_id').primaryKey(), bindingGeneration: text('binding_generation').notNull(),
  enabled: integer('enabled').notNull().default(0), enabledAt: integer('enabled_at').notNull(),
  cursor: text('cursor').notNull(), lastPollAt: integer('last_poll_at'),
  leaseId: text('lease_id'), leaseExpires: integer('lease_expires'),
  pendingBatch: text('pending_batch'), pendingCursor: text('pending_cursor'), pendingKeys: text('pending_keys'),
  lastAckBatch: text('last_ack_batch'), errorCode: text('error_code'),
});
export const inboundDedup = sqliteTable('inbound_dedup', {
  messageKey: text('message_key').primaryKey(), ownerId: text('owner_id').notNull(),
  bindingGeneration: text('binding_generation').notNull(), acknowledgedAt: integer('acknowledged_at').notNull(),
  fingerprint: text('fingerprint').notNull().default(''),
});
