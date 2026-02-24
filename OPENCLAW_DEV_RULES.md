# OpenClaw 开发指南与规则

## 一、项目架构总览

OpenClaw 是一个多渠道 AI 网关，使用 pnpm workspace monorepo 结构，核心语言为 TypeScript (ESM)。

### 模块结构

```
openclaw/
├── src/                          # 核心源码
│   ├── cli/                      # CLI 入口和命令注册
│   │   ├── deps.ts               # 依赖注入工厂 createDefaultDeps()
│   │   └── run-main.ts           # CLI 主入口
│   ├── gateway/                  # Gateway HTTP/WebSocket 服务器
│   │   ├── server.impl.ts        # 服务器实现
│   │   ├── openai-http.ts        # /v1/chat/completions (OpenAI 兼容)
│   │   ├── openresponses-http.ts # /v1/responses (OpenResponses API)
│   │   ├── tools-invoke-http.ts  # /tools/invoke (直接调用工具)
│   │   └── server/ws-connection.ts # WebSocket 协议
│   ├── agents/                   # Agent 运行时
│   │   ├── pi-tools.ts           # 工具创建工厂
│   │   ├── pi-embedded-runner/   # Agent 运行循环
│   │   │   └── run/attempt.ts    # 单次 LLM 交互
│   │   ├── pi-tool-definition-adapter.ts # 工具定义适配器
│   │   ├── tool-policy-pipeline.ts # 工具策略过滤管道
│   │   ├── system-prompt.ts      # System Prompt 构建
│   │   ├── skills.ts             # Skills 系统入口
│   │   ├── skills/               # Skills 加载、过滤、格式化
│   │   └── tools/                # 内置工具实现
│   │       ├── common.ts         # jsonResult() 等公共函数
│   │       ├── cron-tool.ts      # 定时任务工具
│   │       ├── sessions-spawn-tool.ts  # 子 Agent 工具
│   │       ├── sessions-send-tool.ts   # Agent 间通信
│   │       └── web-fetch.ts      # HTTP 抓取工具
│   ├── auto-reply/               # 消息自动回复调度
│   │   ├── reply/dispatch-from-config.ts # 入站消息调度入口
│   │   ├── reply/get-reply.ts    # 回复编排
│   │   ├── tokens.ts             # SILENT_REPLY_TOKEN (NO_REPLY)
│   │   └── reply/groups.ts       # 群聊行为控制
│   ├── channels/                 # 渠道抽象层
│   │   └── plugins/types.ts      # 渠道插件接口定义
│   ├── routing/                  # 消息路由
│   │   ├── resolve-route.ts      # Agent 路由解析
│   │   └── session-key.ts        # Session Key 管理
│   ├── infra/outbound/           # 统一出站消息投递
│   ├── plugins/                  # 插件系统
│   │   ├── discovery.ts          # 插件发现
│   │   ├── loader.ts             # 插件加载
│   │   ├── registry.ts           # 插件注册表
│   │   ├── hooks.ts              # Hook 运行器
│   │   └── types.ts              # 插件 API 类型定义
│   ├── cron/                     # 定时任务服务
│   ├── media/                    # 媒体处理
│   ├── plugin-sdk/               # 插件 SDK 导出
│   ├── telegram/                 # Telegram 渠道 (内置)
│   ├── discord/                  # Discord 渠道 (内置)
│   ├── slack/                    # Slack 渠道 (内置)
│   ├── signal/                   # Signal 渠道 (内置)
│   ├── imessage/                 # iMessage 渠道 (内置)
│   └── web/                      # WhatsApp Web 渠道 (内置)
├── extensions/                   # 插件/扩展
│   ├── feishu/                   # 飞书渠道插件
│   ├── msteams/                  # Microsoft Teams
│   ├── matrix/                   # Matrix
│   ├── voice-call/               # 语音通话
│   ├── memory-core/              # 记忆搜索
│   └── ...                       # 共 31 个扩展
├── skills/                       # 内置 Skills (Markdown)
├── apps/                         # 原生应用
│   ├── macos/                    # macOS (Swift)
│   ├── ios/                      # iOS (Swift)
│   └── android/                  # Android (Kotlin)
├── ui/                           # Web UI
└── docs/                         # 文档 (Mintlify)
```

## 二、模块职责与通信方式

### 消息处理完整链路

```
用户消息 → 渠道插件 (feishu/telegram/...) 接收事件
  → auto-reply/dispatch-from-config.ts 调度
    → Hooks: message_received (fire-and-forget)
    → auto-reply/get-reply.ts 编排回复
      → agents/pi-embedded-runner/run.ts 运行 Agent
        → 构建 System Prompt (含 Skills)
        → 注册 Tools (经 Policy Pipeline 过滤)
        → 调用 LLM API (流式)
        → LLM 返回 tool_call → Hook 拦截 → Tool 执行 → 结果回传 LLM
        → LLM 最终回复
      → infra/outbound/deliver.ts 投递回复
    → 渠道插件发送消息
```

