# BennuNote 字幕获取流程

本文档描述 BennuNote 获取 B 站视频字幕的完整流程。

---

## 总览

```
用户选择目标语言（默认中文）
  │
  ▼
获取视频信息（bvid, cid, title）
  │
  ├─ 策略1: __INITIAL_STATE__（页面注入）
  │    失败 ↓
  └─ 策略2: Bilibili /x/web-interface/view API
       失败 → 终止
  │
  ▼
阶段1: Bilibili Player API 字幕（严格语言匹配）
  ├─ 匹配目标语言 → 成功，结束
  ├─ 有轨道但不匹配目标语言 → 失败，降级
  └─ 无字幕轨道 → 失败，降级
       │
       ▼
阶段2: 后台服务（Python localhost:2185）
  POST /transcript
  ├─ yt-dlp 下载音频
  ├─ 尝试 Bcut ASR（B站必剪语音识别）→ 成功，结束
  │    失败 ↓
  └─ faster-whisper 本地模型识别 → 成功，结束
```

---

## 阶段 0：获取视频信息

从当前页面提取 `bvid`、`cid`、`title`，有两级降级：

### 策略 1：页面注入读取 `__INITIAL_STATE__`

- **方式**：MAIN world 脚本（`page-bridge.ts`）读取 `window.__INITIAL_STATE__`，通过 `postMessage` 传回 content script
- **超时**：1 秒
- **数据**：bvid、cid、title、分P信息（pages 数组），支持 `?p=N` 多P定位
- **失败原因**：B 站页面结构变化、SPA 路由未渲染完成

### 策略 2：URL 解析 + Bilibili API

- **方式**：正则从 URL 提取 BV 号，调用 `api.bilibili.com/x/web-interface/view?bvid=` 获取 cid
- **认证**：`credentials: 'include'`，使用浏览器已有 Cookie
- **失败原因**：非视频页面、API 返回非 0 code

两者都失败则终止提取。

---

## 语言选择

用户在 Popup 中选择目标语言后触发提取。可选语言：

- **中文**（zh，默认）
- **English**（en）
- **日本語**（ja）
- **한국어**（ko）

选中的语言作为 `EXTRACT_SUBTITLES` 消息的 `language` 字段传递到 content script。

---

## ���段 1：Bilibili Player API 字幕

最快路径，2-3 秒内完成。**严格匹配用户选择的目标语言**。

### 调用

```
GET api.bilibili.com/x/player/wbi/v2?bvid={bvid}&cid={cid}
  credentials: include
  Referer: 当前页面 URL
```

### 登录检测

调用前先请求 `api.bilibili.com/x/web-interface/nav` 确认登录状态，记录到 debug 信息中。

### 字幕轨道选择（`pickTrack`）

按以下优先级选取目标语言（以 `zh` 为例）：

1. `ai-zh`（AI 生成中文）
2. `zh`（人工中文）
3. `ai-zh` 前缀匹配（如 `ai-zh-Hans`）
4. `zh` 前缀匹配

**如果以上都不匹配 → 视为失败，终止提取**。不会降级到其他语言。

### API 不一致兜底

B 站 Player API 存在已知问题：同一视频的相同请求，不同时刻返回的字幕轨道可能不同。

当第一次请求未匹配到目标语言但返回了其他轨道时，等待 1 秒后重试一次。如果重试匹配到了目标语言则使用重试结果。

### 字幕加载

```
GET {subtitle_url}   // https://aisubtitle.hdslb.com/...
→ JSON { body: [{ from, to, content }] }
```

字幕来源标记：`lan` 以 `ai-` 开头标记为 `source: 'ai'`，否则为 `source: 'cc'`。

### 多轨道

如果有多条字幕轨道，面板会显示语言下拉框，用户可手动切换。切换时调用 `loadTrack()` 重新加载对应轨道。

### 失败条件

- API 返回 0 条轨道
- 有轨道但目标语言不匹配（重试后仍不匹配）
- API 请求异常

→ 降级到阶段 2。

---

## 阶段 2：后台服务（Python）

Python 后台运行在 `localhost:2185`，提供 `/transcript` 接口。内部有两级降级：先尝试 Bcut ASR，失败再用 faster-whisper。

### 调用

```
POST localhost:2185/transcript
Body: { "bvid": "BVxxxx", "model_size": "small", "cookie": "", "language": "zh" }
```

### 步骤 1：yt-dlp 下载音频

- 命令：`yt-dlp -f ba -o audio.m4a --no-playlist {url}`
- 支持传入 cookie 文件用于登录态视频
- 超时：120 秒
- 选择最佳音频流（`-f ba`）

### 步骤 2：尝试 Bcut ASR（优先）

B 站必剪（Bcut）自带的语音识别服务，**无需认证**，中文识别质量高，服务端运算速度快。

API 基地址：`member.bilibili.com/x/bcut/rubick-interface`

流程：

1. **请求上传** — `POST /resource/create`，获取分块上传地址
2. **分块上传音频** — `PUT upload_urls[i]`，按 `per_size` 分块，收集 ETag
3. **完成上传** — `POST /resource/create/complete`，提交 ETag 列表
4. **创建识别任务** — `POST /task`，model_id=8
5. **轮询结果** — `GET /task/result`，每 5 秒一次，最多 5 分钟
   - state=4（COMPLETE）：解析 `utterances` 数组，包含 `start_time`/`end_time`（毫秒）和 `transcript`
   - state=3（ERROR）：失败，降级到 Whisper

成功时返回 `source: "bcut_asr"`。

### 步骤 3：faster-whisper 兜底

当 Bcut ASR 失败时（网络问题、服务限流等），降级到本地 Whisper 模型。

- 模型大小可通过 Options 页配置（tiny / base / small / medium / large，默认 small）
- `device="auto"`, `compute_type="auto"`（有 GPU 自动使用）
- `language` 参数来自请求

成功时返回 `source: "whisper"`。

### 返回格式

```json
{ "text": "...", "source": "bcut_asr" | "whisper", "duration": 123.45, "items": [...] }
```

---

## 数据流图

```
┌─────────────┐    EXTRACT_SUBTITLES     ┌────────────────┐
│   Popup     │ ─────(+language)───────► │   Background   │
│ (语言选择)   │                          │  Service Worker │
└─────────────┘                          └───────┬────────┘
                                                  │
                                    sendMessage   │
                                                  ▼
                                         ┌────────────────┐
                                         │ Content Script  │
                                         │  (index.ts)     │
                                         └───┬────────────┘
                                             │
                        ┌────────────────────┤
                        │                    │
                        ▼                    ▼
               ┌──────────────┐      ┌──────────────────┐
               │ Bilibili API │      │  Python 后台     │
               │ (字幕轨道)    │      │  localhost:2185  │
               │ 阶段 1       │      │  阶段 2          │
               │ 严格语言匹配  │      │                  │
               └──────────────┘      │  yt-dlp 下载     │
                                     │    ↓              │
                                     │  Bcut ASR        │
                                     │    ↓ 失败         │
                                     │  faster-whisper  │
                                     └──────────────────┘
```
