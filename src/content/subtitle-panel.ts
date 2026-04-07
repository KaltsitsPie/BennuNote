import type { SubtitleItem, SubtitleSource, SubtitleTrack, VideoInfo } from '../shared/types';
import cssText from './subtitle-panel.css?inline';

type LogLevel = 'info' | 'success' | 'warn' | 'error' | 'step';

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}


/** Merge consecutive short segments into paragraphs based on pauses and length. */
function mergeSegments(items: SubtitleItem[]): SubtitleItem[] {
  if (items.length === 0) return [];

  const GAP_THRESHOLD = 2.0;   // seconds of silence to force a new paragraph
  const MAX_CHARS = 200;        // max characters before starting a new paragraph

  const merged: SubtitleItem[] = [];
  let current: SubtitleItem = { ...items[0] };

  for (let i = 1; i < items.length; i++) {
    const item = items[i];
    const gap = item.from - current.to;
    const wouldBeLen = current.content.length + item.content.length;

    if (gap > GAP_THRESHOLD || wouldBeLen > MAX_CHARS) {
      merged.push(current);
      current = { ...item };
    } else {
      current.to = item.to;
      current.content += ',' + item.content;
    }
  }
  merged.push(current);
  return merged;
}

function nowStr(): string {
  const d = new Date();
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
}

