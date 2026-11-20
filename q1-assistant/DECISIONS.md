# DECISIONS · 关键取舍、假设与未做项

> 记录 Q1 项目资料助手的关键决策。每条格式：选择 / 理由 / 否决的备选 / 代价与复核点。
> 依据：`Q1-建筑项目资料助手.md`、`Q1-设计/PRD-需求分析与设计.md`、`Q1-设计/架构设计.md`。

## 一、关键取舍

### D1 检索方案：SQLite FTS5 + 中文 2-gram + BM25，不引入向量库

- **选择**：语料切块后生成 2-gram 写入 FTS5 虚表，用 `bm25()` 粗排，内存做 active/日期/关键词覆盖加权。
- **理由**：语料仅 32 份、约数百 KB，关键词召回足够；PRD §1.4 明确将向量库列入"不做"。
- **否决**：① 向量库 + Embedding（多一个服务、多一份运维，且需要额外 Key）；② 纯内存 `Map` 索引（进程重启重建、无法沉淀索引）。
- **代价**：语义相似度召回弱于向量方案，依赖领域小抄做术语扩展；若未来语料扩到数千份需复核。

### D2 数据库：嵌入式 SQLite 单文件，不用 C/S 数据库

- **选择**：`better-sqlite3`，数据库落在 `data/app.db`，随容器卷持久化。
- **理由**：零运维、随容器一键起；表结构（文档、ACL、会话、历史）用关系模型表达最直接。
- **否决**：PostgreSQL/MySQL（多一个服务、多一份部署与字符集配置，收益为零）。
- **复核点**：`better-sqlite3` 是原生模块，Dockerfile 已装 python3/make/g++ 兜底编译；本机 Node 25 + PowerShell 构建失败属环境特例，已在架构设计 §13 记录。

### D3 身份：切换而非登录；状态存服务端会话

- **选择**：`POST /api/switch-identity` 写 `sessions.client_id`，`httpOnly` Cookie 带 `sid`；`/api/chat` 只从会话读身份。
- **理由**：题目原文是"切换客户身份"而非登录；评分考察的是可见性过滤与抗注入，不是认证。服务端会话可防前端篡改（T8）。
- **否决**：① 前端传 `clientId` 直接检索（篡改即绕过隔离，致命）；② 无状态 JWT（本题不需要签名态，徒增复杂度）。
- **代价**：会话依赖服务端存储，不适合多实例水平扩展；本题单容器，可接受。

### D4 权限过滤位置：写进检索 SQL，而非检索后过滤

- **选择**：`chunk_fts JOIN document_acl ... WHERE a.client_id = :session_client`，权限与召回同一条 SQL。
- **理由**：越权文档从源头不进入上下文，才能同时满足"不使用"和"不泄露存在"两条硬要求。
- **否决**："先全量召回再按白名单过滤"（易遗漏、且 LLM 可能从 prompt 中感知到被过滤文档的存在）。
- **落实**：`retrieve()` 先调 `acl.visibleDocIds(clientId)` 取白名单，SQL 用 `c.doc_id IN (...)` 占位符过滤，未在 service 里另写权限逻辑（符合 SCAFFOLD.md 禁令 7）。虽与架构文档 §4.4 的 JOIN 写法不同，但同样做到"越权文档物理上取不到"。

### D5 LLM 接入：LangChain 1.3.1 JS + ChatOpenAI 统一兼容协议

- **选择**：`langchain@1.3.1` / `@langchain/core@1.3.1` / `@langchain/openai@~1.3.0`；DeepSeek、豆包、OpenAI 全部走 `ChatOpenAI` + `configuration.baseURL`。
- **理由**：用户要求 LangChain 1.3.1 JS 版本且支持多厂商仅改地址与 Key；三家均为 OpenAI 兼容协议，一个 provider 足够。
- **否决**：① 每厂商装独立 provider 包（增加依赖与维护面）；② 手写 fetch 直连（无统一结构化输出与重试）。
- **代价**：`baseURL` 必须放在 `configuration` 内（顶层写无效，已踩坑并纠正）；结构化输出用 `functionCalling`，对不支持 tool calling 的端点需 `LLM_STRUCTURED_METHOD=json` 降级。

### D6 结构化输出：Zod schema 约束 + 服务端引用校验双层

- **选择**：`withStructuredOutput(AnswerSchema)` 保证格式；服务端再校验 `citation.docId ∈ 可见白名单 ∩ 本轮召回集`。
- **理由**：schema 只保证 JSON 合法，不保证引用真实；安全判断不能交给模型。
- **否决**：完全信任 LLM 自报引用（会张冠李戴或编造 docId）。
- **复核点**：无有效引用必须降级"资料不足"（T1/T6）。

### D7 部署：Docker Compose 单容器 + 数据卷

- **选择**：`docker compose up --build -d` 一条命令；Key 走 `.env`，数据走 `./data` 卷。
- **理由**：题目门槛是"一条命令起、网页能交互"。
- **否决**：K8s / 多服务编排（过度设计）；纯 `npm start`（需先装依赖，非一条命令，仅作无 Docker 兜底）。

