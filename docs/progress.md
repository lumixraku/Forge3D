# Progress

> 仓库工作日志。为保持体积稳定，历史按主题合并为长期能力总结（不逐条追加），只在本文件末尾的 Recent Work 中保留短期更新；Recent Work 单调累积时定期把旧条目并入对应主题。

## Recent Work

### 2026-09-04 - main

- Debug 面板移除执行模式的 Auto 选项，只保留 Mock / Tripo API / Meshy API 三种：单选选中态改由 `activeProvider` 驱动（用户未选择时自动高亮服务器默认值），`setProvider` 收紧为只接受 `RunProvider`（去掉 null 与 localStorage 清除分支），`DebugPanel` 删除 `selectedProvider` prop、`serverDefault` 计算属性与 Auto 按钮，`App.vue` 移除对应绑定。
- 行为不变：未手动选择时 `selectedProvider` 仍为 null，运行请求依然省略 provider 由服务器决定默认值。
- 验证：`npm run typecheck`、`npm test`（348/348）、`npm run build`、`git diff --check` 通过；浏览器实测本工作树 dev server（5175），面板仅显示三个选项且 Tripo API（服务器默认）为选中态、Meshy 无 key 置灰。
- Remaining issues: None。

### 2026-09-03 - main

- 重新发布到 Cloudflare：`npm run cf:deploy`（vite build → prepare-cloudflare-assets → wrangler deploy），工作区干净、无代码变更；部署 worker `forge3d-canvas-studio`，Version ID `63194ab0-f2c0-4bec-963c-4b21d85a9db0`，上传 5 个新静态资产。
- 验证：`curl https://forge3d.lumixraku.org/` 返回 200 且引用新构建产物 `index-Br5paG_x.js`，与本次构建一致。
- Remaining issues: None。

### 2026-09-03 - main

- 节点左右两侧 `+` 按钮弹出的“添加上游/下游节点”菜单改为 viewport UI：`Teleport` 到 `body` 并以 `position: fixed` + 屏幕坐标挂载在按钮旁（`togglePreviousMenu`/`toggleNextMenu`/`anchoredMenuPosition`），不再随画布缩放/平移，与右键菜单一致。
- 点击空白画布（`VueFlow @pane-click` → `dismissCanvasPopups`）同样关闭右键菜单与 `+` 菜单，不再仅限画布移动/缩放时。
- 验证：`pnpm run typecheck`、`pnpm run build` 通过；build 仅保留既有 large-chunk warning。
- Remaining issues: 未在浏览器实测视觉位置（本地 dev 指向不确定），逻辑与右键菜单同构。

## Current State

- Branch: `main`（最近提交 `3da0c15 fix: throttle canvas saves at 2s, save structural edits immediately`）。
- 测试基线：`pnpm test` 302/302 通过；`pnpm run typecheck`、`pnpm run build` 干净（build 保留既有 large-chunk warning）；`git diff --check` 通过。
- 浏览器验证说明：本机 5175/5176 的 dev server 偶发指向 `/Users/nan/repos/tripo-forge3d-demo`（第二个分叉 clone，含 `forge:`→`forge-` 前缀迁移），因此部分条目未做浏览器验证；验证时需确认运行的是本工作树。
- 生产环境：`https://forge3d.lumixraku.org`（worker `forge3d-canvas-studio`，D1 `forge3d`/`9b7fb975-...`），`TRIPO_API_KEY`/`TRIPO_BASE_URL` 来自 `.env`；Tripo 仅在本地 Node server 可跑，Cloudflare 上不可用（见 Capability Summaries 内 “Tripo 与 Cloudflare”）。

## Capability Summaries

### 画布编辑与交互

