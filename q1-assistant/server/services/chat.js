import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { getDb } from '../db.js';
import { badRequest } from '../errors.js';
import { AnswerSchema } from '../validate.js';
import { createStructuredModel, streamChat } from '../llm.js';
import { visibleDocIds } from '../acl.js';
import { STREAM_SYSTEM_PROMPT, SYSTEM_PROMPT, wrapDocuments } from '../guard.js';
import { retrieve } from './retrieve.js';

// 【注入顺序 4/4】依赖：db / errors / validate / llm / acl / guard → retrieve。
// 只做编排：身份由路由从服务端会话取好；不重写检索、注入防护、校验或权限逻辑。

const HISTORY_LIMIT = 6;
const THINK_TAG = '【思考】';
const ANSWER_TAG = '【回答】';
const REF_TAG = '【引用】';

const insufficient = () => ({
  text: '资料不足：当前身份可见的资料中没有可支持的依据，无法回答该问题。',
  reasoning: '当前身份可见的片段中没有能支撑该问题的依据，因此不作答，也不列举任何可能存在的其他文档。',
  mode: '资料不足',
  citations: [],
  conflicts: [],
  insufficient: true,
});

// 指代消解：带指代词时把上一问作为语境前缀，得到可独立检索的问题（不额外调 LLM）。
function standaloneQuestion(question, history) {
  const previous = [...history].reverse()
    .find((m) => m.role === 'user' && typeof m.payload === 'string');
  if (!previous || !/那|它|这个|该|此|前者|后者|上面|刚才/.test(question)) return question;
  return `${previous.payload}\n${question}`;
}

function loadHistory(db, sessionId) {
  return db.prepare(
    'SELECT role, payload FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT ?',
  ).all(sessionId, HISTORY_LIMIT).reverse();
}

async function generate(question, chunks) {
  const model = createStructuredModel(AnswerSchema);
  const raw = await model.invoke([
    new SystemMessage(SYSTEM_PROMPT),
    new HumanMessage(`问题：${question}\n\n可见资料片段：\n${wrapDocuments(chunks)}`),
  ]);
  return AnswerSchema.parse(raw);
}

// 服务端引用校验：docId 必须在白名单 ∩ 本轮召回集，chunkId 必须属于该 docId。
// type/date 一律用库里的元数据覆盖模型自报值，避免模型编造出处。
function validateAnswer(parsed, chunks, allowedIds) {
  const recallDocs = new Set(chunks.map((c) => c.doc_id));
  const chunkById = new Map(chunks.map((c) => [c.chunk_id, c]));
  const citations = [];
  for (const cite of parsed.citations ?? []) {
    const chunk = chunkById.get(cite.chunkId);
    if (!allowedIds.has(cite.docId) || !recallDocs.has(cite.docId)) continue;
    if (!chunk || chunk.doc_id !== cite.docId) continue;
    citations.push({
      docId: cite.docId,
      chunkId: cite.chunkId,
      type: chunk.doc_type,
      date: chunk.doc_date,
      quote: cite.quote,
    });
  }
  const conflicts = (parsed.conflicts ?? []).filter(
    (c) => allowedIds.has(c.docId) && recallDocs.has(c.docId),
  );
  return { citations, conflicts, dropped: (parsed.citations?.length ?? 0) - citations.length };
}

// 统一的答案构造：两种模式共用，保证安全规则只有一份。
function buildResult(parsed, chunks, clientId) {
  const { citations, conflicts, dropped } = validateAnswer(
    parsed, chunks, new Set(visibleDocIds(clientId)),
  );
  if (parsed.insufficient || citations.length === 0) {
    const result = insufficient();
    if (dropped > 0) {
      result.reasoning = '模型给出的引用未通过服务端可见性校验，已全部剔除；当前可见片段不足以作答。';
    }
    return result;
  }
  return {
    text: parsed.text,
    // 引用被剔除时模型的 reasoning 可能提及越权文档，统一替换为安全话术。
    reasoning: dropped > 0
      ? '部分引用未通过服务端可见性校验已剔除；下面只依据保留的引用片段作答。'
      : parsed.reasoning ?? '',
    mode: dropped > 0 ? '模型推断' : parsed.mode === '资料不足' ? '资料所述' : parsed.mode,
    citations,
    conflicts,
    insufficient: false,
  };
}

function persist(db, sessionId, question, result) {
  const now = new Date().toISOString();
  const insert = db.prepare(
    'INSERT INTO messages (session_id, role, payload, created_at) VALUES (?, ?, ?, ?)',
  );
  db.transaction(() => {
    insert.run(sessionId, 'user', question, now);
    insert.run(sessionId, 'assistant', JSON.stringify(result), now);
  })();
}

export async function answer({ clientId, sessionId, question }) {
  if (!clientId || !sessionId) throw badRequest('缺少会话上下文');
  const db = getDb();
  const promptQuestion = standaloneQuestion(question, loadHistory(db, sessionId));
  const chunks = retrieve({ clientId, question: promptQuestion });
  const result = chunks.length === 0
    ? insufficient()
    : buildResult(await generate(promptQuestion, chunks), chunks, clientId);
  persist(db, sessionId, question, result);
  return result;
}

