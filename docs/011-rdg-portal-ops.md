# 011 RDG 门户自驱研发 · 运维手册（fork）

本文说明如何在**内网服务器**上跑 **一个** dsh-superagent 实例，覆盖五个产品仓，并配合 GitLab Source、portal-feedback Source、飞书决策卡与低风险自动合入。上游 dsh 仅支持 github.com；本 fork 的交付与 CI 合入走 **git.iflytek.com**，不是 GitHub。

英文要点见文末 *English summary*。

## 一期默认：单实例多仓

| 产品仓（GitLab） | 反馈 `source` | 短名 | 职责 |
| --- | --- | --- | --- |
| `rdg-ai-cloud/ai-hub/aihub-site` | `portal` | `aihub-site` | 门户页反馈 → 改 site |
| `rdg-ai-cloud/ai-hub/rdg-promotion-console`（以实际 path 为准） | `console` | `rdg-promotion-console` | 控制台反馈 |
| `rdg-ai-cloud/ai-hub/aihub-doc` | `docs` | `aihub-doc` | 文档中心反馈 |
| `rdg-ai-cloud/ai-hub/aihub-service` | （无独立反馈源；常由 GitLab Issue/MR 触发） | `aihub-service` | 后端 API / 反馈服务本身 |
| `rdg-ai-cloud/ai-hub/aihub-admin` | （管理端；可只盯 Issue/MR） | `aihub-admin` | 管理后台 |

**推荐拓扑：**

- **一个** DeepSeek Harness profile、**一个** `stateDir=/var/dsh/rdg-portal`、**一个** systemd 单元（`deploy/systemd/dsh-superagent-rdg-portal.service`）。
- Overlay：`examples/rdg-portal-single.cordis.patch.yml`（`examples/rdg-portal.profile.cordis.patch.yml` 同内容）。
- portal-feedback 在同一进程内轮询 `portal` / `console` / `docs`，写入 Worker 环境：
  - `DSH_SUPERAGENT_PORTAL_FEEDBACK_PRODUCT_REPO`（短名）
  - `DSH_SUPERAGENT_DELIVERY_GITLAB_PROJECT`（完整 GitLab path，交付优先用它）
- GitLab Source 的 `project` 仍只能配 **一个** 观察仓（Issue/MR 轮询）；开 MR 时用 `glab -R "$DSH_SUPERAGENT_DELIVERY_GITLAB_PROJECT"`（见 `prompts/team/delivery-rdg-gitlab.md`）。观察仓可设为最常开 Issue 的仓（如 `aihub-service`），或与多数反馈目标一致的仓。

**遗留（不推荐一期默认）：** `examples/rdg-portal-profiles/*` + `dsh-superagent@.service` 五实例拆分，仅在需要强进程隔离时使用。

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

在 profile 的 `cordis.patch.yml`（或叠加 patch）中启用（示例见 `examples/rdg-portal-single.cordis.patch.yml`）：

- `dsh-superagent`（必选，配置 `stateDir`）
- `dsh-superagent-gitlab` → `dsh-superagent/gitlab-watch`（自建 GitLab）
- `dsh-superagent-portal-feedback` → `dsh-superagent/portal-feedback-watch`（一期默认开）
- `dsh-superagent-feishu` → `dsh-superagent/feishu-watch`（决策卡 / 通知）

上游自带的 `dsh-superagent-github` 在纯 GitLab 交付时可保持配置为空；GitLab-only 时 `configured()` 仍可通过（见 docs/009）。

## i讯飞 / 飞书决策卡

Eval 需要人拍板时走 **Feishu Source** 出站（决策卡 / 回复）。对讯飞内网，目标是 **i讯飞企业机器人**（xfchat，飞书兼容 OpenAPI），不是公网飞书。详见 [012 i讯飞企业机器人](012-ixunfei-bot.md)。

运维侧：

