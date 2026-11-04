# 淘宝／天猫商品读取与当前角色分析

核对日期：2026-11-04（Asia/Shanghai）。当前状态：独立模块、聊天接入和模拟接口测试已实现；真实商品读取尚未获得权限并验收，生产数据源保持关闭。

## 已做与未做

- 在原聊天内识别详情页与分享短链，最多查询 6 个商品。原消息和原链接不改写，普通网址不会触发商品查询。
- 沿用当前角色、模型配置、聊天历史、人格和既有限流；不新增购物聊天窗口、购物专用模型或用户 MCP 配置。
- 商品卡片绑定原消息，含平台、实际返回的标题／图片／价格／店铺、获取时间、安全详情链接和未读字段。图片失败用占位，重读不自动请求模型。
- 同一会话中可继续比较，普通话题不附商品资料。其他角色／群聊的商品不会带入。明确刷新可重查；过期价格不能作为当前价格。
- 没有淘宝登录、Cookie、验证码处理、搜索全库、加购、付款、推广佣金或商家通信。
- **当前生产环境没有 TBK_APP_KEY／TBK_APP_SECRET，也没有取得并实测消费者比价场景权限。单商品真实读取、多商品真实比较、真实模型的推荐文风均未验收。任何合成商品只用于被忽略目录中的测试，未作为生产成功数据。**

## 数据源调查

### chengkit-taobao

参考仓库：https://github.com/banxia79009/chengkit-taobao

核对版本：`7ede18a2c74437b834dd86c0d0393b8ab8cae782`。README、CLOUD-SETUP.md、tools/taobao-detail.cjs 和浏览器会话模块显示其依赖 Windows Chrome、OpenCLI 扩展和用户本机登录态；登录／验证由用户本人处理。它没有提供已验证的无登录 Workers 商品数据 API，云环境也没有完成其作者的部署验收。因此只借鉴“按已读字段作判断、展示价不冒充成交价、网页内容不是指令”的设计思路，没有复制其源码或安装、移植其本机浏览器与登录机制。

该仓库采用 PolyForm Noncommercial 1.0.0（非商业许可），不能因为源码可见就视为无限制商用。参考版本和许可信息保留在本说明；本项目没有包含其代码。

### 淘宝官方

1. 原 `taobao.item.detail.get` 下线公告：
   https://developer.alibaba.com/support/announcementDetail.htm?id=25481
   公告发布于 2019-11-08，宣布 11 月 25 日下线该接口。目录或旧示例存在不代表当前可以申请。
2. 已核对的候选接口：
   https://developer.alibaba.com/docs/api.htm?apiId=24518
   `taobao.tbk.item.info.get` 是淘宝联盟的商品信息简版查询。文档列有 AppKey、签名、商品编号及场景参数；当前适配器固定请求 `biz_scene_id=2`（消费者比价），不做转链推广或佣金业务。
3. 实现仅映射已核对字段：`num_iid`、`title`、`pict_url`、`zk_final_price`、`nick`、`user_type`。`reserve_price` 是标价，不足以证明历史原价，故不填写 originalPrice。未读到 SKU、材质属性、描述、评价、库存时列入 unavailableFields，不从标题猜测补全。
4. **待项目方实际核实**：当前账号能否申请场景 2、AppKey／AppSecret 的账号资格和备案要求、所需 API 权限、配额及调用限制、兴趣项目是否被允许、图片／价格／SKU 等展示及缓存许可。公开文档不能证明本项目已获许可；没有登录开发者后台、提交申请或进行真实授权调用，不能承诺免费、免备案或可查询所有商品。
5. 申请后必须用一条实际商品进行服务端验收，检查身份／权限、响应字段、实际配额与展示条款，再打开开关。AppSecret 不应粘贴到聊天、前端或备份中。

### 第三方

调查过公开商品数据服务文档（例如 JustOneAPI 的淘宝／天猫详情说明：https://docs.justoneapi.com/zh/api/taobao-and-tmall/product-details-v4）。接口文档和试用资格不能证明其获得适合本项目的合法数据及展示授权。没有验证到可采用的授权，故本次未接入第三方，也未设置任意第三方 URL 代理。

## 模块与修改文件

