// 公共前端 API 封装：统一请求、错误处理、Cookie 携带。业务代码只调这些方法。
const base = '/api';

async function request(path, options = {}) {
  const res = await fetch(base + path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const body = await res.json();
  if (!body.ok) throw new Error(body.error?.message ?? '请求失败');
  return body.data;
}

export const api = Object.freeze({
  me: () => request('/me'),
  clients: () => request('/clients'),
  switchIdentity: (clientId) => request('/switch-identity', {
    method: 'POST', body: JSON.stringify({ clientId }),
  }),
  documents: () => request('/documents'),
  chat: (question) => request('/chat', {
    method: 'POST', body: JSON.stringify({ question }),
  }),
  // 流式问答：fetch + ReadableStream 逐块读取 SSE，避免 EventSource 自动重连/保留事件名冲突。
  chatStream: async (question, onEvent) => {
    const res = await fetch(base + '/chat', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, stream: true }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error?.message ?? '请求失败');
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() ?? '';
      for (const block of blocks) {
        const eventLine = block.split('\n').find((l) => l.startsWith('event: '));
        const dataLine = block.split('\n').find((l) => l.startsWith('data: '));
        if (!dataLine) continue;
        try {
          const payload = JSON.parse(dataLine.slice(6));
          onEvent({ type: eventLine?.slice(7) ?? payload.type, ...payload });
        } catch {
          // 忽略不完整事件
        }
      }
    }
  },
});
