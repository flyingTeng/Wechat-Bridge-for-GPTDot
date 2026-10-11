import { bridge } from '@/lib/runtime';
import { handleMcp } from '@/lib/mcp.mjs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) { return handleMcp(request, bridge); }
export async function GET() { return new Response('Stateless MCP: use POST', { status: 405, headers: { Allow: 'POST' } }); }