- 节点目录分 Input / 2D / 3D / Video 分类；点击目录或从目录拖拽创建节点、自动选中并居中到视野；右上 `+` 菜单只列出兼容后继节点。
- 连接生命周期（`onConnect`/`onConnectStart`/`onConnectEnd`/`onConnectCancel`）与类型化端口（`text`/`image`/`model`/`asset`/`any`），拒绝不兼容连接；`+ Incompatible edges` 在加载时过滤；source/target 端口元数据随连线持久化；指针命中扩展为 36px 不可见命中线，Shift 扩展选择。
- Ctrl+D 复制节点：直接追加到渲染图、保留相对布局与参数（24px 偏移）、刷新节点/边/父节点 ID、复制不携带运行结果，也不重排既有 Section。
- 选中感知的 Auto Layout：无选择=全局布局；选中节点=仅其坐标范围；仅选中一个 Section=只布局其直接内容；Section+外部节点=作为组节点。Auto Layout 不再伴随 fitView（拆分出工具栏主动调用）。
- Section（Frame）：从点击放置改为拖拽绘制（`useFrameDraw` + `buildDrawnFrame`）、拖拽矩形吸附子节点、拖动 Section 时重叠根节点被收养、跨 Section 拖入/拖出采用重叠所有权规则、选中感知 Fit、节点进入/离开/手拖时才 refit（运行态重测量不再触发 refit）、`manualSize` 退役、帧尺寸自适应其子节点。
- 远程焦点刷新只修数据不重绘布局；顶部 bar / canvas 工具栏位于 Vue Flow 之上，Section 位于普通节点之上。
- 引力向画布放下图片文件会在落点创建 Asset Upload 节点并立即上传，保持既有目录拖拽路径不变（图片扩展名兜底 MIME 缺失）。
- MessagePack 二进制系统剪贴板（无 `text/plain` 兜底）、版本化 canvas fragment 跨标签粘贴、跨标签粘贴时节点/边/父 ID 重映射。

### Agent 与对话系统

- 单 Agent 串行化每用户请求一条 canvas turn；移除 coordinator 拆分/worker summaries/coordinator 端点；恢复 `Thinking` / `Preparing canvas agent` 状态。
- SSE：canvas 单事件通道、10 分钟空闲 `sse-end`、浏览器 `EventSource` 收到 end 主动关闭、每帧 `id:` 用于重连、恢复连接后经 REST 重读 turn（`reconcileRestoredTurns`：新增 bubble 或修复缺卡片）、`request_user_select` 卡片在断线期间不丢失。
- 计划引擎 `server/planner.ts`：AI 只提交有序 `nodeTypes`，服务端 `createNode()` 写死坐标（第 1 个 `(100,150)`，其后 `previous.x+340`、同 y），节点宽按 260、帧内边距 70，新 Section 放在已有顶层内容右侧 +160，保证生成 Workflow 永不重叠；`addCanvasStage` 在已有画布上追加节点；参数批量 `applyParameterChanges`。
- 工具集：`get_canvas_structure`、`list_available_node_types`、`get_credit_balance`、`build_canvas`、`update_node_parameters`、`add_canvas_node`、`execute_canvas_node`、`list_canvas_executions`、`get_execution_status`、`cancel_execution`、`request_user_select`。
- 持久化 trace 与可恢复 checkpoint；`pnpm agent:eval` fixture 离线 eval；恢复时避免重复入队已有用户选择请求的 turn；失败显示 `重试`；Enter 发送、Shift+Enter 换行；一个动作按钮在 Send/Stop/Stopping 间切换；附件胶囊 + 悬停/聚焦放大预览。

### 节点模型与数据流