export class SubtitlePanel {
  private shadow: ShadowRoot;
  private container: HTMLElement;
  private panelEl!: HTMLElement;
  private logEl!: HTMLElement;
  private listEl!: HTMLElement;
  private sourceBadge!: HTMLElement;
  private footerEl!: HTMLElement;
  private emptyEl!: HTMLElement;
  private tabSubtitle!: HTMLElement;
  private tabLog!: HTMLElement;
  private tabSummary!: HTMLElement;
  private tabSettings!: HTMLElement;
  private contentSubtitle!: HTMLElement;
  private contentLog!: HTMLElement;
  private contentSummary!: HTMLElement;
  private contentSettings!: HTMLElement;
  private summaryEmptyEl!: HTMLElement;
  private summarySetupEl!: HTMLElement;
  private summaryLoadingEl!: HTMLElement;
  private summaryTextEl!: HTMLElement;
  private summaryActionsEl!: HTMLElement;
  private langSelect!: HTMLSelectElement;
  private langBar!: HTMLElement;
  private items: SubtitleItem[] = [];
  private mergedItems: SubtitleItem[] = [];
  private onTrackChange: ((track: SubtitleTrack) => void) | null = null;
  private logLines: string[] = [];
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private logHourKey = ''; // current hour storage key
  private feishuLink!: HTMLElement;
  private feishuUrl!: HTMLAnchorElement;
  private onSyncFeishu: (() => void) | null = null;
  private onSummarize: (() => void) | null = null;
  private videoInfo: VideoInfo | null = null;

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'bennunote-panel-host';
    this.shadow = this.container.attachShadow({ mode: 'closed' });
    this.buildUI();
    document.body.appendChild(this.container);
  }

  private buildUI() {
    const style = document.createElement('style');
    style.textContent = cssText;
    this.shadow.appendChild(style);

    const panel = document.createElement('div');
    panel.className = 'bennu-panel hidden';
    panel.innerHTML = `
      <div class="bennu-header">
        <div style="display:flex;align-items:center">
          <span class="bennu-title">BennuNote</span>
          <span class="bennu-source-badge" style="display:none"></span>
          <span class="bennu-status-dot" title="Checking service..."></span>
        </div>
        <div class="bennu-header-actions">
          <button class="bennu-btn" data-action="settings" title="Settings">&#x2699;</button>
          <button class="bennu-btn" data-action="save-log" title="Save log">&#x1f4be;</button>
          <button class="bennu-btn bennu-close-btn" data-action="close">&times;</button>
        </div>
      </div>
      <div class="bennu-tabs">
        <button class="bennu-tab" data-tab="log">Log</button>
        <button class="bennu-tab" data-tab="subtitle">Subtitles</button>
        <button class="bennu-tab" data-tab="summary">Summary</button>
        <button class="bennu-tab" data-tab="settings">Settings</button>
      </div>
      <div class="bennu-tab-content" data-content="log">
        <div class="bennu-log"></div>
      </div>
      <div class="bennu-tab-content" data-content="subtitle">
        <div class="bennu-lang-bar" style="display:none">
          <label class="bennu-lang-label">Language:</label>
          <select class="bennu-lang-select"></select>
        </div>
        <div class="bennu-empty">No subtitles yet. Click extract to start.</div>
        <div class="bennu-subtitle-list" style="display:none"></div>
      </div>
      <div class="bennu-tab-content" data-content="summary">
        <div class="bennu-summary-empty">Extract subtitles first, then click Summarize.</div>
        <div class="bennu-summary-setup" style="display:none">
          <div class="bennu-setup-title">Configure Claude Setup Token</div>
          <div class="bennu-setup-desc">
            To use AI summarization, you need a Claude setup token from your Claude subscription.<br>
            Run the following command in your terminal:
          </div>
          <div class="bennu-setup-cmd">
            <code>claude config get apiKey</code>
          </div>
          <div class="bennu-setup-desc">
            Copy the output (starts with <code>sk-ant-oat01-</code>) and paste it below.<br>
            <small>Requires <a href="https://docs.anthropic.com/en/docs/claude-code" target="_blank" class="bennu-setup-link">Claude Code CLI</a> installed and logged in with your Claude Pro/Max account.</small>
          </div>
          <input type="password" class="bennu-setup-input" placeholder="sk-ant-oat01-..." spellcheck="false" autocomplete="off">
          <div class="bennu-setup-error" style="display:none"></div>
          <div class="bennu-setup-actions">
            <button class="bennu-btn" data-action="save-token">Save &amp; Summarize</button>
            <button class="bennu-btn" data-action="cancel-setup">Cancel</button>
          </div>
        </div>
        <div class="bennu-summary-loading" style="display:none">Generating summary...</div>
        <div class="bennu-summary-text" style="display:none"></div>
        <div class="bennu-summary-actions" style="display:none">
          <button class="bennu-btn" data-action="summarize">Summarize</button>
          <button class="bennu-btn" data-action="copy-summary" style="display:none">Copy Summary</button>
          <button class="bennu-btn" data-action="regenerate" style="display:none">Regenerate</button>
        </div>
      </div>
      <div class="bennu-tab-content" data-content="settings">
        <div class="bennu-settings">
          <div class="bennu-settings-section">
            <div class="bennu-settings-section-title">Feishu Wiki</div>
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
              <div class="bennu-feishu-auth-status" style="font-size:12px;color:#999;flex:1">
                Checking...
              </div>
              <button class="bennu-btn bennu-feishu-logout-btn" style="font-size:11px;padding:2px 8px;display:none">Clear Auth</button>
            </div>
            <div class="bennu-wiki-config">
              <div class="bennu-wiki-mode-tabs" style="display:flex;gap:4px;margin-bottom:8px">
                <button class="bennu-btn bennu-wiki-mode-btn active" data-wiki-mode="existing" style="font-size:11px;padding:3px 10px;flex:1">Use Existing Wiki</button>
                <button class="bennu-btn bennu-wiki-mode-btn" data-wiki-mode="create" style="font-size:11px;padding:3px 10px;flex:1">Create New Wiki</button>
              </div>
              <div class="bennu-wiki-existing">
                <input type="text" class="bennu-settings-input bennu-wiki-root-node" placeholder="Paste wiki root page URL (e.g. https://xxx.feishu.cn/wiki/XxxXxx)" spellcheck="false" style="width:100%;font-size:12px;padding:4px 6px;border:1px solid #ddd;border-radius:4px">
                <div style="font-size:11px;color:#aaa;margin-top:2px">Paste the full URL of your wiki root page</div>
              </div>
              <div class="bennu-wiki-create" style="display:none">
                <input type="text" class="bennu-settings-input bennu-wiki-create-name" placeholder="Knowledge base name (e.g. My Video Notes)" spellcheck="false" style="width:100%;font-size:12px;padding:4px 6px;border:1px solid #ddd;border-radius:4px;margin-bottom:6px">
                <button class="bennu-btn bennu-wiki-create-btn" style="font-size:12px;padding:4px 12px;width:100%">Create Knowledge Base</button>
                <div class="bennu-wiki-create-status" style="font-size:11px;margin-top:4px;display:none"></div>
              </div>
            </div>
          </div>
          <div class="bennu-settings-section">
            <div class="bennu-settings-section-title">AI Provider <span style="font-weight:400;color:#aaa">(pick one)</span></div>
            <div class="bennu-provider-tabs">
              <button class="bennu-provider-tab active" data-provider="claude_setup_token">Setup Token</button>
              <button class="bennu-provider-tab" data-provider="claude_api">Claude API</button>
              <button class="bennu-provider-tab" data-provider="openai">OpenAI</button>
              <button class="bennu-provider-tab" data-provider="gemini">Gemini</button>
              <button class="bennu-provider-tab" data-provider="deepseek">DeepSeek</button>
            </div>
            <div class="bennu-provider-panel active" data-panel="claude_setup_token">
              <div class="bennu-secret-row" data-key="claudeSetupToken">
                <div class="bennu-secret-header">
                  <span class="bennu-secret-dot"></span>
                  <span class="bennu-secret-label">Setup Token</span>
                  <span class="bennu-secret-preview"></span>
                  <button class="bennu-btn bennu-secret-update">Update</button>
                  <button class="bennu-btn bennu-secret-clear">Clear</button>
                </div>
                <div class="bennu-secret-edit">
                  <input type="password" placeholder="sk-ant-oat01-...">
                  <button class="bennu-btn bennu-secret-save">OK</button>
                </div>
              </div>
              <select class="bennu-model-select" data-model-key="claudeModel">
                <option value="claude-haiku-4-5-20251001">Haiku 4.5 (fast)</option>
                <option value="claude-sonnet-4-6">Sonnet 4.6</option>
                <option value="claude-opus-4-6">Opus 4.6</option>
              </select>
              <details class="bennu-settings-guide">
                <summary>How to get a Setup Token</summary>
                <div class="bennu-guide-content">
                  <ol>
                    <li>Open a terminal and run: <code>claude setup-token</code></li>
                    <li>Copy the token (starts with <code>sk-ant-oat01-</code>) and paste it above.</li>
                  </ol>
                </div>
              </details>
            </div>
            <div class="bennu-provider-panel" data-panel="claude_api">
              <div class="bennu-secret-row" data-key="claudeApiKey">
                <div class="bennu-secret-header">
                  <span class="bennu-secret-dot"></span>
                  <span class="bennu-secret-label">API Key</span>
                  <span class="bennu-secret-preview"></span>
                  <button class="bennu-btn bennu-secret-update">Update</button>
                  <button class="bennu-btn bennu-secret-clear">Clear</button>
                </div>
                <div class="bennu-secret-edit">
                  <input type="password" placeholder="sk-ant-api03-...">
                  <button class="bennu-btn bennu-secret-save">OK</button>
                </div>
              </div>
              <select class="bennu-model-select" data-model-key="claudeApiModel">
                <option value="claude-haiku-4-5-20251001">Haiku 4.5 (fast)</option>
                <option value="claude-sonnet-4-6">Sonnet 4.6</option>
                <option value="claude-opus-4-6">Opus 4.6</option>
              </select>
              <details class="bennu-settings-guide">
                <summary>How to get a Claude API Key</summary>
                <div class="bennu-guide-content">
                  <ol>
                    <li>Go to <a href="https://console.anthropic.com/settings/keys" target="_blank">Anthropic Console</a>.</li>
                    <li>Create a new API key and paste it above.</li>
                  </ol>
                </div>
              </details>
            </div>
            <div class="bennu-provider-panel" data-panel="openai">
              <div class="bennu-secret-row" data-key="openaiApiKey">
                <div class="bennu-secret-header">
                  <span class="bennu-secret-dot"></span>
                  <span class="bennu-secret-label">API Key</span>
                  <span class="bennu-secret-preview"></span>
                  <button class="bennu-btn bennu-secret-update">Update</button>
                  <button class="bennu-btn bennu-secret-clear">Clear</button>
                </div>
                <div class="bennu-secret-edit">
                  <input type="password" placeholder="sk-...">
                  <button class="bennu-btn bennu-secret-save">OK</button>
                </div>
              </div>
              <select class="bennu-model-select" data-model-key="openaiModel">
                <option value="gpt-5.4">GPT-5.4 (recommended)</option>
                <option value="gpt-5.4-pro">GPT-5.4 Pro (strongest, Responses API only)</option>
                <option value="gpt-5.4-mini">GPT-5.4 mini (fast)</option>
                <option value="gpt-5.4-nano">GPT-5.4 nano (cheapest)</option>
              </select>
              <details class="bennu-settings-guide">
                <summary>How to get an OpenAI API Key</summary>
                <div class="bennu-guide-content">
                  <ol>
                    <li>Go to <a href="https://platform.openai.com/api-keys" target="_blank">OpenAI Platform</a>.</li>
                    <li>Create a new API key and paste it above.</li>
                  </ol>
                </div>
              </details>
            </div>
            <div class="bennu-provider-panel" data-panel="gemini">
              <div class="bennu-secret-row" data-key="geminiApiKey">
                <div class="bennu-secret-header">
                  <span class="bennu-secret-dot"></span>
                  <span class="bennu-secret-label">API Key</span>
                  <span class="bennu-secret-preview"></span>
                  <button class="bennu-btn bennu-secret-update">Update</button>
                  <button class="bennu-btn bennu-secret-clear">Clear</button>
                </div>
                <div class="bennu-secret-edit">
                  <input type="password" placeholder="AIza...">
                  <button class="bennu-btn bennu-secret-save">OK</button>
                </div>
              </div>
              <select class="bennu-model-select" data-model-key="geminiModel">
                <option value="gemini-2.5-flash">Gemini 2.5 Flash (fast)</option>
                <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
              </select>
              <details class="bennu-settings-guide">
                <summary>How to get a Gemini API Key</summary>
                <div class="bennu-guide-content">
                  <ol>
                    <li>Go to <a href="https://aistudio.google.com/apikey" target="_blank">Google AI Studio</a>.</li>
                    <li>Create a new API key and paste it above.</li>
                  </ol>
                </div>
              </details>
            </div>
            <div class="bennu-provider-panel" data-panel="deepseek">
              <div class="bennu-secret-row" data-key="deepseekApiKey">
                <div class="bennu-secret-header">
                  <span class="bennu-secret-dot"></span>
                  <span class="bennu-secret-label">API Key</span>
                  <span class="bennu-secret-preview"></span>
                  <button class="bennu-btn bennu-secret-update">Update</button>
                  <button class="bennu-btn bennu-secret-clear">Clear</button>
                </div>
                <div class="bennu-secret-edit">
                  <input type="password" placeholder="sk-...">
                  <button class="bennu-btn bennu-secret-save">OK</button>
                </div>
              </div>
              <select class="bennu-model-select" data-model-key="deepseekModel">
                <option value="deepseek-chat">DeepSeek Chat (V3)</option>
                <option value="deepseek-reasoner">DeepSeek Reasoner (R1)</option>
              </select>
              <details class="bennu-settings-guide">
                <summary>How to get a DeepSeek API Key</summary>
                <div class="bennu-guide-content">
                  <ol>
                    <li>Go to <a href="https://platform.deepseek.com/api_keys" target="_blank">DeepSeek Platform</a>.</li>
                    <li>Create a new API key and paste it above.</li>
                  </ol>
                </div>
              </details>
            </div>
          </div>
          <div class="bennu-settings-section">
            <div class="bennu-settings-section-title">Other</div>
            <label class="bennu-settings-label">Max Tokens (AI output length)</label>
            <input type="number" class="bennu-settings-input" data-setting="maxTokens" placeholder="4096" min="256" max="32768" step="256">
            <label class="bennu-settings-label">Bilibili Cookie (optional)</label>
            <input type="text" class="bennu-settings-input" data-setting="bilibiliCookie" placeholder="SESSDATA=xxxxx">
            <label class="bennu-settings-label">Whisper Model (backend transcription)</label>
            <select class="bennu-settings-select" data-setting="whisperModelSize">
              <option value="tiny">Tiny</option>
              <option value="base">Base</option>
              <option value="small">Small (default)</option>
              <option value="medium">Medium</option>
              <option value="large">Large</option>
            </select>
          </div>
          <button class="bennu-btn bennu-settings-save">Save</button>
          <div class="bennu-settings-toast" style="display:none">Saved!</div>
        </div>
      </div>
      <div class="bennu-footer" style="display:none">
        <div class="bennu-wiki-doc-input">
          <input type="text" class="bennu-settings-input bennu-wiki-doc-link" placeholder="飞书文档链接（留空则新建）" spellcheck="false">
        </div>
        <div class="bennu-footer-buttons">
          <button class="bennu-btn" data-action="copy">Copy Text</button>
          <button class="bennu-btn" data-action="download">Download</button>
          <button class="bennu-btn bennu-feishu-btn" data-action="sync-feishu">Sync to Feishu</button>
        </div>
      </div>
      <div class="bennu-feishu-link" style="display:none">
        <a class="bennu-feishu-url" href="#" target="_blank">Open in Feishu</a>
      </div>
    `;

    this.shadow.appendChild(panel);
    this.panelEl = panel;

    this.logEl = panel.querySelector('.bennu-log')!;
    this.listEl = panel.querySelector('.bennu-subtitle-list')!;
    this.sourceBadge = panel.querySelector('.bennu-source-badge')!;
    this.footerEl = panel.querySelector('.bennu-footer')!;
    this.emptyEl = panel.querySelector('.bennu-empty')!;

    this.tabLog = panel.querySelector('[data-tab="log"]')!;
    this.tabSubtitle = panel.querySelector('[data-tab="subtitle"]')!;
    this.tabSummary = panel.querySelector('[data-tab="summary"]')!;
    this.tabSettings = panel.querySelector('[data-tab="settings"]')!;
    this.contentLog = panel.querySelector('[data-content="log"]')!;
    this.contentSubtitle = panel.querySelector('[data-content="subtitle"]')!;
    this.contentSummary = panel.querySelector('[data-content="summary"]')!;
    this.contentSettings = panel.querySelector('[data-content="settings"]')!;
    this.summaryEmptyEl = panel.querySelector('.bennu-summary-empty')!;
    this.summarySetupEl = panel.querySelector('.bennu-summary-setup')!;
    this.summaryLoadingEl = panel.querySelector('.bennu-summary-loading')!;
    this.summaryTextEl = panel.querySelector('.bennu-summary-text')!;
    this.summaryActionsEl = panel.querySelector('.bennu-summary-actions')!;
    this.langSelect = panel.querySelector('.bennu-lang-select')!;
    this.langBar = panel.querySelector('.bennu-lang-bar')!;
    this.feishuLink = panel.querySelector('.bennu-feishu-link')!;
    this.feishuUrl = panel.querySelector('.bennu-feishu-url')!;

    // Language change handler
    this.langSelect.addEventListener('change', () => {
      const idx = this.langSelect.selectedIndex;
      const tracks = (this.langSelect as unknown as { _tracks?: SubtitleTrack[] })._tracks;
      if (tracks && tracks[idx] && this.onTrackChange) {
        this.onTrackChange(tracks[idx]);
      }
    });

    // Default: show log tab
    this.switchTab('log');

    // Settings tab: provider tab switching
    this.contentSettings.querySelectorAll<HTMLElement>('.bennu-provider-tab').forEach((tab) => {
      tab.addEventListener('click', (e) => {
        e.stopPropagation();
        const p = tab.dataset.provider!;
        this.contentSettings.querySelectorAll<HTMLElement>('.bennu-provider-tab').forEach(
          (t) => t.classList.toggle('active', t.dataset.provider === p)
        );
        this.contentSettings.querySelectorAll<HTMLElement>('.bennu-provider-panel').forEach(
          (panel) => panel.classList.toggle('active', panel.dataset.panel === p)
        );
        this.saveToLocal('aiProvider', p);
      });
    });

    // Settings tab: wire up model selects
    this.contentSettings.querySelectorAll<HTMLSelectElement>('.bennu-model-select').forEach((sel) => {
      sel.addEventListener('change', () => {
        this.saveToLocal(sel.dataset.modelKey!, sel.value);
      });
    });

    // --- Feishu Wiki settings wiring ---
    const authStatusEl = panel.querySelector('.bennu-feishu-auth-status') as HTMLElement;
    const logoutBtn = panel.querySelector('.bennu-feishu-logout-btn') as HTMLButtonElement;
    const wikiRootInput = panel.querySelector<HTMLInputElement>('.bennu-wiki-root-node');
    const wikiExistingDiv = panel.querySelector('.bennu-wiki-existing') as HTMLElement;
    const wikiCreateDiv = panel.querySelector('.bennu-wiki-create') as HTMLElement;
    const wikiCreateNameInput = panel.querySelector<HTMLInputElement>('.bennu-wiki-create-name');
    const wikiCreateBtn = panel.querySelector('.bennu-wiki-create-btn') as HTMLButtonElement;
    const wikiCreateStatus = panel.querySelector('.bennu-wiki-create-status') as HTMLElement;

    // Auth status check
    const refreshAuthStatus = () => {
      fetch('http://localhost:2185/feishu/auth/status', { signal: AbortSignal.timeout(3000) })
        .then(r => r.json())
        .then(data => {
          if (data.tokenStatus === 'valid') {
            authStatusEl.textContent = `✓ ${data.userName || 'Authenticated'}`;
            authStatusEl.style.color = '#4caf50';
            logoutBtn.style.display = '';
          } else {
            authStatusEl.textContent = '✗ Not authenticated — run ./start-server.sh';
            authStatusEl.style.color = '#f44336';
            logoutBtn.style.display = 'none';
          }
        })
        .catch(() => {
          authStatusEl.textContent = '✗ Server offline';
          authStatusEl.style.color = '#f44336';
          logoutBtn.style.display = 'none';
        });
    };
    refreshAuthStatus();

    // Logout button
    logoutBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      fetch('http://localhost:2185/feishu/auth/logout', { method: 'POST' })
        .then(() => refreshAuthStatus())
        .catch(() => refreshAuthStatus());
    });

    // Wiki mode tabs (existing vs create)
    panel.querySelectorAll<HTMLElement>('.bennu-wiki-mode-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const mode = btn.dataset.wikiMode;
        panel.querySelectorAll<HTMLElement>('.bennu-wiki-mode-btn').forEach(
          (b) => b.classList.toggle('active', b.dataset.wikiMode === mode)
        );
        wikiExistingDiv.style.display = mode === 'existing' ? '' : 'none';
        wikiCreateDiv.style.display = mode === 'create' ? '' : 'none';
      });
    });

    // Wiki root node: load from storage and save on change (accepts full URL)
    if (wikiRootInput) {
      chrome.storage.local.get('bennunote_config', (data) => {
        const config = (data.bennunote_config || {}) as Record<string, string>;
        wikiRootInput.value = config.feishuWikiRootNodeToken || '';
      });
      wikiRootInput.addEventListener('change', () => {
        const raw = wikiRootInput.value.trim();
        const token = this.parseDocToken(raw);
        this.saveToLocal('feishuWikiRootNodeToken', token || raw);
      });
    }

    // Create new wiki
    if (wikiCreateBtn) {
      wikiCreateBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const name = wikiCreateNameInput?.value.trim() || 'BennuNote';
        wikiCreateBtn.disabled = true;
        wikiCreateBtn.textContent = 'Creating...';
        wikiCreateStatus.style.display = '';
        wikiCreateStatus.style.color = '#999';
        wikiCreateStatus.textContent = 'Creating wiki space...';
        try {
          // 1. Create wiki space
          const spaceResp = await fetch('http://localhost:2185/feishu/wiki/spaces/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
          });
          const spaceData = await spaceResp.json();
          const spaceId = spaceData?.data?.space?.space_id || spaceData?.space_id || '';
          if (!spaceId) throw new Error(spaceData?.detail || 'Failed to create wiki space');

          wikiCreateStatus.textContent = 'Creating root document...';

          // 2. Create root doc with template content
          const rootMarkdown = `# 🌌 ${name}
<callout emoji="ringed_planet" background-color="light-orange" border-color="light-orange">
欢迎来到 **${name}**！本空间是 BennuNote Chrome 扩展所生成的视频字幕与 AI 总结的统一归档中心
</callout>

---

## 🎯 愿景和目标
将 Bilibili 等视频平台上的知识内容，通过自动字幕提取与 AI 总结，沉淀为可检索、可回顾的结构化文档，让「看过的视频」不再遗忘。
## 📂 知识库结构
本节点是知识库的**总起节点（目录页）**，起到索引与导航的作用。子节点按视频组织，每篇文档通常包含：
- **视频基本信息** — 标题、UP主、BV号、链接
- **完整字幕文本** — 由 BennuNote 自动提取（Bilibili API / Bcut ASR / Whisper 多级降级）
- **AI 总结** — 由 Claude 生成的结构化摘要
## ⚙️ 工作流程
1. 在 Bilibili 视频页面点击 BennuNote 扩展的「提取字幕」按钮
1. 扩展自动获取字幕（优先官方字幕 → Bcut ASR → Whisper 转录）
1. 点击「AI 总结」生成结构化摘要
1. 点击「同步到飞书」将字幕与总结写入本知识库
## 🔗 相关链接
- [BennuNote 项目仓库](https://github.com) — 扩展源码与开发文档
- [Transcript 使用说明](https://github.com) — 安装配置与使用指南


# 📖 知识空间目录

`;
          const docResp = await fetch('http://localhost:2185/feishu/docs/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              markdown: rootMarkdown,
              title: name,
              wiki_space: spaceId,
            }),
          });
          const docData = await docResp.json();
          const docUrl = docData?.data?.doc_url || docData?.doc_url || '';
          const nodeToken = this.parseDocToken(docUrl);

          if (nodeToken) {
            this.saveToLocal('feishuWikiRootNodeToken', nodeToken);
            if (wikiRootInput) wikiRootInput.value = nodeToken;
          }

          wikiCreateStatus.style.color = '#4caf50';
          wikiCreateStatus.innerHTML = docUrl
            ? `✓ Created! <a href="${docUrl}" target="_blank" style="color:#00a1d6">Open in Feishu →</a>`
            : '✓ Created!';

          if (docUrl) window.open(docUrl, '_blank');

          // Switch to existing mode to show the token
          panel.querySelectorAll<HTMLElement>('.bennu-wiki-mode-btn').forEach(
            (b) => b.classList.toggle('active', b.dataset.wikiMode === 'existing')
          );
          wikiExistingDiv.style.display = '';
          wikiCreateDiv.style.display = 'none';
        } catch (err) {
          wikiCreateStatus.style.color = '#f44336';
          wikiCreateStatus.textContent = `✗ ${err}`;
        } finally {
          wikiCreateBtn.disabled = false;
          wikiCreateBtn.textContent = 'Create Knowledge Base';
        }
      });
    }

    // Settings tab: wire up secret row buttons (all local storage)
    this.contentSettings.querySelectorAll<HTMLElement>('.bennu-secret-row').forEach((row) => {
      const key = row.dataset.key!; // camelCase config key
      const editDiv = row.querySelector<HTMLElement>('.bennu-secret-edit')!;
      const input = editDiv.querySelector<HTMLInputElement>('input')!;
      const btnUpdate = row.querySelector<HTMLButtonElement>('.bennu-secret-update')!;
      const btnClear = row.querySelector<HTMLButtonElement>('.bennu-secret-clear')!;
      const btnSave = editDiv.querySelector<HTMLButtonElement>('.bennu-secret-save')!;

      btnUpdate.addEventListener('click', (e) => { e.stopPropagation(); input.value = ''; editDiv.style.display = 'flex'; input.focus(); });
      btnSave.addEventListener('click', (e) => {
        e.stopPropagation();
        const val = input.value.trim();
        if (!val) return;
        this.saveToLocal(key, val);
        editDiv.style.display = 'none';
        this.refreshSecretStatus();
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') btnSave.click();
        if (e.key === 'Escape') { editDiv.style.display = 'none'; }
      });
      btnClear.addEventListener('click', (e) => {
        e.stopPropagation();
        this.saveToLocal(key, '');
        this.refreshSecretStatus();
      });
    });

    // Settings tab: save button saves all visible form fields
    const saveBtn = this.contentSettings.querySelector<HTMLButtonElement>('.bennu-settings-save')!;
    saveBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const getValue = (setting: string) => {
        const el = this.contentSettings.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-setting="${setting}"]`);
        return el?.value.trim() || '';
      };
      chrome.storage.local.get('bennunote_config', (data) => {
        const config = {
          ...(data.bennunote_config || {}),
          bilibiliCookie: getValue('bilibiliCookie'),
          whisperModelSize: getValue('whisperModelSize'),
          maxTokens: parseInt(getValue('maxTokens'), 10) || 4096,
        };
        chrome.storage.local.set({ bennunote_config: config }, () => {
          const toast = this.contentSettings.querySelector<HTMLElement>('.bennu-settings-toast')!;
          toast.style.display = '';
          setTimeout(() => (toast.style.display = 'none'), 1500);
        });
      });
    });

    // Event delegation
    panel.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;

      // Tab switching
      const tab = target.closest('[data-tab]')?.getAttribute('data-tab');
      if (tab) {
        this.switchTab(tab as 'log' | 'subtitle' | 'summary' | 'settings');
        return;
      }

      const action = target.closest('[data-action]')?.getAttribute('data-action');
      if (action === 'close') this.hide();
      else if (action === 'save-log') this.saveLog();
      else if (action === 'copy') this.copyText();
      else if (action === 'download') this.downloadMarkdown();
      else if (action === 'sync-feishu') this.onSyncFeishu?.();
      else if (action === 'settings') this.switchTab('settings');
      else if (action === 'summarize') this.onSummarize?.();
      else if (action === 'copy-summary') this.copySummary();
      else if (action === 'regenerate') this.onSummarize?.();
      else if (action === 'save-token') this.handleSaveToken();
      else if (action === 'cancel-setup') this.hideSetupForm();

      // Scope copy button
      if (target.closest('.bennu-scope-copy')) {
        const box = target.closest('.bennu-scope-box-wrapper')?.querySelector('.bennu-scope-box');
        if (box) {
          navigator.clipboard.writeText(box.textContent || '').then(() => {
            const btn = target.closest('.bennu-scope-copy') as HTMLElement;
            const orig = btn.textContent;
            btn.textContent = 'Copied!';
            setTimeout(() => { btn.textContent = orig; }, 1500);
          });
        }
        return;
      }

      const item = target.closest('.bennu-subtitle-item') as HTMLElement | null;
      if (item?.dataset.time) {
        this.seekTo(parseFloat(item.dataset.time));
      }
    });
  }

  private switchTab(tab: 'log' | 'subtitle' | 'summary' | 'settings') {
    this.tabLog.classList.toggle('active', tab === 'log');
    this.tabSubtitle.classList.toggle('active', tab === 'subtitle');
    this.tabSummary.classList.toggle('active', tab === 'summary');
    this.tabSettings.classList.toggle('active', tab === 'settings');
    this.contentLog.classList.toggle('active', tab === 'log');
    this.contentSubtitle.classList.toggle('active', tab === 'subtitle');
    this.contentSummary.classList.toggle('active', tab === 'summary');
    this.contentSettings.classList.toggle('active', tab === 'settings');
    // Show footer only when subtitle tab is active and has items
    this.footerEl.style.display = (tab === 'subtitle' && this.items.length > 0) ? '' : 'none';
    // Load settings when switching to settings tab
    if (tab === 'settings') this.loadSettings();
  }

  private saveToLocal(key: string, value: string) {
    chrome.storage.local.get('bennunote_config', (data) => {
      const config = { ...(data.bennunote_config || {}), [key]: value };
      chrome.storage.local.set({ bennunote_config: config });
    });
  }

  private loadSettings() {
    chrome.storage.local.get('bennunote_config', (data) => {
      const config = { ...(data.bennunote_config || {}) } as Record<string, string>;

      // Restore form fields
      const set = (setting: string, val: string) => {
        const el = this.contentSettings.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-setting="${setting}"]`);
        if (el) el.value = val || '';
      };
      set('bilibiliCookie', config.bilibiliCookie || '');
      set('maxTokens', String(config.maxTokens || 4096));
      set('whisperModelSize', config.whisperModelSize || 'small');

      // Restore model selects
      this.contentSettings.querySelectorAll<HTMLSelectElement>('.bennu-model-select').forEach((sel) => {
        const saved = config[sel.dataset.modelKey!];
        if (saved) sel.value = saved;
      });

      // Restore active provider tab
      const provider = config.aiProvider;
      if (provider) {
        this.contentSettings.querySelectorAll<HTMLElement>('.bennu-provider-tab').forEach(
          (t) => t.classList.toggle('active', t.dataset.provider === provider)
        );
        this.contentSettings.querySelectorAll<HTMLElement>('.bennu-provider-panel').forEach(
          (p) => p.classList.toggle('active', p.dataset.panel === provider)
        );
      }

      // Update secret status dots
      this.refreshSecretStatusFromConfig(config);
    });
  }

  private refreshSecretStatus() {
    chrome.storage.local.get('bennunote_config', (data) => {
      this.refreshSecretStatusFromConfig({ ...(data.bennunote_config || {}) } as Record<string, string>);
    });
  }

  private refreshSecretStatusFromConfig(config: Record<string, string>) {
    this.contentSettings.querySelectorAll<HTMLElement>('.bennu-secret-row').forEach((row) => {
      const key = row.dataset.key!;
      const dot = row.querySelector<HTMLElement>('.bennu-secret-dot')!;
      const preview = row.querySelector<HTMLElement>('.bennu-secret-preview')!;
      const val = config[key] || '';
      if (val) {
        dot.classList.add('set');
        preview.textContent = val.length > 4 ? val.substring(0, 4) + '***' : '***';
      } else {
        dot.classList.remove('set');
        preview.textContent = 'not set';
      }
    });
  }

  /** Get the target doc token from the wiki doc link input in the footer. */
  getWikiDocLink(): string {
    const input = this.footerEl.querySelector<HTMLInputElement>('.bennu-wiki-doc-link');
    return this.parseDocToken(input?.value.trim() || '');
  }

  show() {
    this.panelEl.classList.remove('hidden');
  }

  hide() {
    this.panelEl.classList.add('hidden');
  }

  toggle() {
    this.panelEl.classList.toggle('hidden');
  }

  log(message: string, level: LogLevel = 'info') {
    const ts = nowStr();
    const line = `[${ts}] [${level.toUpperCase()}] ${message}`;
    this.logLines.push(line);

    const entry = document.createElement('div');
    entry.className = 'bennu-log-entry';
    const time = document.createElement('span');
    time.className = 'bennu-log-time';
    time.textContent = ts;
    const text = document.createElement('span');
    text.className = `bennu-log-${level}`;
    text.textContent = message;
    entry.appendChild(time);
    entry.appendChild(text);
    this.logEl.appendChild(entry);
    this.logEl.scrollTop = this.logEl.scrollHeight;

    // Debounced persist to chrome.storage.local (1s)
    this.schedulePersist();
  }

  private static hourKey(): string {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `log_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}`;
  }

  private schedulePersist() {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      const key = SubtitlePanel.hourKey();
      if (key !== this.logHourKey) {
        // Hour rolled over — start fresh for new key
        this.logHourKey = key;
      }
      try {
        chrome.storage?.local?.set({ [key]: this.logLines.join('\n') });
        this.cleanOldLogs();
      } catch { /* storage not available */ }
    }, 1000);
  }

  private cleanOldLogs() {
    try {
      chrome.storage?.local?.get(null, (all) => {
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        const stale = Object.keys(all).filter((k) => {
          if (!k.startsWith('log_')) return false;
          // parse "log_YYYY-MM-DD-HH"
          const m = k.match(/^log_(\d{4})-(\d{2})-(\d{2})-(\d{2})$/);
          if (!m) return false;
          const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4]);
          return d.getTime() < cutoff;
        });
        if (stale.length) chrome.storage.local.remove(stale);
      });
    } catch { /* ignore */ }
  }

  private saveLog() {
    const key = SubtitlePanel.hourKey();
    const content = this.logLines.join('\n');
    const filename = `${key.replace('log_', 'bennunote-')}.txt`;
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    this.log('Log saved to file', 'success');
  }

  /**
   * Populate the language dropdown with available tracks.
   * Highlights the currently active track.
   */
  setTracks(tracks: SubtitleTrack[], activeLan: string, onChange: (track: SubtitleTrack) => void) {
    this.onTrackChange = onChange;
    (this.langSelect as unknown as { _tracks?: SubtitleTrack[] })._tracks = tracks;

    this.langSelect.innerHTML = tracks
      .map((t) => {
        const selected = t.lan === activeLan ? ' selected' : '';
        return `<option value="${t.lan}"${selected}>${t.lan_doc} (${t.lan})</option>`;
      })
      .join('');

    this.langBar.style.display = tracks.length > 1 ? '' : 'none';
  }

  setSubtitles(items: SubtitleItem[], source: SubtitleSource) {
    this.items = items;
    this.mergedItems = mergeSegments(items);
    this.emptyEl.style.display = 'none';
    this.listEl.style.display = '';

    const sourceLabels: Record<SubtitleSource, string> = {
      ai: 'AI Subtitle',
      cc: 'CC Subtitle',
      whisper: 'Whisper',
      bcut_asr: 'Bcut ASR',
      yt_cc: 'YouTube CC',
      yt_auto: 'YouTube Auto',
    };
    this.sourceBadge.textContent = sourceLabels[source];
    this.sourceBadge.style.display = '';

    this.listEl.innerHTML = this.mergedItems
      .map(
        (item) => `
        <div class="bennu-subtitle-item" data-time="${item.from}">
          <span class="bennu-time">${formatTime(item.from)}</span>
          <span class="bennu-text">${this.escapeHtml(item.content)}</span>
        </div>
      `
      )
      .join('');

    this.log(`Loaded ${items.length} subtitle entries → ${this.mergedItems.length} paragraphs (${sourceLabels[source]})`, 'success');

    // Show summarize button and reset previous summary
    this.showSummarizeButton();

    // Auto-switch to subtitle tab
    this.switchTab('subtitle');
  }

  private showSummarizeButton() {
    this.summaryEmptyEl.style.display = 'none';
    this.summaryLoadingEl.style.display = 'none';
    this.summaryTextEl.style.display = 'none';
    this.summaryTextEl.innerHTML = '';
    this.summaryActionsEl.style.display = '';
    const summarizeBtn = this.summaryActionsEl.querySelector('[data-action="summarize"]') as HTMLElement;
    const copyBtn = this.summaryActionsEl.querySelector('[data-action="copy-summary"]') as HTMLElement;
    if (summarizeBtn) {
      summarizeBtn.style.display = '';
      (summarizeBtn as HTMLButtonElement).disabled = false;
      summarizeBtn.textContent = 'Summarize';
    }
    if (copyBtn) copyBtn.style.display = 'none';
  }

  setSummarizeHandler(handler: () => void) {
    this.onSummarize = handler;
  }

  /** Show inline token setup form when no token is configured. */
  showSetupForm() {
    this.summaryEmptyEl.style.display = 'none';
    this.summaryLoadingEl.style.display = 'none';
    this.summaryTextEl.style.display = 'none';
    this.summaryActionsEl.style.display = 'none';
    this.summarySetupEl.style.display = '';
    const input = this.summarySetupEl.querySelector('.bennu-setup-input') as HTMLInputElement;
    if (input) {
      input.value = '';
      input.focus();
    }
    const errorEl = this.summarySetupEl.querySelector('.bennu-setup-error') as HTMLElement;
    if (errorEl) errorEl.style.display = 'none';
    this.switchTab('summary');
  }

  private hideSetupForm() {
    this.summarySetupEl.style.display = 'none';
    if (this.items.length > 0) {
      this.showSummarizeButton();
    } else {
      this.summaryEmptyEl.style.display = '';
    }
  }

  private handleSaveToken() {
    const input = this.summarySetupEl.querySelector('.bennu-setup-input') as HTMLInputElement;
    const errorEl = this.summarySetupEl.querySelector('.bennu-setup-error') as HTMLElement;
    const token = input?.value.replace(/\s+/g, '').trim() || '';

    if (!token) {
      if (errorEl) { errorEl.textContent = 'Token is required'; errorEl.style.display = ''; }
      return;
    }
    if (!token.startsWith('sk-ant-')) {
      if (errorEl) { errorEl.textContent = 'Token must start with sk-ant-'; errorEl.style.display = ''; }
      return;
    }
    if (token.length < 40) {
      if (errorEl) { errorEl.textContent = 'Token looks too short, paste the full token'; errorEl.style.display = ''; }
      return;
    }

    // Save token to server config + local storage
    this.saveToLocal('claudeSetupToken', token);
    this.saveToLocal('aiProvider', 'claude_setup_token');
    fetch('http://localhost:2185/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claude_setup_token: token, ai_provider: 'claude_setup_token' }),
    }).catch(() => {});
    this.log('Claude Setup Token saved', 'success');
    this.hideSetupForm();
    this.showSummarizeButton();
    this.onSummarize?.();
  }

  setSummarizing(loading: boolean) {
    const summarizeBtn = this.summaryActionsEl.querySelector('[data-action="summarize"]') as HTMLButtonElement;
    if (loading) {
      this.summaryEmptyEl.style.display = 'none';
      this.summaryTextEl.style.display = 'none';
      this.summaryLoadingEl.style.display = '';
      if (summarizeBtn) {
        summarizeBtn.disabled = true;
        summarizeBtn.textContent = 'Summarizing...';
      }
    } else {
      this.summaryLoadingEl.style.display = 'none';
      if (summarizeBtn) {
        summarizeBtn.disabled = false;
        summarizeBtn.textContent = 'Summarize';
      }
    }
  }

  setSummary(text: string) {
    this.summaryLoadingEl.style.display = 'none';
    this.summaryEmptyEl.style.display = 'none';
    this.summaryTextEl.style.display = '';
    this.summaryTextEl.innerHTML = text
      .split('\n\n')
      .map((p) => `<p>${this.escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
      .join('');

    // Show copy + regenerate buttons, hide summarize button
    const summarizeBtn = this.summaryActionsEl.querySelector('[data-action="summarize"]') as HTMLElement;
    const copyBtn = this.summaryActionsEl.querySelector('[data-action="copy-summary"]') as HTMLElement;
    const regenBtn = this.summaryActionsEl.querySelector('[data-action="regenerate"]') as HTMLElement;
    if (summarizeBtn) summarizeBtn.style.display = 'none';
    if (copyBtn) copyBtn.style.display = '';
    if (regenBtn) regenBtn.style.display = '';
    this.summaryActionsEl.style.display = '';

    // Auto-switch to summary tab
    this.switchTab('summary');
  }

  private copySummary() {
    const text = this.summaryTextEl.innerText;
    navigator.clipboard.writeText(text);
    const copyBtn = this.summaryActionsEl.querySelector('[data-action="copy-summary"]') as HTMLElement;
    if (copyBtn) {
      const orig = copyBtn.textContent;
      copyBtn.textContent = 'Copied!';
      setTimeout(() => (copyBtn.textContent = orig), 1500);
    }
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  private seekTo(seconds: number) {
    const video = document.querySelector('video');
    if (video) {
      video.currentTime = seconds;
      video.play();
    }
  }

  getMergedItems(): SubtitleItem[] {
    return this.mergedItems;
  }

  private getPlainText(): string {
    return this.mergedItems
      .map((item) => `[${formatTime(item.from)}] ${item.content}`)
      .join('\n\n');
  }

  private copyText() {
    navigator.clipboard.writeText(this.getPlainText());
    const copyBtn = this.shadow.querySelector('[data-action="copy"]') as HTMLElement;
    const orig = copyBtn.textContent;
    copyBtn.textContent = 'Copied!';
    setTimeout(() => (copyBtn.textContent = orig), 1500);
  }

  private buildFeishuMarkdown(): string {
    const vi = this.videoInfo;
    const title = vi?.title || 'Untitled';
    const lines: string[] = [`# ${title}`];

    // Cover image
    if (vi?.coverUrl) {
      const url = vi.coverUrl.startsWith('//') ? `https:${vi.coverUrl}` : vi.coverUrl;
      lines.push(`![cover](${url})`);
    }

    // Info table
    const infoRows: [string, string][] = [];
    if (vi?.ownerName) {
      const ownerCell = vi.ownerMid
        ? `[${vi.ownerName}](https://space.bilibili.com/${vi.ownerMid})`
        : vi.ownerName;
      infoRows.push(['Up主', ownerCell]);
    }
    if (vi?.bvid) {
      infoRows.push(['链接', `https://www.bilibili.com/video/${vi.bvid}`]);
    } else if (vi?.platform === 'youtube' && vi.youtubeVideoId) {
      infoRows.push(['链接', `https://www.youtube.com/watch?v=${vi.youtubeVideoId}`]);
    }
    if (vi?.pubdate) {
      const dt = new Date(vi.pubdate * 1000);
      const pad = (n: number) => n.toString().padStart(2, '0');
      const dateStr = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
      infoRows.push(['发布时间', dateStr]);
    }
    if (vi?.desc) {
      infoRows.push(['简介', vi.desc]);
    }

    if (infoRows.length > 0) {
      lines.push('', '## 主要信息', '', '| | |', '|---|---|');
      for (const [label, value] of infoRows) {
        lines.push(`| ${label} | ${value} |`);
      }
    }

    // Subtitle table
    if (this.mergedItems.length > 0) {
      lines.push('', '## 字幕', '', '| 时间 | 内容 |', '|---|---|');
      for (const item of this.mergedItems) {
        const total = Math.floor(item.from);
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        const time = h > 0
          ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
          : `${m}:${s.toString().padStart(2, '0')}`;
        lines.push(`| ${time} | ${item.content} |`);
      }
    }

    lines.push('');
    return lines.join('\n');
  }

  private async downloadMarkdown() {
    if (this.mergedItems.length === 0) return;

    const btn = this.shadow.querySelector('[data-action="download"]') as HTMLButtonElement;
    const origText = btn.textContent;
    btn.textContent = 'Saving...';
    btn.disabled = true;

    try {
      const videoTitle = this.videoInfo?.title || 'subtitle';
      const safeTitle = videoTitle.replace(/[/\\:*?"<>|]/g, '_');
      const date = new Date().toLocaleDateString('zh-CN');
      const filename = `${safeTitle} - ${date}.md`;
      const content = this.buildFeishuMarkdown();

      // showSaveFilePicker: works with all folders (including Downloads),
      // and the browser automatically remembers the last used directory.
      const fileHandle = await (window as any).showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md'] } }],
      });
      const writable = await fileHandle.createWritable();
      await writable.write(content);
      await writable.close();

      btn.textContent = 'Saved!';
      setTimeout(() => { btn.textContent = origText; btn.disabled = false; }, 1500);
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        btn.textContent = origText;
        btn.disabled = false;
        return;
      }
      btn.textContent = 'Failed';
      setTimeout(() => { btn.textContent = origText; btn.disabled = false; }, 1500);
    }
  }

  setServiceStatus(online: boolean) {
    const dot = this.shadow.querySelector('.bennu-status-dot') as HTMLElement;
    if (dot) {
      dot.style.background = online ? '#4caf50' : '#f44336';
      dot.title = online ? 'Backend online' : 'Backend offline';
    }
  }

  setVideoInfo(info: VideoInfo) {
    this.videoInfo = info;
  }

  setSyncHandler(handler: () => void) {
    this.onSyncFeishu = handler;
  }

  private parseDocToken(input: string): string {
    input = input.trim();
    if (!input) return '';
    // Try to extract token from Feishu/Lark document URLs
    // Patterns: https://xxx.larkoffice.com/docx/TOKEN, https://xxx.feishu.cn/docx/TOKEN
    const urlMatch = input.match(/(?:larkoffice\.com|feishu\.cn|larksuite\.com)\/(?:docx|wiki|docs)\/([A-Za-z0-9]+)/);
    if (urlMatch) return urlMatch[1];
    // If it looks like a plain token (no slashes), use as-is
    if (!input.includes('/')) return input;
    return '';
  }

  showFeishuLink(url: string) {
    this.feishuUrl.href = url;
    this.feishuUrl.textContent = 'Open in Feishu →';
    this.feishuLink.style.display = '';
  }

  setFeishuSyncing(syncing: boolean) {
    const btn = this.shadow.querySelector('.bennu-feishu-btn') as HTMLButtonElement;
    if (btn) {
      btn.textContent = syncing ? 'Syncing...' : 'Sync to Feishu';
      btn.disabled = syncing;
    }
  }

  destroy() {
    this.container.remove();
  }
}
