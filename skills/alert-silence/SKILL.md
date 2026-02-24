---
name: alert-silence
description: "Batch-silence stale alerts in MySQL. Auto-runs hourly via cron to mark old alerts as ignored. Supports custom time windows via conversation (e.g. '静默超过2小时的告警'). Use when: user asks to clean up / silence / ignore old alerts, or to check alert silence status."
user-invocable: true
command: silence
command-description: "静默超过指定时间的告警"
metadata:
  {
    "openclaw":
      {
        "emoji": "🔕",
        "primaryEnv": "ALERT_DB_HOST",
        "requires": { "bins": ["mysql"] },
      },
  }
---

# Alert Silence Skill

批量静默超时告警：将 `alert_records` 表中超过指定时间窗口的待处理告警标记为"已忽略"。

## When to Use

✅ **USE this skill when:**

- "帮我静默一下超时告警"
- "清理一下告警"
- "把超过 2 小时的告警忽略掉"
- "/silence"
- "/silence 120" (指定分钟数)
- "告警静默状态"
- 定时任务触发的告警清理

❌ **DON'T use this skill when:**

- 查询告警详情 → 直接查数据库
- 修改告警级别或其他字段
- 告警通知/推送相关操作

## Configuration

数据库连接信息从 OpenClaw 配置文件读取，路径：`~/.openclaw/openclaw.json`

```json
{
  "plugins": {
    "entries": {
      "alert-silence": {
        "config": {
          "db": {
            "host": "127.0.0.1",
            "port": 3306,
            "user": "root",
            "password": "your_password",
            "database": "your_database"
          },
          "defaultMinutes": 1440
        }
      }
    }
  }
}
```

也可以通过环境变量配置（优先级低于配置文件）：

- `ALERT_DB_HOST` — 数据库地址 (默认 127.0.0.1)
- `ALERT_DB_PORT` — 端口 (默认 3306)
- `ALERT_DB_USER` — 用户名 (默认 root)
- `ALERT_DB_PASSWORD` — 密码
- `ALERT_DB_NAME` — 数据库名

## Usage

### 手动执行（对话触发）

直接对话：

- "帮我静默超过 24 小时的告警" → 使用 `alert_silence` 工具，minutes=1440
- "清理一下超过 2 小时的告警" → 使用 `alert_silence` 工具，minutes=120
- "静默告警" → 使用默认时间窗口 (1440 分钟)
- "/silence" → 同上
- "/silence 720" → 指定 720 分钟

### 自动执行（Cron 定时任务）

首次设置定时任务：使用 `cron` 工具添加每小时执行的任务。

```
cron add:
  label: "alert-silence-hourly"
  schedule: "every 1h"
  text: "请使用 alert_silence 工具，用默认时间窗口静默超时告警，然后报告结果。"
  agentId: "main"
```

## Tool: alert_silence

调用 `alert_silence` 工具执行静默操作。参数：

| 参数 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| minutes | number | 否 | 1440 | 时间窗口（分钟），静默 alert_time 早于 now-minutes 的告警 |
| dry_run | boolean | 否 | false | 预览模式，只统计不修改 |

工具会：

1. 连接 MySQL 数据库
2. 查询符合条件的待处理告警数量（status 不为 '已忽略' 且不为 '已完成'，且 alert_time 早于阈值）
3. 执行 UPDATE 将这些告警的 status 设为 '已忽略'，同时设置 ignore_time 为当前时间戳
4. 返回受影响的行数

## Response Format

执行后请简洁报告：

- 本次静默了多少条告警
- 使用的时间窗口
- 如果是 dry_run，注明是预览模式

示例回复：
> 🔕 已静默 42 条超过 24 小时的告警（时间窗口：1440 分钟）

如果没有需要静默的告警：
> ✅ 没有需要静默的超时告警

## Notes

- `alert_time` 字段是毫秒级 Unix 时间戳
- 只处理 status 不为 '已忽略' 且不为 '已完成' 的告警
- UPDATE 同时设置 `ignore_time = UNIX_TIMESTAMP() * 1000`
- 建议通过 cron 定时任务每小时自动执行一次
