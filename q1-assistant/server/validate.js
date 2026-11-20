import { z } from 'zod';

// 全局唯一 Answer 契约，对应 PRD §2.3。业务禁止另建同义 schema。
export const CitationSchema = z.object({
  docId: z.string(),
  chunkId: z.string(),
  type: z.string(),
  date: z.string(),
  quote: z.string(),
});

export const AnswerSchema = z.object({
  text: z.string(),
  reasoning: z.string().optional(),
  mode: z.enum(['资料所述', '模型推断', '资料不足']),
  citations: z.array(CitationSchema),
  conflicts: z.array(z.object({ docId: z.string(), statement: z.string() })),
  insufficient: z.boolean(),
});

export const ChatRequestSchema = z.object({
  sessionId: z.string().optional(),
  question: z.string().trim().min(1).max(1000),
});

// clientId 不在此处枚举，存在性由 service 查 clients 表校验，换语料不改代码。
export const SwitchIdentitySchema = z.object({
  clientId: z.string().trim().min(1),
});