| 文件 | 用途 |
| --- | --- |
| src/shopping.ts | 独立类型、严格链接解析、字段清洗、图片限制、过期判断、会话证据整理 |
| src/shopping-client.ts | 同源查询、已有商品复用、刷新、错误回退、绑定原消息 |
| src/shopping-ui.ts、src/shopping.css | 原聊天内的商品卡片、失图占位、过期显示和重读操作 |
| worker/products/http.ts | 超时、响应大小及中止控制 |
| worker/products/taobao.ts | 默认关闭的固定官方候选接口与 TOP MD5 签名、字段映射 |
| worker/products/service.ts | 独立请求入口、域名／逐跳检查、限流与标准错误 |
| worker/index.ts | 在既有 Worker 增量接入 /api/products，保留 /health |
| functions/api/products.ts | Pages 同源入口，复用同一商品服务 |
| src/api.ts | 通过既有调度器传递数据，按能力使用真实工具往返或受控上下文 |
| src/main.ts | 原发送／群聊／渲染流程的局部接入，过期清理与导出前清理 |
| src/storage.ts | 事务合并商品 metadata，防止异步覆盖已编辑／撤回／回退的消息 |
| wrangler.toml、worker/wrangler.toml | 分别用于 Pages 与可选独立 Worker，启用 nodejs_compat |
| public/_routes.json、public/sw.js | 仅商品 API 进入 Function，商品 API 不进离线缓存；缓存版本 v41 |
| tsconfig.worker.json、worker/node-crypto.d.ts、package.json | 把服务端也纳入 TypeScript 检查，使用平台内置密码库 |
| scripts/shopping.test.mjs、scripts/shopping-ui.test.mjs | 独立规则、服务、浏览器与协议测试 |
| scripts/smoke.mjs、scripts/theme.test.mjs | 同步既有缓存版本检查 |

没有升级 IndexedDB 或重建消息库。metadata.shopping 随原有整机备份／恢复保存，API Secrets 不进入商品记录。

## 配置与 Secrets

默认变量（已提交，可安全部署）：

```toml
PRODUCT_SOURCE = "disabled"
TAOBAO_USE_APPROVED = "false"
ENABLE_SHORT_LINKS = "false"
```

项目方取得并验证真实权限、使用范围、展示及缓存许可后，才改为 PRODUCT_SOURCE="taobao-tbk"、TAOBAO_USE_APPROVED="true"。

| Secret | 用途 | 当前状态 |
| --- | --- | --- |
| TBK_APP_KEY | 获准应用的 AppKey | 未配置 |
| TBK_APP_SECRET | TOP 请求签名 | 未配置 |

终端用户无需设置这些信息。部署者使用 Cloudflare Secrets，例如：

```powershell
node <已安装的wrangler路径> pages secret put TBK_APP_KEY --project-name xiaozhang-pwa
node <已安装的wrangler路径> pages secret put TBK_APP_SECRET --project-name xiaozhang-pwa
```

密钥通过 CLI 的私密输入设置，不写入命令字面值、配置文件、前端环境变量或聊天。独立 Worker 使用 `--config worker/wrangler.toml` 的对应 secret put。

### 短链接与限流

- 已识别 m.tb.cn、e.tb.cn 的限定分享路径，但生产短链跳转开关关闭。只有在实际样本安全验收后才启用。
- 启用后仅解析最多四次 HTTP 30x 跳转，每跳都验证确切域名与路径。需要页面脚本、登录、验证码、非白名单中转或没有商品 ID 时停止，不抓 HTML 绕过限制。
- 请求体上限 16 KiB，商品 API 响应上限 512 KiB；单次上游查询 12 秒，短链解析总计 10 秒。最多 6 个商品，服务端逐一查询；前端总等待上限 75 秒。
- 有每实例限流和可选 PRODUCT_RATE_LIMITER 绑定。实例内限制不是全局配额保障；开放有额度的真实数据源前，还应在 Cloudflare 配置边缘限流／配额保护，按接口获准配额验收。
- 对外不接受上游 URL、Cookie、Authorization 转发或任意请求头。发送给淘宝的只有必要的商品编号和应用签名参数，不转发用户链接的跟踪查询串或 IP。

## 模型兼容