### 核心通信机制

| 组件间 | 通信方式 |
|--------|----------|
| CLI ↔ Gateway | WebSocket / HTTP |
| Gateway ↔ 渠道 | 渠道各自协议 (WebSocket/HTTP Webhook) |
| Gateway ↔ LLM | HTTP API (Anthropic/OpenAI/etc.) |
| Agent ↔ Tools | 同进程函数调用 (tool.execute()) |
| 插件 ↔ 核心 | registerTool/registerHook 注册回调 |
| Agent ↔ Agent | sessions_send/sessions_spawn 工具 |
| 外部 ↔ Gateway | /v1/responses, /v1/chat/completions, /tools/invoke |

## 三、Skills 与 Tools 交互原理

### Skills (知识层)

Skills 是 **Markdown 文件** (`SKILL.md`)，不是可执行代码。它们被注入到 LLM 的 System Prompt 中，指导 LLM 在特定场景下如何行动。

**发现流程** (优先级从低到高)：
1. 插件附带的 skills 目录
2. OpenClaw 内置 bundled skills
3. `~/.openclaw/skills/` (managed)
4. `~/.agents/skills/` (个人级)
5. `<workspace>/.agents/skills/` (项目级)
6. `<workspace>/skills/` (workspace 级，最高优先级)

**LLM 如何使用 Skills**：
1. System Prompt 包含所有 Skills 的名称、描述、文件路径列表
2. LLM 根据用户请求匹配最相关的 Skill
3. LLM 用 `read` 工具读取对应的 `SKILL.md` 文件内容
4. LLM 按 SKILL.md 中的指令行动 (调用工具、执行命令等)

### Tools (执行层)

Tools 是可执行的代码函数，LLM 通过 function calling 机制调用。

**工具注册来源**：
- 内置工具: `src/agents/tools/` (exec, read, write, web_fetch, cron, sessions_spawn 等)
- 插件工具: 通过 `api.registerTool()` 注册
- Client Tools: 通过 OpenResponses API 由外部客户端提供

**工具执行管道**：
```
LLM 请求 tool_call
  → before_tool_call Hook (可拦截/修改参数)
  → Tool Policy Pipeline 检查 (7 层策略过滤)
  → tool.execute(toolCallId, params)
  → after_tool_call Hook
  → 结果返回 LLM
```

**工具策略管道** (按顺序应用)：
1. Profile 策略 (minimal/coding/messaging/full)
2. Provider Profile 策略
3. 全局策略 (tools.allow/deny)
4. 全局 Provider 策略
5. Agent 策略 (agents.<id>.tools.allow/deny)
6. Group 策略 (渠道/群组级别)
7. Subagent 策略

## 四、Skills 开发注意事项

### SKILL.md 格式规范

```markdown
---
name: my-skill                    # 必填: 唯一标识符
description: "简短描述"            # 必填: LLM 匹配用
user-invocable: true              # 可选: 是否支持 /命令 触发
command: mycommand                # 可选: 斜杠命令名
command-description: "命令描述"    # 可选: 命令帮助文本
metadata:
  { "openclaw": { "emoji": "🔧" } }
---

# Skill 标题

## When to Use
描述何时使用此 Skill

## When NOT to Use
描述何时不应使用

## Commands / Usage
具体使用方法和工具调用指南

## Response Format
期望的回复格式
```

### Skills 开发要点

1. **Skills 不执行代码** — 只是给 LLM 的文本指令，实际动作靠 Tools 完成
2. **一个 Skill 通常搭配一个 Tool** — Skill 描述何时/如何使用，Tool 提供执行能力
3. **避免 `primaryEnv`** — 除非你的 Skill 真的需要一个环境变量/API Key，否则管理界面会强制要求用户填写
4. **`requires.bins`** — 如果 Skill 依赖命令行工具 (如 `curl`, `mysql`)，在 metadata 中声明
5. **文件大小限制** — 默认最大 256KB，超过会被跳过
6. **Skills 数量限制** — 默认最多 150 个 Skill、30,000 字符的 prompt 总长度

## 五、Tools (插件) 开发注意事项

### 插件目录结构

```
~/.openclaw/extensions/my-plugin/
├── openclaw.plugin.json          # 必须: 插件清单
├── package.json                  # 必须: 包描述 + openclaw.extensions 入口
├── index.ts                      # 必须: 插件入口
├── node_modules/                 # npm install 安装的依赖
└── src/
    └── *.ts                      # 插件源码
```

