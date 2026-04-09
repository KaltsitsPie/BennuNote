# Morandi UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin BennuNote's entire UI to a minimalist Morandi palette with `#A6B3A7` as primary accent, replacing Bilibili blue throughout — no functional, DOM structure, or TypeScript changes.

**Architecture:** Three files change: `src/content/subtitle-panel.css` (918-line reskin), `src/popup/popup.html` (inline CSS update), `src/options/options.html` (inline CSS update). No `.ts` files touched. All Shadow DOM class names (`bennu-*`) stay unchanged.

**Tech Stack:** CSS, Chrome Extension MV3 (Shadow DOM), TypeScript build via `npm run build`

---

## Color Mapping Reference

| Old Value | New Value | Role |
|-----------|-----------|------|
| `#00a1d6` | `#A6B3A7` | Primary accent |
| `#0090c0` | `#96A497` | Accent hover |
| `rgba(0,0,0,0.15)` | `rgba(45,53,48,0.10)` | Shadow alpha |
| `#f8f9fa` / `#fafafa` | `#FAFBFA` | Header/footer/lang-bar bg |
| `#f0f7ff` | `#F4F5F3` | Hover bg, info boxes |
| `#dde8f8` | `#D4DDD5` | Info box border |
| `#eee` | `#E8EBEA` | Borders |
| `#ddd` | `#D8DDD9` | Input/button borders |
| `#d0d0d0` | `#D8DDD9` | Input borders |
| `#333` | `#2D3530` | Primary text |
| `#555` / `#666` | `#5A6358` | Secondary text |
| `#888` / `#999` / `#aaa` | `#9AA097` | Muted text |
| `#e8f5e9` | `#EBF0EB` | Success/badge bg |
| `#2e7d32` | `#6B8A6E` | Success/badge text |
| `#4caf50` | `#5C8C6A` | Success color |
| `#f44336` / `#f44747` | `#B86060` | Error color |
| `#ff9800` | `#B89A5C` | Warning color |
| `#e8f4ff` | `#EBF0EB` | Provider tab active bg |
| `#e0e0e0` | `#E0E4E1` | Hover bg (generic) |
| `#f0f0f0` | `#F0F2F1` | Hover bg (light) |
| **Log colors** | | |
| `#1e1e1e` (log bg) | `#F4F5F3` | Log background (light!) |
| `#d4d4d4` (log text) | `#4A5248` | Log default text |
| `#6a9955` (log time) | `#A6B3A7` | Log timestamp |
| `#9cdcfe` (log info) | `#7A9880` | Log info |
| `#4ec9b0` (log ok) | `#5C8C6A` | Log success |
| `#dcdcaa` (log warn) | `#B89A5C` | Log warning |
| `#f44747` (log err) | `#B86060` | Log error |
| `#c586c0` (log step) | `#7A6E8C` | Log step |
| **Keep unchanged** | | |
| `#3370ff` | `#3370ff` | Feishu brand blue |
| `#2860e0` | `#2860e0` | Feishu brand hover |
| `#1e1e1e` (`.bennu-setup-cmd`) | `#1e1e1e` | Code display box (intentional dark) |

**Border radius changes:** Panel `12px` → `14px`; buttons/inputs `6px` → `7px` where specified below.

---

## Task 1: :host, panel shell, header

**Files:**
- Modify: `src/content/subtitle-panel.css:1-78`

- [ ] **Step 1: Replace :host, .bennu-panel, .bennu-header, .bennu-title, .bennu-source-badge, .bennu-btn**

Replace lines 1–78 with:

```css
:host {
  all: initial;
  font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
  font-size: 14px;
  color: #2D3530;
}

.bennu-panel {
  position: fixed;
  top: 80px;
  right: 16px;
  width: 380px;
  max-height: calc(100vh - 120px);
  background: #fff;
  border-radius: 14px;
  box-shadow: 0 2px 16px rgba(45,53,48,0.10), 0 0 0 1px rgba(45,53,48,0.05);
  z-index: 100000;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.bennu-panel.hidden {
  display: none;
}

/* Header */
.bennu-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 13px 16px 12px;
  border-bottom: 1px solid #E8EBEA;
  background: #FFFFFF;
  border-radius: 14px 14px 0 0;
  flex-shrink: 0;
}

.bennu-title {
  font-size: 14px;
  font-weight: 600;
  color: #2D3530;
  letter-spacing: -0.2px;
}

.bennu-source-badge {
  font-size: 10px;
  padding: 2px 7px;
  border-radius: 8px;
  background: #EBF0EB;
  color: #6B8A6E;
  margin-left: 8px;
  letter-spacing: 0.2px;
}

.bennu-header-actions {
  display: flex;
  gap: 2px;
}

.bennu-btn {
  border: none;
  background: none;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 7px;
  font-size: 13px;
  color: #9AA097;
  transition: background 0.15s;
}

.bennu-btn:hover {
  background: #F0F2F1;
}

.bennu-close-btn {
  font-size: 18px;
  line-height: 1;
  padding: 2px 6px !important;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/content/subtitle-panel.css
git commit -m "style: update panel shell, header, badge to Morandi palette"
```

---

## Task 2: Tabs, language bar, progress bar

**Files:**
- Modify: `src/content/subtitle-panel.css:80-156`

- [ ] **Step 1: Replace tabs, language bar, and progress bar rules**

Replace lines 80–156 with:

```css
/* Tabs */
.bennu-tabs {
  display: flex;
  border-bottom: 1px solid #E8EBEA;
  padding: 0 16px;
  flex-shrink: 0;
}

.bennu-tab {
  padding: 9px 14px;
  font-size: 12.5px;
  color: #9AA097;
  cursor: pointer;
  border: none;
  background: none;
  border-bottom: 2px solid transparent;
  transition: color 0.15s, border-color 0.15s;
  margin-bottom: -1px;
  letter-spacing: 0.1px;
}

.bennu-tab:hover {
  color: #5A6358;
}

.bennu-tab.active {
  color: #A6B3A7;
  border-bottom-color: #A6B3A7;
  font-weight: 500;
}

/* Language bar */
.bennu-lang-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 16px;
  border-bottom: 1px solid #E8EBEA;
  background: #FAFBFA;
  flex-shrink: 0;
}

.bennu-lang-label {
  font-size: 12px;
  color: #9AA097;
  flex-shrink: 0;
}

.bennu-lang-select {
  flex: 1;
  font-size: 12px;
  padding: 3px 6px;
  border: 1px solid #D8DDD9;
  border-radius: 5px;
  background: #fff;
  color: #2D3530;
  cursor: pointer;
  outline: none;
}

.bennu-lang-select:focus {
  border-color: #A6B3A7;
}

/* Progress bar */
.bennu-progress-bar {
  width: 100%;
  height: 3px;
  background: #E8EBEA;
  overflow: hidden;
  flex-shrink: 0;
}

.bennu-progress-fill {
  height: 100%;
  background: #A6B3A7;
  transition: width 0.3s;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/content/subtitle-panel.css
git commit -m "style: update tabs, language bar, progress bar to Morandi"
```

---

## Task 3: Subtitle list

**Files:**
- Modify: `src/content/subtitle-panel.css:158-241`

- [ ] **Step 1: Replace tab-content, log, and subtitle rules**

Replace lines 158–241 with:

```css
/* Tab content */
.bennu-tab-content {
  display: none;
  flex: 1;
  overflow: hidden;
  min-height: 0;
}

.bennu-tab-content.active {
  display: flex;
  flex-direction: column;
}

/* Log view */
.bennu-log {
  flex: 1;
  overflow-y: auto;
  padding: 8px 12px;
  font-family: 'SF Mono', Monaco, Consolas, monospace;
  font-size: 11.5px;
  line-height: 1.7;
  background: #F4F5F3;
  color: #4A5248;
}

.bennu-log-entry {
  padding: 2px 0;
  word-break: break-all;
}

.bennu-log-time {
  color: #A6B3A7;
  margin-right: 6px;
}

.bennu-log-info { color: #7A9880; }
.bennu-log-success { color: #5C8C6A; }
.bennu-log-warn { color: #B89A5C; }
.bennu-log-error { color: #B86060; }
.bennu-log-step { color: #7A6E8C; font-weight: 500; }

/* Subtitle list */
.bennu-subtitle-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

.bennu-subtitle-item {
  display: flex;
  padding: 9px 16px;
  cursor: pointer;
  transition: background 0.12s;
  gap: 12px;
  line-height: 1.55;
}

.bennu-subtitle-item:hover {
  background: #F4F5F3;
}

.bennu-time {
  flex-shrink: 0;
  font-size: 11px;
  color: #B5BCBA;
  font-family: 'SF Mono', Monaco, monospace;
  min-width: 42px;
  padding-top: 2px;
}

.bennu-text {
  flex: 1;
  font-size: 13.5px;
  color: #2D3530;
  word-break: break-word;
}

.bennu-empty {
  padding: 24px 16px;
  text-align: center;
  color: #9AA097;
  font-size: 13px;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/content/subtitle-panel.css
git commit -m "style: update log panel (dark→light Morandi) and subtitle list"
```

---

## Task 4: Footer and Feishu option panels

**Files:**
- Modify: `src/content/subtitle-panel.css:242-400`

- [ ] **Step 1: Replace footer, feishu-options, feishu-panels, feishu-link rules**

Replace lines 242–400 with:

```css
/* Footer */
.bennu-footer {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 11px 16px 13px;
  border-top: 1px solid #E8EBEA;
  background: #FAFBFA;
  border-radius: 0 0 14px 14px;
  flex-shrink: 0;
}

.bennu-footer-buttons {
  display: flex;
  gap: 8px;
}

.bennu-footer-buttons .bennu-btn {
  flex: 1;
  text-align: center;
  padding: 7px 0;
  font-size: 12.5px;
  border: 1px solid #D8DDD9;
  border-radius: 7px;
  color: #5A6358;
}

.bennu-footer-buttons .bennu-btn:hover {
  background: #F0F2F1;
  border-color: #C8CEC9;
}

.bennu-feishu-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.bennu-feishu-options .bennu-wiki-doc-link {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 10px;
  font-size: 12px;
  border: 1px solid #D8DDD9;
  border-radius: 7px;
  background: #fff;
}

.bennu-feishu-option-buttons {
  display: flex;
  gap: 8px;
}

.bennu-feishu-option-buttons .bennu-btn {
  flex: 1;
  text-align: center;
  padding: 7px 0;
  font-size: 12.5px;
  border: 1px solid #D8DDD9;
  border-radius: 7px;
  color: #5A6358;
}

.bennu-feishu-cancel-btn {
  color: #9AA097;
}

.bennu-feishu-append-panel,
.bennu-feishu-new-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.bennu-feishu-new-info {
  font-size: 12px;
  color: #5A6358;
  padding: 6px 8px;
  background: #EBF0EB;
  border-radius: 6px;
  border: 1px solid #D4DDD5;
}

.bennu-wiki-space-name {
  font-weight: 600;
  color: #3370ff;
}

.bennu-wiki-refresh-btn {
  cursor: pointer;
  font-size: 14px;
  color: #3370ff;
  user-select: none;
  vertical-align: middle;
  margin-left: 2px;
}
.bennu-wiki-refresh-btn:hover {
  opacity: 0.7;
}

.bennu-feishu-wiki-hint {
  font-size: 11px;
  color: #9AA097;
  line-height: 1.5;
}

.bennu-feishu-settings-link {
  color: #3370ff;
  cursor: pointer;
  text-decoration: underline;
}

.bennu-feishu-confirm-btn {
  background: #3370ff !important;
  color: #fff !important;
  border-color: #3370ff !important;
}

.bennu-feishu-confirm-btn:hover:not(:disabled) {
  background: #2860e0 !important;
}

.bennu-feishu-confirm-btn:disabled {
  background: #c0c4cc !important;
  border-color: #c0c4cc !important;
  cursor: not-allowed;
}

.bennu-status-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #9AA097;
  margin-left: 8px;
  vertical-align: middle;
}

.bennu-feishu-btn {
  background: #3370ff !important;
  color: #fff !important;
  border-color: #3370ff !important;
}
.bennu-feishu-btn:hover {
  background: #2860e0 !important;
}
.bennu-feishu-btn:disabled {
  background: #9AA097 !important;
  border-color: #9AA097 !important;
  cursor: not-allowed;
}
.bennu-feishu-link {
  padding: 8px 16px;
  background: #EBF0EB;
  border-top: 1px solid #E8EBEA;
  border-radius: 0 0 14px 14px;
}
.bennu-feishu-url {
  color: #3370ff;
  font-size: 13px;
  text-decoration: none;
}
.bennu-feishu-url:hover {
  text-decoration: underline;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/content/subtitle-panel.css
git commit -m "style: update footer and Feishu option panels to Morandi"
```

