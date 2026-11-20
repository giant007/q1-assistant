# Q1 项目资料助手

基于 32 份建筑项目资料（施工日志、进度计划、报价单、验收记录、会议纪要等）的**有据可查**对话助手：每条结论标注来源，资料不足时如实说明；总包 / 分包两种身份严格隔离。

> 设计基线与取舍见 `../Q1-设计/PRD-需求分析与设计.md`、`../Q1-设计/架构设计.md`、`DECISIONS.md`；AI 使用过程见 `AI_LOG.md`。

## 一键运行

```bash
cp .env.example .env       # 填 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL
docker compose up --build -d
# 浏览器打开 http://localhost:3000
```

无 Docker 兜底：`npm install && npm start`（需本机可编译 `better-sqlite3`）。

**注意**：`public/` 与 `server/` 在构建镜像时 COPY 进去，改代码后必须 `docker compose up --build -d`；只改 `.env` 可用 `docker compose up -d --force-recreate` 让新配置生效（不必 rebuild）。

## 换模型

只改 `.env` 三行，`docker compose up -d --force-recreate` 重启即可，无需 rebuild：

| 厂商 | LLM_BASE_URL | LLM_MODEL |
|---|---|---|
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| 豆包（方舟） | `https://ark.cn-beijing.volces.com/api/v3` | 推理接入点 ID |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |

`LLM_TIMEOUT_MS` 默认 30 秒；流式调用内部强制至少 120 秒超时，避免慢模型首字延迟触发 `terminated`。

## 数据处理方式

1. **灌库**（启动自动，仅当 `documents` 为空）：读 `Q1-语料/access.json` 作为 clients / documents / document_acl 的唯一权威源；读每份 md/txt/csv 正文，按标题 / 段落切块（200–500 字），写入 `chunks` 与 FTS5 虚表 `chunk_fts`（中文 2-gram）；通用解析"第 N 版 / 作废"声明落到 `documents.status / superseded_by`；`领域小抄.md` 写入 `glossary`。换语料清库重灌即可，不改代码。
2. **检索**：问题同样切 2-gram，FTS5 `MATCH` 粗排 Top-40，内存重排（BM25 + 关键词覆盖率 + active 加权 + 日期新近度）取 Top-8。**权限过滤前置于检索**：先用 `acl.visibleDocIds(clientId)` 取白名单，SQL 只从这些文档取片段，越权内容物理上进不了上下文。
3. **问答流水线**：服务端会话取身份 → 历史指代消解 → 检索 → `guard.js` 用 `<document>` 数据标签包裹 → LLM 流式生成（思考 / 回答两段）→ 服务端引用校验（`docId` 必须 ∈ 白名单 ∩ 本轮召回集，type/date 用库中元数据覆盖）→ 写回 `messages`。召回为空或引用无效 → 硬兜底"资料不足"。
4. **身份切换**：`POST /api/switch-identity` 更新 `sessions.client_id` 并清空历史；请求体里的 `clientId` 一律忽略（T8 伪造身份无效）。

## 架构

| 层 | 位置 | 职责 |
|---|---|---|
| 公共层 | `server/{config,db,logger,errors,http,validate,llm,session,acl,guard}.js` | 环境变量 / SQLite / 日志 / 响应 / Zod 契约 / 模型工厂 / 会话 / 权限 / 注入防护，只写一次 |
| 业务层 | `server/services/{ingest,documents,retrieve,chat}.js` | 灌库、可见文档、检索、问答编排（按依赖顺序：ingest → documents → retrieve → chat） |
| 路由 | `server/routes/*.js` | 仅「Zod 校验 → 调 service → ok() 返回」 |
| 前端 | `public/{index.html,api.js,app.js,style.css}` | 原生 JS 单页；`api.js` 封装请求，`app.js` 负责渲染 |
| 存储 | `data/app.db`（SQLite + FTS5）、`data/` 卷 | 单文件持久化 |

开发规范见 `../.codebuddy/rules/SCAFFOLD.md`（九条禁令：禁止直接读 env / 自建连接 / 手写响应 / 重定义 schema / 自拼 document 标签 / 路由写逻辑 / 另写权限 SQL / 硬编码 docId / console.log）。

## HTTP 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/clients` | 身份列表 |
| `GET` | `/api/me` | 当前服务端会话身份（前端高亮用） |
| `POST` | `/api/switch-identity` | `{clientId}`；写会话 + 清空历史 |
| `GET` | `/api/documents` | 当前身份可见文档元数据 |
| `POST` | `/api/chat` | `{question}`；身份从会话读。默认返回 Answer JSON |
| `POST` | `/api/chat` | `{question, stream:true}`；SSE 流式推 `reasoning` / `text` / `done` 事件 |

Answer 契约：`{ text, reasoning?, mode, citations[], conflicts[], insufficient }`。

前端用 SSE 流式接口，提问后立即显示"正在检索资料…/正在连接模型…"等待提示，收到首字后思考与回答逐字刷出，最后补引用徽章（点击展开原文）。

## 测试

```bash
npm test          # vitest run，16 个用例
```

| 文件 | 覆盖 |
|---|---|
| `tests/acl.test.js` | 分包 28 份排除 15/24/28/32、总包 32 份、检索白名单前置、空白名单边界 |
| `tests/citation.test.js` | 伪造/越权引用降级、无引用兜底、元数据以库中为准、部分无效降级、doc26 注入当数据、reasoning 透传与安全覆盖 |
| `tests/llm.test.js` | functionCalling 正常 / undefined 兜底 / 围栏 JSON / json 模式 |
| `tests/stream.test.js` | 思考与回答逐块分流、结束时给出经校验的引用 |

## 验证状态

- 已在 Docker（Linux + 编译工具）内 `docker compose up --build -d` 实测：灌库 `2 身份 / 32 文档 / 65 分块`；`/api/clients`、`/api/me`、`/api/documents`、流式 `/api/chat` 均正常。
- 实测分包身份 28 份可见、越权 4 份不出现在列表与回答；伪造 `clientId` 被忽略；伪造引用降级"资料不足"；doc02 正确标记作废、doc03 优先。
- `npm test` 16/16 通过；`node --check` 与 lint 零错误。
- **SSE 实测**：首字延迟约 16 秒（LLM 厂商端点的 TTFB，非 SSE 缓冲），首字后 1.5 秒内推送 64 个事件。SSE 只保证"数据产生即推送"，不能缩短模型生成首字的时间；对延迟敏感可换更快的 `LLM_MODEL` 或减小 `TOP_K`。

## 交付物

- `DECISIONS.md`：关键取舍、假设、未做项及原因、复核点。
- `AI_LOG.md`：AI 使用方式、提问与采纳/否决记录、发现并纠正的错误、人工验证结果。
- `../Q1-设计/架构设计.md`：完整系统架构。
- `../Q1-设计/PRD-需求分析与设计.md`：需求与设计基线。
