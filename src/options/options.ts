import type { BennuNoteConfig } from '../shared/types';
import { DEFAULT_CONFIG } from '../shared/types';

const SERVER_URL = 'http://localhost:2185';

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
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
  const el = document.getElementById('server-status')!;
  el.className = `server-status ${online ? 'online' : 'offline'}`;
  el.textContent = online
    ? 'Server connected (localhost:2185)'
    : 'Server offline — start with ./start-server.sh';
}

function renderSecretRows(status: ConfigStatus | null) {
  document.querySelectorAll<HTMLElement>('.secret-row').forEach((row) => {
    const key = row.dataset.key!;
    const dot = row.querySelector<HTMLElement>('.status-dot')!;
    const preview = row.querySelector<HTMLElement>('.secret-preview')!;
    const btnUpdate = row.querySelector<HTMLButtonElement>('.btn-update')!;
    const btnClear = row.querySelector<HTMLButtonElement>('.btn-clear')!;

    if (!status) {
      dot.classList.remove('set');
      preview.textContent = '';
      btnUpdate.disabled = true;
      btnClear.disabled = true;
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
    btnUpdate.disabled = false;
    btnClear.disabled = false;
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
    try {
      await fetch(`${SERVER_URL}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: value }),
      });
    } catch { /* handled by refresh */ }
    editDiv.classList.remove('visible');
    await refreshServerConfig();
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') btnSave.click();
    if (e.key === 'Escape') btnCancel.click();
  });

  btnClear.addEventListener('click', async () => {
    try {
      await fetch(`${SERVER_URL}/config/${key}`, { method: 'DELETE' });
    } catch { /* handled by refresh */ }
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
  const config: BennuNoteConfig = {
    feishuMode: el<HTMLSelectElement>('feishu-mode').value as 'append' | 'new',
    feishuDocToken: el<HTMLInputElement>('feishu-doc-token').value.trim(),
    feishuFolderToken: el<HTMLInputElement>('feishu-folder-token').value.trim(),
    bilibiliCookie: el<HTMLTextAreaElement>('bilibili-cookie').value.trim(),
    whisperModelSize: el<HTMLSelectElement>('whisper-model').value as BennuNoteConfig['whisperModelSize'],
  };
  chrome.storage.local.set({ bennunote_config: config }, () => {
    const toast = document.getElementById('toast')!;
    toast.style.display = 'block';
    setTimeout(() => (toast.style.display = 'none'), 2000);
  });
});