---

## Task 5: Summary tab

**Files:**
- Modify: `src/content/subtitle-panel.css:401-571`

- [ ] **Step 1: Replace summary tab rules**

Replace lines 401–571 with:

```css
/* Summary tab */
.bennu-summary-empty {
  padding: 24px 16px;
  text-align: center;
  color: #9AA097;
  font-size: 13px;
  line-height: 1.6;
}

.bennu-summary-empty small {
  color: #B5BCBA;
}

.bennu-summary-loading {
  padding: 32px 16px;
  text-align: center;
  color: #9AA097;
  font-size: 13px;
}

@keyframes bennu-pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}

.bennu-summary-loading::after {
  content: '...';
  animation: bennu-pulse 1.5s infinite;
}

.bennu-summary-text {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  font-size: 13px;
  line-height: 1.75;
  color: #4A5248;
}

.bennu-summary-text p {
  margin-bottom: 12px;
}

.bennu-summary-text p:last-child {
  margin-bottom: 0;
}

.bennu-summary-actions {
  padding: 11px 16px 13px;
  border-top: 1px solid #E8EBEA;
  display: flex;
  gap: 8px;
  flex-shrink: 0;
  background: #FAFBFA;
}

.bennu-summary-actions .bennu-btn {
  flex: 1;
  text-align: center;
  padding: 7px 0;
  font-size: 12.5px;
  border: 1px solid #D8DDD9;
  border-radius: 7px;
  color: #5A6358;
}

.bennu-summary-actions .bennu-btn:hover {
  background: #F0F2F1;
  border-color: #C8CEC9;
}

.bennu-summary-actions .bennu-btn:disabled {
  background: #F4F5F3;
  color: #9AA097;
  cursor: not-allowed;
}

/* Token setup form */
.bennu-summary-setup {
  padding: 16px;
}

.bennu-setup-title {
  font-size: 14px;
  font-weight: 600;
  color: #2D3530;
  margin-bottom: 8px;
}

.bennu-setup-desc {
  font-size: 12px;
  color: #5A6358;
  line-height: 1.6;
  margin-bottom: 8px;
}

.bennu-setup-link {
  color: #A6B3A7;
  text-decoration: none;
}

.bennu-setup-link:hover {
  text-decoration: underline;
}

.bennu-setup-cmd {
  background: #1e1e1e;
  color: #d4d4d4;
  padding: 10px 14px;
  border-radius: 6px;
  margin-bottom: 10px;
  font-family: 'SF Mono', Monaco, Consolas, monospace;
  font-size: 13px;
  user-select: all;
}

.bennu-setup-cmd code {
  background: none;
  padding: 0;
  color: inherit;
  font-size: inherit;
}

.bennu-setup-desc code {
  background: #EBF0EB;
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 11px;
}

.bennu-setup-input {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid #D8DDD9;
  border-radius: 7px;
  font-size: 13px;
  font-family: monospace;
  margin-bottom: 8px;
  background: #fff;
  color: #2D3530;
  outline: none;
  box-sizing: border-box;
}

.bennu-setup-input:focus {
  border-color: #A6B3A7;
  box-shadow: 0 0 0 2px rgba(166,179,167,0.18);
}

.bennu-setup-error {
  font-size: 12px;
  color: #B86060;
  margin-bottom: 8px;
}

.bennu-setup-actions {
  display: flex;
  gap: 8px;
}

.bennu-setup-actions .bennu-btn {
  flex: 1;
  text-align: center;
  padding: 7px 0;
  font-size: 12.5px;
  border: 1px solid #D8DDD9;
  border-radius: 7px;
  color: #5A6358;
}

.bennu-setup-actions .bennu-btn[data-action="save-token"] {
  background: #A6B3A7;
  color: #fff;
  border-color: #A6B3A7;
}

.bennu-setup-actions .bennu-btn[data-action="save-token"]:hover {
  background: #96A497;
  border-color: #96A497;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/content/subtitle-panel.css
git commit -m "style: update summary tab and token setup form to Morandi"
```

