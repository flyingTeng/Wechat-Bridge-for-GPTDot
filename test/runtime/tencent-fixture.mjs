function assert(value, message) { if (!value) throw new Error(message); }
let requestCount = 0;
const tencentFixture = {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.origin === 'https://ilinkai.weixin.qq.com' && url.pathname === '/__fixture_count') return Response.json({ requestCount });
    requestCount++;
    assert(url.origin === 'https://ilinkai.weixin.qq.com', 'Unexpected request origin');
    assert(request.headers.get('iLink-App-Id') === 'bot', 'Missing app metadata');
    if (url.pathname === '/ilink/bot/get_qrcode_status') {
      assert(request.method === 'GET', 'QR poll must be GET');
      assert(!request.headers.has('Authorization'), 'QR poll must not carry bot authorization');
      if (url.searchParams.get('qrcode') === 'fixture-redirect') return new Response(null, {status: 302, headers: { Location: 'https://example.invalid/never-follow' }});
      return Response.json({ status: 'wait' });
    }
    assert(request.method === 'POST', 'API call must be POST');
    const body = await request.json();
    if (url.pathname === '/ilink/bot/get_bot_qrcode') {
      assert(!request.headers.has('Authorization'), 'QR creation must not carry bot authorization');
      assert(Array.isArray(body.local_token_list) && !body.local_token_list.length, 'QR creation must not upload old credentials');
      return Response.json({ qrcode: 'fixture-qr', qrcode_img_content: 'fixture-payload' });
    }
    assert(request.headers.get('Authorization') === 'Bearer fixture-bot', 'Authenticated request metadata mismatch');
    if (url.pathname === '/ilink/bot/getupdates') {
      if (body.get_updates_buf === 'fixture-inbound-redirect') return new Response(null, { status: 307, headers: { Location: 'https://example.invalid/never-forward-auth' } });
      if (body.get_updates_buf === 'fixture-owner-text') {
        const owner = { message_id: 'replace-numeric-id', from_user_id: 'fixture-owner', to_user_id: 'fixture-bot-id', message_type: 1, message_state: 0, item_list: [{ type: 1, text_item: { text: 'native-owner-text-fixture' } }] };
        const text = JSON.stringify({ ret: 0, msgs: [owner, { ...owner, message_id: '2', from_user_id: 'someone-else' }], get_updates_buf: 'fixture-inbound-next' }).replace('"replace-numeric-id"', '18446744073709551615');
        return new Response(text, { headers: { 'Content-Type': 'application/json' } });
      }
      return Response.json({ ret: 0, msgs: [], get_updates_buf: 'fixture-cursor' });
    }
    if (url.pathname === '/ilink/bot/sendmessage') {
      if (body.msg.client_id === 'fixture-redirect') return new Response(null, {status: 307, headers: { Location: 'https://example.invalid/never-forward-auth' }});
      assert(body.msg.to_user_id === 'fixture-owner', 'Unexpected test recipient');
      if (body.msg.client_id === 'fixture-approved-notice') assert(body.msg.item_list[0].text_item.text === '这是一条本地固定通知测试。', 'Expected exact local fixture');
      else if (body.msg.client_id === 'fixture-brief') assert(body.msg.item_list[0].text_item.text === '助手找你：论文阅读已准备好。详细内容请回助手的 ChatGPT 对话查看。', 'Expected exact enum-generated summons');
      else assert(body.msg.item_list[0].text_item.text.includes('微信连接测试消息'), 'Expected fixed harmless test');
      // Official sendMessage accepts an omitted ret. Exercise both send paths.
      return Response.json(body.msg.client_id === 'fixture-approved-notice' ? { errcode: 0 } : {});
    }
    throw new Error('Unexpected endpoint');
  }
};

export default tencentFixture;