### openclaw.plugin.json (必须)

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "description": "插件描述",
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "myKey": { "type": "string" }
    }
  }
}
```

### package.json

```json
{
  "name": "@openclaw/my-plugin",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "dependencies": {
    "some-dep": "^1.0.0"
  },
  "peerDependencies": {
    "openclaw": ">=2026.2.0"
  },
  "openclaw": {
    "extensions": ["./index.ts"]
  }
}
```

**禁止事项**：
- 不要在 `dependencies` 中写 `"openclaw": "workspace:*"` — 独立安装时会报错
- 不要在 `devDependencies` 中写 `workspace:*` — 同上

### index.ts (入口文件)

```typescript
// 禁止: import ... from "openclaw/plugin-sdk"
// 独立安装的插件无法解析 openclaw/plugin-sdk 的 jiti alias

import { createMyTool } from "./src/tool.js";

export default function register(api: Record<string, any>) {
  const pluginCfg = (api.pluginConfig ?? {}) as Record<string, unknown>;
  api.registerTool(createMyTool(pluginCfg));
}
```

**关键规则**：
- `index.ts` 中**绝对不要** `import ... from "openclaw/plugin-sdk"` — 独立插件无法解析此路径
- `import type` 也不安全 — jiti 可能仍然尝试解析模块路径
- `api` 参数用 `Record<string, any>` 类型，运行时是完整的 `OpenClawPluginApi` 对象

### Tool 定义格式

```typescript
function createMyTool(pluginCfg: Record<string, unknown> | undefined) {
  return {
    name: "my_tool",                    // 必须: 工具名 (snake_case)
    label: "My Tool",                   // 可选: 显示名称
    description: "工具功能描述",          // 必须: LLM 用于决策
    parameters: {                       // 必须: JSON Schema 格式
      type: "object" as const,
      properties: {
        param1: {
          type: "string" as const,
          description: "参数描述",
        },
        param2: {
          type: "number" as const,
          description: "参数描述",
          minimum: 1,
        },
      },
    },
    execute: async (_toolCallId: string, args: unknown) => {
      const params = (args ?? {}) as Record<string, unknown>;
      // ... 业务逻辑 ...
      return jsonResult({ status: "ok", data: "..." });
    },
  };
}
```

### Tool 返回值格式 (重要!)

```typescript
// 正确格式 — content 必须是数组
function jsonResult(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    details: payload,
  };
}

// 错误格式 — 会导致 content.some is not a function
// { type: "json", content: { ... } }     ← 错误!
// { content: { ... } }                   ← 错误!
```

### parameters Schema 格式 (重要!)

```typescript
// 正确: 纯 JSON Schema 对象 (无外部依赖)
const schema = {
  type: "object" as const,
  properties: {
    name: { type: "string" as const, description: "..." },
    count: { type: "number" as const, minimum: 0 },
    enabled: { type: "boolean" as const },
  },
};

// 错误: 依赖 @sinclair/typebox (独立安装时无法解析)
// import { Type } from "@sinclair/typebox";
// const schema = Type.Object({ ... });

// 错误: 依赖 @mariozechner/pi-agent-core (同上)
// import type { AgentToolResult } from "@mariozechner/pi-agent-core";
```

### MySQL 等大数值参数注意事项

```typescript
// 错误: JS 毫秒时间戳作为 mysql2 execute() 参数可能溢出
const cutoff = Date.now() - 1440 * 60 * 1000;  // ~1.7万亿
await conn.execute("SELECT * FROM t WHERE ts < ?", [cutoff]);  // 可能出错!

// 正确: 在 SQL 内部计算, 只传小数值参数
await conn.execute(
  "SELECT * FROM t WHERE ts < (UNIX_TIMESTAMP() * 1000 - ? * 60 * 1000)",
  [1440]  // 小整数, 安全
);
```

### 插件配置位置

插件配置写在 `~/.openclaw/openclaw.json` 中：

```json
{
  "plugins": {
    "entries": {
      "my-plugin": {
        "config": {
          "key1": "value1"
        }
      }
    }
  }
}
```

代码中通过 `api.pluginConfig` 访问 (即上面的 `config` 对象)。

### 插件启用/禁用

- 如果 `plugins.allow` 为空 → 所有发现的非 bundled 插件自动加载
- 如果 `plugins.allow` 非空 → 只加载白名单中的插件
- `plugins.deny` → 黑名单，优先于 allow

### 插件安装步骤

```bash
# 1. 复制到全局插件目录
cp -r my-plugin ~/.openclaw/extensions/my-plugin

