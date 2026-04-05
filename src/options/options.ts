import type { BennuNoteConfig } from '../shared/types';
import { DEFAULT_CONFIG } from '../shared/types';

const ids = {
  appId: 'feishu-app-id',
  appSecret: 'feishu-app-secret',
  mode: 'feishu-mode',
  docToken: 'feishu-doc-token',
  folderToken: 'feishu-folder-token',
  cookie: 'bilibili-cookie',
  whisper: 'whisper-model',
} as const;

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

// Toggle conditional fields based on mode
function updateConditional() {
  const mode = el<HTMLSelectElement>(ids.mode).value;
  document.getElementById('append-fields')!.classList.toggle('visible', mode === 'append');
  document.getElementById('new-fields')!.classList.toggle('visible', mode === 'new');
}

// Load saved config
chrome.storage.local.get('bennunote_config', (data) => {
  const saved = data.bennunote_config as Partial<BennuNoteConfig> | undefined;
  const config: BennuNoteConfig = { ...DEFAULT_CONFIG, ...saved };
  el<HTMLInputElement>(ids.appId).value = config.feishuAppId;
  el<HTMLInputElement>(ids.appSecret).value = config.feishuAppSecret;
  el<HTMLSelectElement>(ids.mode).value = config.feishuMode;
  el<HTMLInputElement>(ids.docToken).value = config.feishuDocToken;
  el<HTMLInputElement>(ids.folderToken).value = config.feishuFolderToken;
  el<HTMLTextAreaElement>(ids.cookie).value = config.bilibiliCookie;
  el<HTMLSelectElement>(ids.whisper).value = config.whisperModelSize;
  updateConditional();
});

el<HTMLSelectElement>(ids.mode).addEventListener('change', updateConditional);

// Save
el<HTMLButtonElement>('save-btn').addEventListener('click', () => {
  const config: BennuNoteConfig = {
    feishuAppId: el<HTMLInputElement>(ids.appId).value.trim(),
    feishuAppSecret: el<HTMLInputElement>(ids.appSecret).value.trim(),
    feishuMode: el<HTMLSelectElement>(ids.mode).value as 'append' | 'new',
    feishuDocToken: el<HTMLInputElement>(ids.docToken).value.trim(),
    feishuFolderToken: el<HTMLInputElement>(ids.folderToken).value.trim(),
    bilibiliCookie: el<HTMLTextAreaElement>(ids.cookie).value.trim(),
    whisperModelSize: el<HTMLSelectElement>(ids.whisper).value as BennuNoteConfig['whisperModelSize'],
  };
  chrome.storage.local.set({ bennunote_config: config }, () => {
    const toast = document.getElementById('toast')!;
    toast.style.display = 'block';
    setTimeout(() => (toast.style.display = 'none'), 2000);
  });
});
