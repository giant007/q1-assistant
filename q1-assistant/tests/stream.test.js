import { describe, it, expect, vi } from 'vitest';

const env = vi.hoisted(() => ({
  chunks: [{
    chunk_id: '06-2',
    doc_id: '06',
    text: '5 层顶板混凝土浇筑，2026-05-12',
    doc_date: '2026-05-12',
    doc_type: '施工日志',
    status: 'active',
    text_2gram: '层顶 顶板 混凝 浇筑',
  }],
}));

vi.mock('../server/llm.js', () => ({
  createStructuredModel: () => ({ invoke: async () => ({}) }),
  streamChat: async function* () {
    const full = '【思考】\n依据 06 施工日志判断浇筑日期。\n【回答】\n5 层顶板于 2026-05-12 浇筑，见 docId="06"。';
    for (const piece of full.match(/.{1,7}/gs)) yield piece;
  },
}));

vi.mock('../server/db.js', () => ({
  getDb: () => ({
    prepare: (sql) => ({
      all: () => (sql.includes('chunk_fts MATCH') ? env.chunks : []),
      run: () => {},
      get: () => undefined,
    }),
    transaction: (fn) => fn,
  }),
}));

vi.mock('../server/acl.js', () => ({
  visibleDocIds: () => ['06'],
}));

import { answerStream } from '../server/services/chat.js';

describe('流式问答', () => {
  it('逐块推送思考过程与回答，结束时给出校验后的 Answer', async () => {
    const events = [];
    for await (const event of answerStream({
      clientId: 'zongbao_A', sessionId: 's1', question: '5 层顶板哪天浇的',
    })) {
      events.push(event);
    }

    const reasoning = events.filter((e) => e.type === 'reasoning').map((e) => e.delta).join('');
    const text = events.filter((e) => e.type === 'text').map((e) => e.delta).join('');
    const done = events.find((e) => e.type === 'done');

    expect(reasoning).toContain('依据 06 施工日志');
    expect(reasoning).not.toContain('【回答】');
    expect(text).toContain('2026-05-12');
    expect(text).not.toContain('【思考】');
    expect(done.answer.insufficient).toBe(false);
    expect(done.answer.citations).toHaveLength(1);
    expect(done.answer.citations[0].docId).toBe('06');
    expect(events.at(-1).type).toBe('done');
  });
});