- 节点由 schema 驱动：`canvas-schema.ts`（`inputs`/`outputs` keyed maps、`requires?: NodeRequirement[]`、`advanced` 元数据、`executable`/`modelEditor` 标志）、端口 ID 即 map key，避免声明与边引用漂移。
- 运行门控从端口改为参数：`NodePortSpec` 仅保留数据流语义（`type`/`label`/`multiple`/`fallbackConfig`），`CanvasNodeSchema.requires` 声明“不能运行则缺失的参数”，缺失参数禁用按钮并显示原因（`missingParametersByNode`/`required_parameter_missing`）。
- 节点存储三棵树：`config`（用户填的参数）、`uploadAssets`（用户上传）、`generatedAssets`（运行产物），空树不写字段；复制节点丢弃 `generatedAssets`、保留 `uploadAssets`；统一迁移点（`splitNodeTrees` + `migrateCanvas`），兼容旧的 `outputResult` 遗留 key。
- 执行基于声明端口：`resolveNodeInputs`/`resolveNodeOutputs`/`resolveEdgePorts`/`nodeOutputPortValues`；`multiple` 输入在折叠边携带全部兼容输出；`texture` 可回退搜索数跳之外的上游参考图（`reference_image_path not found`）；`bake` 节点因无 Tripo endpoint 被退役。
- `generate-model` 单节点接受全部图像输入形态（单图/多图/标注四视图），多视图输入端 `front/back/left/right` 与 `multiview-to-3d` 同 key 配对。

### 执行引擎与 Tripo

- `server/api-core.ts` 统一 Node/Worker 路由与 `executeAgentTurn`（注入 `store`/`config`/`waitUntil`）；`server/index.ts` 为 Node 绑定，`worker.ts` 为 Cloudflare 绑定。
- 计划：前端 `planNodes` 与 server `executionNodes`/`downstreamCanvas` 必须一致（mismatch 返回 409）；依赖图按 wave 执行（`Promise.all`），Tripo 用 `context` map 显式传递上游结果；`waiting_review` 软门控 + 审核通过重跑；失败短路余下节点为 `skipped`；支持取消。
- 独立后台执行（`execute_canvas_node`）、任务列表/状态/取消工具、多执行并行跟踪；Task List/Drawer 展示任务进度、下载产物、每任务唯一 run ID。
- Tripo 输出不再落盘进 `server/data/assets`，改用 task ID 作为稳定引用（`GET /api/...` 按需刷新并 302 到当前 model URL）；`createGeneration`/`createJob` 等映射统一 `server/tripo-mapping.ts`/`tripo-provider.ts`。
- 真实 Tripo 链端到端已验证（参考图→Gen HD Model→Retopology→UV Texture→Export，5 节点全绿，共 80 credits，11m28s）；模拟路径保留给无 key 开发；模拟运行 5s 便于观察进度。

### 保存、持久化与协作

- 保存收敛为一个入口：`saveCanvas({ immediate, keepalive })`（默认 700ms debounce，`immediate` 立即发），删除 `flushPendingSave`/`pendingSaveSnapshot`/`localSequence` 竞态；`savePromise` 链式串行，避免 409 覆盖；2016-08-30 起改为 2000ms throttle + 结构性改动（增删节点、上传完成、Agent 面板聚焦）立即保存。
- 服务器端 `baseRevision` 条件写、stale 返回 409；草稿持久化到 localStorage；blur/pagehide/keepalive 尽快 flush。
- 协作：进程内 edit lease（30s 过期、10s 续租、blur/page exit 释放、30s 无编辑自动释放）、per-tab 访客身份、当前编辑者 top notice（advisory，不阻塞编辑）；帧内边距与 `componentGap` 与 zoom 无关，避免不同缩放两端互相 refit 来回写。
- 历史既有的数据迁移：`workflows`→`canvases`、`tasks`→`turns`、`workflowId`→`canvasId`、`outputResult`→`generatedAssets`、消息端口迁移；D1 六集合备份在 `~/backups/forge3d-d1/2026-08-03-pre-canvas-migration/`。

### 账户、积分与扣费

- 持久化 `Demo User` 账户与追加式执行账本；每次执行固定扣 10 credits、余额不足 402、成功计费、失败/取消退款一次（按 run ID 幂等）；顶栏头像/用户名/余额随执行与 canvas events 刷新；跨 store reload 串行化扣费。

### 资源、上传与预览

