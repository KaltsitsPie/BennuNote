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
}

export const DEFAULT_CONFIG: BennuNoteConfig = {
  feishuMode: 'new',
  feishuDocToken: '',
  feishuFolderToken: '',
  bilibiliCookie: '',
  whisperModelSize: 'small',
};
