# CodeIsland 机器人动画实现深度分析

**仓库**: [wxtsky/CodeIsland](https://github.com/wxtsky/CodeIsland/tree/main)  
**项目简介**: macOS Swift 应用，在 MacBook 刘海区域（Dynamic Island / Notch）显示 AI 编码 Agent 的实时状态  
**调研日期**: 2026-04-08

---

## 核心结论：纯程序化 SwiftUI Canvas 动画

动画**不是** GIF 或 Sprite Sheet。`docs/images/mascots/*.gif` 仅为文档预览图，不在 App 内加载。  
所有动画完全由 Swift 代码实时绘制，基于 4 个核心构建块。

---

## 构建块 1：TimelineView — 动画驱动引擎

```swift
TimelineView(.periodic(from: .now, by: 0.06)) { ctx in
    sleepCanvas(t: ctx.date.timeIntervalSinceReferenceDate * speed)
}
```

- 替代传统游戏循环
- `by: 0.03–0.06` → 每帧 16–33ms（约 30–60fps）
- 每个 Scene 有各自独立的 `TimelineView`
- `speed` 从 SwiftUI Environment 注入，可全局控制播放速率

---

## 构建块 2：V() — 坐标映射结构体

```swift
private struct V {
    let ox: CGFloat, oy: CGFloat, s: CGFloat, y0: CGFloat

    init(_ sz: CGSize, svgW: CGFloat = 15, svgH: CGFloat = 10, svgY0: CGFloat = 6) {
        s = min(sz.width / svgW, sz.height / svgH)   // 统一缩放比
        ox = (sz.width - svgW * s) / 2                // 水平居中偏移
        oy = (sz.height - svgH * s) / 2               // 垂直居中偏移
        y0 = svgY0                                     // Y 轴基准点
    }

    func r(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat,
           dy: CGFloat = 0) -> CGRect {
        CGRect(x: ox + x * s,
               y: oy + (y - y0 + dy) * s,
               width: w * s, height: h * s)
    }
}
```

**作用**：设计时用小整数坐标（如 `3, 6, 2.5, 1.0`）描述角色，运行时自动映射到实际像素。`dy` 参数用于动态位移（弹跳、浮动）。

> **注意**：`V` 结构体和下方的 `lerp()` 函数没有共享实现——每个 Mascot View 文件各自持有一份 `private` 副本。

---

## 构建块 3：lerp() — 关键帧线性插值

```swift
private func lerp(_ keyframes: [(CGFloat, CGFloat)], at pct: CGFloat) -> CGFloat {
    guard let first = keyframes.first else { return 0 }
    if pct <= first.0 { return first.1 }
    for i in 1..<keyframes.count {
        if pct <= keyframes[i].0 {
            let t = (pct - keyframes[i-1].0) / (keyframes[i].0 - keyframes[i-1].0)
            return keyframes[i-1].1 + (keyframes[i].1 - keyframes[i-1].1) * t
        }
    }
    return keyframes.last?.1 ?? 0
}
```

主要用于 **Alert 场景**中的复杂多步动作序列（跳跃、摇晃），keyframe 数组约 40 个控制点，周期 3.5 秒。

---

## 构建块 4：三角函数运动 + 时间归一化

```swift
// 循环时间归一化 → 0..1
let phase = t.truncatingRemainder(dividingBy: cycleDuration) / cycleDuration

// 呼吸 / 浮动
let breathe = sin(phase * .pi * 2)

// 弹跳（0.4s 周期）
let bounce = sin(t * 2 * .pi / 0.4)

// 快速抖动
let shake = sin(pct * 80)
```

---

## 状态机：AgentStatus → 3 种渲染场景

`AgentStatus` 共 5 个枚举值，合并映射为 3 个渲染场景：

```swift
switch status {
case .idle:                                   sleepScene   // 睡眠
case .processing, .running:                   workScene    // 工作
case .waitingApproval, .waitingQuestion:      alertScene   // 警告/等待
}
```

### 各场景视觉效果

| 场景 | 动画技术 |
|------|---------|
| **Sleep（睡眠）** | sin() 呼吸（躯干拉伸/压缩）、浮动的 Z 字母（错开延迟级联）、慢速光标闪烁 |
| **Work（工作）** | 弹跳（0.4s 周期）、手臂旋转（左右不同频率的 sin）、键盘按键高亮循环（0.1s）、快速眨眼 |
| **Alert（等待）** | lerp() 关键帧序列（3.5s 周期）、跳跃时 squash/stretch 变形、带阻尼振荡的感叹号、眼睛颜色闪烁（青色 ↔ 红/琥珀色）|

---

## 全局速度控制

```swift
// SwiftUI Environment Key（各 Mascot View 文件中各有一份 private 声明）
private struct MascotSpeedKey: EnvironmentKey {
    static let defaultValue: Double = 1.0
}

// MascotView 中注入
.environment(\.mascotSpeed, Double(speedPct) / 100.0)
```

设置滑块范围 **0–300**（步长 25），`0 = speed_off`（停止），`100 = 1.0×`（默认），`300 = 3.0×`（最快）：

| 滑块值 | 倍率 | 效果 |
|--------|------|------|
| 0 | 0.0× | 动画停止 |
| 100 | 1.0× | 正常速度（默认）|
| 200 | 2.0× | 2 倍速 |
| 300 | 3.0× | 3 倍速 |

---

## 9 个角色（每个独立 View 文件）

| 角色 | View 文件 | 对应 AI 工具 | 特色 |
|------|----------|------------|------|
| Clawd | `PixelCharacterView.swift` | Claude Code | 机器猫 |
| Dex | `DexView.swift` | Codex | 云朵形象 |
| Gemini | `GeminiView.swift` | Gemini CLI | **8 角星形 Path**（唯一非矩形身体）|
| Cursor | `CursorView.swift` | Cursor | — |
| Copilot | `CopilotView.swift` | GitHub Copilot | 耳朵信号闪烁 |
| Qoder | `QoderView.swift` | Qoder | — |
| Droid | `DroidView.swift` | Factory | — |
| Buddy | `BuddyView.swift` | CodeBuddy | 宇航猫 |
| OpenCode | `OpenCodeView.swift` | OpenCode | — |

路由入口在 `MascotView.swift`：

```swift
switch source {
case "codex":     DexView(status: status, size: size)
case "gemini":    GeminiView(status: status, size: size)
case "cursor":    CursorView(status: status, size: size)
case "copilot":   CopilotView(status: status, size: size)
case "qoder":     QoderView(status: status, size: size)
case "droid":     DroidView(status: status, size: size)
case "codebuddy": BuddyView(status: status, size: size)
case "opencode":  OpenCodeView(status: status, size: size)
default:          ClawdView(status: status, size: size)  // Claude Code
}
```

---

## 完整数据流

```
Claude Code / Cursor / Gemini / etc.  ←→  Unix Socket IPC
    ↓
EventNormalizer.normalize(event.eventName)
    将各工具特有格式统一为标准 PascalCase：
    "beforeSubmitPrompt" (Cursor)   → "UserPromptSubmit"
    "BeforeTool"         (Gemini)   → "PreToolUse"
    "userPromptSubmitted"(Copilot)  → "UserPromptSubmit"
    ↓
路由分发：
    权限请求  → handlePermissionRequest()  → UI 队列
    用户提问  → handleQuestion()            → UI 队列
    普通事件  → handleEvent()
                  → reduceEvent() → [SideEffect]
                  → executeEffect()
                     ├ .playSound(eventName)
                     ├ .tryMonitorSession(sid)
                     ├ .removeSession
                     └ .setActiveSession
    ↓
AppState.sessions[sessionId].status 更新
    ↓
多 Session 优先级调度：
    statusPriority:
        waitingApproval(5) > waitingQuestion(4) > running(3) > processing(2) > idle(0)
    紧急 session 立即抢占显示；普通情况：Timer 每 3 秒 rotateToNextSession()
    ↓
MascotView(status: dominantStatus, source: "claude"|"codex"|...)
    ↓
switch source → XxxView(status:, size:)
    ↓
TimelineView 根据 AgentStatus 渲染对应 Scene
```

---

## 刘海面板动画（与 Mascot 独立）

`NotchAnimation.swift` 定义 4 种 Spring 物理预设：

| 名称 | 参数 | 用途 |
|------|------|------|
| `open` | response=0.42, damping=**0.82**（欠阻尼）| 面板展开，有轻微反弹感 |
| `close` | response=0.38, damping=**1.0**（临界阻尼）| 面板收起，无过冲 |
| `pop` | response=0.3, damping=**0.65**（强欠阻尼）| 通知自动弹出，活泼感 |
| `micro` | `easeOut(0.12s)` | 悬停等小交互，极快响应 |

open 与 close 刻意选用不同阻尼：展开时允许轻微弹过以增加生气，收起时临界阻尼防止刘海区域出现几何伪影。

其他 UI 过渡技术：

- **`BlurFadeModifier`**：`blur(radius: 0↔5)` + opacity 同时变化，内容切换比纯淡入淡出更自然
- **`MorphText`**：三阶段文字变形（blur out → 换字 → blur in），用 Task-based 时序串联
- **`IslandSurface`** 5 种状态：`collapsed / sessionList / approvalCard / questionCard / completionCard`

---

## 技术本质

CodeIsland 的动画系统可以用一句话总结：

> **时钟（TimelineView）→ 归一化时间 → 数学函数（sin / lerp）→ 偏移量 → Canvas 绘制几何图形**

无资源文件依赖，无 Core Animation layer tree，全程 SwiftUI 原生实现。

---

## 可借鉴的设计模式

| 模式 | 适用场景 | 优先级 |
|------|---------|--------|
| `TimelineView(.periodic)` 驱动持续动画 | 需要连续动画的任何 SwiftUI 组件 | P0 |
| `truncatingRemainder / cycleDuration` 时间归一化 | 循环动画，避免浮点累积误差 | P0 |
| `lerp()` 关键帧序列 | 多步骤复杂动作（通知弹入、角色跳跃）| P1 |
| `V()` 坐标映射 | 设计稿坐标与视图坐标解耦 | P1 |
| `EnvironmentKey` 传递全局动画参数 | 速度、主题等跨层级参数 | P2 |
| Spring 阻尼差异化（open vs close）| 展开/收起动画的不同手感需求 | P2 |
