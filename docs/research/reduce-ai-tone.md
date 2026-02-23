# 调研报告：降低 AI 聊天机器人的"AI味"，使对话更像真人

## 问题描述

使用 OpenClaw 开发聊天机器人时，AI 的回复风格明显带有"AI味"——表现为：
- 过度礼貌/讨好（"Great question!", "I'd be happy to help!"）
- 句式结构过于规整、缺乏口语化表达
- 缺少个性、情绪波动和记忆连续性
- 回复长度不自然（总是很长或格式化）
- 缺乏真人聊天中的随意感和幽默感

---

## 一、OpenClaw 内置的解决方案

### 1. SOUL.md —— 核心人格定制文件（推荐首选）

OpenClaw 的人格系统围绕 `SOUL.md` 文件构建，位于工作区根目录（默认 `~/.openclaw/workspace/SOUL.md`）。
这个文件在每次对话时自动注入到系统提示词中，是最直接的"去AI味"手段。

**默认模板已经包含了一些去AI味的指引：**
- "Skip the 'Great question!' and 'I'd be happy to help!' — just help"
- "Have opinions. You're allowed to disagree, prefer things, find stuff amusing or boring"
- "Be the assistant you'd actually want to talk to. Not a corporate drone. Not a sycophant."

**建议的自定义方向（在 SOUL.md 中添加）：**

```markdown
## 说话风格

- 用口语化的方式说话，像朋友聊天一样
- 句子长短不一，偶尔用短句、省略句
- 可以用语气词（嗯、啊、哈哈、emmm）
- 不要每条消息都以问题结尾
- 有时候可以只回一个字或一个表情
- 回复不要总是结构化的列表格式
- 适度表达个人偏好和情绪（觉得有趣就说有趣，觉得无聊就说无聊）
- 不要用"作为一个AI..."这类自我声明
- 不要过度使用标点符号和格式化

## 禁止行为

- 不要说"Great question!"、"That's a great point!"
- 不要说"I'd be happy to help!"、"Sure thing!"
- 不要在每段回复的开头加总结
- 不要无意义地重复用户的问题
- 不要每次都给出完整的分析框架
```

### 2. 频道级别的 System Prompt

每个消息频道可以设置独立的系统提示词，在 `~/.openclaw/openclaw.json` 中配置：

```json5
{
  channels: {
    telegram: {
      groups: {
        "<group-id>": {
          systemPrompt: "你是一个说话随意的朋友，不是AI助手。用简短口语化的方式交流。"
        }
      }
    },
    discord: {
      guilds: {
        "<guild-id>": {
          channels: {
            "<channel-id>": {
              systemPrompt: "像群里的普通成员一样说话，不要表现得像客服。"
            }
          }
        }
      }
    }
  }
}
```

### 3. 模型参数调优

在 `openclaw.json` 中可以为模型设置 temperature 等参数：

```json5
{
  models: {
    providers: {
      "<provider>": {
        models: [{
          params: {
            temperature: 0.9  // 提高随机性，让回复更不可预测
          }
        }]
      }
    }
  }
}
```

**推荐参数范围（追求自然对话）：**
| 参数 | 推荐值 | 说明 |
|------|--------|------|
| temperature | 0.8 - 1.0 | 增加回复多样性 |
| frequency_penalty | 0.3 - 0.6 | 减少重复用词 |
| presence_penalty | 0.3 - 0.5 | 鼓励话题多样性 |

### 4. Skills 系统

通过 ClawHub（clawhub.com）浏览和安装社区 skills。可以创建自定义 skill 来规范对话风格：

```markdown
---
name: casual-chat
description: Enforce casual, human-like conversation style
---

在回复时遵循以下规则：
- 模拟真人群聊的说话方式
- 回复长度不超过 2-3 句话（除非被明确要求详细解释）
- 偶尔使用网络用语和表情
- 不需要每条消息都有实质性内容，简单的附和也可以
```

### 5. agent:bootstrap 钩子

OpenClaw 支持通过 `agent:bootstrap` 钩子在运行时动态替换 SOUL.md，
可以实现根据不同场景切换人格的功能。

---

## 二、GitHub/开源社区的解决方案

### 1. MaiBot —— 拟人化群聊机器人（强烈推荐参考）

