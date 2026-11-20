import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

const env = vi.hoisted(() => ({ cfg: {}, structuredResult: undefined, chatContent: '' }));

vi.mock('../server/config.js', () => ({
  getLlmConfig: () => env.cfg,
}));

vi.mock('@langchain/openai', () => ({
  ChatOpenAI: class {
    withStructuredOutput() {
      return { invoke: async () => env.structuredResult };
    }
    async invoke() {
      return { content: env.chatContent };
    }
  },
}));

import { createStructuredModel } from '../server/llm.js';

const schema = z.object({ text: z.string() });

beforeEach(() => {
  env.cfg = {
    structuredMethod: 'functionCalling', model: 'mock', apiKey: 'sk-test',
    baseURL: 'http://localhost/v1', temperature: 0, timeoutMs: 1000,
  };
  env.structuredResult = { text: '来自 function call' };
  env.chatContent = '';
});

describe('结构化输出降级', () => {
  it('functionCalling 返回对象时直接使用', async () => {
    const result = await createStructuredModel(schema).invoke([]);
    expect(result.text).toBe('来自 function call');
  });

  it('functionCalling 返回 undefined 时从正文 JSON 兜底', async () => {
    env.structuredResult = undefined;
    env.chatContent = '{"text":"来自正文"}';
    const result = await createStructuredModel(schema).invoke([]);
    expect(result.text).toBe('来自正文');
  });

  it('正文带 ```json 围栏与说明文字也能提取', async () => {
    env.structuredResult = undefined;
    env.chatContent = '好的，答案如下：\n```json\n{"text":"带围栏"}\n```';
    const result = await createStructuredModel(schema).invoke([]);
    expect(result.text).toBe('带围栏');
  });

  it('json 模式从正文提取并通过 Zod 校验', async () => {
    env.cfg.structuredMethod = 'json';
    env.chatContent = '{"text":"json 模式"}';
    const result = await createStructuredModel(schema).invoke([]);
    expect(result.text).toBe('json 模式');
  });
});
