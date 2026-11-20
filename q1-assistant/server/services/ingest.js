import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { getDb } from '../db.js';
import { logger } from '../logger.js';

// 【注入顺序 1/4】依赖：config → db → logger。本服务产出后续所有服务的数据基础。

const CJK = /[\u3400-\u9fff]/;
const isCjk = (ch) => CJK.test(ch);

// FTS5 用的 2-gram：连续汉字切成重叠双字，英数按整词保留（不引入分词依赖）。
export function to2gram(text) {
  const s = String(text ?? '').toLowerCase();
  const out = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (isCjk(ch)) {
      let j = i + 1;
      while (j < s.length && isCjk(s[j])) j += 1;
      const run = s.slice(i, j);
      if (run.length === 1) out.push(run);
      else for (let k = 0; k < run.length - 1; k += 1) out.push(run.slice(k, k + 2));
      i = j;
    } else if (/[a-z0-9]/.test(ch)) {
      let j = i + 1;
      while (j < s.length && /[a-z0-9]/.test(s[j])) j += 1;
      out.push(s.slice(i, j));
      i = j;
    } else {
      i += 1;
    }
  }
  return out;
}

// 按标题/段落切块，长段落再按句号附近断开，目标 200–500 字。
function splitChunks(content) {
  const sections = [];
  let heading = '';
  let lines = [];
  const flush = () => {
    const text = lines.join('\n').trim();
    if (text) sections.push({ heading, text });
    lines = [];
  };
  for (const line of content.split(/\r?\n/)) {
    const title = line.match(/^#{1,6}\s+(.+)$/);
    if (title) {
      flush();
      heading = title[1].trim();
    } else if (line.trim()) {
      lines.push(line.trim());
    }
  }
  flush();

  const chunks = [];
  for (const sec of sections) {
    let rest = sec.text;
    while (rest.length > 500) {
      let cut = rest.lastIndexOf('。', 460);
      if (cut < 200) cut = 460;
      chunks.push({ heading: sec.heading, text: rest.slice(0, cut + 1).trim() });
      rest = rest.slice(cut + 1).trim();
    }
    if (rest) chunks.push({ heading: sec.heading, text: rest });
  }
  return chunks;
}

function parseVersion(content) {
  const m = content.match(/第\s*(\d+)\s*版/) || content.match(/\bv(\d+)\b/i);
  return m ? Number(m[1]) : 1;
}

// 通用解析：声明"替代第 N 版 / 第 N 版作废"的较新文档，把同类型旧文档标记为 superseded。
// 不硬编码任何 docId；只看元数据与正文里的版本声明。
function markSuperseded(docs) {
  for (const newer of docs) {
    const mentions = newer.content
      .split(/\r?\n/)
      .filter((line) => /作废|替代/.test(line))
      .join('\n');
    const oldVersions = new Set(
      [...mentions.matchAll(/第\s*(\d+)\s*版/g)].map((m) => Number(m[1])),
    );
    for (const version of oldVersions) {
      if (version >= newer.version) continue;
      for (const older of docs) {
        if (older.id === newer.id || older.type !== newer.type) continue;
        if (older.version === version && older.date < newer.date) {
          older.status = 'superseded';
          older.superseded_by = newer.id;
        }
      }
    }
  }
}

function parseGlossary(markdown) {
  const terms = [];
  for (const line of markdown.split(/\r?\n/)) {
    const m = line.match(/^\s*-\s*\*\*(.+?)\*\*[:：]\s*(.+)$/);
    if (m) terms.push({ term: m[1].trim(), expansion: m[2].replaceAll('**', '').trim() });
  }
  return terms;
}

// 灌库：access.json 是 clients / documents / document_acl 的唯一权威源。
// 幂等：documents 非空时直接跳过；换语料请清库后重灌。
export function ingest() {
  const db = getDb();
  const existing = db.prepare('SELECT COUNT(*) AS n FROM documents').get().n;
  if (existing > 0) {
    logger.info(`[ingest] documents 已有 ${existing} 行，跳过灌库`);
    return { skipped: true };
  }

  const root = config.corpusDir;
  const access = JSON.parse(fs.readFileSync(path.join(root, 'access.json'), 'utf8'));
  const clients = Object.entries(access.clients).map(([id, c]) => ({
    id, name: c.name, role: c.role, description: c.description ?? null,
  }));
  const docs = access.documents.map((d) => {
    const content = fs.readFileSync(path.join(root, d.file), 'utf8');
    return {
      ...d,
      content,
      version: parseVersion(content),
      status: 'active',
      superseded_by: null,
    };
  });
  markSuperseded(docs);

  const glossaryPath = path.join(root, '领域小抄.md');
  const glossary = fs.existsSync(glossaryPath)
    ? parseGlossary(fs.readFileSync(glossaryPath, 'utf8'))
    : [];

  const tx = db.transaction(() => {
    // 仅清理派生表，不动 sessions / messages / clients，避免外键冲突。
    db.prepare('DELETE FROM chunk_fts').run();
    db.prepare('DELETE FROM chunks').run();
    db.prepare('DELETE FROM document_acl').run();
    db.prepare('DELETE FROM documents').run();
    db.prepare('DELETE FROM glossary').run();

    const insClient = db.prepare(
      'INSERT OR REPLACE INTO clients (id, name, role, description) VALUES (?, ?, ?, ?)',
    );
    for (const c of clients) insClient.run(c.id, c.name, c.role, c.description);

    const insDoc = db.prepare(
      'INSERT INTO documents (id, file, type, doc_date, version, status, superseded_by, content) '
      + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    const insAcl = db.prepare('INSERT INTO document_acl (doc_id, client_id) VALUES (?, ?)');
    const insChunk = db.prepare(
      'INSERT INTO chunks (chunk_id, doc_id, seq, heading, doc_date, doc_type, status, text, text_2gram) '
      + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    const insFts = db.prepare('INSERT INTO chunk_fts (chunk_id, text_2gram) VALUES (?, ?)');

    let chunkCount = 0;
    for (const doc of docs) {
      insDoc.run(doc.id, doc.file, doc.type, doc.date, doc.version, doc.status,
        doc.superseded_by, doc.content);
      for (const clientId of doc.visible_to) insAcl.run(doc.id, clientId);

      splitChunks(doc.content).forEach((part, index) => {
        const chunkId = `${doc.id}-${index + 1}`;
        const text = part.heading ? `${part.heading}\n${part.text}` : part.text;
        const grams = to2gram(text).join(' ');
        insChunk.run(chunkId, doc.id, index + 1, part.heading, doc.date, doc.type,
          doc.status, text, grams);
        insFts.run(chunkId, grams);
        chunkCount += 1;
      });
    }

    const insTerm = db.prepare('INSERT OR REPLACE INTO glossary (term, expansion) VALUES (?, ?)');
    for (const g of glossary) insTerm.run(g.term, g.expansion);
    return { clients: clients.length, documents: docs.length, chunks: chunkCount };
  });

  const result = tx();
  logger.info(`[ingest] 灌库完成：${result.clients} 身份 / ${result.documents} 文档 / ${result.chunks} 分块`);
  return result;
}