### D8 脚手架分层：公共层实现、业务层占位

- **选择**：config/db/http/validate/llm/session/acl/guard 等在脚手架内实现；`services/*` 与前端 `app.js` 先留签名与 TODO，业务阶段再填。
- **理由**：用户要求公共通用方法放入脚手架、业务开发不写冗余代码；先定边界避免各写一套。
- **否决**：把业务逻辑一并写进脚手架（超出"脚手架"定位，且会掩盖公共层的复用约束）。
- **落实**：`.codebuddy/rules/SCAFFOLD.md` 的九条禁令把边界固化为规则；业务阶段严格按 `ingest → documents → retrieve → chat` 依赖顺序实现，每层只消费公共层与前序服务。

### D9 实时思考过程：SSE 流式 + 三段式文本，不依赖 JSON

- **选择**：`/api/chat` 的 `stream:true` 走 SSE，前端 `fetch + ReadableStream` 逐块读；System Prompt 要求模型输出 `【思考】/【回答】` 两段；服务端按分隔符实时分流，结束时统一做引用校验再发 `done`。
- **理由**：用户要求"输入后马上显示思考过程"；实测模型端点不返回标准 function call / JSON，结构化输出拿不到 `reasoning`，只能走流式文本。SSE 只保证"数据一产生就推送"，首字延迟由模型端点决定（实测约 16 秒）。
- **否决**：① 继续强依赖 `withStructuredOutput` 的 JSON（端点返回 undefined，多次 ZodError）；② EventSource（GET 接口 + `event: error` 是保留事件名 + 服务端 `res.end()` 后自动重连，实测导致 `terminated` 与连接中断）；③ 等整段生成完再渲染（无实时感）。
- **代价**：引用从正文 `docId="03"` 等文本里提取，正则需覆盖多种写法；仍严格与召回集取交集，越权编号照常过滤。流式超时单独放宽到至少 120 秒。

### D10  answering 安全：reasoning 也要防泄露

- **选择**：模型输出的 `reasoning` 若伴随被服务端剔除的引用，整体替换为安全话术；"资料不足"兜底自带固定 reasoning。
- **理由**：模型可能在推导文字里提及越权文档（如 doc28），即使 citations 被过滤，文本仍会泄露。
- **否决**：原样透传 reasoning（有泄露风险）。
- **落实**：`tests/citation.test.js` 覆盖"伪造引用被剔除后 reasoning 不含 doc28/单价"。

## 二、假设

1. 语料固定为 `Q1-语料/` 的 32 份合成文档；`access.json` 的 `visible_to` 是权限唯一权威源，换语料不改代码。
2. 模型供应商提供 OpenAI 兼容端点与 function calling；若不支持，用 `LLM_STRUCTURED_METHOD=json` 降级。
3. 演示环境为单用户单容器，无并发隔离与水平扩展需求。
4. 身份切换是 UX 入口，不是登录；不要求密码、验证码、持久化登录态。
5. LLM Key 由使用方自备并通过环境变量注入，不入库、不入前端包。

## 三、明确不做及原因

| 不做 | 原因 | 来源 |
|---|---|---|
| 向量库 / Embedding | 32 份文档规模小，2-gram + BM25 足够；题目明示不做 | PRD §1.4 |
| 用户登录体系 | 题目要求"切换身份"；隔离靠服务端过滤而非认证 | PRD §7.1 / 题目原文 |
| 文档上传 / 多项目 | 语料固定，范围外 | PRD §1.4 |
| UI 美化 | 题目明示 UI 不加分，限 4–6 小时 | 题目评分标准 |
| 前端框架与构建链 | 零构建才能一条命令起 | 架构设计 §3 |
| 微服务 / MQ / Redis | 单进程单容器足够，会话与历史落 SQLite | 架构设计 §3 |
| 独立 citations 表 | 引用嵌在 Answer JSON 即可，无独立查询需求 | 架构设计 §4.1 |

## 四、验证结论与待复核项

**已验证**（在 Docker 内实测）：
- `docker compose up --build -d` 一条命令启动，灌库 `2 身份 / 32 文档 / 65 分块`，网页可交互（"可运行"门槛已过）。
- 分包 28 份可见、15/24/28/32 不可见；伪造 `clientId` 被忽略；伪造引用降级"资料不足"；doc02 作废、doc03 优先；doc26 注入转义；`npm test` 16/16 通过。
- SSE 实测首字约 16 秒（LLM 端点 TTFB），首字后 1.5 秒推完 64 个事件——流式链路本身实时。

**待复核**：
- 首字延迟取决于模型端点；对延迟敏感时换更快的 `LLM_MODEL`（影响最大）或把 `TOP_K` 从 8 降到 4 减少 prefill。
- 若某厂商连正文 JSON 也不返回，三段式文本解析是唯一兜底；需确认模型遵守 `【思考】/【回答】` 分隔符。
- 若检索漏召回导致误答"资料不足"，按 PRD §1.6 加全文关键词兜底。
- 本机 `better-sqlite3` 因 Node 25 + PowerShell 构建限制未装成，仅 Docker 内验证；无 Docker 的 `npm install && npm start` 路径未实测。
