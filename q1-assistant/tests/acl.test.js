import { describe, it, expect, vi } from 'vitest';

const { HIDDEN, CHUNKS } = vi.hoisted(() => {
  const all = Array.from({ length: 32 }, (_, i) => String(i + 1).padStart(2, '0'));
  const hidden = ['15', '24', '28', '32'];
  const chunks = all.map((id) => ({
    chunk_id: `${id}-1`,
    doc_id: id,
    text: `doc ${id}`,
    doc_date: '2026-05-12',
    doc_type: '施工日志',
    status: 'active',
    text_2gram: '合同 同单 单价 层顶 顶板 混凝',
  }));
  return { HIDDEN: hidden, CHUNKS: chunks };
});

vi.mock('../server/acl.js', () => ({
  visibleDocIds: (clientId) => {
    if (clientId === 'none') return [];
    if (clientId === 'zongbao_A') return CHUNKS.map((c) => c.doc_id);
    return CHUNKS.map((c) => c.doc_id).filter((id) => !HIDDEN.includes(id));
  },
}));

vi.mock('../server/db.js', () => ({
  getDb: () => ({
    prepare: (sql) => ({
      all: (...args) => {
        if (sql.includes('FROM documents')) {
          return args.map((id) => ({ id, type: '施工日志', date: '2026-05-12', status: 'active' }));
        }
        if (sql.includes('chunk_fts MATCH')) {
          const ids = args.slice(1, -1);
          return CHUNKS.filter((c) => ids.includes(c.doc_id)).map((c) => ({ ...c, score: -1 }));
        }
        return [];
      },
    }),
  }),
}));

import { listVisibleDocuments } from '../server/services/documents.js';
import { retrieve } from '../server/services/retrieve.js';

describe('客户隔离 ACL', () => {
  it('分包可见 28 份，排除 15/24/28/32', () => {
    const ids = listVisibleDocuments('fenbao_B').map((d) => d.id);
    expect(ids).toHaveLength(28);
    for (const hidden of HIDDEN) expect(ids).not.toContain(hidden);
  });

  it('总包可见全部 32 份', () => {
    expect(listVisibleDocuments('zongbao_A')).toHaveLength(32);
  });

  it('检索只在白名单内召回，越权文档不进入结果', () => {
    const rows = retrieve({ clientId: 'fenbao_B', question: '合同单价是多少' });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(HIDDEN).not.toContain(row.doc_id);
  });

  it('白名单为空时不召回任何片段', () => {
    expect(retrieve({ clientId: 'none', question: '合同单价是多少' })).toEqual([]);
  });
});