1. 使用支持 `LARKSUITE_CLI_BRAND=xfchat.iflytek.com` 的定制 `lark-cli`，bot-only 配置（strict-mode `bot`）；包装示例 `scripts/lark-bot-ixunfei.example`。上游通用步骤仍见 docs/006。
2. 开放平台在 `https://open.xfchat.iflytek.com` 建企业自建应用；密钥名 `IXUNFEI_APP_ID` / `IXUNFEI_APP_SECRET`（或同义 `FEISHU_*`），值不进仓库。
3. Policy 里允许名单与 admission 行与各仓一致。
4. 低风险自动合入**不要**指望 IM 点按钮去 push GitHub；人批或自动路径最终应落在 **GitLab MR → feature/deploy**（禁止 `release/deploy`）。

## 低风险自动合入（GitLab CI，非 GitHub）

各 aihub 仓惯例（以团队现行 CI 为准）：

| 目标环境 | GitLab 分支 | 效果 |
| --- | --- | --- |
| 研发 | `feature/deploy` | 推送触发研发部署（如 namespace `platform`） |
| 灰度 / pre | `release/deploy` | 推送触发 `deploy_pre`（如 admin-pre / ai-pre）— **一期禁止自动合入** |

**低风险自动合入**在本 fork 语义下指：Agent 在**正确产品仓**内开 MR，通过检查后 **merge 到 `feature/deploy`**，由 **git.iflytek.com CI** 部署；**不是**向 github.com 开 PR / merge。项目 path 取 `$DSH_SUPERAGENT_DELIVERY_GITLAB_PROJECT`（有则优先）或 `$DSH_SUPERAGENT_GITLAB_PROJECT`。

建议门禁：单测 / `test:feedback`（有则跑）、变更行数阈值、仅 docs 或文案类可更宽。生产分支与 Secret 仍由人管。

## 单实例启动清单

1. 安装 Node 22+、DSH、本包 build；内网可访问 `GITLAB_HOST` 与 feedback `baseUrl`。
2. 准备 glab 包装与 feedback-cli 包装（密钥仅在包装环境）。
3. 复制 `examples/rdg-portal-single.cordis.patch.yml`，确认 `stateDir=/var/dsh/rdg-portal`。
4. 面板启用 GitLab Source（`baseUrl` / 一个观察用 `project` / `cli`）；启用 portal-feedback（三个 source）与 Feishu。
5. `systemctl enable --now dsh-superagent-rdg-portal`（或 `scripts/dsh-superagent start --profile rdg-portal`）。
6. 配置 cron：`deploy/crontab.example`（单个 `--state-dir /var/dsh/rdg-portal`）。

## Watchdog

`scripts/rdg-portal-watchdog.py`：只读扫描 `stateDir` 下 `orchestrator.sqlite` 的 open tickets，按闲置时长标 stalled；可选调用 GitLab 列表接口的**可注入命令**（测试用 stub）；结果打印 JSON，或 POST 到 hook URL。

```sh
python3 scripts/rdg-portal-watchdog.py \
  --state-dir /var/dsh/rdg-portal \
  --stale-hours 24 \
  --json
```

离线自检：`python3 scripts/rdg-portal-watchdog.py --self-test`。

## 相关文档

- [006 Deployment](006-deployment.md)
- [009 GitLab Source](009-gitlab-source.md)
- [010 Portal-feedback Source](010-portal-feedback-source.md)
- [012 i讯飞企业机器人](012-ixunfei-bot.md)
- [014 一期收尾](014-rdg-phase1-close.md)

---

## English summary

Phase-1 default is **one** dsh-superagent process (`stateDir=/var/dsh/rdg-portal`) covering aihub-site, console, doc, service, and admin. portal-feedback polls portal/console/docs and sets `DSH_SUPERAGENT_DELIVERY_GITLAB_PROJECT` so Workers open MRs with `glab -R` against the right GitLab path. The GitLab Source still observes a single configured project for Issue/MR intake. Put PATs / `AIHUB_INTERNAL_SECRET` only in CLI wrappers. **Low-risk auto-merge** means merging to GitLab `feature/deploy` (dev only — never `release/deploy`). Use `scripts/rdg-portal-watchdog.py` with one `--state-dir`. Five per-repo profiles under `examples/rdg-portal-profiles/` are legacy.
