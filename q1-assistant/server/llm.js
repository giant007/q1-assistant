import { HumanMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { getLlmConfig } from './config.js';
import { logger } from './logger.js';

// 流式文本输出：不依赖 function calling / JSON，拿到什么就往外吐什么。
// 实测部分模型首字延迟 >30s，流式调用单独放宽超时，避免 SDK 抛 "terminated"。
export async function* streamChat(messages) {
  const cfg = getLlmConfig();
  const model = new ChatOpenAI({
    model: cfg.model,
    apiKey: cfg.apiKey,
    temperature: cfg.temperature,
    timeout: Math.max(cfg.timeoutMs, 120000),
    maxRetries: 0,
    configuration: { baseURL: cfg.baseURL },
  });
  const stream = await model.stream(messages);
  for await (const chunk of stream) {
    const content = chunk.content;
    const text = typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.map((part) => part?.text ?? (typeof part === 'string' ? part : '')).join('')
        : '';
    if (text) yield text;
  }
}

// 公共模型工厂：所有厂商均为 OpenAI 兼容协议，只靠 .env 三元组切换。
export function createChatModel() {
  const cfg = getLlmConfig();
  return new ChatOpenAI({
    model: cfg.model,
    apiKey: cfg.apiKey,
    temperature: cfg.temperature,
    timeout: cfg.timeoutMs,
    configuration: { baseURL: cfg.baseURL },
  });
}

function contentText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => part?.text ?? (typeof part === 'string' ? part : '')).join('\n');
  }
  return '';
}

// 从模型正文里提取 JSON（兼容 ```json 围栏与前后说明文字）。
function extractJson(content) {
  const text = contentText(content);
  const decoder = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = decoder ? [decoder[1], text] : [text];
  for (const candidate of candidates) {
    const start = candidate.indexOf('{');
    if (start < 0) continue;
    try {
      return JSON.parse(candidate.slice(start, candidate.lastIndexOf('}') + 1));
    } catch {
      // 继续尝试下一个候选
    }
  }
  return undefined;
}

// 回退调用要显式告诉模型输出什么字段；字段名从传入的 Zod schema 取，不硬编码业务契约。
function jsonInstruction(schema) {
  const fields = schema?.shape ? Object.keys(schema.shape).join(', ') : '';
  return `请仅输出一个 JSON 对象，不要输出任何其他文字或 Markdown 围栏。`
    + (fields ? `必须包含字段：${fields}。` : '');
}

// 结构化输出：优先 functionCalling；厂商不返回 tool_calls 时自动降级到正文 JSON。
export function createStructuredModel(schema) {
  const cfg = getLlmConfig();
  const model = createChatModel();

  if (cfg.structuredMethod === 'json') {
    return {
      invoke: async (messages) => {
        const fallbackMessages = [...messages, new HumanMessage(jsonInstruction(schema))];
        const response = await model.invoke(fallbackMessages);
        return schema.parse(extractJson(response.content));
      },
    };
  }

  const structured = model.withStructuredOutput(schema, { method: 'functionCalling' });
  return {
    invoke: async (messages) => {
      try {
        const value = await structured.invoke(messages);
        if (value != null) return schema.parse(value);
      } catch {
        // 结构化调用失败，走下面的正文 JSON 兜底
      }
      const fallbackMessages = [...messages, new HumanMessage(jsonInstruction(schema))];
      const response = await model.invoke(fallbackMessages);
      const value = extractJson(response.content);
      if (value === undefined) {
        logger.warn('[llm] 模型未返回 JSON，正文片段：', contentText(response.content).slice(0, 300));
      }
      return schema.parse(value);
    },
  };
}
