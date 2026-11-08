# GitHub 多账户面板

> ## ⚠️ 免责声明（请务必阅读）
>
> **本项目仅供个人学习、研究与本地自用。严禁将本工具用于任何违规行为，包括但不限于批量刷 Star、刷赞、互关互粉、刷量、制造虚假互动、操纵排名等。**
>
> - 上述行为**违反 GitHub 服务条款（Terms of Service）**，可能被 GitHub 判定为滥用，导致相关账号被**限制、影子封禁（shadowban）甚至永久封禁**。
> - 本项目的「批量 Star / 跨账户操作」等能力**仅用于管理你自己的多个账户**，请勿用于影响他人或平台的自动化刷量。
> - 因使用或滥用本工具所产生的一切后果（账号被封、数据丢失、法律责任等），**由使用者自行承担**，作者不承担任何责任。
> - 你使用本项目即表示已阅读并同意本声明。

一个**只在本机运行**的 GitHub 多账户管理面板。支持 OAuth 设备授权与 Token 单次/批量登录；可在多个账户间切换浏览仓库、查看 Star/Fork 与增长趋势、跨账户聚合统计、管理收藏，以及向选定账户 Star / Fork 项目。

- **零依赖**：只需要 Node.js 20.11+，没有 npm 依赖，没有构建步骤。
- **只监听本机**：默认 `127.0.0.1`，不暴露到局域网，带 Host / Origin 校验与严格 CSP。
- **令牌不落明文**：账户令牌用 AES-256-GCM 本地加密保存，API 从不把 token 返回给浏览器。
- **多账户视角**：侧栏切换账户，主区展示该账户的公开 / 私有 / 收藏仓库，并提供跨账户总览。

## 目录

