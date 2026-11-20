# AI_LOG · AI 使用记录

> 按题目要求记录：怎么用 AI、问了什么、采纳/否决了什么、发现过 AI 哪些错。
> 本项目的设计与脚手架均在 AI 辅助下完成，以下为真实过程记录（非事后编造）。

## 一、使用方式概览

| 阶段 | AI 扮演角色 |  human 动作 |
|---|---|---|
| 需求分析 | 拆解题目与 PRD，核对硬要求与评分权重 | 提供题目原文、PRD、语料，人工复核硬约束 |
| 架构设计 | 产出技术选型、数据库表结构、检索与部署方案 | 人工收敛到"少而对"，砍掉向量库/独立 DB/登录 |
| 模型层调研 | 联网核实 LangChain 1.3.1 的 API 与多厂商配置 | 要求改为 LangChain 1.3.1 JS，人工确认版本与字段 |
| 脚手架搭建 | 生成公共层代码、规则文件、部署配置 | 人工定边界（公共层实现/业务层占位），逐项验证 |
| 文档补齐 | 汇总架构设计、取舍记录 | 人工核对与代码一致性 |
| 业务实现 | 按 SCAFFOLD 注入顺序实现 4 个 service、前端、测试 | 人工逐项实测（Docker 内跑接口、发真实问题）并纠偏 |
| 流式调试 | 定位"思考不实时 / terminated / 资料不足"等问题 | 人工用 curl / Node 客户端实测 SSE 事件与耗时，否决错误猜测 |

**约束策略**：给 AI 明确边界——"不要过度设计""不写业务代码""公共方法放脚手架""写入规则文件"，避免 AI 一次性生成大量业务代码和冗余抽象。

## 二、提问与采纳/否决记录

### Q1：基于 PRD 设计系统架构（数据库 + 前后端选型 + 一键部署，不过度设计）

- **AI 建议**：前端原生 HTML/JS；后端 Node+Express；SQLite 单文件 + FTS5 检索；身份存服务端会话；Docker 单容器。
- **采纳**：全部采纳。理由与"少而对"原则和 32 份文档规模吻合。
- **人工修正**：AI 初版把检索描述为"内存 Map + BM25"，人工收敛为"SQLite FTS5 持久化索引"，避免重启重建且便于引用溯源。

### Q2：LLM 改用 LangChain 1.3.1 JS，支持 DeepSeek/豆包仅改地址与 Key

- **提问**：核实 langchain 1.3.1 是否存在、`ChatOpenAI` 接自定义端点的正确字段。
- **AI 调研结论（联网查证官方文档）**：
  - `langchain@1.3.1` 是有效版本（2026-10 补丁版）；
  - 自定义端点字段是 `configuration.baseURL`，**不是顶层 `baseURL`**；
  - 模型名用顶层 `model`，Key 用顶层 `apiKey`。
- **采纳**：按此实现 `server/llm.js` 的 `createChatModel()`；配置三元组 `LLM_BASE_URL / LLM_API_KEY / LLM_MODEL`。
- **否决**：搜索结果中部分中文文章写的 `new ChatOpenAI({ baseURL: '...' })`（顶层）——与官方文档冲突，判定为错误写法并弃用。

### Q3：建立脚手架，公共方法放脚手架，业务不写冗余代码，写入规则文件

- **AI 建议**：新建 `.codebuddy/rules/SCAFFOLD.md`，列出公共层清单 + 九条禁令；脚手架内实现公共层、业务层留 TODO 占位。
- **采纳**：全部采纳，并让入口规则 `ENTRY.md` 引用新规范文件，形成引用链。
- **人工修正**：AI 初版让 `config.js` 在模块加载时就校验 LLM 密钥，导致未配 Key 时服务无法启动、无法查看页面；人工改为 `getLlmConfig()` 懒加载。

### Q4：补齐架构设计.md / DECISIONS.md / AI_LOG.md

- **AI 建议**：按既定章节汇总，如实记录未验证事项。
- **采纳**：采纳；明确写入"本机未做端到端实测，宣称可运行前需在 Docker 内验证"，不虚报通过。

### Q5：按 SCAFFOLD.md 的注入顺序实现 4 个 service

- **提问**：`.codebuddy/rules/SCAFFOLD.md` 定义了公共层与九条禁令，实现 `services/{ingest,documents,retrieve,chat}.js`。
- **AI 产出**：按 `ingest → documents → retrieve → chat` 依赖顺序实现；灌库以 access.json 为权威源、通用解析作废版本；检索白名单前置；问答流水线串联 guard/llm/acl 并做服务端引用校验。
- **人工验证与纠偏**：用真实语料跑纯函数校验时发现 `markSuperseded` 比较了不存在的 `doc_date`（应为 `date`），doc02 未被标作废——AI 写错字段名，人工发现并修复。

### Q6：模型端点不返回 JSON / function call，结构化输出一直 ZodError

