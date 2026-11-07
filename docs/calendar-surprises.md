# 网页版节日与生日留笺

本轮只更新 `xiaozhang-pwa`，未同步 Android、PC 或鸿蒙工程。

## 入口和阅读方式

- 在聊天页长按当前桌宠约 0.9 秒，仍使用原来「角色偷偷动过小手机」的纸笺入口。
- 当天依次提供角色生日、用户生日、节日/节气留笺，最后一页保留原有日常彩蛋；用「再翻一张」轮换。同日多个日子不会互相覆盖。
- 「翻过来看」阅读正文，「收好」关闭；手动长按的卡片不自动消失。原来离开页面后返回的自动发现保留，翻面阅读也会取消自动收起。
- 长按松手不会再附带触发一次摸头；移动超过原有阈值仍按拖动处理。
- 日历所选日期下的「日子的悄悄话」提供补看和预览，能选角色，也能预览其他节日或生日。预览明确区分于实际当天。
- 所有新纸笺均在本地读取，不调用模型、不消耗 API、不写入聊天、日记或记忆。原生日系统已经存在的生日消息仍按原有幂等规则发送，只将通用祝福改为角色各自的文案。

## 内容范围

当前 27 位联系人均覆盖，共 55 个节气、传统节日、现代节日与纪念日：24 节气、13 个农历节日、14 个固定公历日，以及复活节、母亲节、父亲节、美国感恩节 4 个浮动日期。

每个角色独立撰写 9 类节日情景笔触，按节日器物与习俗组合为 1,485 个可呈现的角色/节日组合。冬至、角色生日、用户生日另有完整专写片段；不是将同一篇正文替换角色名字，也不将 1,485 个组合宣称为逐篇手写故事。生日在线祝福也分别撰写。

节日正文是虚构日常与心意，不是原作引文或官方剧情。老九门及南部档案角色保留时代语境；现代纪念日附说明，不编造角色亲历未来历史。张小鱼沿用已有核实后的角色框架，本轮未新增未经验证的身世。

饮食与仪式注明地域差异。清明、中元以追思陪伴为主；南北小年分开；冬至不强迫选择饺子或汤圆；愚人节不拿受伤、失联和分手制造惊吓；现代节日不自动赋予人物宗教信仰或家庭关系。

## 日期与来源

- 24 节气使用香港天文台 2025—2035 公农历对照表中的逐年日期，不把某一年的月日套给所有年份。共核对 264 个日期；超出内置年份不猜节气。
- 主源：https://www.hko.gov.hk/tc/gts/time/conversion.htm
- 年表 PDF：https://www.hko.gov.hk/tc/gts/time/calendar/pdf/files/2026.pdf （将年份替换为 2025—2035）。本次已下载这些年份，核验材料在 `.local-review/calendar-eggs-20261107/research/`。
- 例如，2026 年立冬为 11 月 7 日，冬至为 12 月 22 日，两者分别触发。
- 农历节日使用浏览器 `Intl` 农历，以 `Asia/Shanghai` 转换；普通农历节日不在闰月重复，除夕按次日月初识别。
- 复活节采用西方教会公历算法；母亲节为五月第二个星期日，父亲节为六月第三个星期日；此处感恩节仅指美国十一月第四个星期四，界面明确标注。
- 生日仍只使用原有生日簿的可靠收录日期或用户自定日期。张起灵十一月生日季不等同于确切生日，未知生日不编造；可预览生日文案，也可在生日簿自定日期。二月二十九日只在实际闰年当天触发。
- 节日标签不产生「休/班」安排；放假和调休仍使用原来经过校验的官方安排数据。生日来源与原日历规则见 `docs/calendar-module.md`，新增 11 位联系人没有被杜撰为已取得确切生日。

## 模块