- [免责声明](#)（见顶部）
- [功能特性](#功能特性)
- [快速开始](#快速开始)
- [登录方式](#登录方式)
- [功能说明](#功能说明)
- [数据与安全](#数据与安全)
- [环境变量](#环境变量)
- [技术栈与项目结构](#技术栈与项目结构)
- [测试](#测试)
- [已知范围与限制](#已知范围与限制)
- [常见问题](#常见问题)
- [许可证](#许可证)

## 功能特性

**账户管理**
- OAuth 设备流授权（单次授权一个账户）与 Token 登录（单次 / 批量，单次最多 50 个）。
- 复用本机已登录的 GitHub CLI（`gh`）账户，一键导入无需粘贴 Token。
- 多账户切换；账户搜索；账户备注（区分工作号 / 个人号等）。
- 账户健康检查：一键批量校验所有账户令牌是否仍有效、权限是否够用。

**仓库与收藏**
- 浏览账户的**公开 / 私有 / 收藏**仓库，三个标签页分类，支持按名称 / 描述 / 语言搜索。
- 仓库排序：最近更新 / Star 最多 / 名称。
- 取消 Star（Unstar）与批量取消 Star。
- 给**指定账户** Star 或 Fork 某个仓库（多账户互惠操作）。
- 仓库详情增强：描述、Star/Fork/Issue 数、许可证、最新 Release、最近 Issue、README 预览。

**统计与洞察**
- 多账户总览：所有账户的仓库数、Star 总数、Fork 总数汇总。
- 跨账户重复收藏检测（同一仓库被多个账户收藏时列出）。
- 收藏跨账户汇总视图：所有账户收藏去重后的清单及"被哪些账户收藏"。
- 自有项目 **Star 增长曲线**（本地采样，可观察趋势）与最近推送时间。
- 账户详情画像：仓库数、Star/Fork 总数、关注数、Star 最多的仓库。
- 每日自动快照（后台定时记录自有仓库 Star 历史，让增长曲线更连续）。

**其它**
- 一键 Star 到全部 / 前 N 个 / 指定账户，逐账户显示成功 / 失败原因。
- 导出账户清单 / 收藏清单为 CSV。
- 内置「发现 · 趋势」快捷链接（GitHub Trending、Explore、Topics、Collections 等），并可添加自定义网址。
- **设置页功能开关**：以上功能可逐个启用 / 停用，关闭只隐藏入口、不删数据。

## 快速开始

Windows 下直接双击 [`start.bat`](start.bat)：脚本会检查 Node.js、启动服务并自动打开浏览器（端口被占用或系统保留时会自动寻找可用端口）。

手动运行：

```powershell
npm start
```

打开终端打印的地址（默认 <http://127.0.0.1:7790>）。服务只监听 `127.0.0.1`。

- 指定端口：`start.bat 7791`
- 不自动打开浏览器：`set NO_BROWSER=1` 后再运行 `start.bat`

## 登录方式

### 方式一：OAuth 设备流授权

首次使用需配置一个 OAuth App；只用 Token 登录可跳过。

1. 任意 GitHub 账户打开 **Settings → Developer settings → OAuth Apps → New OAuth App**。
2. 填写：
   - **Application name**：任意，例如 `GitHub Account Panel`
   - **Homepage URL**：`http://127.0.0.1:7790`
   - **Authorization callback URL**：同上（设备流不使用回调）
3. 勾选 **Enable Device Flow**。
4. 复制 **Client ID**（不是 Client Secret，本面板不需要 Secret）。
5. 回到面板「添加账户」→「OAuth 授权」，填入 Client ID 保存。

授权时面板显示一次性代码并打开 `github.com/login/device`，在浏览器中登录目标账户、输入代码批准即可。注意授权页跟随浏览器当前登录账户，添加第二个账户前先切换。

### 方式二：Token 单次 / 批量登录

「添加账户」→「Token 登录」标签。未配置 OAuth App 也可直接使用。

1. GitHub → Settings → Developer settings → Personal access tokens → **Tokens (classic)** → **Generate new token (classic)**。
2. 勾选权限：`read:user`（读取账户信息）、`public_repo`（Star 公开项目）。
3. 复制 `ghp_...`（只显示一次）。
4. 粘贴到面板：单行为单次登录；多行每行一个为批量（单次最多 50 个，自动去重，支持 `Bearer ` 前缀）。

> Fine-grained PAT 需能读取用户信息并有目标仓库的 Star 权限；权限名因策略而异，不确定时用 Classic PAT。

### 方式三：复用本机 GitHub CLI（gh）

若本机已安装并登录过 [GitHub CLI](https://cli.github.com/)（`gh auth login`），无需再粘贴 Token：

1. 「添加账户」→「GitHub CLI」标签，面板自动检测本机 `gh` 已登录的 `github.com` 账户。
2. 点「从 gh 导入账户」，即用 `gh` 的凭据登录对应账户（token 只在本机加密保存，不回显、不发往浏览器）。

> 面板通过本机子进程调用 `gh auth status --json hosts --show-token` 读取凭据，仅支持 `github.com`（不含 GHES 私有域名）。未安装时先 `winget install GitHub.cli` 再 `gh auth login`。

## 功能说明

**Star 项目**：侧边栏输入 `owner/repo`、项目链接或点仓库卡片的「Star」；选择全部 / 前 N 个 / 指定账户，逐账户显示结果。Star 是幂等操作，重复点击不会重复记录。

**收藏与取消**：在「收藏」标签查看账户已 Star 的项目，可逐个或批量「取消 Star」。

**总览与趋势**：「多账户总览」汇总所有账户数据；「收藏汇总」列出跨账户收藏去重清单；「健康检查」批量校验令牌。自有项目的 Star 增长曲线来自本地采样——GitHub 只给当前值，曲线需多次打开 / 每日快照后才成型。

**发现链接**：「发现 · 趋势」提供 GitHub Trending（今日 / 本周 / 中文圈）、Explore、Topics、Collections 等外链，可在设置里增删自定义网址。

**功能开关**：「OAuth 设置」页底部可逐个启用 / 停用上述功能，关闭仅隐藏入口。

## 数据与安全

| 项目 | 位置 / 行为 |
| --- | --- |
| 加密后的账户与令牌 | `data/state.enc`（AES-256-GCM） |
| 本地密钥 | `data/.key`（首次启动生成，随机 32 字节） |
| 面板会话 Cookie | `ghpanel_session`，HMAC 签名、HttpOnly、SameSite=Lax、30 天滑动续期 |
| 令牌是否发到浏览器 | 否，API 从不返回 token |
| 绑定地址 | 默认 `127.0.0.1:7790`，校验 Host 与写请求 Origin |
| 安全响应头 | 严格 CSP（`script-src 'self'`、`frame-ancestors 'none'`）、`nosniff` 等 |

注意：

- 本地密钥与加密数据存在同一台机器，能防误传和明文泄露，但**不能防已控制该机器的恶意程序**。
- 移除账户只删本地令牌，**不会自动撤销** GitHub 上的授权；需要撤销请到 **GitHub → Settings → Applications** 或 Personal access tokens。
- **不要将 `data/` 提交到版本库**（已在 `.gitignore` 中忽略）。
- 面板没有远程访问 / 反向代理设计；**不要用公网隧道暴露它**。

## 环境变量

| 变量 | 说明 | 默认 |
| --- | --- | --- |
| `PORT` | 监听端口 | `7790` |
| `HOST` | 监听地址 | `127.0.0.1` |
| `GITHUB_CLIENT_ID` | OAuth App Client ID（也可在面板保存） | 空 |
| `GITHUB_PANEL_DATA` | 数据目录 | `./data` |
| `NO_BROWSER` | 设为任意值则不自动开浏览器 | 未设 |
| `GITHUB_PANEL_SECRET` | 见下方警告 | 未设 |

> **⚠️ 关于 `GITHUB_PANEL_SECRET`（强烈不建议设置）**：一旦设置，程序会用该变量派生加密密钥、**忽略 `data/.key`**。若你先前在「无此变量」时登录过（数据用 `.key` 加密），之后再设置或更换该变量，旧的 `data/state.enc` 就会**无法解密、账户丢失**。除非你有意使用固定密钥，否则**不要设置它**，让程序使用自动生成的 `data/.key` 即可稳定保存登录。

## 技术栈与项目结构

- **运行时**：Node.js ≥ 20.11，原生 `node:http`，零第三方依赖。
- **前端**：原生 HTML / CSS / ES Module，无框架、无构建。
- **加密**：AES-256-GCM 加密状态，HMAC 签名会话 Cookie，scrypt 派生密钥（可选 secret）。

```text
.
├── server.mjs          # HTTP 服务与全部 /api 路由（登录、gh 导入、仓库、Star、统计、导出等）
├── lib.mjs             # 加密存储、会话签名、Star 历史采样等工具
├── start.bat           # Windows 启动脚本（自动找端口、开浏览器）
├── package.json
├── public/
│   ├── index.html      # 单页面结构
│   ├── app.js          # 前端逻辑与渲染
│   ├── styles.css      # 样式
│   └── favicon.svg
├── test/               # node:test 测试（core / server / github-mock）
└── data/               # 运行时生成，已 gitignore（含密钥与加密状态）
```

## 测试

```powershell
npm test
```

覆盖：仓库地址解析、gh 输出解析、会话签名 / 过期 / 篡改、加密状态篡改与损坏容错、服务器启动、Cookie、CSP、Client ID 校验、跨站请求拦截；并通过 mock GitHub 完整验证设备授权、Token 单次 / 批量登录、公开与私有仓库加载、单 / 多账户 Star、取消 Star、账户健康检查、账户详情、收藏汇总、仓库详情增强、Fork、CSV 导出、功能开关等。

## 已知范围与限制

- 只浏览**公开与私有仓库**；私有仓库需 Token 具备 `repo` 权限。
- 界面已适配手机 / 安卓浏览器（响应式布局、安全区留白、触控友好、输入框不自动放大）。因面板只监听 `127.0.0.1` 且校验 Host，手机需通过本机浏览器/安卓模拟器访问（`127.0.0.1`），不经局域网 IP（会被拒绝）。
- 每个账户最多加载最近更新 / 推送的 100 个仓库。
- Token 登录单次最多 50 个；重复 Token 自动去重。
- Star 增长曲线依赖本地采样，首次使用时只有当前值，需多次打开或开启每日快照后才有趋势。
- 跨账户总览 / 收藏汇总会为每个账户请求 GitHub，账户较多时首次加载略慢（有 60 秒短缓存）。
- OAuth 设备流不提供 refresh token，授权失效时需移除后重新添加。
- gh 导入依赖本机 `gh` 已登录且为 `github.com`；GHES 私有域名账户请用 Token 登录。

## 常见问题

| 现象 | 处理 |
| --- | --- |
| 浏览器提示「无法访问此网站」 | 服务未起来或端口不一致；看黑窗口打印的 URL，确认服务在运行。 |
| 双击 start.bat 窗口一闪而退 | 之前可能出现 `state` 解密失败（见下条）；现版本会容错并备份后以空状态启动，不再闪退。 |
| 重启后账户丢失 / 报 `Unsupported state` | 多为设置过 `GITHUB_PANEL_SECRET` 导致密钥不一致；请不要设置该变量，并重新登录。 |
| Star 失败但登录成功 | Token 缺少 `public_repo` 或 Fine-grained 的 Star 权限。 |
| Token 无效或已过期 | Token 错误、被撤销或过期，重新生成。 |

## 许可证

[MIT](LICENSE)

---

**再次提醒**：本项目仅供个人学习与本地自用，**禁止用于刷 Star、刷量、互关等任何违反 GitHub 服务条款的行为**，后果自负。