---

## Task 6: Feishu setup form

**Files:**
- Modify: `src/content/subtitle-panel.css:573-608`

- [ ] **Step 1: Replace Feishu setup form rules**

Replace lines 573–608 with:

```css
/* Feishu setup form */
.bennu-feishu-setup {
  padding: 16px;
  border-top: 1px solid #E8EBEA;
  background: #FAFBFA;
  border-radius: 0 0 14px 14px;
  max-height: 360px;
  overflow-y: auto;
}

.bennu-feishu-setup .bennu-setup-input {
  margin-bottom: 10px;
}

.bennu-setup-field-label {
  display: block;
  font-size: 12px;
  font-weight: 500;
  color: #5A6358;
  margin-bottom: 4px;
}

.bennu-setup-optional {
  font-weight: 400;
  color: #9AA097;
}

.bennu-feishu-save-btn {
  background: #3370ff !important;
  color: #fff !important;
  border-color: #3370ff !important;
}

.bennu-feishu-save-btn:hover {
  background: #2860e0 !important;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/content/subtitle-panel.css
git commit -m "style: update Feishu setup form to Morandi"
```

---

## Task 7: Settings tab

**Files:**
- Modify: `src/content/subtitle-panel.css:610-765`

- [ ] **Step 1: Replace settings tab rules**

Replace lines 610–765 with:

```css
/* Settings tab */
.bennu-settings {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
}

.bennu-settings-section {
  margin-bottom: 16px;
}

.bennu-settings-section-title {
  font-size: 10px;
  font-weight: 600;
  color: #9AA097;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  margin-bottom: 8px;
}

.bennu-secret-row {
  padding: 8px 10px;
  background: #FAFBFA;
  border: 1px solid #E8EBEA;
  border-radius: 7px;
  margin-bottom: 6px;
}

.bennu-secret-header {
  display: flex;
  align-items: center;
  gap: 6px;
}

.bennu-secret-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #C8CEC9;
  flex-shrink: 0;
}
.bennu-secret-dot.set {
  background: #A6B3A7;
}

.bennu-secret-label {
  font-size: 12px;
  font-weight: 500;
  color: #2D3530;
  flex: 1;
}

.bennu-secret-preview {
  font-size: 11px;
  color: #9AA097;
  font-family: monospace;
}

.bennu-secret-update,
.bennu-secret-clear {
  font-size: 11px !important;
  padding: 2px 6px !important;
  border: 1px solid #D8DDD9;
  border-radius: 4px;
  background: #fff;
  color: #5A6358;
}
.bennu-secret-clear {
  color: #B86060;
  border-color: #D9B0B0;
}
.bennu-secret-update:hover { background: #F0F2F1; }
.bennu-secret-clear:hover { background: #F5EAEA; }

.bennu-secret-edit {
  display: none;
  margin-top: 6px;
  gap: 6px;
  align-items: center;
}
.bennu-secret-edit input {
  flex: 1;
  padding: 5px 8px;
  border: 1px solid #D8DDD9;
  border-radius: 5px;
  font-size: 12px;
  font-family: monospace;
  outline: none;
  background: #fff;
  color: #2D3530;
  box-sizing: border-box;
}
.bennu-secret-edit input:focus {
  border-color: #A6B3A7;
}
.bennu-secret-save {
  font-size: 11px !important;
  padding: 4px 10px !important;
  background: #A6B3A7 !important;
  color: #fff !important;
  border: none;
  border-radius: 5px;
}

.bennu-settings-label {
  display: block;
  font-size: 11px;
  font-weight: 500;
  color: #9AA097;
  margin-bottom: 3px;
  margin-top: 8px;
}

.bennu-settings-input,
.bennu-settings-select {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid #D8DDD9;
  border-radius: 5px;
  font-size: 12px;
  background: #fff;
  color: #2D3530;
  outline: none;
  box-sizing: border-box;
}
.bennu-settings-input:focus,
.bennu-settings-select:focus {
  border-color: #A6B3A7;
}

.bennu-settings-conditional {
  display: none;
}

.bennu-settings-save {
  margin-top: 10px;
  width: 100%;
  padding: 7px 0;
  text-align: center;
  font-size: 12px;
  border: 1px solid #A6B3A7;
  border-radius: 7px;
  background: #A6B3A7 !important;
  color: #fff !important;
}
.bennu-settings-save:hover {
  background: #96A497 !important;
  border-color: #96A497 !important;
}

.bennu-settings-toast {
  text-align: center;
  font-size: 12px;
  color: #5C8C6A;
  margin-top: 6px;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/content/subtitle-panel.css
git commit -m "style: update settings tab (secret rows, inputs, status dots) to Morandi"
```