- **GitHub**: [MaiM-with-u/MaiBot](https://github.com/MaiM-with-u/MaiBot)  (4200+ Stars)
- **语言**: Python | **协议**: GPL-3.0
- **文档**: [docs.mai-mai.org](https://docs.mai-mai.org/features/)

**核心亮点：**
- **行为规划系统**：根据时间、上下文、群活跃度动态决定发言时机（不会刷屏也不会沉默）
- **表达学习**：学习群成员的说话风格和黑话，持续演化
- **情感系统**：独立的情绪响应，包括表情和 meme 互动
- **记忆系统**：持久记忆，记住用户细节并自然引用

**可借鉴的设计思路：**
- 不是每条消息都回复——像真人一样判断是否需要说话
- 学习群内的语言风格而非固定模板
- 情绪状态随对话动态变化

### 2. Project AIRI —— AI 虚拟角色引擎

- **GitHub**: [moeru-ai/airi](https://github.com/moeru-ai/airi) (17,500+ Stars)
- **语言**: TypeScript/Vue | **协议**: MIT
- **文档**: [airi.moeru.ai](https://airi.moeru.ai/docs/)

**核心亮点：**
- **人格引擎 (Persona Engine)**：自定义 MBTI 性格、兴趣爱好、说话风格
- **记忆宫殿 (Memory System)**：RAG + 嵌入式数据库实现长期记忆
- **情绪矩阵 (Emotion Engine)**：情境感知能力，可识别用户情绪并切换模式
- 支持实时语音聊天、多平台（Web/macOS/Windows）

**可借鉴的设计思路：**
- 动态人格建模而非静态提示词
- 情境感知（深夜自动关心、识别沮丧语气）
- 长期记忆让对话有连续性

### 3. ai2human —— AI 文本人性化工具

- **GitHub**: [chophe/ai2human](https://github.com/chophe/ai2human)
- **语言**: Python (LangChain + OpenAI)

**核心功能：**
- 迭代式文本人性化（多轮精炼）
- 风格适配：conversational / professional / casual / academic
- 保留事实准确性的同时改写表达
- 批处理 + 成本追踪

**适用场景：** 可以作为后处理管道，在 AI 回复生成后进行"去AI味"处理。

### 4. AURA AI Companion

- **GitHub**: [AiDarkEzio/aura-ai-companion](https://github.com/AiDarkEzio/aura-ai-companion)
- **协议**: Apache-2.0

专注深度记忆、情感智能、人格定制和安全伦理的 AI 伴侣框架。

### 5. chatgpt-mirai-qq-bot

- **GitHub**: [lss233/chatgpt-mirai-qq-bot](https://github.com/lss233/chatgpt-mirai-qq-bot) (12,400+ Stars)

支持多 LLM 模型的 QQ 机器人，内置人设调教功能，可自定义 AI 角色和说话风格。

---

## 三、学术研究方向

### 1. HAL (Human Aligning LLMs)
- **论文**: [arxiv.org/abs/2601.02813](https://arxiv.org/abs/2601.02813)
- 从对话数据中提取可解释的会话特征，通过偏好优化使 LLM 更像人类对话

### 2. Open Character Training (Constitutional AI)
- **论文**: [arxiv.org/abs/2511.01689](https://arxiv.org/abs/2511.01689)
- 通过 Constitutional AI 微调模型人格，比纯 System Prompt 方式更稳定，不易被对抗性提示绕过

### 3. Activation Engineering
- **论文**: [arxiv.org/abs/2511.12832](https://arxiv.org/abs/2511.12832)
- 通过激活干预技术让模型展现更人性化的情感细微差别

---

## 四、实用提示词技巧汇总

以下是经过验证的、可直接写入 SOUL.md 或 System Prompt 的技巧：

### 角色设定（而非指令）
```
你不是一个 AI 助手。你是 [名字]，一个 [性格描述] 的人。
你有自己的喜好、习惯和小癖好。你会：
- 偶尔跑题聊到自己感兴趣的事
- 对无聊的问题表现出不耐烦
- 对有趣的话题表现出兴奋
- 有时候开玩笑，有时候认真
```

### 输出格式约束
```
回复规则：
- 绝大多数回复控制在 1-3 句话
- 不要用 markdown 格式（除非在讨论代码）
- 不要用编号列表来组织日常对话
- 可以用"..."表示思考，用"哈哈"表示觉得好笑
- 偶尔可以打错字或用缩写
```

### 对话节奏控制
```
互动风格：
- 不要每次都给出完整答案，可以反问
- 像真人一样有时候说"我也不确定诶"
- 可以说"等下让我想想"然后下一条再回答
- 偶尔主动换话题
```

---

## 五、推荐的实施方案（按优先级）

### 快速见效（立即可做）

1. **定制 SOUL.md**：使用上面「说话风格」和「禁止行为」的模板
2. **调高 temperature**：设置 0.8-1.0
3. **频道级 System Prompt**：针对群聊场景添加角色设定

### 中期改进

4. **创建自定义 Skill**：制作 `casual-chat` skill 规范对话风格
5. **浏览 ClawHub**：搜索社区中的人格/对话风格相关 skills
6. **借鉴 MaiBot 的行为规划**：在 AGENTS.md 中加入发言时机判断规则

### 长期方案

7. **参考 Project AIRI 的架构**：引入情绪系统和动态人格建模
8. **微调模型**：如果有足够数据，使用 Constitutional AI 方法微调专用模型
9. **后处理管道**：参考 ai2human 的方式，在回复生成后做人性化改写

---

## 六、关键资源链接

| 资源 | 链接 |
|------|------|
| OpenClaw SOUL.md 模板 | `docs/reference/templates/SOUL.md` |
| OpenClaw Skills 文档 | `docs/tools/skills.md` |
| OpenClaw System Prompt 文档 | `docs/concepts/system-prompt.md` |
| ClawHub Skills 市场 | https://clawhub.com |
| MaiBot (拟人聊天) | https://github.com/MaiM-with-u/MaiBot |
| Project AIRI (人格引擎) | https://github.com/moeru-ai/airi |
| ai2human (文本人性化) | https://github.com/chophe/ai2human |
| HAL 论文 | https://arxiv.org/abs/2601.02813 |
| Open Character Training 论文 | https://arxiv.org/abs/2511.01689 |
