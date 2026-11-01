# 011 RDG 门户自驱研发 · 运维手册（fork）

本文说明如何在**内网服务器**上为五个产品仓各跑一个 dsh-superagent 实例，并配合 GitLab Source、portal-feedback Source、飞书决策卡与低风险自动合入。上游 dsh 仅支持 github.com；本 fork 的交付与 CI 合入走 **git.iflytek.com**，不是 GitHub。

英文要点见文末 *English summary*。

## 五实例拓扑

| 产品仓（GitLab） | 反馈 `source` | 建议 profile / `stateDir` 后缀 | 职责 |
| --- | --- | --- | --- |
| `rdg-ai-cloud/ai-hub/aihub-site` | `portal` | `aihub-site` | 门户页反馈 → 改 site |
| `rdg-ai-cloud/ai-hub/rdg-promotion-console`（以实际 path 为准） | `console` | `rdg-promotion-console` | 控制台反馈 |
| `rdg-ai-cloud/ai-hub/aihub-doc` | `docs` | `aihub-doc` | 文档中心反馈 |
| `rdg-ai-cloud/ai-hub/aihub-service` | （无独立反馈源；常由 service 联调触发） | `aihub-service` | 后端 API / 反馈服务本身 |
| `rdg-ai-cloud/ai-hub/aihub-admin` | （管理端；可只盯 Issue/MR） | `aihub-admin` | 管理后台 |

建议：**一仓一 DSH profile、一 `stateDir`、一 tmux/ systemd 单元**，避免五个仓共用一个 SQLite。`scripts/dsh-superagent` 的 `--profile` 可区分进程。

portal-feedback Source 的环境变量 `DSH_SUPERAGENT_PORTAL_FEEDBACK_PRODUCT_REPO` 提示 Worker 优先改对应仓（`aihub-site` / `rdg-promotion-console` / `aihub-doc`）。五个实例可都启用 portal-feedback，但用 Policy / 规则把非本仓的反馈 ignore，或只在「门户编排」实例上开 portal-feedback、其余只开 GitLab。

## 环境变量与密钥（勿写入仓库）

| 变量 | 用途 |
| --- | --- |
| `GITLAB_HOST` | 自建实例，如 `https://git.iflytek.com`（与 Source `baseUrl` 一致） |
| `GITLAB_TOKEN` / glab 登录态 | 仅在 **glab 包装脚本** 环境中；Source 设置只填包装命令路径 |
| `AIHUB_INTERNAL_SECRET` | portal-feedback CLI 包装注入 `X-Internal-Secret` |
| `AIHUB_ADMIN_USER` | 可选；管理评论审计身份 |
| 模型相关 | 按 DSH / cordis 模型插件配置（API key 走 DSH 密钥或机器环境，不进 Source settings） |

存储网关 HMAC（`AIHUB_FEEDBACK_ACCESS_KEY` / `SECRET_KEY`）**不是** portal-feedback Source 所需；那是截图上传用。

## Cordis 插件

在 profile 的 `cordis.patch.yml`（或叠加 patch）中启用（示例见 `examples/rdg-portal.profile.cordis.patch.yml`）：

- `dsh-superagent`（必选，配置 `stateDir`）
- `dsh-superagent-gitlab` → `dsh-superagent/gitlab-watch`（自建 GitLab）
- `dsh-superagent-portal-feedback` → `dsh-superagent/portal-feedback-watch`（按需）
- `dsh-superagent-feishu` → `dsh-superagent/feishu-watch`（决策卡 / 通知，按需）

上游自带的 `dsh-superagent-github` 在纯 GitLab 交付时可保持配置为空；GitLab-only 时 `configured()` 仍可通过（见 docs/009）。

## i讯飞 / 飞书决策卡

Eval 需要人拍板时走 **Feishu Source** 出站（决策卡 / 回复）。对讯飞内网，目标是 **i讯飞企业机器人**（xfchat，飞书兼容 OpenAPI），不是公网飞书。详见 [012 i讯飞企业机器人](012-ixunfei-bot.md)。

