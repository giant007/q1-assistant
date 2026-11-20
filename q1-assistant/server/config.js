import 'dotenv/config';

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '' || value.startsWith('sk-替换')) {
    throw new Error(`缺少或无效的环境变量 ${name}，请复制 .env.example 为 .env 后填写`);
  }
  return value;
}

function int(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} 必须为正整数`);
  return value;
}

export const config = Object.freeze({
  port: int('PORT', 3000),
  dbPath: process.env.DB_PATH ?? './data/app.db',
  corpusDir: process.env.CORPUS_DIR ?? './Q1-语料',
});

// 密钥按需校验：未配 LLM 时脚手架仍可启动、静态页与元数据接口可用。
let llmCache;
export function getLlmConfig() {
  if (!llmCache) {
    llmCache = Object.freeze({
      baseURL: required('LLM_BASE_URL'),
      apiKey: required('LLM_API_KEY'),
      model: required('LLM_MODEL'),
      temperature: Number(process.env.LLM_TEMPERATURE ?? 0),
      timeoutMs: int('LLM_TIMEOUT_MS', 30000),
      structuredMethod: process.env.LLM_STRUCTURED_METHOD === 'json' ? 'json' : 'functionCalling',
    });
  }
  return llmCache;
}
