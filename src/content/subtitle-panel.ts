import type { SubtitleItem, SubtitleSource, SubtitleTrack, WhisperProgress } from '../shared/types';
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
  private progressBar!: HTMLElement;
  private progressFill!: HTMLElement;
  private sourceBadge!: HTMLElement;
  private footerEl!: HTMLElement;
  private emptyEl!: HTMLElement;
  private tabSubtitle!: HTMLElement;
  private tabLog!: HTMLElement;
  private contentSubtitle!: HTMLElement;
  private contentLog!: HTMLElement;
  private langSelect!: HTMLSelectElement;
  private langBar!: HTMLElement;
  private items: SubtitleItem[] = [];
  private onTrackChange: ((track: SubtitleTrack) => void) | null = null;
  private logLines: string[] = [];
  private lastProgressMilestone: number = -1;

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
        </div>
        <div class="bennu-header-actions">
          <button class="bennu-btn" data-action="save-log" title="Save log">&#x1f4be;</button>
          <button class="bennu-btn bennu-close-btn" data-action="close">&times;</button>
        </div>
      </div>
      <div class="bennu-tabs">
        <button class="bennu-tab" data-tab="log">Log</button>
        <button class="bennu-tab" data-tab="subtitle">Subtitles</button>
      </div>
      <div class="bennu-progress-bar" style="display:none">
        <div class="bennu-progress-fill" style="width:0%"></div>
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
      <div class="bennu-footer" style="display:none">
        <button class="bennu-btn" data-action="copy">Copy Text</button>
        <button class="bennu-btn" data-action="download-txt">TXT</button>
        <button class="bennu-btn" data-action="download-srt">SRT</button>
      </div>
    `;

    this.shadow.appendChild(panel);
    this.panelEl = panel;

    this.logEl = panel.querySelector('.bennu-log')!;
    this.listEl = panel.querySelector('.bennu-subtitle-list')!;
    this.progressBar = panel.querySelector('.bennu-progress-bar')!;
    this.progressFill = panel.querySelector('.bennu-progress-fill')!;
    this.sourceBadge = panel.querySelector('.bennu-source-badge')!;
    this.footerEl = panel.querySelector('.bennu-footer')!;
    this.emptyEl = panel.querySelector('.bennu-empty')!;

    this.tabLog = panel.querySelector('[data-tab="log"]')!;
    this.tabSubtitle = panel.querySelector('[data-tab="subtitle"]')!;
    this.contentLog = panel.querySelector('[data-content="log"]')!;
    this.contentSubtitle = panel.querySelector('[data-content="subtitle"]')!;
    this.langSelect = panel.querySelector('.bennu-lang-select')!;
    this.langBar = panel.querySelector('.bennu-lang-bar')!;

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
        this.switchTab(tab as 'log' | 'subtitle');
        return;
      }

      const action = target.closest('[data-action]')?.getAttribute('data-action');
      if (action === 'close') this.hide();
      else if (action === 'save-log') this.saveLog();
      else if (action === 'copy') this.copyText();
      else if (action === 'download-txt') this.downloadTxt();
      else if (action === 'download-srt') this.downloadSrt();

      const item = target.closest('.bennu-subtitle-item') as HTMLElement | null;
      if (item?.dataset.time) {
        this.seekTo(parseFloat(item.dataset.time));
      }
    });
  }

  private switchTab(tab: 'log' | 'subtitle') {
    this.tabLog.classList.toggle('active', tab === 'log');
    this.tabSubtitle.classList.toggle('active', tab === 'subtitle');
    this.contentLog.classList.toggle('active', tab === 'log');
    this.contentSubtitle.classList.toggle('active', tab === 'subtitle');
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
  }

  private persistLog() {
    try {
      chrome.storage?.local?.set({ bennunote_log: this.logLines.join('\n') });
    } catch {
      // storage not available in some contexts
    }
  }

  private saveLog() {
    const content = this.logLines.join('\n');
    const date = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    this.downloadFile(content, `bennunote-log-${date}.txt`, 'text/plain');
    this.log('Log saved to file', 'success');
  }

  setProgress(progress: WhisperProgress) {
    const pctRaw = progress.progress || 0;
    const milestone = Math.floor(pctRaw / 10) * 10;

    if (progress.status === 'loading-model') {
      // Only log at 10% milestones
      if (milestone > this.lastProgressMilestone || pctRaw === 0) {
        this.lastProgressMilestone = milestone;
        const label = progress.message || 'Loading Whisper model...';
        this.log(`${label} ${milestone}%`, 'info');
      }
      this.progressBar.style.display = '';
      this.progressFill.style.width = `${pctRaw}%`;
    } else if (progress.status === 'transcribing') {
      if (milestone > this.lastProgressMilestone || pctRaw === 0) {
        this.lastProgressMilestone = milestone;
        this.log(`Transcribing: ${milestone}%`, 'info');
      }
      this.progressBar.style.display = '';
      this.progressFill.style.width = `${pctRaw}%`;
    } else if (progress.status === 'error') {
      this.lastProgressMilestone = -1;
      this.log(`Whisper error: ${progress.message || 'unknown'}`, 'error');
      this.progressBar.style.display = 'none';
    } else if (progress.status === 'done') {
      this.lastProgressMilestone = -1;
      this.log('Whisper transcription complete', 'success');
      this.progressBar.style.display = 'none';
    }
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

    // Auto-switch to subtitle tab
    this.switchTab('subtitle');
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

  destroy() {
    this.container.remove();
  }
}
