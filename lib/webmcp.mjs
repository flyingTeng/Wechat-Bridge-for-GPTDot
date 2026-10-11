export function registerStatusTool(doc, readStatus) {
  const context = doc?.modelContext;
  if (!context?.registerTool) return () => {};
  const life = new AbortController();
  try {
    Promise.resolve(context.registerTool({
      name: 'read_wechat_test_status', title: '查看微信测试状态',
      description: 'Read the same owner-only test status shown in this page. Does not begin authentication, disclose credentials, or send messages.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      async execute(input) {
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) throw new Error('No arguments are accepted');
        return await readStatus();
      },
    }, { signal: life.signal })).catch(() => {});
  } catch {}
  return () => life.abort();
}
