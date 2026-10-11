import { bridge } from '@/lib/runtime';
import { identity, sameOrigin, json, failure, readSmallJson, exactKeys } from '@/lib/http.mjs';
import { BridgeError } from '@/lib/wechat.mjs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try { return json(await bridge().status(identity(request))); } catch (e) { return failure(e); }
}
export async function POST(request: Request) {
  try {
    const owner = identity(request); sameOrigin(request);
    const input = await readSmallJson(request);
    exactKeys(input, ['action', 'consent', 'flow_id', 'kind']);
    const b = bridge();
    switch (input.action) {
      case 'begin': return json(await b.begin(owner, input.consent));
      case 'poll': return json(await b.poll(owner, input.flow_id));
      case 'refresh': return json(await b.refresh(owner));
      case 'send': return json(await b.send(owner, input.kind));
      case 'receipt': return json(await b.receipt(owner, input.kind));
      case 'disconnect': return json(await b.disconnect(owner));
      case 'notifications_off': return json(await b.setNotifications(owner, false));
      case 'inbound_off': return json(await b.setInbound(owner, false));
      default: throw new BridgeError('invalid_action');
    }
  } catch (e) { return failure(e); }
}