---

## Task 8: Toast, provider tabs, model select, settings guide

**Files:**
- Modify: `src/content/subtitle-panel.css:766-918`

- [ ] **Step 1: Replace toast, provider tabs, model select, guide, scope-box rules**

Replace lines 766–918 with:

```css
/* Floating toast */
.bennu-toast {
  position: absolute;
  top: 8px;
  left: 50%;
  transform: translateX(-50%);
  padding: 6px 16px;
  border-radius: 6px;
  font-size: 12px;
  color: #fff;
  z-index: 100;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.3s;
}
.bennu-toast.visible {
  opacity: 1;
}
.bennu-toast.error {
  background: #B86060;
}
.bennu-toast.warn {
  background: #B89A5C;
}
.bennu-toast.success {
  background: #5C8C6A;
}

/* Provider tabs */
.bennu-provider-tabs {
  display: flex;
  border: 1px solid #D8DDD9;
  border-radius: 6px;
  overflow: hidden;
  margin-bottom: 8px;
}
.bennu-provider-tab {
  flex: 1;
  padding: 4px 2px;
  text-align: center;
  font-size: 10px !important;
  color: #9AA097;
  border: none;
  border-right: 1px solid #D8DDD9;
  background: #fff;
  cursor: pointer;
  border-radius: 0;
}
.bennu-provider-tab:last-child { border-right: none; }
.bennu-provider-tab:hover { background: #F4F5F3; }
.bennu-provider-tab.active {
  background: #EBF0EB;
  color: #A6B3A7;
  font-weight: 500;
}
.bennu-provider-panel { display: none; }
.bennu-provider-panel.active { display: block; }

.bennu-model-select {
  width: 100%;
  padding: 4px 6px;
  margin-top: 6px;
  border: 1px solid #D8DDD9;
  border-radius: 4px;
  font-size: 11px;
  background: #fff;
  color: #5A6358;
  outline: none;
}
.bennu-model-select:focus { border-color: #A6B3A7; }

.bennu-settings-guide {
  margin-top: 6px;
}
.bennu-settings-guide summary {
  cursor: pointer;
  color: #A6B3A7;
  font-size: 10px;
  user-select: none;
  padding: 2px 0;
  list-style: none;
}
.bennu-settings-guide summary::before {
  content: '▸ ';
}
.bennu-settings-guide[open] summary::before {
  content: '▾ ';
}
.bennu-settings-guide summary::-webkit-details-marker { display: none; }
.bennu-guide-content {
  margin-top: 4px;
  padding: 6px 8px;
  background: #F4F5F3;
  border-radius: 5px;
  font-size: 10px;
  line-height: 1.6;
  color: #5A6358;
}
.bennu-guide-content ol {
  padding-left: 16px;
  margin: 0;
}
.bennu-guide-content li {
  margin-bottom: 3px;
}
.bennu-guide-content a {
  color: #A6B3A7;
  text-decoration: none;
}
.bennu-guide-content a:hover { text-decoration: underline; }
.bennu-guide-content code {
  background: #E8EBEA;
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 10px;
}
.bennu-scope-box-wrapper {
  position: relative;
  margin: 6px 0;
}
.bennu-scope-box {
  background: #fff;
  border: 1px solid #D8DDD9;
  border-radius: 4px;
  padding: 6px 8px;
  padding-right: 50px;
  font-family: monospace;
  font-size: 9px;
  line-height: 1.6;
  white-space: pre-wrap;
  max-height: 120px;
  overflow-y: auto;
  margin: 0;
  color: #2D3530;
}
.bennu-scope-copy {
  position: absolute;
  top: 4px;
  right: 4px;
  padding: 2px 6px !important;
  font-size: 9px !important;
  background: #F4F5F3;
  border: 1px solid #D8DDD9;
  border-radius: 3px;
  cursor: pointer;
  color: #5A6358;
  min-width: auto !important;
}
.bennu-scope-copy:hover {
  background: #E8EBEA;
  color: #2D3530;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/content/subtitle-panel.css
git commit -m "style: update toast, provider tabs, settings guide to Morandi"
```

