export interface SubtitleItem {
  from: number;
  to: number;
  content: string;
}

export interface VideoInfo {
  bvid: string;
  cid: number;
  title: string;
  partTitle?: string;
}

export type SubtitleSource = 'ai' | 'cc' | 'whisper' | 'bcut_asr';

export interface SubtitleResult {
  source: SubtitleSource;
  items: SubtitleItem[];
  language?: string;
}

export interface SubtitleTrack {
  lan: string;
  lan_doc: string;
  subtitle_url: string;
}

export interface BennuNoteConfig {
  feishuMode: 'append' | 'new';
  feishuDocToken: string;
  feishuFolderToken: string;
  bilibiliCookie: string;
  whisperModelSize: 'tiny' | 'base' | 'small' | 'medium' | 'large';
  // Server secrets stored locally for offline fallback
  feishuAppId: string;
  feishuAppSecret: string;
  aiProvider: string;
  claudeSetupToken: string;
  claudeModel: string;
  claudeApiKey: string;
  claudeApiModel: string;
  openaiApiKey: string;
  openaiModel: string;
  geminiApiKey: string;
  geminiModel: string;
  deepseekApiKey: string;
  deepseekModel: string;
}

export const DEFAULT_CONFIG: BennuNoteConfig = {
  feishuMode: 'new',
  feishuDocToken: '',
  feishuFolderToken: '',
  bilibiliCookie: '',
  whisperModelSize: 'small',
  feishuAppId: '',
  feishuAppSecret: '',
  aiProvider: '',
  claudeSetupToken: '',
  claudeModel: '',
  claudeApiKey: '',
  claudeApiModel: '',
  openaiApiKey: '',
  openaiModel: '',
  geminiApiKey: '',
  geminiModel: '',
  deepseekApiKey: '',
  deepseekModel: '',
};