// 把流式累积文本按分隔符拆成"思考"和"回答"两段；模型不遵守格式时全部当回答。
function splitStreamText(buffer) {
  if (!buffer.includes(THINK_TAG) && !buffer.includes(ANSWER_TAG)) {
    // 仍可能在输出分隔符的前缀（如"【"），先不推送，避免闪烁。
    return { reasoning: '', text: buffer.startsWith('【') ? '' : buffer };
  }
  const thinkIdx = buffer.indexOf(THINK_TAG);
  const answerIdx = buffer.indexOf(ANSWER_TAG);
  const reasoning = thinkIdx < 0 ? '' : buffer.slice(
    thinkIdx + THINK_TAG.length, answerIdx < 0 ? buffer.length : answerIdx,
  ).trimStart();
  let text = '';
  if (answerIdx >= 0) {
    const tStart = answerIdx + ANSWER_TAG.length;
    const refIdx = buffer.indexOf(REF_TAG, tStart);
    text = buffer.slice(tStart, refIdx < 0 ? buffer.length : refIdx).trimStart();
  }
  return { reasoning, text };
}

// 流式结束后从全文还原 Answer：优先 JSON；否则按三段式解析，引用从正文 docId 提取并校验。
function parseStreamResult(full, chunks, clientId) {
  try {
    return buildResult(AnswerSchema.parse(JSON.parse(full)), chunks, clientId);
  } catch {
    // 非 JSON，走三段式文本解析
  }
  const thinkIdx = full.indexOf(THINK_TAG);
  const answerIdx = full.indexOf(ANSWER_TAG);
  const refIdx = full.indexOf(REF_TAG);
  const reasoning = thinkIdx < 0 ? '' : full.slice(
    thinkIdx + THINK_TAG.length, answerIdx < 0 ? full.length : answerIdx,
  ).trim();
  const text = answerIdx < 0 ? full.trim() : full.slice(
    answerIdx + ANSWER_TAG.length, refIdx < 0 ? full.length : refIdx,
  ).trim();

  const docIds = new Set();
  // 模型实际会写 docId="03" / docId=03 / doc03 / [03] / 03 号文档等多种形式，
  // 统一提取两位数字后与召回集取交集，越权或编造的编号自然被过滤掉。
  for (const m of text.matchAll(/doc\s*I?\s*D?\s*=?\s*["']?0?(\d{1,2})/gi)) {
    docIds.add(m[1].padStart(2, '0'));
  }
  for (const m of text.matchAll(/["'\[\s]0?(\d{1,2})["'\]\s](?=号文档|\s*号|\s*[·,，、])/g)) {
    docIds.add(m[1].padStart(2, '0'));
  }
  const chunkByDoc = new Map(chunks.map((c) => [c.doc_id, c]));
  const citations = [...docIds].map((id) => {
    const c = chunkByDoc.get(id);
    if (!c) return null;
    return {
      docId: c.doc_id,
      chunkId: c.chunk_id,
      type: c.doc_type,
      date: c.doc_date,
      quote: c.text.replace(/\s+/g, ' ').slice(0, 80),
    };
  }).filter(Boolean);

  return buildResult({
    text, reasoning, mode: '资料所述', citations, conflicts: [], insufficient: false,
  }, chunks, clientId);
}

// 流式问答：逐块推送 reasoning / text，结束时推送 done（含服务端校验后的 Answer）。
export async function* answerStream({ clientId, sessionId, question }) {
  if (!clientId || !sessionId) throw badRequest('缺少会话上下文');
  const db = getDb();
  const promptQuestion = standaloneQuestion(question, loadHistory(db, sessionId));
  const chunks = retrieve({ clientId, question: promptQuestion });

  let result;
  if (chunks.length === 0) {
    result = insufficient();
    yield { type: 'reasoning', delta: result.reasoning };
    yield { type: 'text', delta: result.text };
  } else {
    const messages = [
      new SystemMessage(STREAM_SYSTEM_PROMPT),
      new HumanMessage(`问题：${promptQuestion}\n\n可见资料片段：\n${wrapDocuments(chunks)}`),
    ];
    let buffer = '';
    let sentReasoning = 0;
    let sentText = 0;
    for await (const delta of streamChat(messages)) {
      buffer += delta;
      const parts = splitStreamText(buffer);
      if (parts.reasoning.length > sentReasoning) {
        yield { type: 'reasoning', delta: parts.reasoning.slice(sentReasoning) };
        sentReasoning = parts.reasoning.length;
      }
      if (parts.text.length > sentText) {
        yield { type: 'text', delta: parts.text.slice(sentText) };
        sentText = parts.text.length;
      }
    }
    result = parseStreamResult(buffer, chunks, clientId);
  }

  yield { type: 'done', answer: result };
  persist(db, sessionId, question, result);
}
