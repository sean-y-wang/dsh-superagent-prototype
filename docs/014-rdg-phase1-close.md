# 014 一期收尾：单实例多仓、低风险合入、决策卡（fork）

对照总规划「一期工作拆分」W4–W6 与验收项。仅在**研发环境**验证（`feature/deploy` / admin-dev / ai-dev）。禁止操作灰度/pre（`release/deploy`、admin-pre、ai-pre）。

## 单实例多仓（一期默认）

| 项 | 说明 |
| --- | --- |
| Profile / `stateDir` | `rdg-portal` → `/var/dsh/rdg-portal` |
| Overlay | `examples/rdg-portal-single.cordis.patch.yml` |
| systemd | `deploy/systemd/dsh-superagent-rdg-portal.service` |
| portal-feedback | 开；轮询 `portal` / `console` / `docs` |
| GitLab Source | 开；`project` 配一个观察仓；开 MR 用 `DSH_SUPERAGENT_DELIVERY_GITLAB_PROJECT` |
| Feishu / 星辰测试 | 开；决策卡只发给 `xywang73@iflytek.com` |

反馈路由：

| `source` | 短名 | GitLab path（交付） |
| --- | --- | --- |
| portal | `aihub-site` | `rdg-ai-cloud/ai-hub/aihub-site` |
| console | `rdg-promotion-console` | `rdg-ai-cloud/ai-hub/rdg-promotion-console` |
| docs | `aihub-doc` | `rdg-ai-cloud/ai-hub/aihub-doc` |

`aihub-service` / `aihub-admin` 同实例承接 GitLab Issue/MR（无独立反馈 source）。遗留五实例 overlay：`examples/rdg-portal-profiles/`。

## 低风险自动合入（GitLab）

语义：Worker 开 MR → 检查通过后 **merge 到产品仓 `feature/deploy`**，由 GitLab CI 部署研发环境。**不是** GitHub auto-merge。

门禁（与总规划一致）：

1. 只改文案 / 样式 / i18n / 单个前端组件量级  
2. diff ≤50 行、文件 ≤3  
3. 不碰鉴权、支付、接口契约、依赖锁、CI、迁移、k8s/helm/deploy 路径  
4. MR pipeline `success`  
5. **目标分支必须是 `feature/deploy`**（脚本拒绝 `release/deploy`）

脚本：`scripts/gitlab-low-risk-merge.sh --project "$PROJECT" --mr <iid>`，其中  
`PROJECT="${DSH_SUPERAGENT_DELIVERY_GITLAB_PROJECT:-$DSH_SUPERAGENT_GITLAB_PROJECT}"`。  
离线自检：`python3 scripts/gitlab-low-risk-merge-selftest.py`。

任一条件不满足：不要 merge；Router / Eval 发 **i讯飞决策卡**，工单在面板挂起，等人确认。

Delivery：`prompts/team/delivery-rdg-gitlab.md`。

## 人类决策：卡片 + 看板

- **卡片**：Feishu Source（i讯飞 brand）出站；DEV 接收人固定为 `xywang73@iflytek.com`。  
- **看板**：单实例 dsh 面板（Tickets / Eval Decisions）。一期不做跨环境汇总看板（二期项）。  
- **停滞**：`scripts/rdg-portal-watchdog.py --state-dir /var/dsh/rdg-portal` + 可选 `scripts/rdg-portal-watchdog-ixunfei.sh`。

## 收消息事件

双向联调需要在开放平台订阅 `im.message.receive_v1`（及卡片 `card.action.trigger`）。未订阅时 bot **只能发不能收**；单向通知与脚本冒烟仍可用。

## 验收对照

| 项 | 做法 |
| --- | --- |
| 反馈进 Router | portal-feedback 轮询 ai-dev Internal-Secret；测试单 `FB-3eb3553a3a86432ba3b3f80c7564398e` |
| Worker 开 MR + 评论回写 | `glab -R $DSH_SUPERAGENT_DELIVERY_GITLAB_PROJECT` + feedback-cli POST comments |
| 决策卡 + 面板 | Feishu Source + 单面板；仅 DEV 接收人 |
| 低风险进 feature/deploy | `gitlab-low-risk-merge.sh` |
| 五仓可路由 | 单实例；反馈按 `source` 落到 site/console/doc；service/admin 走 GitLab |

## 相关文档

- [011 RDG portal ops](011-rdg-portal-ops.md)  
- [012 i讯飞企业机器人](012-ixunfei-bot.md)  
- [013 Intranet GitLab CI](013-intranet-gitlab-ci.md)

## admin-dev 开放 HMAC 现状（2026-11-02）

`aihub-admin` 已将 open feedback 路由合入研发 `feature/deploy`（`d34774d`），`deploy_dev` 成功后直连返回应用层 `401 缺少网关身份`（不再是 Next 404）。说明 **应用侧已就绪**，仍差 **admin-dev Kong** 对 `/admin/api/open/feedback*` 挂 `hmac-auth` 并注入 `X-Consumer-Username=aihub-admin-api-inner`（与 admin-pre 对齐）。在此之前 `scripts/admin-open-hmac-smoke.py` 会失败；portal-feedback Source 继续走 **ai-dev Internal-Secret**，不依赖该 HMAC。
