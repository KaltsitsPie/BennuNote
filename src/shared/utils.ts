import type { BennuNoteConfig } from './types';
import { DEFAULT_CONFIG } from './types';

/** Read bennunote_config from chrome.storage.local, merged with defaults. */
export async function getConfig(): Promise<BennuNoteConfig> {
  const data = await chrome.storage.local.get('bennunote_config');
  return { ...DEFAULT_CONFIG, ...(data.bennunote_config as Partial<BennuNoteConfig> | undefined) };
}

/** Merge a single key into the stored bennunote_config. */
export function saveToLocal(key: string, value: unknown): void {
  chrome.storage.local.get('bennunote_config', (data) => {
    const config = { ...(data.bennunote_config || {}), [key]: value };
    chrome.storage.local.set({ bennunote_config: config });
  });
}

/**
 * Extract a Feishu/Lark document token from a URL or raw token string.
 * Returns the token string, or null if not found.
 */
export function parseFeishuToken(input: string): string | null {
  const m = input.match(/(?:larkoffice\.com|feishu\.cn|larksuite\.com)\/(?:docx|wiki|docs)\/([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}
