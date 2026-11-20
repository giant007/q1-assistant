# 脚手架与开发规范（写业务代码前必读）

> 本项目脚手架在 `q1-assistant/`。会话开始时由 `ENTRY.md` 引用本文件。
> 目标：**公共能力只写一次，业务代码保持薄**。禁止重复造轮子导致维护成本上升。

## 1. 分层与职责

```
q1-assistant/
├── server/
│   ├── index.js          # 唯一入口：装配 app、挂路由、启动
│   ├── config.js         # 【公共】唯一环境变量出口
│   ├── logger.js         # 【公共】唯一日志出口
│   ├── errors.js         # 【公共】AppError 错误类型
│   ├── http.js           # 【公共】响应包装 / asyncHandler / 错误中间件
│   ├── db.js             # 【公共】唯一 SQLite 连接与 schema 迁移入口
│   ├── schema.sql        # 【公共】全部建表语句（含 FTS5 虚表）
│   ├── validate.js       # 【公共】全部 Zod schema（含 Answer 契约）
│   ├── llm.js            # 【公共】模型工厂：createChatModel / createStructuredModel / streamChat
│   ├── session.js        # 【公共】Cookie 解析、会话读写、切换清历史
│   ├── acl.js            # 【公共】可见文档白名单查询（前置过滤的唯一入口）
│   ├── guard.js          # 【公共】System Prompt（含流式三段式）+ <document> 数据标签包裹
│   ├── services/         # 【业务】ingest / documents / retrieve / chat（含 answerStream）
│   └── routes/           # 【业务】clients / me / identity / documents / chat，仅校验→调 service→返回
├── public/               # 前端：index.html / api.js（SSE 流式）/ app.js / style.css
├── tests/                # 单测：acl / citation / llm / stream（共 16 例）
├── data/                 # SQLite 文件（.gitignore 忽略）
├── Dockerfile / docker-compose.yml / .env.example
└── README.md / DECISIONS.md / AI_LOG.md
```

## 2. 九条禁令（业务代码必须遵守）

1. **禁止直接读 `process.env`** —— 一律 `import { config } from './config.js'`。
2. **禁止 `new Database(...)`** —— 一律 `import { getDb } from './db.js'`；禁止在业务里写 `CREATE TABLE`。
3. **禁止手写 `res.json({...})` 响应格式** —— 用 `ok(res, data)` / `fail(res, status, code, msg)`。
4. **禁止重复定义 Answer / 请求 schema** —— 从 `validate.js` 导入，不另建 Zod schema。
5. **禁止自己拼 `<document>` 标签或 System Prompt** —— 用 `guard.js` 的 `wrapDocuments()` 与 `SYSTEM_PROMPT`。
6. **禁止在路由里写业务逻辑** —— 路由只做：Zod 校验入参 → 调 service → `ok()` 返回；异步必须经 `asyncHandler` 包裹。
7. **禁止在 service 里另写权限 SQL** —— 可见范围只经 `acl.visibleDocIds(clientId)` 获取；`clientId` 只从 `getSession(req)` 读，**忽略请求体里的 clientId**。
8. **禁止硬编码 docId / clientId 白名单** —— 一切来自 `access.json` 灌库结果；换语料不改代码。
9. **禁止 `console.log` 调试** —— 用 `logger`；禁止吞异常，向上抛 `AppError` 交给 `errorMiddleware`。

## 3. 代码规范

- ESM：`"type": "module"`，import 一律带 `.js` 后缀。
- 命名：文件名 `kebab-case`；函数/变量 `camelCase`；常量 `UPPER_SNAKE_CASE`。
- 异步统一 `async/await`；不用回调嵌套；不用 `var`。
- 所有外部输入（body / query / cookie）必须过 Zod 校验后才进入 service。
- 模型切换只改 `.env` 的 `LLM_BASE_URL / LLM_API_KEY / LLM_MODEL`，不得改代码。
- 新增公共方法必须补单测；业务模块至少覆盖 T3（隔离）、T4（注入）、T8（伪造身份）。

## 4. 扩展流程

- 换厂商（DeepSeek / 豆包 / OpenAI）：改 `.env` 三行 → `docker compose up -d --force-recreate`（**必须 force-recreate**，普通 `up -d` 不会重新读 env），无需 rebuild；**不要读取 key 文件**。
- 改业务代码（`server/` / `public/`）：**必须** `docker compose up --build -d`。Dockerfile 在构建时 COPY 代码，只 `up -d` 容器里仍是旧代码——曾因此多轮误判"前端没生效"。
- 换语料：替换 `CORPUS_DIR` 指向的目录 → 清库重灌；`access.json` 是权限唯一权威源。
- 加接口：在 `routes/` 新建路由文件 → `index.js` 挂载；公共能力先沉到对应公共模块，不在路由里实现。

## 5. 测试流程

- **本机单测**：`cd q1-assistant && npm test`（vitest，16 例）。测试用 `vi.mock` 隔离 `better-sqlite3` 与 LLM，不依赖原生模块——本机 Node 25 + PowerShell 装不上 `better-sqlite3`，属环境特例。
- **端到端**：`docker compose up --build -d` 后用 curl 验证接口，重点覆盖 T1 引用 / T3 隔离 / T5 时效 / T6 不足 / T8 伪造身份；流式用 `curl -N` 观察 `event: reasoning → text → done`。
- 改公共方法必须补单测；改流式/引用/权限相关逻辑必须同时补对应测试并实测。

## 6. 已知陷阱（实测踩坑，勿重复）

1. **SSE 首字延迟**：实测首字约 16 秒来自 **LLM 端点 TTFB**，不是 SSE 缓冲。SSE 只保证"数据产生即推送"。不要为"等太久"反复改前端协议——先用 Node 客户端直接量服务端事件到达时间。
2. **LLM 超时**：`.env` 的 `LLM_TIMEOUT_MS=30000` 会让慢模型流式调用抛 `terminated`；`streamChat` 已单独放宽到至少 120 秒，勿改回。
3. **不要用 EventSource**：`event: error` 是保留事件名、服务端 `res.end()` 后自动重连导致 `terminated`；统一用 `fetch + ReadableStream` + `setNoDelay(true)`。
4. **模型不返回 JSON/function call**：结构化输出有自动降级（functionCalling → 正文 JSON → 三段式文本）；流式模式靠 `【思考】/【回答】` 分隔符，勿强依赖 JSON。
5. **引用提取正则**：模型实际写 `docId="03"` 而非 `doc03`；正则须覆盖多种写法，但提取后仍要与召回集取交集，越权编号照常过滤。
6. **reasoning 防泄露**：模型可能在推导文字里提及越权文档；有引用被剔除时必须用安全话术覆盖 reasoning。
7. **流式区块创建**：思考区块必须在提问瞬间创建（`renderReasoning(wrap, bubble)` 允许空文本），否则 `null.textContent += delta` 会被 `catch {}` 静默吞掉。
8. **字段名**：`access.json` 用 `date`，不是 `doc_date`；作废判断别写错。
9. **检索阈值**：FTS5 OR 召回偏宽，重排时按最小命中数过滤（≥2，短问题 ≥1）；active 版本权重须明显高于作废版本（当前 2）。
