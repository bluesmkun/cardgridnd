# cardgridnd — 开发约束清单（摘自 https://monitor-document.pages.dev/dev/theme）

写 `App.tsx` / `NodeDetail.tsx` 前逐条对照。**加粗**的是尚未落地、容易写错的。

## 主题包
- 目录名 = `theme.json` 的 `short`（`cardgridnd`）；`theme.tar.gz` 解开就是这个目录
- `theme.json` 六个字段都要写；`config` 可不写但本主题有
- 上限：整包 32 MiB / 解压 64 MiB / 单文件 8 MiB / 2000 条目 / tar 填充 1 MiB；只接受普通文件和目录
- 发布前 `gzip -t theme.tar.gz`；一键更新要求 release tag `v1.0.0` 对 `version` `1.0.0`

## 接口
- 只有五个：`/api/me`、`/api/nodes`、`/api/nodes/{id}/metrics`、`/api/ws`、`/api/themes/{short}/config`（+ `PUT`）
- `hours` 默认 6，上限 `history_days × 24`，超出**静默收窄**；`points` 60–1440；`series=metrics|ping`
- 响应顶层 `step` = 每点秒数；7 天内是 60 的倍数，更宽是 3600 的倍数
- `minutes` 满额 = `step ÷ 60`；不满额说明该段部分离线可画在线率；**最后一个点未过完，不满额不代表离线**
- 网速 × `minutes` × 60 = 该段流量；累计流量以 `/api/nodes` 为准
- `cpu_max` / `net_rx_max` / `net_tx_max` 是峰值，短时测速与满载要读它
- 延迟探针名在响应 `probes` 里随数据返回，**画延迟图不需要第二个请求、也不需要登录**
- 按 `task_id` 首次出现顺序生成曲线，图例与面板一致

## 推送
- `/api/ws?gzip`：浏览器无 `DecompressionStream` 时不要加参数；登录后推的管理帧是文本
- 解压异步，**一帧接一帧地处理**；只有解开的帧才重置断流计时
- 匿名 `/api/ws` 上限 1000 条，超出握手 503，浏览器读不到内容
- **收到 503 要退回轮询 `/api/nodes`（5 秒一次），隔一段时间再试 WebSocket**（已修：cap 时 60 秒退避）

## 时间
- **`expires_in`**：按 hub 日期算的剩余天数，0 = 今天到期，负数 = 已过期，无到期日 = `null`。不要用 `expires_at` 按浏览器时钟算
- **`last_seen_ago`**：按 hub 时钟算的秒数，从未上报 = `null`。离线时显示它，不要用 `last_seen` 减浏览器时钟；**只在 `online === false` 时显示**（在线节点也带此值）

## 货币 / 周期
- `currency` 交给 `Intl.NumberFormat`，地区写死 `zh-CN`，`maximumFractionDigits: 2`，try/catch 回落
- `billing_cycle`：`monthly|quarterly|semiannual|yearly|biennial|triennial` = 1/3/6/12/24/36 月；`<n>m` 自定义 1–1200；`once` = 0（不续期）。有名字的长度不会以 `12m` 出现

## 分组（**App.tsx 必须遵守**）
- `group` 字段公开可读，空字符串 = 未分组；旧 hub 无此字段 → 按 `?? ""` 处理
- **按节点顺序排，不按名字排**（每组首次出现的位置即它的位置）
- **一个分组都没有时，页面要和没有分组功能时一样**；只有部分节点有分组时，其余节点要有「未分组」的去处，不能藏起来
- 分组名是任意文本，最多 13 字，可能叫 `*`、`all`、`none`、「全部」、「未分组」
- **「全部」/「未分组」这类标签的取值不要和分组名混在同一个字符串空间里 → 用 `null` 表示全部**
- 分组可能有几十个，横排标签要能滚动或换行
- **切换分组时，汇总数字（在线数、流量、网速）跟着这一组算，不要一半跟着分组、一半是全站** → `<Summary nodes={filtered} />`

## 公开备注
- `public_remark` 最多 100 字、不含换行、空串表示没有，按纯文本渲染
- 私有备注是 `remark`，访客拿不到

## 主题设置
- 站点级设置只能放 `theme.json` 的 `config`；**不要放 `localStorage`**（只在站长自己浏览器里生效）
- **不要改 `dist/` 里的文件**（更新/重装是整个目录替换）
- 访客自己的偏好（深浅色、排序）属访客，仍放 `localStorage`
- 读取：`GET` 只返回改过的项；失败一律按默认值渲染，**不要报错也不要提示**
- 面板逐项校验，**不合格的那一项不显示，其余照常**
- 页面启动时和 `/api/me`、`/api/nodes` **并行**请求，不要排在后面
- `saveConfig`：先 `GET` 原始那份（不是 `loadConfig()` 合并过的），只改声明过的项，**等于默认值的删掉**，然后 `PUT`
- 自带设置界面仅当 `/api/me` 的 `authed === true`
- 优先级（低→高）：`theme.json` 默认值 → hub 站点设置 → 访客 `localStorage`

## 安全
- 设置值**永不进 `innerHTML`**；markdown 返回 React 节点，链接只允许 `http:`/`https:`/`mailto:`
