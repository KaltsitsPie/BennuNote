import type { BennuNoteConfig } from '../shared/types';
import { DEFAULT_CONFIG } from '../shared/types';

const SERVER_URL = 'http://localhost:2185';

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function saveToLocal(camelKey: string, value: string) {
  chrome.storage.local.get('bennunote_config', (data) => {
    const config = { ...(data.bennunote_config || {}), [camelKey]: value };
    chrome.storage.local.set({ bennunote_config: config });
  });
}

// --- Server Secrets ---

type ConfigStatus = Record<string, { set: boolean; preview: string }>;

async function fetchConfigStatus(): Promise<ConfigStatus | null> {
  try {
    const resp = await fetch(`${SERVER_URL}/config`);
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

function renderServerStatus(online: boolean) {
  const statusEl = document.getElementById('server-status')!;
  statusEl.className = `server-status ${online ? 'online' : 'offline'}`;
  statusEl.textContent = online
    ? 'Server connected (localhost:2185)'
    : 'Server offline — secrets saved locally';
}

function renderSecretRows(status: ConfigStatus | null) {
  document.querySelectorAll<HTMLElement>('.secret-row').forEach((row) => {
    const key = row.dataset.key!;
    const dot = row.querySelector<HTMLElement>('.status-dot')!;
    const preview = row.querySelector<HTMLElement>('.secret-preview')!;

    if (!status) {
      // Server offline — check local storage for this key
      chrome.storage.local.get('bennunote_config', (data) => {
        const val = ((data.bennunote_config || {}) as Record<string, string>)[snakeToCamel(key)] || '';
        if (val) {
          dot.classList.add('set');
          preview.textContent = val.substring(0, 4) + '*** (local)';
        } else {
          dot.classList.remove('set');
          preview.textContent = 'not set';
        }
      });
      return;
    }

    const info = status[key];
    if (info?.set) {
      dot.classList.add('set');
      preview.textContent = info.preview;
    } else {
      dot.classList.remove('set');
      preview.textContent = 'not set';
    }
  });
}

async function refreshServerConfig() {
  const status = await fetchConfigStatus();
  renderServerStatus(status !== null);
  renderSecretRows(status);
}

// Wire up Update / Clear / Save / Cancel buttons
document.querySelectorAll<HTMLElement>('.secret-row').forEach((row) => {
  const key = row.dataset.key!;
  const editDiv = row.querySelector<HTMLElement>('.secret-edit')!;
  const input = editDiv.querySelector<HTMLInputElement>('input')!;
  const btnUpdate = row.querySelector<HTMLButtonElement>('.btn-update')!;
  const btnClear = row.querySelector<HTMLButtonElement>('.btn-clear')!;
  const btnSave = editDiv.querySelector<HTMLButtonElement>('.btn-save')!;
  const btnCancel = editDiv.querySelector<HTMLButtonElement>('.btn-cancel')!;

  btnUpdate.addEventListener('click', () => {
    input.value = '';
    editDiv.classList.add('visible');
    input.focus();
  });

  btnCancel.addEventListener('click', () => {
    editDiv.classList.remove('visible');
  });

  btnSave.addEventListener('click', async () => {
    const value = input.value.trim();
    if (!value) return;
    // Dual-write: server + local
    saveToLocal(snakeToCamel(key), value);
    try {
      await fetch(`${SERVER_URL}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: value }),
      });
    } catch { /* server offline — local save is enough */ }
    editDiv.classList.remove('visible');
    await refreshServerConfig();
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') btnSave.click();
    if (e.key === 'Escape') btnCancel.click();
  });

  btnClear.addEventListener('click', async () => {
    // Dual-clear: server + local
    saveToLocal(snakeToCamel(key), '');
    try {
      await fetch(`${SERVER_URL}/config/${key}`, { method: 'DELETE' });
    } catch { /* server offline */ }
    await refreshServerConfig();
  });
});

// Initial load
refreshServerConfig();

// --- Local Settings ---

function updateConditional() {
  const mode = el<HTMLSelectElement>('feishu-mode').value;
  document.getElementById('append-fields')!.classList.toggle('visible', mode === 'append');
  document.getElementById('new-fields')!.classList.toggle('visible', mode === 'new');
}

chrome.storage.local.get('bennunote_config', (data) => {
  const saved = data.bennunote_config as Partial<BennuNoteConfig> | undefined;
  const config: BennuNoteConfig = { ...DEFAULT_CONFIG, ...saved };
  el<HTMLSelectElement>('feishu-mode').value = config.feishuMode;
  el<HTMLInputElement>('feishu-doc-token').value = config.feishuDocToken;
  el<HTMLInputElement>('feishu-folder-token').value = config.feishuFolderToken;
  el<HTMLTextAreaElement>('bilibili-cookie').value = config.bilibiliCookie;
  el<HTMLSelectElement>('whisper-model').value = config.whisperModelSize;
  updateConditional();
});

el<HTMLSelectElement>('feishu-mode').addEventListener('change', updateConditional);

el<HTMLButtonElement>('save-btn').addEventListener('click', () => {
  chrome.storage.local.get('bennunote_config', (data) => {
    const existing = data.bennunote_config || {};
    const config = {
      ...existing,
      feishuMode: el<HTMLSelectElement>('feishu-mode').value,
      feishuDocToken: el<HTMLInputElement>('feishu-doc-token').value.trim(),
      feishuFolderToken: el<HTMLInputElement>('feishu-folder-token').value.trim(),
      bilibiliCookie: el<HTMLTextAreaElement>('bilibili-cookie').value.trim(),
      whisperModelSize: el<HTMLSelectElement>('whisper-model').value,
    };
    chrome.storage.local.set({ bennunote_config: config }, () => {
      const toast = document.getElementById('toast')!;
      toast.style.display = 'block';
      setTimeout(() => (toast.style.display = 'none'), 2000);
    });
  });
});