- `POST /api/assets`（Node server）把字节写入 hashed asset cache 并返回 `/api/assets/<hash>.<ext>`；聊天附件上传后才入库，保存 server URL；Cloudflare Worker 无 R2 时不提供上传。
- Asset Upload 节点：图片/3D 模型上传、图片即时预览、模型下载卡片、blob 预览不持久化、上传完成后替换为持久 URL、失败清除临时预览、上传中整卡 loading 覆盖、单资源槽位（drop zone 与 preview 互斥）+ `×` 清除；`thumbnailUrl` 由浏览器离屏渲染 512px PNG 一次性生成。
- GLB/GLTF 缩略图管线与轻量静态 3D 卡片（点击打开 Model Editor）；节点高度稳定（预览卡统一 `aspect-[4/3]`），运行/上传不改变节点尺寸。
- 空/失败图片统一干净状态占位，避免 broken-image 图标与 alt 文本。

### 界面、主题与视觉

- Tailwind 迁移：应用级规则从 `styles.css` 迁入组件按需类（`forge:` 前缀 + `forge3d-` 命名，适配宿主内嵌）；`light:` 变体；执行中边缘流动高亮、进度条、输出端口 halo。
- 主题：`index.html` 在首帧前同步解析 `data-theme`（消除 light 主题刷新闪烁）、主题色同步、浅/深主题 token（`--node-ring` 等）。
- 聊天/顶栏：紧凑 99px composer、30px 圆形按钮（Send/Stop 合并）、附件 pinned 宽度 120px、消息边框统一、顶部按钮群等高对齐。
- 其它：调试球可拖拽并吸附四角（corner 记忆）、pinch-zoom 仅画布、执行边缘动画、autosave 后 `Saved` 状态、README 截图与文档迁移到 `docs/`。

### 稳定性与基础设施

- 共享 API core 消除 Node/Worker 双实现分歧；`listen.ts` 端口自动探测（`EADDRINUSE` 递增）、Vite 端口 fallback；并行保存期间也允许自动布局（`CanvasToolbar` 不再在多 PUT 期间置灰）。
- 修过的关键事故：自定义域名曾在重命名后流浪到旧 worker（wrangler `name` 即身份，`[[routes]] custom_domain` 修复）；重命名未随附数据迁移（`migrateCanvasRefs`）；空库时无法新建第一个画布（TopBar 空态分支）；`bizClass` 未导入导致 debug ball/任务队列空白；Node 双进程互相删 canvas（`persistCanvasFiles` 改为只写、显式 `removeCanvas`）。
- 记录到的真实 bug：`ExecutionOutputPanel` 引用未定义的 `bizClass`；Node 服务 `EADDRINUSE` 崩溃；`outputResult` 改名后遗留旧树未迁移。

### Tripo 与 Cloudflare（当前约束）

- Tripo 需要文件系统（写入 `server/data/assets/`）+ 运行时长 > 单次 Worker 请求（11m28s），故 Cloudflare 上不可用：`worker.ts` 硬编码 `createTripoProvider: null`，能力探测返回 `tripo: false`；需 R2（未启用，`code 10042`）+ Durable Objects/Queues 才能迁移 —— 未开始，详见 `docs/execution-engine.md` 与历史备注。
- 生产 `wrangler secret put DEEPSEEK_API_KEY` 已配置；旧 worker `forge3d-workflow-studio` 残留同一份 secret（无害但建议删除）。

## Verification Summary

- 常规验证命令：`pnpm test`、`pnpm run typecheck`、`pnpm run build`、`git diff --check`、`npx wrangler deploy --dry-run`。
- 测试规模沿革：20 → 182 → 186 → 192 → 227 → 253 → 259 → 265 → 269 → 284 → 288 → 294 → 297 → 300 → 301 → 302（当前）。
- 浏览器验证集中在现有 Chrome/Chrome MCP 会话的 localhost dev server；本地 dev 指向第二个 clone 的时段（2026-08-29 起）阻止了部分视觉验证。
- `docs/execution-engine.md`、`docs/project-reference.md`、`docs/api.md` 与本日志同属文档主力；执行引擎细节与 SSE 协议另见 `docs/agent-sse-data-design.md`。