# 2. 安装运行时依赖
cd ~/.openclaw/extensions/my-plugin
npm install --omit=dev

# 3. 如果 npm 报上层目录依赖冲突
echo "install-strategy=nested" > .npmrc
rm -rf node_modules package-lock.json
npm install --omit=dev

# 4. 在 openclaw.json 中添加配置
# 5. 重启 Gateway
openclaw gateway restart

# 6. 验证
openclaw status --all
```

## 六、Plugin API 可注册的组件

| 方法 | 用途 |
|------|------|
| `api.registerTool(tool)` | 注册一个 Agent 可调用的工具 |
| `api.registerHook(events, handler)` | 注册生命周期 Hook |
| `api.on(hookName, handler)` | 类型安全的 Hook 注册 |
| `api.registerHttpHandler(handler)` | 注册自定义 HTTP 端点 |
| `api.registerHttpRoute({path, handler})` | 注册 HTTP 路由 |
| `api.registerGatewayMethod(name, handler)` | 注册 Gateway RPC 方法 |
| `api.registerChannel(plugin)` | 注册消息渠道 |
| `api.registerProvider(provider)` | 注册 LLM Provider |
| `api.registerCli(registrar)` | 注册 CLI 子命令 |
| `api.registerService(service)` | 注册后台服务 |
| `api.registerCommand(command)` | 注册直接命令 (绕过 LLM) |

## 七、可用的 Hook 列表

| Hook 名称 | 触发时机 | 是否可修改/阻断 |
|-----------|---------|---------------|
| `message_received` | 收到消息 | 否 (fire-and-forget) |
| `message_sending` | 发送前 | 是 (可修改内容或 cancel) |
| `message_sent` | 发送后 | 否 |
| `before_model_resolve` | 模型选择前 | 是 (可覆盖 provider/model) |
| `before_prompt_build` | Prompt 构建前 | 是 (可注入内容) |
| `before_agent_start` | Agent 启动前 | 是 |
| `before_tool_call` | 工具执行前 | 是 (可拦截或修改参数) |
| `after_tool_call` | 工具执行后 | 否 |
| `llm_input` | LLM 请求发送前 | 否 |
| `llm_output` | LLM 响应收到后 | 否 |
| `agent_end` | Agent 执行结束 | 否 |
| `session_start` | 会话开始 | 否 |
| `session_end` | 会话结束 | 否 |
| `gateway_start` | Gateway 启动 | 否 |
| `gateway_stop` | Gateway 停止 | 否 |

## 八、定时任务 (Cron)

通过 `cron` 工具或 CLI 添加：

```bash
# CLI 方式
openclaw cron add \
  --label "my-job" \
  --schedule "every 1h" \
  --text "执行 my_tool 工具并报告结果"

# 对话方式
# 对 OpenClaw 说: "帮我设置一个每小时执行的定时任务, 调用 my_tool 工具"
```

Cron 支持的 schedule 格式：
- `every 30m` / `every 1h` / `every 6h`
- `daily 09:00` / `daily 18:30`
- `weekday 09:00` / `weekend 10:00`
- 标准 cron 表达式: `0 * * * *`

## 九、Session 与上下文隔离

Session Key 格式: `agent:<agentId>:<mainKey>`

- 不同 Session Key → 完全隔离的对话历史
- OpenResponses API 的 `user` 字段 → 自动创建 per-user session
- `X-Session-Key` header → 自定义 session 标识
- Session 文件存储: `~/.openclaw/agents/<agentId>/sessions/<sessionId>.jsonl`

## 十、常见问题速查

| 问题 | 原因 | 解决 |
|------|------|------|
| 插件未加载 | 缺少 openclaw.plugin.json | 添加清单文件 |
| `extensions is not defined` | index.ts import 了 openclaw/plugin-sdk | 去掉 import, api 用 Record<string, any> |
| `content.some is not a function` | Tool 返回值格式错误 | content 必须是 [{type:"text",text:"..."}] 数组 |
| npm install 报 workspace:* | devDependencies 含 workspace 协议 | 删除 devDependencies 中的 openclaw |
| npm install 拉取无关依赖 | 上层目录 package-lock 干扰 | 添加 .npmrc: install-strategy=nested |
| mysql2 大数值参数返回 0 | JS BigInt 参数绑定问题 | 在 SQL 内部计算时间戳 |
| 插件 not in allowlist | plugins.allow 白名单限制 | 在 allow 数组中加入插件 ID |
| 群聊 @机器人无反应 | groupPolicy 未设为 open | 配置 groupPolicy: "open" |
| 飞书事件不推送 | 未订阅 im.message.receive_v1 | 飞书开放平台添加事件订阅并发布新版本 |
