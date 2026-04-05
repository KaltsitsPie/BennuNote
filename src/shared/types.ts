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
  ownerName?: string;
  ownerMid?: number;
  coverUrl?: string;
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
  bilibiliCookie: string;
  whisperModelSize: 'tiny' | 'base' | 'small' | 'medium' | 'large';
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
  maxTokens: number;
  feishuWikiRootNodeToken: string;
}

export const DEFAULT_CONFIG: BennuNoteConfig = {
  bilibiliCookie: '',
  whisperModelSize: 'small',
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
  maxTokens: 4096,
  feishuWikiRootNodeToken: '',
};
