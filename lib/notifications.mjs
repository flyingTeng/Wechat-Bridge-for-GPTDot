import { BridgeError } from './wechat.mjs';
import { exactKeys } from './http.mjs';
export const NOTIFICATION_TOPICS = Object.freeze({ paper_reading: '论文阅读', research_digest: '科研简报', mail_github: '邮件与 GitHub', codex_quota: 'Codex 用量', schedule: '日程', general_work: '工作安排' });
export const NOTIFICATION_INTENTS = Object.freeze({ ready: '已准备好', needs_attention: '有件事需要你看一下', reminder: '提醒你留意一下' });
export const NOTICE_COOLDOWN = 10 * 60 * 1000;
export const NOTICE_DAILY_CAP = 6;
export const BEIJING_OFFSET = 8 * 3600 * 1000;
export function beijingDayStart(now) { return Math.floor((now + BEIJING_OFFSET) / 86400000) * 86400000 - BEIJING_OFFSET; }
export function prepareBriefNotice(input) {
  exactKeys(input, ['dedup_key', 'topic', 'intent', 'event_date', 'event_time']);
  if (typeof input.dedup_key !== 'string' || !/^[a-z0-9][a-z0-9_.:-]{0,79}$/.test(input.dedup_key)) throw new BridgeError('invalid_dedup_key');
  if (typeof input.topic !== 'string' || typeof input.intent !== 'string' || !Object.hasOwn(NOTIFICATION_TOPICS, input.topic) || !Object.hasOwn(NOTIFICATION_INTENTS, input.intent)) throw new BridgeError('invalid_notice_template');
  let eventAt = null;
  if (input.event_date !== undefined || input.event_time !== undefined) {
    if (typeof input.event_date !== 'string' || !/^20\d\d-\d{2}-\d{2}$/.test(input.event_date)
        || typeof input.event_time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.event_time)) throw new BridgeError('invalid_event_time');
    eventAt = Date.parse(`${input.event_date}T${input.event_time}:00+08:00`);
    if (!Number.isFinite(eventAt) || new Date(eventAt + BEIJING_OFFSET).toISOString().slice(0, 16) !== `${input.event_date}T${input.event_time}`) throw new BridgeError('invalid_event_time');
  }
  const text = `助手找你：${NOTIFICATION_TOPICS[input.topic]}${input.intent === 'ready' ? '' : '，'}${NOTIFICATION_INTENTS[input.intent]}。${eventAt === null ? '' : `时间：${input.event_date} ${input.event_time}（北京时间）。`}详细内容请回助手的 ChatGPT 对话查看。`;
  return { text, eventAt, canonical: JSON.stringify([input.topic, input.intent, input.event_date || null, input.event_time || null]) };
}
export function validateNoticeTime(eventAt, now) {
  if (eventAt !== null && eventAt <= now) throw new BridgeError('notification_event_expired', 409);
  if (eventAt !== null && eventAt - now > 31 * 86400000) throw new BridgeError('notification_event_too_far', 409);
}
export async function noticeHash(value) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('');
}
export function safeBriefNotice(row) { return { state: row.state, attempted_at: row.attempted_at, error: row.error_code || null }; }
