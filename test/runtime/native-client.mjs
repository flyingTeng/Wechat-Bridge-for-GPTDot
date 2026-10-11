import { TencentClient, API_BASE } from './wechat.mjs';
const FIXTURE_NOTICE_TEXT = '这是一条本地固定通知测试。';
import { prepareBriefNotice } from './notifications.mjs';
import { ownerTextBatch } from './inbound.mjs';
function assert(value, message) { if (!value) throw new Error(message); }
const nativeClientTest = {
  async test() {
    // This test uses actual native Workers fetch. All outbound HTTP is routed
    // to the local fixture service in config.capnp, never to Tencent.
    const client = new TencentClient();
    const qr = await client.qr();
    assert(qr.qrcode === 'fixture-qr', 'Native QR request must reach the fixture');
    assert(qr.qrcode_img_content === 'fixture-payload', 'QR payload must parse');
    const poll = await client.poll('fixture-qr');
    assert(poll.status === 'wait', 'Native QR status request must reach the fixture');
    const updates = await client.updates({ bot_token: 'fixture-bot', cursor: '' });
    assert(updates.ret === 0, 'Native getupdates request must reach the fixture');
    const sent = await client.send({ base_url: API_BASE, bot_token: 'fixture-bot', recipient_id: 'fixture-owner', context_token: 'fixture-context' }, 'immediate', 'fixture-client-id');
    assert(sent === true, 'Native send must accept a valid response with omitted ret');
    let redirectError;
    try { await client.poll('fixture-redirect'); } catch (error) { redirectError = error; }
    assert(redirectError?.code === 'tencent_redirect_rejected', '3xx must be rejected without following');
    let sendRedirectError;
    try { await client.send({ base_url: API_BASE, bot_token: 'fixture-bot', recipient_id: 'fixture-owner', context_token: 'fixture-context' }, 'immediate', 'fixture-redirect'); } catch (error) { sendRedirectError = error; }
    assert(sendRedirectError?.code === 'tencent_redirect_rejected', 'Authenticated send redirect must be rejected');
    const notice = await client.sendApprovedNotice({ base_url: API_BASE, bot_token: 'fixture-bot', recipient_id: 'fixture-owner', context_token: 'fixture-context' }, FIXTURE_NOTICE_TEXT, 'fixture-approved-notice');
    assert(notice === true, 'Approved notice must accept errcode zero without ret');
    const brief = prepareBriefNotice({ dedup_key: 'fixture-brief', topic: 'paper_reading', intent: 'ready' });
    await client.sendApprovedNotice({ base_url: API_BASE, bot_token: 'fixture-bot', recipient_id: 'fixture-owner', context_token: 'fixture-context' }, brief.text, 'fixture-brief');
    const row = { owner_id: 'fixture-platform-owner', binding_generation: 'fixture-generation', base_url: API_BASE, bot_token: 'fixture-bot', recipient_id: 'fixture-owner', bot_id: 'fixture-bot-id' };
    const incoming = await client.ownerTextUpdates(row, 'fixture-owner-text');
    assert(incoming.msgs[0].message_id === '18446744073709551615', 'Native parser must preserve exact uint64 ID');
    const filtered = await ownerTextBatch(incoming, row, 1, Date.now());
    assert(filtered.messages.length === 1 && filtered.messages[0].text === 'native-owner-text-fixture', 'Only exact verified owner/bot text may remain');
    let inboundRedirect;
    try { await client.ownerTextUpdates(row, 'fixture-inbound-redirect'); } catch (error) { inboundRedirect = error; }
    assert(inboundRedirect?.code === 'tencent_redirect_rejected', 'Inbound auth must not follow a redirect');
    const counts = await (await fetch(API_BASE + '/__fixture_count')).json();
    assert(counts.requestCount === 10, 'Redirect handling must not issue any follow-up request');
    console.log('Native TencentClient: QR creation, QR polling, context retrieval, and fixed-message transport passed with local fixtures only');
  }
};

export default nativeClientTest;