| 当前接口 | 行为 |
| --- | --- |
| 已识别的官方 OpenAI 工具模型 | 先通过当前模型获得实际工具调用，再返回同一 call ID 的结构化商品结果，最后生成角色回复；不是伪造模型工具调用 |
| 已识别的官方 Gemini 工具模型 | 原生 functionCall／functionResponse 往返，保留模型实际返回的 thoughtSignature |
| 未确认工具能力的 OpenAI 兼容服务（含 Claude 兼容端点） | 默认受控上下文；不因协议名或模型名就假设支持 tools |
| 工具格式明确被拒绝 | 400／422 的工具相关拒绝允许一次受控上下文回退，本页面记忆该配置不支持；429／500 不盲重试 |
| 普通无商品聊天 | 仍走原来的请求路径，不加商品指令、不发工具探测 |
| Claude 原生 Messages / Tool Use | 原工程没有该适配，本次没有谎称已支持；Claude 通过既有兼容接口仍可使用受控上下文 |

原生工具流程会额外产生一次模型调用，并沿用既有间隔、Token 估算、跨标签页锁与配额处理。缺失人格、清空历史、自动换模型或另建购物模型均不在实现中。

模型协议参考：
- https://developers.openai.com/api/docs/guides/function-calling
- https://aistudio.google.com/docs/function-calling
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview

## 数据有效期

平台展示价格只作为获取时的数据，不保证实时或成交价。15 分钟后不再交给模型作当前比较；卡片渲染时及前台每 60 秒检查过期状态并提示刷新。前台定时和导出前清理会删除消息快照里的易变价格，稳定标题、链接和店铺等保留。重新打开旧备份时也按时间校验。不会在后台自动持续请求商品接口。

## 测试与验收

```powershell
npm test
npm run test:shopping
npm run test:chat-limits
npm run test:context
npm run test:groups
npm run test:group-scenes
npm run test:date-isolation
```

购物、群剧场与约会隔离浏览器测试默认使用 4184 的生产预览，可分别用 SHOPPING_TEST_URL、GROUP_SCENE_TEST_URL、DATE_TEST_URL 覆盖。其他既有测试使用 CONTACT_TEST_URL、CONTEXT_TEST_URL、SCENE_FLOOR_TEST_URL、INTRO_TEST_URL 指向同一预览。测试使用独立临时 Chrome、合成 IndexedDB、合成商品 API 响应和模拟模型，不触碰用户浏览器资料，也不消耗用户付费模型。

本次本地通过：构建与 smoke、商品规则／服务 5 组、购物浏览器 7 组、约会记忆隔离 5 组、群剧场 8 组、群活动规则 7 组及群功能 14 组、场景楼层 11 组、滚动卡片 6 组、上下文 21 组。聊天调度 8 组也已通过。以上通过不等于授权商品或真实付费模型验收。

| 验收项 | 当前结论 |
| --- | --- |
| 普通聊天不受影响 | 自动化验证 |
| 单商品读取真实数据 | 待获得权限并实测 |
| 两个真实商品读取与比较 | 批量流程与资料绑定已测；真实数据待验收 |
| 保持角色人格 | 原提示词／历史保留已测；真实文笔待模型验收 |
| 商品卡片、图片、价格、链接 | 合成接口验证 |
| 同会话继续追问 | 自动化验证 |
| 不支持工具仍能聊天 | 自动化验证 |
| 商品 API 失败不影响聊天 | 自动化验证 |
| 密钥不入前端、记录与错误 | 代码检查及合成密钥验证 |
| 缺失字段不补造 | 数据标准化与请求证据验证 |
| 历史商品卡片及备份 | 已实际导出整机备份，并在空浏览器导入、重开，核对完整商品附件及安全跳转 |
| 手机竖屏布局 | 五主题 320／390／1280 屏宽浏览器验证；未作 Android 真机验收 |

报告与截图在 `.local-review/` 中，不进入发布目录或 Git。

## 部署

1. `npm test`，运行上述相关回归。
2. `wrangler pages dev dist --port 4185` 用默认关闭的数据源核对 /api/products：普通商品返回 SOURCE_NOT_CONFIGURED，非法目标返回 INVALID_LINK，Cache-Control 为 no-store。
3. `wrangler pages deploy dist --project-name xiaozhang-pwa --branch main`。根目录现在是正式 Pages 配置，Functions 仅路由 /api/products；普通静态资源不经 Function。
4. 可选独立 Worker：`wrangler deploy --config worker/wrangler.toml`。前端当前使用同源 Pages 入口，不要求用户配置另一个地址；两者共享同一服务实现。
5. 未获真实权限时保持默认关闭。权限获批后配置 Secrets、确认边缘配额保护、验证实际商品和展示许可，再打开变量并重新部署。不能把默认部署或合成测试当作真实读取完成。
