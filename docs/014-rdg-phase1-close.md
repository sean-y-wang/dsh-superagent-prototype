# 014 一期收尾：五实例、低风险合入、决策卡（fork）

对照总规划「一期工作拆分」W4–W6 与验收项。仅在**研发环境**验证（`feature/deploy` / admin-dev / ai-dev）。禁止操作灰度/pre（`release/deploy`、admin-pre、ai-pre）。

## 五实例

| Profile / `stateDir` | 产品仓 | portal-feedback |
| --- | --- | --- |
| `aihub-site` | `ai-hub/aihub-site` | 开（`source=portal`） |
| `rdg-promotion-console` | `portal-rdg/rdg-promotion-console` | 开（`source=console`） |
| `aihub-doc` | `ai-hub/aihub-doc` | 开（`source=docs`） |
| `aihub-service` | `ai-hub/aihub-service` | 关（GitLab Issue/MR） |
| `aihub-admin` | `ai-hub/aihub-admin` | 关（GitLab Issue/MR） |

Overlay 示例：`examples/rdg-portal-profiles/*.cordis.patch.yml`。进程：`deploy/systemd/dsh-superagent@.service`。

每个实例的 Feishu Source 使用同一套 **星辰测试** bot（`scripts/lark-bot-ixunfei.example` → `LARKSUITE_CLI_CONFIG_DIR=~/.lark-cli-cloud-agent-dispatch`），决策卡**只发给** `xywang73@iflytek.com`（或该邮箱对应的 `ou_…`，以面板 Policy 白名单为准）。

## 低风险自动合入（GitLab）

语义：Worker 开 MR → 检查通过后 **merge 到产品仓 `feature/deploy`**，由 GitLab CI 部署研发环境。**不是** GitHub auto-merge。

门禁（与总规划一致）：

1. 只改文案 / 样式 / i18n / 单个前端组件量级  
2. diff ≤50 行、文件 ≤3  
3. 不碰鉴权、支付、接口契约、依赖锁、CI、迁移、k8s/helm/deploy 路径  
4. MR pipeline `success`  
5. **目标分支必须是 `feature/deploy`**（脚本拒绝 `release/deploy`）

脚本：`scripts/gitlab-low-risk-merge.sh`。离线自检：`python3 scripts/gitlab-low-risk-merge-selftest.py`。

任一条件不满足：不要 merge；Router / Eval 发 **i讯飞决策卡**，工单在面板挂起，等人确认。前期也可关掉自动路径，全部人工确认。

Delivery 补充说明见 `prompts/team/delivery-rdg-gitlab.md`（GitLab 交付时并入 Delivery requirements）。

## 人类决策：卡片 + 看板

- **卡片**：Feishu Source（i讯飞 brand）出站；DEV 接收人固定为 `xywang73@iflytek.com`。  
- **看板**：各实例 dsh 面板（Tickets / Eval Decisions）。一期不做跨实例汇总看板（二期项）。  
- **停滞**：`scripts/rdg-portal-watchdog.py` + 可选 `scripts/rdg-portal-watchdog-ixunfei.sh` 把 findings IM 给同一接收人。

## 收消息事件

双向联调需要在开放平台订阅 `im.message.receive_v1`（及卡片 `card.action.trigger`）。未订阅时 bot **只能发不能收**；单向通知与脚本冒烟仍可用。

## 验收对照

| 项 | 做法 |
| --- | --- |
| 反馈进 Router | portal-feedback Source 轮询 ai-dev Internal-Secret；测试单 `FB-3eb3553a3a86432ba3b3f80c7564398e` |
| Worker 开 MR + 评论回写 | GitLab Source + feedback-cli POST comments |
| 决策卡 + 面板 | Feishu Source + panel；仅 DEV 接收人 |
| 低风险进 feature/deploy | `gitlab-low-risk-merge.sh` |
| 五仓可路由 | 五 profile；反馈按 `source` 落到 site/console/doc |

## 相关文档

- [011 RDG portal ops](011-rdg-portal-ops.md)  
- [012 i讯飞企业机器人](012-ixunfei-bot.md)  
- [013 Intranet GitLab CI](013-intranet-gitlab-ci.md)
