'use client';
import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { registerStatusTool } from '@/lib/webmcp.mjs';
import { Check, LockKeyhole, MessageCircle, ArrowUpRight, LoaderCircle, Unplug } from 'lucide-react';

type Run = { kind: string; current_connection: boolean; state: string; attempted_at: number; confirmed_at: number | null; error: string | null };
type Status = { state: string; connected: boolean; context_available: boolean; context_recorded_at: number | null; next_day_eligible_at: number | null; tests: Run[]; notifications?: { enabled: boolean; daily_limit: number; attempts_today: number }; inbound?: { enabled: boolean; last_poll_at: number | null; next_poll_at: number; pending_ack_count: number } };
const errorText: Record<string, string> = {
  sign_in_required: '请重新登录这个私有页面。', owner_only: '这个连接只属于最初绑定的页面主人。', service_unavailable: '服务暂时不可用，请稍后查看状态。',
  storage_unavailable: '安全存储暂时不可用，连接尚未开始。', same_origin_required: '请在此页面中操作。', explicit_consent_required: '请先阅读并勾选授权说明。',
  unsupported_tencent_host: '微信返回了尚未核实的服务地址。为保护账号，已停止连接。', unsupported_tencent_redirect: '微信要求切换到另一个服务地址。此最小测试暂不支持，已安全停止。',
  verification_requires_supported_flow: '微信要求额外验证，此最小测试暂不支持。请停止并告诉助手，不要在聊天里提供验证码或密钥。',
  qr_preparing: '二维码正在准备，请稍后再次点击连接。', qr_expired: '二维码已过期，请重新生成。', incomplete_binding: '微信未返回完整的绑定信息，尚未保存连接。', invalid_qr_response: '微信返回的二维码无法使用。',
  tencent_redirect_rejected: '微信接口要求跳转到其他地址。为保护授权信息，连接已停止，请把此提示告诉助手。',
  bridge_runtime_error: '测试服务的请求执行失败，尚未完成这一步。请把此提示告诉助手。',
  qr_request_unavailable: '暂时无法从微信取得二维码，尚未进入扫码步骤，也没有发送测试消息。请把此提示告诉助手。',
  tencent_network_uncertain: '请求中断，结果尚不确定。如果发生在发送期间，为避免重复，不会自动重发。', tencent_http_error: '微信服务未接受请求，请稍后检查连接。',
  tencent_rejected: '微信拒绝了这次测试。暂时无法证明消息可达。', wechat_session_expired: '微信授权已失效。请在微信中检查连接，必要时重新授权。',
  first_message_required: '请先在微信向刚绑定的 ClawBot 发「连接测试」，再读取连接状态。', not_connected: '请先扫码连接微信。',
  confirm_first_delivery: '需要在同一次连接中确认已收到第一条消息。重新绑定不会沿用旧连接的测试结果。', wait_24_hours: '还未满 24 小时。请不要继续向机器人发消息，稍后再测试。',
  test_already_attempted: '这类测试已经尝试过。为避免重复消息，不会再次发送。', send_acceptance_unknown: '微信未返回明确接受状态，结果待确认，不会自动重发。',
};
function date(value: number | null) { return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '尚未开始'; }
function stateText(run?: Run) {
  if (!run) return '尚未发送';
  if (run.confirmed_at) return run.current_connection ? '已确认收到' : '前次连接：已确认收到';
  if (run.state === 'accepted') return '微信已接受，待你确认';
  if (run.state === 'sending') return '发送结果待确认';
  if (run.state === 'rejected') return '微信拒绝';
  return '结果不确定，不会重发';
}
export default function BridgePanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [qr, setQr] = useState<{ flow_id: string; image: string; expires_at: number } | null>(null);
  const [scanState, setScanState] = useState('');
  const [now, setNow] = useState(0);
  const readStatus = useCallback(async () => {
    const r = await fetch('/api/bridge', { cache: 'no-store' }); const data = await r.json() as Status & { error?: string };
    if (!r.ok) throw new Error(data.error || 'service_unavailable');
    setStatus(data); return data;
  }, []);
  const post = useCallback(async (action: string, extra: Record<string, string> = {}) => {
    const r = await fetch('/api/bridge', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bridge-Action': 'owner-ui' }, body: JSON.stringify({ action, ...extra }) });
    const data = await r.json() as { error?: string; qr_payload: string; flow_id: string; expires_at: number; state: string }; if (!r.ok) throw new Error(data.error || 'service_unavailable'); return data;
  }, []);
  useEffect(() => {
    const initial = setTimeout(() => { setNow(Date.now()); readStatus().catch(e => setError(e.message)); }, 0);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearTimeout(initial); clearInterval(timer); };
  }, [readStatus]);
  useEffect(() => registerStatusTool(document, readStatus), [readStatus]);
  async function action(name: string, extra: Record<string, string> = {}) {
    if (busy) return; setBusy(name); setError('');
    try {
      const data = await post(name, extra);
      if (name === 'begin') {
        const image = await QRCode.toDataURL(data.qr_payload, { width: 280, margin: 2, errorCorrectionLevel: 'M' });
        setQr({ flow_id: data.flow_id, image, expires_at: data.expires_at }); setScanState('waiting');
      } else if (name === 'poll') {
        setScanState(data.state); if (data.state === 'confirmed') setQr(null);
      }
      await readStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'service_unavailable');
      if (e instanceof Error && e.message === 'qr_expired') setQr(null);
      await readStatus().catch(() => {});
    } finally { setBusy(''); }
  }
  const immediate = status?.tests.find(r => r.kind === 'immediate');
  const nextDay = status?.tests.find(r => r.kind === 'next_day');
  const canNextDay = !!immediate?.confirmed_at && !!immediate?.current_connection && !!status?.next_day_eligible_at && now >= status.next_day_eligible_at;
  return <main className="mx-auto w-full max-w-4xl px-5 py-8 sm:px-9 sm:py-12">
    <header className="mb-10 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-white"><MessageCircle size={24} /></span><span className="text-lg font-semibold tracking-tight">微信连接测试</span></div>
      <span className="flex items-center gap-1.5 rounded-full border bg-white px-3 py-1.5 text-xs text-muted-foreground"><LockKeyhole size={13} />仅本人</span>
    </header>
    <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
      <div><p className="mb-2 text-sm text-muted-foreground">本人微信桥接 · 实验版</p><h1 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">让测试消息到达微信</h1></div>
      <span className={'rounded-full px-3 py-1.5 text-sm ' + (status?.connected ? 'bg-emerald-100 text-emerald-800' : 'bg-stone-200/70 text-stone-600')}>{status ? status.connected ? '已扫码连接' : '尚未连接' : '正在检查连接'}</span>
    </div>
    <p className="mb-8 max-w-2xl text-[15px] leading-7 text-muted-foreground">先验证一条普通消息，再验证 24 小时后能否继续使用原会话信息。连接测试只发两条固定消息。另支持你单独要求的简短提醒；报告和论文仍留在 ChatGPT。</p>
    {error && <div role="alert" className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">{errorText[error] || '操作未完成，请稍后查看状态。'}<span className="mt-1 block text-xs opacity-70">状态：{error}</span></div>}
    {!status?.connected && <section className="mb-5 rounded-2xl border bg-card p-5 shadow-sm sm:p-7">
      <div className="mb-5 flex items-start gap-3"><span className="step">1</span><div><h2 className="font-semibold">由你扫码授权</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">请确认当前账号符合腾讯服务要求，并只用你本人的微信扫描。</p></div></div>
      <div className="rounded-xl bg-muted/60 p-4 text-sm leading-6 text-muted-foreground"><p>连接后，此私有服务会持续保存微信提供的机器人授权、绑定账号标识和回复所需的会话信息。它会向腾讯读取机器人消息页，在内存中筛选本人消息以建立回复通道；不会保存消息正文。</p><p className="mt-2">授权信息只保存在服务端，不通过页面或 MCP 返回，不写入聊天。测试页不会购买服务；官方资料尚未承诺长期免费或隔天可达。</p></div>
      <div className="my-5 flex items-start gap-3"><Checkbox id="consent" checked={consent} onCheckedChange={v => setConsent(v === true)} disabled={!!busy || !!qr} className="mt-1" /><label htmlFor="consent" className="cursor-pointer text-sm leading-6">我同意连接并在这个私有服务中保存微信授权，用于向我本人发送上面说明的两条测试消息。我会亲自完成微信内的授权。</label></div>
      {!qr ? <Button size="lg" disabled={!consent || !!busy || !status} onClick={() => action('begin', { consent: 'wechat-test-v1' })}>{busy === 'begin' ? <LoaderCircle className="animate-spin" /> : <MessageCircle />}连接微信并保存授权</Button> : <div className="flex flex-col gap-5 rounded-xl border p-4 sm:flex-row sm:items-center">
        {/* QR is a local data URL; do not send it to an image optimization service. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qr.image} alt="用你本人的微信扫描此连接二维码" className="h-56 w-56 self-center rounded-lg" width={224} height={224} />
        <div className="text-sm leading-6"><p className="font-medium">请用微信扫码，在微信里确认。</p><p className="mt-2 text-muted-foreground">不要分享这个二维码。有效至 {date(qr.expires_at)}。</p><p className="mt-2">{scanState === 'scanned' ? '已扫码，请在微信里继续确认。' : '确认后，点击下方检查。'}</p><Button className="mt-4" disabled={!!busy || now > qr.expires_at} onClick={() => action('poll', { flow_id: qr.flow_id })}>{busy === 'poll' ? <LoaderCircle className="animate-spin" /> : <Check />}我已扫码，检查授权</Button>{now > qr.expires_at && <Button className="mt-3" variant="outline" disabled={!!busy} onClick={() => { setQr(null); setError('qr_expired'); }}>重新生成二维码</Button>}</div>
      </div>}
    </section>}
    {status?.connected && !status.context_available && <section className="mb-5 rounded-2xl border bg-card p-5 sm:p-7"><div className="mb-4 flex gap-3"><span className="step">1</span><div><h2 className="font-semibold">在微信里发一句「连接测试」</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">发给刚绑定的 ClawBot。然后点下面的按钮，取得这次私聊的回复通道。读取可能需要约 35 秒。</p></div></div><Button disabled={!!busy} onClick={() => action('refresh')}>{busy === 'refresh' && <LoaderCircle className="animate-spin" />}我已发送，读取连接</Button></section>}
    {status?.connected && <section className="mb-5 rounded-2xl border bg-card p-5 sm:p-7"><div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="font-semibold">简短微信提醒：{status.notifications?.enabled ? '已开启' : '已关闭'}</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">按你另行提出的要求，只发送呼唤、宽泛主题和可选的北京时间。不包含报告正文、附件、姓名或链接。简短提醒开关与下方的文字读取开关相互独立。</p><p className="mt-2 text-xs leading-5 text-muted-foreground">最多每 10 分钟一次、北京时间每天 6 次。今天已尝试 {status.notifications?.attempts_today || 0} 次。没有自动定时任务，失败或结果不确定不会重发。会话限制仍可能导致发送失败。</p></div>{status.notifications?.enabled && <Button variant="outline" disabled={!!busy} onClick={() => action('notifications_off')}>关闭简短提醒</Button>}</div><p className="mt-3 text-xs leading-5 text-muted-foreground">关闭会阻止新尝试，已经开始的请求仍可能完成。重新绑定后默认关闭；可以在与助手的对话中要求重新开启。</p></section>}
    {status?.connected && <section className="mb-5 rounded-2xl border bg-card p-5 sm:p-7"><div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="font-semibold">读取本人文字回复：{status.inbound?.enabled ? '已开启' : '已关闭'}</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">按你单独同意的范围，仅把你发给已绑定机器人的纯文字带回助手的 ChatGPT 私聊。只返回符合筛选条件的本人纯文字，不返回其他发送者的消息，不下载媒体或附件，也不提取引用正文。腾讯返回的整页数据会短暂在内存中解析后过滤。</p><p className="mt-2 text-xs leading-5 text-muted-foreground">中转不保存正文，只保存读取进度和去重信息。正文在 ChatGPT 中按会话设置保留。最多每小时检查一次；此开关本身不会创建定时任务，也不会即时唤醒助手。</p></div>{status.inbound?.enabled && <Button variant="outline" disabled={!!busy} onClick={() => action('inbound_off')}>关闭文字读取</Button>}</div><p className="mt-3 text-xs leading-5 text-muted-foreground">最近检查：{date(status.inbound?.last_poll_at || null)}。待确认读取：{status.inbound?.pending_ack_count || 0} 段。未确认的文字可能再次返回；腾讯未承诺历史重放期。长文字分段读取，需读完整后再理解请求；此页面不显示消息正文。关闭会阻止新读取，并丢弃尚未完成的读取结果。</p></section>}
    <div className="grid gap-5 sm:grid-cols-2">
      <section className="rounded-2xl border bg-card p-5 sm:p-6"><div className="mb-5 flex items-center gap-3"><span className="step">2</span><h2 className="font-semibold">即时送达</h2></div><div className="test-message">这是一条来自助手的微信连接测试消息。没有敏感内容，看到即可。</div><p className="my-4 text-sm font-medium">{stateText(immediate)}</p>{!immediate ? <Button disabled={!status?.context_available || !!busy} onClick={() => action('send', { kind: 'immediate' })}>{busy === 'send' && <LoaderCircle className="animate-spin" />}发送第一条测试</Button> : ['accepted', 'uncertain', 'sending'].includes(immediate.state) && !immediate.confirmed_at ? <Button disabled={!!busy} onClick={() => action('receipt', { kind: 'immediate' })}><Check />我已在微信看到</Button> : <p className="text-xs text-muted-foreground">{date(immediate.confirmed_at || immediate.attempted_at)}</p>}</section>
      <section className="rounded-2xl border bg-card p-5 sm:p-6"><div className="mb-5 flex items-center gap-3"><span className="step">3</span><h2 className="font-semibold">隔天送达</h2></div><div className="test-message">这是来自助手的隔天微信连接测试消息。用于检查没有继续聊天时能否收到。</div><p className="my-4 text-sm font-medium">{stateText(nextDay)}</p>{!nextDay ? <Button variant="outline" disabled={!canNextDay || !!busy} onClick={() => action('send', { kind: 'next_day' })}>发送隔天测试</Button> : ['accepted', 'uncertain', 'sending'].includes(nextDay.state) && !nextDay.confirmed_at ? <Button disabled={!!busy} onClick={() => action('receipt', { kind: 'next_day' })}><Check />我已在微信看到</Button> : <p className="text-xs text-muted-foreground">{date(nextDay.confirmed_at || nextDay.attempted_at)}</p>}<p className="mt-4 text-xs leading-5 text-muted-foreground">{status?.next_day_eligible_at ? `最早测试时间：${date(status.next_day_eligible_at)}。期间请不要继续向机器人发消息。` : '先确认收到第一条；隔天测试使用首次捕获后已满 24 小时的原始会话信息。'}</p></section>
    </div>
    <p className="mt-5 text-xs leading-6 text-muted-foreground">“微信已接受”只代表接口返回成功，是否真正收到需要你确认。隔天发送可能因微信的会话限制而失败；这里不会自动重试或持续轮询，也无法核实你期间是否发送过新消息。重新绑定会保留原测试记录，不会重置发送次数。</p>
    <footer className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t pt-5 text-xs text-muted-foreground"><a href="https://github.com/Tencent/openclaw-weixin/blob/main/docs/protocol.md" target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-foreground">腾讯官方协议<ArrowUpRight size={13} /></a><div className="flex gap-4"><button onClick={() => readStatus().catch(e => setError(e.message))}>刷新状态</button>{status?.connected && <AlertDialog><AlertDialogTrigger asChild><button className="flex items-center gap-1"><Unplug size={13} />移除本地连接</button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>移除此测试服务的微信授权？</AlertDialogTitle><AlertDialogDescription>这会删除本服务保存的机器人授权和会话信息，阻止新的发送。已经开始的请求仍可能完成。测试结果保留。微信端的授权请同时在微信中检查并撤销。重新连接需要再次扫码。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>保留连接</AlertDialogCancel><AlertDialogAction onClick={() => action('disconnect')}>移除连接</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>}</div></footer>
  </main>;
}
