import { getDb } from '../db.js';
import { visibleDocIds } from '../acl.js';
import { to2gram } from './ingest.js';

// 【注入顺序 3/4】依赖：db → acl → ingest(to2gram)。白名单前置于 FTS 查询，越权块物理上取不到。

const CANDIDATES = 40;
const TOP_K = 8;

// FTS5 MATCH 表达式：2-gram 用双引号包成短语，OR 保证召回；池化去重防止 query 过长。
function buildMatchExpression(tokens) {
  const unique = [...new Set(tokens)].slice(0, 40);
  return unique.map((t) => `"${t.replaceAll('"', '""')}"`).join(' OR ');
}

// 内存重排：bm25 相关度 + 问题关键词覆盖率 + active 加权 + 日期新近度。
// FTS 的 OR 召回偏宽，先按最小命中数剔除"只碰到一个常见词"的噪音片段。
function rerank(rows, tokens) {
  const queryGrams = new Set(tokens);
  const minHits = queryGrams.size <= 2 ? 1 : 2;
  const newest = rows.reduce((max, r) => (r.doc_date > max ? r.doc_date : max), '');
  return rows
    .map((row) => {
      const grams = new Set(row.text_2gram.split(' '));
      let hits = 0;
      for (const token of queryGrams) if (grams.has(token)) hits += 1;
      const coverage = queryGrams.size ? hits / queryGrams.size : 0;
      const active = row.status === 'active' ? 1 : 0;
      const fresh = newest && row.doc_date >= newest ? 1 : 0;
      const score = -row.score + coverage * 3 + active * 2 + fresh * 0.2;
      const { text_2gram, score: bm25, ...chunk } = row;
      return { ...chunk, hits, rerankScore: score };
    })
    .filter((row) => row.hits >= minHits)
    .sort((a, b) => b.rerankScore - a.rerankScore)
    .slice(0, TOP_K)
    .map(({ hits, rerankScore, ...chunk }) => chunk);
}

// 在可见白名单内召回 Top-K 片段。clientId 来自服务端会话，绝不读请求体。
export function retrieve({ clientId, question }) {
  const allowed = visibleDocIds(clientId);
  if (allowed.length === 0 || !question?.trim()) return [];

  const tokens = to2gram(question);
  if (tokens.length === 0) return [];
  const placeholders = allowed.map(() => '?').join(',');
  const sql = `
    SELECT c.chunk_id, c.doc_id, c.text, c.doc_date, c.doc_type, c.status, c.text_2gram,
           bm25(chunk_fts) AS score
    FROM chunk_fts
    JOIN chunks c ON c.chunk_id = chunk_fts.chunk_id
    WHERE chunk_fts MATCH ? AND c.doc_id IN (${placeholders})
    ORDER BY score
    LIMIT ?`;
  const rows = getDb().prepare(sql).all(buildMatchExpression(tokens), ...allowed, CANDIDATES);
  return rerank(rows, tokens);
}
