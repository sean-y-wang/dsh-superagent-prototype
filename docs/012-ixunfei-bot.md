# 012 i讯飞企业机器人对接（fork）

一期门户自驱研发的人机决策卡走 **i讯飞企业 IM**，不是公网飞书租户。API 上 i讯飞是飞书开放平台的私有化部署（xfchat），**复用现有 Feishu Source**，不新增 Source kind。

英文要点见文末 *English summary*。

## API 结论

| 项 | 值 |
| --- | --- |
| 产品名 | i讯飞（企业 IM / 云文档） |
| 协议 | 与飞书 OpenAPI 兼容：`/open-apis/...` |
| 开放平台控制台 | `https://open.xfchat.iflytek.com` |
| OpenAPI 网关 brand | `xfchat.iflytek.com`（`LARKSUITE_CLI_BRAND`） |
| 文档 / 会话网页 | `https://<租户>.xfchat.iflytek.com/...` |
| AppLink | `https://applink.xfchat.iflytek.com/client/chat/open?openChatId=oc_…` |
| 事件 | 与飞书相同：`im.message.receive_v1`、卡片 `card.action.trigger`（按需） |
| 身份 ID | `cli_…` App ID、`ou_…` open_id、`oc_…` chat_id、`om_…` message_id |

公网 `open.feishu.cn` / brand `feishu` **不能**代替 i讯飞；必须用支持 `xfchat.iflytek.com` brand 的 **定制 lark-cli**（本机常见版本号带 `-dirty`，例如 `b5de968-dirty`）。**不要**对生产机执行 `npm i -g @larksuite/cli` 或 `lark-cli update`，会冲掉 brand 扩展。

Agent 终端里若已有 `LARKSUITE_CLI_BRAND=xfchat.iflytek.com` 且 `auth` 报 `external_provider`，那是**用户文档身份**，只能读云文档，**不能**当 dsh 的 bot（host 要求 strict-mode `bot`）。调度机器人要单独企业自建应用 + 独立 `LARKSUITE_CLI_CONFIG_DIR`。

## 与 Feishu Source 的映射

| Feishu Source 能力 | i讯飞 |
| --- | --- |
| `lark-cli` event consume / IM reply / 读线程 | 相同命令；包装脚本带 `LARKSUITE_CLI_BRAND` |
| `auth status` → `brand` | 期望 `xfchat.iflytek.com`（本 fork 已放宽 schema） |
| AppLink 回退链接 | `applink.xfchat.iflytek.com` |
| 面板标题 | 「飞书 / i讯飞」 |
| Policy `ou_` / 群 `oc_` | 不变 |

## 研发环境配置步骤（DEV only）

1. 打开 [open.xfchat.iflytek.com](https://open.xfchat.iflytek.com) → 创建**企业自建应用** → 开启**机器人**。
2. 权限（与上游 Feishu 文档同级，按需裁剪）：
   - 收消息：`im:message.group_at_msg:readonly`、`im:message.p2p_msg:readonly`（建议）
   - 发消息：`im:message:send_as_bot`
   - 读成员 / 历史（按策略）：`im:chat:readonly`、`im:message.history:readonly` 等
3. 事件订阅：长连接或回调；至少 `im.message.receive_v1`。决策卡交互再加 `card.action.trigger`。
4. 版本管理 → 创建并发布；可用范围含研发联调群。
5. 在**研发机**（非灰度）用定制 lark-cli 初始化 **bot-only** 配置（密钥只进 keychain / 本地 config，**不进 git**）：

```sh
export LARKSUITE_CLI_BRAND=xfchat.iflytek.com
export LARKSUITE_CLI_CONFIG_DIR="$HOME/.lark-cli-cloud-agent-dispatch"
# App Secret 从 stdin 读入，勿写进 shell history
printf '%s' "$IXUNFEI_APP_SECRET" | lark-cli config init --app-id "$IXUNFEI_APP_ID" --app-secret-stdin --brand xfchat.iflytek.com
lark-cli config strict-mode bot --global
```

6. 安装包装脚本（示例见 `scripts/lark-bot-ixunfei.example`），面板 Feishu Source 的「机器人的 lark-cli」填该命令路径。
7. `examples/rdg-portal.profile.cordis.patch.yml` 中启用 `dsh-superagent-feishu`。
8. 冒烟：私聊或研发群 @ 机器人发一条；面板应出现 Trigger；回复应回到同一线程。

## 环境变量名（值勿入库）

| 变量 | 用途 |
| --- | --- |
| `LARKSUITE_CLI_BRAND` | 固定 `xfchat.iflytek.com`（包装脚本 / 进程环境） |
| `LARKSUITE_CLI_CONFIG_DIR` | bot 专用配置目录，与个人/Agent 用户身份隔离 |
| `IXUNFEI_APP_ID` | 开放平台 App ID（`cli_…`）；仅用于 `config init` |
| `IXUNFEI_APP_SECRET` | App Secret；仅 stdin 交给 `lark-cli`，可进 GitLab **masked** CI 变量但优先本机 keychain |
| （可选别名）`FEISHU_APP_ID` / `FEISHU_APP_SECRET` | 与需求小助手等项目同名时可复用命名，仍指向 **xfchat** 应用 |

GitLab CI masked 建议名：`IXUNFEI_APP_ID`、`IXUNFEI_APP_SECRET`、`LARKSUITE_CLI_BRAND`。流水线若只做镜像构建、不跑 bot，可不配 Secret。

## 还缺什么（阻塞真联调）

- 尚未在本机找到已存在的 **cloud-agent-dispatch 专用 bot** `.env` / keychain 条目；MacBook Agent 侧是用户 `external_provider`，不能当 bot。
- 需要你在 `open.xfchat.iflytek.com` 建应用（或指定已有企业机器人 App ID），在研发机完成上面的 `config init` + strict-mode bot。
- 可选：把同一应用拉进门户反馈决策群，并把 `oc_…` 配进 Source「接收的群」。

## 相关文档

- [006 Deployment](006-deployment.md)（上游 Feishu bot / lark-cli）
- [011 RDG portal ops](011-rdg-portal-ops.md)
- 本机说明：`lark-cli-讯飞云文档本地安装与配置.md`（brand / 定制 CLI）

---

## English summary

**i讯飞** is Feishu Open Platform privatized as **xfchat** (`open.xfchat.iflytek.com`, brand `xfchat.iflytek.com`). Reuse the Feishu Source; set `LARKSUITE_CLI_BRAND` and a bot-only custom `lark-cli`. Do not use public `open.feishu.cn` for this tenant. Agent user credentials are not a bot. Create a self-built app on the xfchat console, init a dedicated config dir, enable `dsh-superagent-feishu` on DEV only.