| 文件 | 作用 |
| --- | --- |
| `src/solar-term-data.ts` | 内置经过核对的逐年节气日期 |
| `src/calendar-observances.ts` | 55 个日期规则、器物、习俗小注 |
| `src/calendar-surprise-copy.ts` | 27 人的情景与生日文案 |
| `src/calendar-surprises.ts` | 按角色、日期、生日设置组装留笺，独立于模型调用 |
| `src/calendar-surprise-ui.ts` | 日历中的只读补看与预览 |
| `src/phone-easter-egg.ts` | 复用旧长按入口，增加当日轮换、异步校验与手动阅读保持 |
| `src/calendar.ts`、`src/calendar-ui.ts` | 加入日期标签和补看面板，生日簿人数按实际联系人数量显示 |
| `src/main.ts` | 注入当天本地留笺查询，沿用原生日提醒流程 |
| `src/calendar.css`、`src/phone-easter-egg.css` | 五主题、窄屏与可滚动阅读区域 |
| `public/sw.js` | 壳缓存 v47，离线携带新文案和日期表 |

未改变模型适配层、记忆数据结构、存档格式、群聊接话或约会隔离规则。

## 验证

测试全部使用临时浏览器 context 和合成测试记录，不读取个人浏览器，不使用真实付费 API。

- `npm run build`、`node scripts/smoke.mjs`：通过。原有大于 500 KB 的构建分包提示仍存在，不影响构建。
- `npm run test:calendar:surprises`：通过，27 角色、55 日期规则、1,485 组合、54 生日片段、264 节气；覆盖生日开关、自定日期、闰日、同日重合、历史语境。
- `npm run test:calendar`：通过，原日历、可靠生日来源、官方休班、ICS 和分享规则保留。
- `npm run test:calendar:surprises:ui`：通过，实际长按、翻面、手动保持、日常轮换、切角色、同日三类留笺、生日幂等、预览不写入、草稿保留、320 px/桌面。没有 API POST 或页面异常。
- `npm run test:phone-easter-egg`：通过，固定无节日日期，回归原纸条及重开功能。
- `npm run test:calendar:ui`：通过，记录保存/删除、旧日记归属、生日簿、ICS、分享开关、群聊隔离、完整备份和关系档案恢复、多标签写入、夜记幂等。测试时钟固定，避免删除日期与运行当天重叠。
- `npm run test:calendar:offline`：通过，真实 Service Worker 下断网重载，五主题、原有记录和新预览可用；通过 Chrome 触摸事件长按发现立冬并轮换，松手不摸头。
- `npm run test:archives`、`npm run test:context`：分别通过 15、21 项。手工转译的测试依赖清单加入新日期模块。
- `npm run test:date-isolation`：通过，私聊/群聊心动约会仍隔离，日常与连续线下衔接不变。

开发服务地址由 `CALENDAR_TEST_URL`、`PHONE_EASTER_EGG_TEST_URL`、`CONTACT_TEST_URL`、`CONTEXT_TEST_URL` 指定；生产离线测试使用 `CALENDAR_PREVIEW_URL`。本次分别使用 `http://127.0.0.1:4192` 与 `http://127.0.0.1:4193`。

验证报告与截图在 `.local-review/calendar-eggs-20261107/`；既有日历与离线回归在 `.local-review/calendar-tests/`。未做 iOS/Android 物理真机验收。

## 发布

无需新增 Secrets、第三方服务、用户设置或数据库迁移。构建后部署 `dist` 到现有 Cloudflare Pages 项目 `xiaozhang-pwa`：

```powershell
npm run build
npx wrangler pages deploy dist --project-name xiaozhang-pwa --branch main
```

打开旧页面后刷新即可接收新的 Service Worker；不应清理站点数据，以免误删本地聊天。发布后的生产入口、构建资源、缓存版本和长按操作另存于本轮 `deployment-result.json`。

2026-11-07 已发布并在正式站点 `https://xiaozhang-pwa.pages.dev` 通过独立浏览器验收。本次部署 `https://5dfa8b7e.xiaozhang-pwa.pages.dev`；生产入口为 `index-DdywcQY-.js`、`index-KW5QVyBl.css`，与本地构建一致，缓存 v47。正式站点真实触摸长按、当日立冬留笺、原日常轮换、27 角色/55 日期预览、角色文案区别及断网重载后长按均通过，无页面异常和 API POST。
