import type { SubtitleItem, SubtitleSource, SubtitleTrack } from '../shared/types';
import cssText from './subtitle-panel.css?inline';

type LogLevel = 'info' | 'success' | 'warn' | 'error' | 'step';

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatSrtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
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
  private autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private feishuLink!: HTMLElement;
  private feishuUrl!: HTMLAnchorElement;
  private feishuSetupEl!: HTMLElement;
  private onSyncFeishu: (() => void) | null = null;
  private onSummarize: (() => void) | null = null;

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
            <div class="bennu-settings-section-title">Feishu / Lark</div>
            <div class="bennu-secret-row" data-key="feishuAppId">
              <div class="bennu-secret-header">
                <span class="bennu-secret-dot"></span>
                <span class="bennu-secret-label">App ID</span>
                <span class="bennu-secret-preview"></span>
                <button class="bennu-btn bennu-secret-update">Update</button>
                <button class="bennu-btn bennu-secret-clear">Clear</button>
              </div>
              <div class="bennu-secret-edit">
                <input type="text" placeholder="cli_xxxxxxxx">
                <button class="bennu-btn bennu-secret-save">OK</button>
              </div>
            </div>
            <div class="bennu-secret-row" data-key="feishuAppSecret">
              <div class="bennu-secret-header">
                <span class="bennu-secret-dot"></span>
                <span class="bennu-secret-label">App Secret</span>
                <span class="bennu-secret-preview"></span>
                <button class="bennu-btn bennu-secret-update">Update</button>
                <button class="bennu-btn bennu-secret-clear">Clear</button>
              </div>
              <div class="bennu-secret-edit">
                <input type="password" placeholder="App Secret">
                <button class="bennu-btn bennu-secret-save">OK</button>
              </div>
            </div>
            <label class="bennu-settings-label">Write Mode</label>
            <select class="bennu-settings-select" data-setting="feishuMode">
              <option value="new">New document each time</option>
              <option value="append">Append to fixed document</option>
            </select>
            <div class="bennu-settings-conditional" data-show-when="append">
              <label class="bennu-settings-label">Document Token</label>
              <input type="text" class="bennu-settings-input" data-setting="feishuDocToken" placeholder="doccnXXXXXX or paste Feishu URL">
            </div>
            <div class="bennu-settings-conditional" data-show-when="new">
              <label class="bennu-settings-label">Folder Token (optional)</label>
              <input type="text" class="bennu-settings-input" data-setting="feishuFolderToken" placeholder="fldcnXXXXXX">
            </div>
            <div class="bennu-settings-help">
              <a href="https://open.feishu.cn/app" target="_blank">Feishu Open Platform</a> → Create app → Credentials
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
                <option value="claude-sonnet-4-6-20250514">Sonnet 4.6</option>
                <option value="claude-opus-4-6-20250514">Opus 4.6</option>
              </select>
              <div class="bennu-settings-help">Terminal: <code>claude setup-token</code> → paste output</div>
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
                <option value="claude-sonnet-4-6-20250514">Sonnet 4.6</option>
                <option value="claude-opus-4-6-20250514">Opus 4.6</option>
              </select>
              <div class="bennu-settings-help"><a href="https://console.anthropic.com/settings/keys" target="_blank">Anthropic Console</a> → API Keys</div>
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
                <option value="gpt-4o-mini">GPT-4o mini (fast)</option>
                <option value="gpt-4o">GPT-4o</option>
                <option value="gpt-4.1-mini">GPT-4.1 mini</option>
                <option value="gpt-4.1">GPT-4.1</option>
              </select>
              <div class="bennu-settings-help"><a href="https://platform.openai.com/api-keys" target="_blank">OpenAI Platform</a> → API Keys</div>
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
              <div class="bennu-settings-help"><a href="https://aistudio.google.com/apikey" target="_blank">Google AI Studio</a> → API Keys</div>
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
              <div class="bennu-settings-help"><a href="https://platform.deepseek.com/api_keys" target="_blank">DeepSeek Platform</a> → API Keys</div>
            </div>
          </div>
          <div class="bennu-settings-section">
            <div class="bennu-settings-section-title">Other</div>
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
        <button class="bennu-btn" data-action="copy">Copy Text</button>
        <button class="bennu-btn" data-action="download-txt">TXT</button>
        <button class="bennu-btn" data-action="download-srt">SRT</button>
        <button class="bennu-btn bennu-feishu-btn" data-action="sync-feishu">Sync to Feishu</button>
      </div>
      <div class="bennu-feishu-setup" style="display:none">
        <div class="bennu-setup-title">配置飞书应用</div>
        <div class="bennu-setup-desc">
          同步字幕到飞书需要配置应用凭证。前往
          <a href="https://open.feishu.cn/app" target="_blank" class="bennu-setup-link">飞书开放平台</a>
          创建应用并获取 App ID 和 App Secret。
        </div>
        <label class="bennu-setup-field-label">App ID</label>
        <input type="text" class="bennu-setup-input bennu-feishu-appid" placeholder="cli_xxxxxxxx" spellcheck="false" autocomplete="off">
        <label class="bennu-setup-field-label">App Secret</label>
        <input type="password" class="bennu-setup-input bennu-feishu-appsecret" placeholder="App Secret" spellcheck="false" autocomplete="off">
        <label class="bennu-setup-field-label">飞书文档链接 <span class="bennu-setup-optional">（可选，粘贴后追加到该文档）</span></label>
        <input type="text" class="bennu-setup-input bennu-feishu-docurl" placeholder="https://xxx.larkoffice.com/docx/..." spellcheck="false" autocomplete="off">
        <div class="bennu-setup-error" style="display:none"></div>
        <div class="bennu-setup-actions">
          <button class="bennu-btn bennu-feishu-save-btn" data-action="save-feishu">保存并同步</button>
          <button class="bennu-btn" data-action="cancel-feishu">取消</button>
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
    this.feishuSetupEl = panel.querySelector('.bennu-feishu-setup')!;
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
          feishuMode: getValue('feishuMode'),
          feishuDocToken: getValue('feishuDocToken'),
          feishuFolderToken: getValue('feishuFolderToken'),
          bilibiliCookie: getValue('bilibiliCookie'),
          whisperModelSize: getValue('whisperModelSize'),
        };
        chrome.storage.local.set({ bennunote_config: config }, () => {
          const toast = this.contentSettings.querySelector<HTMLElement>('.bennu-settings-toast')!;
          toast.style.display = '';
          setTimeout(() => (toast.style.display = 'none'), 1500);
        });
      });
    });

    // Settings tab: mode conditional fields
    const modeSelect = this.contentSettings.querySelector<HTMLSelectElement>('[data-setting="feishuMode"]')!;
    modeSelect.addEventListener('change', () => this.updateSettingsConditional());

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
      else if (action === 'download-txt') this.downloadTxt();
      else if (action === 'download-srt') this.downloadSrt();
      else if (action === 'sync-feishu') this.onSyncFeishu?.();
      else if (action === 'settings') this.switchTab('settings');
      else if (action === 'summarize') this.onSummarize?.();
      else if (action === 'copy-summary') this.copySummary();
      else if (action === 'regenerate') this.onSummarize?.();
      else if (action === 'save-token') this.handleSaveToken();
      else if (action === 'cancel-setup') this.hideSetupForm();
      else if (action === 'save-feishu') this.handleSaveFeishu();
      else if (action === 'cancel-feishu') this.hideFeishuSetup();

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
      set('feishuMode', config.feishuMode || 'new');
      set('feishuDocToken', config.feishuDocToken || '');
      set('feishuFolderToken', config.feishuFolderToken || '');
      set('bilibiliCookie', config.bilibiliCookie || '');
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
      this.updateSettingsConditional();
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

  private updateSettingsConditional() {
    const mode = this.contentSettings.querySelector<HTMLSelectElement>('[data-setting="feishuMode"]')?.value || 'new';
    this.contentSettings.querySelectorAll<HTMLElement>('.bennu-settings-conditional').forEach((el) => {
      el.style.display = el.dataset.showWhen === mode ? '' : 'none';
    });
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

    // Persist to chrome.storage.local
    this.persistLog();

    // Auto-save: debounce 3s after last log entry, so we capture the full run
    this.scheduleAutoSave();
  }

  private persistLog() {
    try {
      chrome.storage?.local?.set({ bennunote_log: this.logLines.join('\n') });
    } catch {
      // storage not available in some contexts
    }
  }

  private scheduleAutoSave() {
    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
    this.autoSaveTimer = setTimeout(() => {
      this.autoSaveToFile();
    }, 3000);
  }

  private autoSaveToFile() {
    const content = this.logLines.join('\n');
    const date = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `bennunote-${date}.log`;
    try {
      chrome.runtime.sendMessage(
        { type: 'SAVE_LOG', content, filename },
        () => { void chrome.runtime.lastError; }
      );
    } catch {
      // extension context invalidated
    }
  }

  private saveLog() {
    const content = this.logLines.join('\n');
    const date = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    this.downloadFile(content, `bennunote-log-${date}.txt`, 'text/plain');
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

  private downloadTxt() {
    const text = this.getPlainText();
    this.downloadFile(text, 'subtitle.txt', 'text/plain');
  }

  private downloadSrt() {
    const srt = this.items
      .map(
        (item, i) =>
          `${i + 1}\n${formatSrtTime(item.from)} --> ${formatSrtTime(item.to)}\n${item.content}\n`
      )
      .join('\n');
    this.downloadFile(srt, 'subtitle.srt', 'text/srt');
  }

  private downloadFile(content: string, filename: string, type: string) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  setServiceStatus(online: boolean) {
    const dot = this.shadow.querySelector('.bennu-status-dot') as HTMLElement;
    if (dot) {
      dot.style.background = online ? '#4caf50' : '#f44336';
      dot.title = online ? 'Backend online' : 'Backend offline';
    }
  }

  setSyncHandler(handler: () => void) {
    this.onSyncFeishu = handler;
  }

  /** Show inline Feishu setup form when credentials are not configured. */
  showFeishuSetup() {
    // Pre-fill doc token from local config
    chrome.storage.local.get('bennunote_config', (data) => {
      const config = (data.bennunote_config || {}) as Partial<import('../shared/types').BennuNoteConfig>;
      const docUrlInput = this.feishuSetupEl.querySelector('.bennu-feishu-docurl') as HTMLInputElement;
      if (docUrlInput) {
        if (config.feishuDocToken) docUrlInput.value = config.feishuDocToken;
        else docUrlInput.value = '';
      }
    });
    // Pre-fill app id/secret previews from server config
    const appIdInput = this.feishuSetupEl.querySelector('.bennu-feishu-appid') as HTMLInputElement;
    const appSecretInput = this.feishuSetupEl.querySelector('.bennu-feishu-appsecret') as HTMLInputElement;
    if (appIdInput) appIdInput.value = '';
    if (appSecretInput) appSecretInput.value = '';
    const errorEl = this.feishuSetupEl.querySelector('.bennu-setup-error') as HTMLElement;
    if (errorEl) errorEl.style.display = 'none';
    this.feishuSetupEl.style.display = '';
    this.footerEl.style.display = 'none';
  }

  private hideFeishuSetup() {
    this.feishuSetupEl.style.display = 'none';
    if (this.items.length > 0) {
      this.footerEl.style.display = '';
    }
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

  private handleSaveFeishu() {
    const appIdInput = this.feishuSetupEl.querySelector('.bennu-feishu-appid') as HTMLInputElement;
    const appSecretInput = this.feishuSetupEl.querySelector('.bennu-feishu-appsecret') as HTMLInputElement;
    const docUrlInput = this.feishuSetupEl.querySelector('.bennu-feishu-docurl') as HTMLInputElement;
    const errorEl = this.feishuSetupEl.querySelector('.bennu-setup-error') as HTMLElement;

    const appId = appIdInput?.value.trim() || '';
    const appSecret = appSecretInput?.value.trim() || '';
    const docUrlRaw = docUrlInput?.value.trim() || '';

    if (!appId) {
      if (errorEl) { errorEl.textContent = 'App ID 不能为空'; errorEl.style.display = ''; }
      return;
    }
    if (!appSecret) {
      if (errorEl) { errorEl.textContent = 'App Secret 不能为空'; errorEl.style.display = ''; }
      return;
    }

    const docToken = this.parseDocToken(docUrlRaw);
    const mode = docToken ? 'append' : 'new';

    // If user pasted a URL but we couldn't parse it
    if (docUrlRaw && !docToken) {
      if (errorEl) { errorEl.textContent = '无法识别文档链接，请粘贴完整的飞书文档 URL 或文档 Token'; errorEl.style.display = ''; }
      return;
    }

    // Save credentials to both server and local storage
    this.saveToLocal('feishuAppId', appId);
    this.saveToLocal('feishuAppSecret', appSecret);
    chrome.storage.local.get('bennunote_config', (data) => {
      const config = { ...(data.bennunote_config || {}), feishuDocToken: docToken, feishuMode: mode };
      chrome.storage.local.set({ bennunote_config: config });
    });
    fetch('http://localhost:2185/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feishu_app_id: appId, feishu_app_secret: appSecret }),
    }).catch(() => {});
    this.log('飞书配置已保存', 'success');
    this.hideFeishuSetup();
    this.onSyncFeishu?.();
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