---

## Task 9: Update popup.html

**Files:**
- Modify: `src/popup/popup.html`

- [ ] **Step 1: Replace the `<style>` block inside popup.html**

The `<style>` block (lines 5–71) currently uses `#00a1d6`, `#0090c0`, and `rgba(0,161,214,0.15)`. Replace it with:

```html
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      width: 280px;
      padding: 16px;
      font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
      color: #2D3530;
    }
    .title {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .title-icon {
      width: 24px;
      height: 24px;
    }
    .status {
      font-size: 13px;
      color: #9AA097;
      margin-bottom: 12px;
    }
    .btn {
      width: 100%;
      padding: 10px;
      border: none;
      border-radius: 8px;
      background: #A6B3A7;
      color: #fff;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s;
    }
    .btn:hover { background: #96A497; }
    .btn:disabled {
      background: #C8CEC9;
      cursor: not-allowed;
    }
    .lang-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;
    }
    .lang-row label {
      font-size: 13px;
      color: #5A6358;
      white-space: nowrap;
    }
    .lang-select {
      flex: 1;
      padding: 6px 8px;
      border: 1px solid #D8DDD9;
      border-radius: 6px;
      font-size: 13px;
      background: #fff;
    }
    .lang-select:focus {
      outline: none;
      border-color: #A6B3A7;
      box-shadow: 0 0 0 2px rgba(166,179,167,0.18);
    }
  </style>
```

- [ ] **Step 2: Commit**

```bash
git add src/popup/popup.html
git commit -m "style: update popup to Morandi palette"
```

---

## Task 10: Update options.html

**Files:**
- Modify: `src/options/options.html`

- [ ] **Step 1: Replace the `<style>` block inside options.html**

The `<style>` block (lines 5–138) uses `#00a1d6`, `#0090c0`, `rgba(0,161,214,0.15)`, `#4caf50`, `#f8f9fa`, `#e8f5e9`, `#2e7d32`, `#fbe9e7`, `#c62828`, `#ef9a9a`, `#ccc`. Replace it with:

```html
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      width: 480px;
      padding: 24px;
      font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
      color: #2D3530;
      background: #F4F5F3;
    }
    h1 { font-size: 20px; margin-bottom: 20px; }
    .section { margin-bottom: 20px; }
    .section h2 {
      font-size: 13px;
      color: #9AA097;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      margin-bottom: 10px;
      padding-bottom: 6px;
      border-bottom: 1px solid #E8EBEA;
      font-weight: 600;
    }
    label {
      display: block;
      font-size: 13px;
      font-weight: 500;
      margin-bottom: 4px;
      color: #5A6358;
    }
    input, select, textarea {
      width: 100%;
      padding: 8px 10px;
      border: 1px solid #D8DDD9;
      border-radius: 7px;
      font-size: 13px;
      margin-bottom: 12px;
      background: #fff;
      color: #2D3530;
    }
    textarea { resize: vertical; min-height: 60px; }
    input:focus, select:focus, textarea:focus {
      outline: none;
      border-color: #A6B3A7;
      box-shadow: 0 0 0 2px rgba(166,179,167,0.18);
    }
    .btn {
      padding: 10px 24px;
      border: none;
      border-radius: 8px;
      background: #A6B3A7;
      color: #fff;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
    }
    .btn:hover { background: #96A497; }
    .toast {
      display: none;
      padding: 8px 14px;
      background: #5C8C6A;
      color: #fff;
      border-radius: 6px;
      font-size: 13px;
      margin-top: 12px;
    }
    .conditional { display: none; }
    .conditional.visible { display: block; }

    /* Server secrets */
    .server-status {
      font-size: 12px;
      padding: 6px 10px;
      border-radius: 6px;
      margin-bottom: 12px;
    }
    .server-status.online { background: #EBF0EB; color: #5C8C6A; }
    .server-status.offline { background: #F5EAEA; color: #B86060; }
    .server-status.loading { background: #F5EFE0; color: #B89A5C; }

    .secret-row {
      padding: 10px 12px;
      background: #fff;
      border: 1px solid #E8EBEA;
      border-radius: 8px;
      margin-bottom: 8px;
    }
    .secret-header {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .secret-label {
      font-size: 13px;
      font-weight: 500;
      color: #2D3530;
      flex: 1;
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #C8CEC9;
      flex-shrink: 0;
    }
    .status-dot.set { background: #A6B3A7; }
    .secret-preview {
      font-size: 12px;
      color: #9AA097;
      font-family: monospace;
      margin-right: 8px;
    }
    .btn-sm {
      padding: 4px 10px;
      border: 1px solid #D8DDD9;
      border-radius: 5px;
      background: #fff;
      font-size: 12px;
      cursor: pointer;
      color: #5A6358;
    }
    .btn-sm:hover { background: #F4F5F3; }
    .btn-sm.danger { color: #B86060; border-color: #D9B0B0; }
    .btn-sm.danger:hover { background: #F5EAEA; }

    .secret-edit {
      display: none;
      margin-top: 8px;
    }
    .secret-edit.visible { display: flex; gap: 6px; }
    .secret-edit input {
      flex: 1;
      margin-bottom: 0;
      font-size: 12px;
      padding: 6px 8px;
    }
    .secret-edit .btn-sm { flex-shrink: 0; align-self: center; }
  </style>
```

- [ ] **Step 2: Commit**

```bash
git add src/options/options.html
git commit -m "style: update options page to Morandi palette"
```

---

## Task 11: Build verification

**Files:** None (read-only verification)

- [ ] **Step 1: Run build**

```bash
cd /Users/bytedance/Documents/BennuNote && npm run build
```

Expected: build completes with no errors. Output in `dist/`.

- [ ] **Step 2: Spot-check output CSS exists**

```bash
ls dist/content/
```

Expected: `subtitle-panel.css` (or bundled into JS) present.

- [ ] **Step 3: Visual check in browser**

Load `dist/` as unpacked extension in `chrome://extensions/` (Developer mode). Open a Bilibili video and verify:

1. Panel appears with `border-radius: 14px`, green-tinted shadow
2. Active tab shows Morandi green `#A6B3A7` underline
3. Log tab: light `#F4F5F3` background (not dark)
4. Subtitle hover: `#F4F5F3` (not blue)
5. Primary buttons: Morandi green `#A6B3A7`
6. Feishu confirm button: still `#3370ff`
7. Token setup code box: still dark `#1e1e1e`
8. Popup button: Morandi green
9. Options page button: Morandi green, status dots green

- [ ] **Step 4: Final commit (if any fixups needed)**

```bash
git add -p
git commit -m "style: fixup Morandi UI reskin"
```