- **现象**：`AnswerSchema.parse(raw)` 收到 `undefined`；`withStructuredOutput(functionCalling)` 在该端点拿不到对象。
- **AI 初版建议**：让用户改 `.env` 切 `LLM_STRUCTURED_METHOD=json`。
- **人工否决**：不要求用户改配置；改为公共层自动降级——functionCalling 失败就从正文提取 JSON（兼容围栏），字段名从 Zod schema 动态取，不硬编码。补 `tests/llm.test.js` 覆盖 4 条路径。
- **后续发现**：连 JSON 也不返回时，进一步改为三段式 `【思考】/【回答】` 文本 + SSE 流式（见 D9）。

### Q7："思考过程"不实时显示

- **多轮错误定位（AI 猜测 → 人工实测否决）**：
  1. AI 猜浏览器缓存 → 加 no-cache、强制 `--build`（确有问题：改前端后只 `up -d` 没 `--build`，容器里是旧代码）；
  2. AI 猜 fetch 缓冲 → 换 EventSource → **更糟**：`event: error` 是保留事件名、服务端 `res.end()` 后自动重连，导致 `terminated`；人工否决 EventSource，改回 fetch + ReadableStream；
  3. 真 bug：`renderReasoning(wrap, '')` 里 `if (!text) return null` 让 reasoningBody 一直是 null，逐字追加时 `null.textContent += delta` 抛错又被 `catch {}` 吞掉；人工发现并修复——提问瞬间就创建思考区块并插到 bubble 前。
- **AI 对"等 30 秒"的错误解释**：一度归为 SSE 缓冲/超时。人工用 curl 与 Node 客户端实测：服务端逐字推送正常，首字 16 秒来自 LLM 端点 TTFB，SSE 只保证"有了就推"。**SSE 不能让模型早点开口**——此认知纠正写入 README 与 DECISIONS。
- **采纳**：前端加等待提示（"正在检索资料…/正在连接模型…"），流式超时单独放宽到至少 120 秒（`.env` 的 30 秒导致 `terminated`）。

### Q8：补全测试与文档

- **提问**：把 `it.todo` 补成可执行用例；完善 README / DECISIONS / AI_LOG。
- **AI 产出**：4 个测试文件 16 个用例（ACL 隔离、引用校验、模型降级、流式分流）；文档按实现状态更新。
- **人工核对**：确认每条文档描述与实际代码一致，未验证项如实标注。

## 三、发现并纠正的错误

### E1（AI 版本幻觉）：`@langchain/openai@^0.8.0` 不存在

- **现象**：脚手架 `package.json` 初版写了 `@langchain/openai: ^0.8.0`，`npm install` 报 `ETARGET: No matching version found`。
- **纠正**：联网查 `npm view @langchain/openai versions`，确认 1.x 系列存在、0.8.0 不存在；查 `langchain@1.3.1` 的 peer 依赖为 `@langchain/core ^1.1.39`，把 provider 对齐到 `~1.3.0`。
- **教训**：LangChain 1.x 时代 provider 版本也进入 1.x，不能沿用旧版 0.x 印象。

### E2（资料误导）：`baseURL` 顶层写法

- **现象**：多篇中文技术文章示例把 `baseURL` 写在 `ChatOpenAI` 构造参数顶层。
- **纠正**：查官方文档 `docs.langchain.com/oss/javascript/integrations/chat/openai` 确认应放 `configuration.baseURL`；项目代码按官方写法实现。
- **教训**：中文二手教程可能与当前版本不符，版本相关 API 以官方文档为准。

### E3（AI 设计遗漏）：Dockerfile 缺原生模块编译工具

- **现象**：AI 初版 Dockerfile 只有 `node:20-bookworm-slim` + `npm install`，未考虑 `better-sqlite3` 在预编译包不可用时需本地编译。
- **纠正**：补 `apt-get install python3 make g++` 兜底。
- **同类遗漏**：AI 初版 `COPY Q1-语料` 但语料在构建上下文的上一级，会导致构建失败；人工把语料复制进 `q1-assistant/Q1-语料/` 使上下文自包含。

### E4（环境限制，非 AI 逻辑错）：本机 `npm install` 失败

- **现象**：Windows + Node 25 + PowerShell 下，`better-sqlite3` 的构建脚本 `prebuild-install || node-gyp rebuild --release` 中 `||` 被 PowerShell 判为非法语句分隔符。
- **处理**：改 `npm_config_script_shell=cmd.exe` 重试仍因 Node 25 无预编译包、且无 Visual Studio C++ 工具失败；判定为本机环境特例。最终在 Docker（Linux + python3/make/g++）内 `npm install` 成功并完成端到端实测，本机限制不再阻塞交付。

### E5（AI 写错字段名）：`markSuperseded` 用了 `doc_date`

- **现象**：access.json 里字段是 `date`，AI 生成的作废判断用 `older.doc_date < newer.doc_date`，两边都是 `undefined`，doc02 永远不会被标作废——T5 时效处理失效。
- **纠正**：改用 `date`；用真实语料跑纯函数校验才发现（单测当时还是 `it.todo`，没兜住）。

