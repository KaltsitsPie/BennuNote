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
  private contentSubtitle!: HTMLElement;
  private contentLog!: HTMLElement;
  private contentSummary!: HTMLElement;
  private summaryEmptyEl!: HTMLElement;
  private summaryLoadingEl!: HTMLElement;
  private summaryTextEl!: HTMLElement;
  private summaryActionsEl!: HTMLElement;
  private langSelect!: HTMLSelectElement;
  private langBar!: HTMLElement;
  private items: SubtitleItem[] = [];
  private onTrackChange: ((track: SubtitleTrack) => void) | null = null;
  private logLines: string[] = [];
  private autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private feishuLink!: HTMLElement;
  private feishuUrl!: HTMLAnchorElement;
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
        <div class="bennu-summary-empty">Extract subtitles first, then click Summarize.<br><small>Requires Claude Setup Token in Settings.</small></div>
        <div class="bennu-summary-loading" style="display:none">Generating summary...</div>
        <div class="bennu-summary-text" style="display:none"></div>
        <div class="bennu-summary-actions" style="display:none">
          <button class="bennu-btn" data-action="summarize">Summarize</button>
          <button class="bennu-btn" data-action="copy-summary" style="display:none">Copy Summary</button>
        </div>
      </div>
      <div class="bennu-footer" style="display:none">
        <button class="bennu-btn" data-action="copy">Copy Text</button>
        <button class="bennu-btn" data-action="download-txt">TXT</button>
        <button class="bennu-btn" data-action="download-srt">SRT</button>
        <button class="bennu-btn bennu-feishu-btn" data-action="sync-feishu">Sync to Feishu</button>
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
    this.contentLog = panel.querySelector('[data-content="log"]')!;
    this.contentSubtitle = panel.querySelector('[data-content="subtitle"]')!;
    this.contentSummary = panel.querySelector('[data-content="summary"]')!;
    this.summaryEmptyEl = panel.querySelector('.bennu-summary-empty')!;
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

    // Event delegation
    panel.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;

      // Tab switching
      const tab = target.closest('[data-tab]')?.getAttribute('data-tab');
      if (tab) {
        this.switchTab(tab as 'log' | 'subtitle' | 'summary');
        return;
      }

      const action = target.closest('[data-action]')?.getAttribute('data-action');
      if (action === 'close') this.hide();
      else if (action === 'save-log') this.saveLog();
      else if (action === 'copy') this.copyText();
      else if (action === 'download-txt') this.downloadTxt();
      else if (action === 'download-srt') this.downloadSrt();
      else if (action === 'sync-feishu') this.onSyncFeishu?.();
      else if (action === 'settings') chrome.runtime.openOptionsPage();
      else if (action === 'summarize') this.onSummarize?.();
      else if (action === 'copy-summary') this.copySummary();

      const item = target.closest('.bennu-subtitle-item') as HTMLElement | null;
      if (item?.dataset.time) {
        this.seekTo(parseFloat(item.dataset.time));
      }
    });
  }

  private switchTab(tab: 'log' | 'subtitle' | 'summary') {
    this.tabLog.classList.toggle('active', tab === 'log');
    this.tabSubtitle.classList.toggle('active', tab === 'subtitle');
    this.tabSummary.classList.toggle('active', tab === 'summary');
    this.contentLog.classList.toggle('active', tab === 'log');
    this.contentSubtitle.classList.toggle('active', tab === 'subtitle');
    this.contentSummary.classList.toggle('active', tab === 'summary');
    // Show footer only when subtitle tab is active and has items
    this.footerEl.style.display = (tab === 'subtitle' && this.items.length > 0) ? '' : 'none';
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
    this.emptyEl.style.display = 'none';
    this.listEl.style.display = '';

    const sourceLabels: Record<SubtitleSource, string> = {
      ai: 'AI Subtitle',
      cc: 'CC Subtitle',
      whisper: 'Whisper',
    };
    this.sourceBadge.textContent = sourceLabels[source];
    this.sourceBadge.style.display = '';

    this.listEl.innerHTML = items
      .map(
        (item) => `
        <div class="bennu-subtitle-item" data-time="${item.from}">
          <span class="bennu-time">${formatTime(item.from)}</span>
          <span class="bennu-text">${this.escapeHtml(item.content)}</span>
        </div>
      `
      )
      .join('');

    this.log(`Loaded ${items.length} subtitle entries (${sourceLabels[source]})`, 'success');

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

    // Show copy button, hide summarize button
    const summarizeBtn = this.summaryActionsEl.querySelector('[data-action="summarize"]') as HTMLElement;
    const copyBtn = this.summaryActionsEl.querySelector('[data-action="copy-summary"]') as HTMLElement;
    if (summarizeBtn) summarizeBtn.style.display = 'none';
    if (copyBtn) copyBtn.style.display = '';
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
    return this.items.map((item) => item.content).join('\n');
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