运维侧：

1. 使用支持 `LARKSUITE_CLI_BRAND=xfchat.iflytek.com` 的定制 `lark-cli`，bot-only 配置（strict-mode `bot`）；包装示例 `scripts/lark-bot-ixunfei.example`。上游通用步骤仍见 docs/006。
2. 开放平台在 `https://open.xfchat.iflytek.com` 建企业自建应用；密钥名 `IXUNFEI_APP_ID` / `IXUNFEI_APP_SECRET`（或同义 `FEISHU_*`），值不进仓库。
3. Policy 里允许名单与 admission 行与各仓一致。
4. 低风险自动合入**不要**指望 IM 点按钮去 push GitHub；人批或自动路径最终应落在 **GitLab MR → feature/deploy 或 release/deploy**。

## 低风险自动合入（GitLab CI，非 GitHub）

各 aihub 仓惯例（以团队现行 CI 为准）：

| 目标环境 | GitLab 分支 | 效果 |
| --- | --- | --- |
| 研发 | `feature/deploy` | 推送触发研发部署（如 namespace `platform`） |
| 灰度 / pre | `release/deploy` | 推送触发 `deploy_pre`（如 admin-pre / ai-pre） |

**低风险自动合入**在本 fork 语义下指：Agent 在仓内开 MR，通过检查后 **merge 或 push 到上述 deploy 分支**，由 **git.iflytek.com CI** 部署；**不是**向 github.com 开 PR / merge。

建议门禁：单测 / `test:feedback`（有则跑）、变更行数阈值、仅 docs 或文案类可更宽。生产分支与 Secret 仍由人管。

## 单实例启动清单（摘要）

1. 安装 Node 22+、DSH、本包 build；内网可访问 `GITLAB_HOST` 与 feedback `baseUrl`。
2. 准备 glab 包装与 feedback-cli 包装（密钥仅在包装环境）。
3. 复制 `examples/rdg-portal.profile.cordis.patch.yml`，改 `stateDir` 与 profile 名。
4. 面板启用 GitLab Source（`baseUrl` / `project` / `cli`）；按需启用 portal-feedback 与 Feishu。
5. `scripts/dsh-superagent start --profile <name>`（或等价 systemd）。
6. 配置 cron：`deploy/crontab.example` 中的 watchdog。

## Watchdog

`scripts/rdg-portal-watchdog.py`：只读扫描各 `stateDir` 下 `orchestrator.sqlite` 的 open tickets，按闲置时长标 stalled；可选调用 GitLab 列表接口的**可注入命令**（测试用 stub）；结果打印 JSON，或 POST 到 hook URL（供后续飞书适配器消费）。

```sh
python3 scripts/rdg-portal-watchdog.py \
  --state-dir /var/dsh/aihub-site \
  --stale-hours 24 \
  --json
# 或 --hook-url https://hooks.example/notify
```

离线自检：`python3 scripts/rdg-portal-watchdog.py --self-test`。

## 相关文档

- [006 Deployment](006-deployment.md)
- [009 GitLab Source](009-gitlab-source.md)
- [010 Portal-feedback Source](010-portal-feedback-source.md)
- [012 i讯飞企业机器人](012-ixunfei-bot.md)

---

## English summary

Run **five** dsh-superagent profiles (one `stateDir` each) for aihub-site, console, doc, service, and admin on an intranet host. Put GitLab PAT / `AIHUB_INTERNAL_SECRET` only in CLI wrappers. Enable `gitlab-watch` and optionally `portal-feedback-watch` / `feishu-watch`. Map feedback `source` → product repo via Worker env. **Low-risk auto-merge** means merging/pushing to GitLab `feature/deploy` (dev) or `release/deploy` (pre) so **GitLab CI** deploys — not GitHub. Use `scripts/rdg-portal-watchdog.py` on cron for stalled tickets (JSON or webhook).