### E6（AI 检索权重失当）：OR 召回过宽 + active 权重过低

- **现象**：FTS5 `MATCH` 用 OR 拼 2-gram，"电梯品牌是什么"也命中无关片段而误调 LLM；作废的 doc02 排在有效 doc03 前面。
- **纠正**：重排阶段加"最小关键词命中数"过滤（≥2，短问题 ≥1）；active 权重从 0.5 提到 2。人工实测 T5/T6 后才定下阈值。

### E7（AI 公共层 bug）：json 降级路径未 parse

- **现象**：`schema.parse((await model.invoke()).content)` 把 JSON 字符串直接喂给 Zod，必然 `invalid_type expected object received string`。
- **纠正**：先 `JSON.parse` 再校验，兼容 content 为字符串或内容块数组；补单测。

### E8（AI 正则过窄）：引用提取认不出 `docId="03"`

- **现象**：模型实际输出 `docId="03"`，正则只认 `doc03`/`[03]`，提取不到引用 → 全部强制降级"资料不足"。日志里思考与回答都正常，全被这一步丢掉。
- **纠正**：放宽正则覆盖 `docId="03"` / `docId=03` / `Doc 03` 等写法；仍与召回集取交集，安全边界不变。用 curl 抓真实 SSE 才定位到。

### E9（AI 前端 bug）：空文本创建区块返回 null

- **现象**：`renderReasoning(wrap, '')` 因 `if (!text) return null` 返回 null，逐字追加时 `null.textContent += delta` 抛错，又被 `api.js` 的 `catch {}` 静默吞掉——思考过程一个字都没实时写出来，只在结束时补渲染一次。
- **纠正**：允许空文本创建区块，提问瞬间就插到 bubble 前，后续 delta 直接追加。

### E10（AI 方案选择错误）：EventSource 不适合本场景

- **现象**：为解决"fetch 缓冲"改用 EventSource，结果 `terminated` + 流式连接中断。
- **纠正**：`event: error` 是 EventSource 保留事件名，不能自定义；服务端 `res.end()` 后 EventSource 自动重连。改回 fetch + ReadableStream，并加 `setNoDelay(true)`。人工实测否决了 AI 的方案。

### E11（AI 误判根因）：把 LLM 首字延迟当成 SSE 缓冲/超时

- **现象**：AI 多次猜测"浏览器缓冲 SSE""连接超时"，反复改前端与协议，问题依旧。
- **纠正**：人工用 Node 客户端直接测量服务端 SSE：首字 16 秒、之后 1.5 秒推完 64 个事件——服务端流式完全正常；16 秒是 LLM 厂商端点的 TTFB。另实测 30 秒超时阈值会导致 `terminated`（curl 21 秒成功、浏览器那次 >30 秒失败），流式超时单独放宽到 120 秒。
- **教训**：先测量再改代码；SSE 只保证"数据产生即推送"，不缩短模型生成时间。此结论写入 README / DECISIONS。

## 四、AI 产出的人工验证

| 验证项 | 方法 | 结果 |
|---|---|---|
| 脚手架完整性 | 列目录，确认公共层/业务层/部署/规则文件齐全 | 通过，约 30 个文件 |
| JS 语法 | 对 21 个 JS 文件 `node --check` | 全部通过（failed=0） |
| 注入防护 | 实际调用 `guard.wrapDocuments()`，传入含 `<系统指令>` 的文本 | 正确转义为 `&lt;系统指令&gt;` |
| lint | `read_lints` 扫描脚手架与规则目录 | 零错误 |
| 版本可行性 | `npm view` 核对 langchain/provider 版本 | 修正后才通过依赖解析 |
| 灌库与隔离 | Docker 内启动后查 API：32/28 份可见、越权 4 份不可见 | 通过 |
| 端到端问答 | curl 真实提问 + Node 客户端测 SSE 事件与耗时 | 正常回答带引用；首字 16s 为模型 TTFB，非 SSE 缓冲 |
| 单测 | `npm test`（vitest） | 16/16 通过（ACL 4 / 引用 7 / 模型降级 4 / 流式 1） |
| 文档一致性 | 逐份比对 README / DECISIONS / AI_LOG 与实际代码 | 已按实现状态更新（本次） |

## 五、结论

AI 在本项目中承担了需求拆解、架构成文、脚手架搭建、业务代码实现、问题定位与文档汇总；人工的价值集中在**定边界、砍过度设计、按官方文档纠错、用实测数据否决 AI 的错误猜测、如实记录未验证项**。

AI 的真实错误（版本幻觉、教程误导、部署遗漏、字段名写错、正则过窄、前端空值 bug、EventSource 方案选错、把模型 TTFB 误判为 SSE 缓冲）均已在上文逐条记录并纠正，而非包装成"一次成功"。其中"流式思考不实时"一条经历了多轮猜测才由实测定位，教训是：**先测量再改代码**。