## Outstanding Issues

- 浏览器验证缺口：因本地 dev server 偶发指向第二个 clone（`/Users/nan/repos/tripo-forge3d-demo`），2026-08-29/31 的行为（Asset Upload 高度稳定、参数门控、图片落画布建节点）未在浏览器实测；视觉确认仍待补。
- 两个 clone 已分叉（本 tree `02bdbc6`，另一处 `c2785d3` 领先三提交并含 `forge:`→`forge-` 前缀迁移）；上一变更可能需要移植过去，前缀差异不是干净 cherry-pick。
- 进程内 edit lease 需要共享 TTL 才能多实例部署；跨标签 30s 空闲交接未完整手测。
- 协作保存仍有边界：`hasUnsavedCanvasChanges` 比较 `viewport`（`toDomainCanvas` 恒等，永不判定 dirty）；`refreshCanvasFromServer` 缺 `openToken` 防护；`releaseOnBlur` 释放后不立即重新获取 lease。
- SSE 断线期间 `text`/`progress` 增量不持久化，恢复时只展示已恢复状态；卡片、节点状态与画布文档可恢复。
- 任务图重试、独立 Task steering、canvas revision rebasing 尚未实现；跨进程恢复不恢复运行中的 Coordinator 模型请求。
- `multiview-to-3d` 保留 hidden 未退役；无标签多图输入尚无真实 Tripo 端点（暂借 `multiview-to-model` 位置数组作为 trial）。
- `generate-model` 的四视图/单图/多图检测仍依赖顺序假定；`nodule` 仅有声明但无节点使用（`any` 端口无人使用）。
- Asset Upload 无 R2 时不提供上传（Worker 上不可用）。
- 微信外链图片可能带 hotlink 防护；需在浏览器验证失败下线逻辑（属于既有高风险项，未在本轮完成后复测）。

## Recent Work

### 2026-09-01 - main

- 节点左侧新增上游 `+`：菜单按目标节点输入端口反向筛选兼容节点；选择后在目标左侧创建节点并自动建立上游→当前节点连线；右侧后继菜单保持不变，两个菜单互斥展开。
- 新增 `compatibleUpstreamNodeTypes` 及覆盖 Asset Upload/Gen HD Model/终端节点的单测。
- 验证：`pnpm run typecheck`、`pnpm test`（303/303）、`pnpm run build`、`git diff --check` 通过；build 仅保留既有 large-chunk warning。
- Remaining issues: None。

### 2026-09-01 - main

- 拖图片到画布：落点自动创建 Asset Upload（`reference-image`）节点并立即上传；临时 `File` 仅作非枚举 live-node 触发器，持久 URL 写 `uploadAssets` 后立即保存；保留既有节点目录拖拽路径，不支持的文件仍被画布认领（防浏览器导航），图片扩展名兜底 MIME 缺失。
- 验证：`pnpm run typecheck`、`pnpm test` (302/302)、`pnpm run build`、`git diff --check` 通过。
- Remaining issues: None。

### 2026-08-31 - main

- 运行门控从端口迁到参数：`NodePortSpec` 去掉 `required`/`requiredGroup`（仅数据流语义），`CanvasNodeSchema.requires` 声明参数（嵌套数组=任一），端口携带时在线即算满足、否则用 `fallbackConfig`，无端口携带则读 `config`；概念名同步更新（`requireParameters`/`required_parameter_missing`/`missingParametersByNode`/`missing-parameters`）；文档同步。
- 验证：`pnpm run typecheck` 干净，`pnpm test` 302/302；新增测试覆盖连接满足端口参数、旧端口测试迁移、无 `required` 端口 + `requires: ['image']`。
- Remaining issues: 浏览器未验证（dev server 指向第二个 clone）；行为按设计不变，预期无视觉差异。
