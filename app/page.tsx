import { requireChatGPTUser } from './chatgpt-auth';
import BridgePanel from './bridge-panel';
export const dynamic = 'force-dynamic';
export default async function Home() {
  await requireChatGPTUser('/');
  return <BridgePanel />;
}
