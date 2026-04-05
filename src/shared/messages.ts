import type { SubtitleResult } from './types';

// Popup → Background → Content Script
export interface ExtractRequest {
  type: 'EXTRACT_SUBTITLES';
  language: string;
}

// Content Script → Background
export interface SubtitleApiResult {
  type: 'SUBTITLE_API_RESULT';
  result: SubtitleResult | null;
  videoInfo: { bvid: string; cid: number; title: string };
}

// Content Script → Background: request backend transcription
export interface TranscriptRequest {
  type: 'TRANSCRIPT_REQUEST';
  bvid: string;
  language: string;
}

// Background → Content Script: backend transcription result
export interface TranscriptResult {
  type: 'TRANSCRIPT_RESULT';
  result: SubtitleResult | null;
  error?: string;
}

// Content Script → Background: write subtitles to Feishu Wiki
export interface WriteFeishuRequest {
  type: 'WRITE_FEISHU';
  text: string;
  title: string;
  items?: { from: number; to: number; content: string }[];
  videoInfo?: {
    bvid: string;
    title: string;
    ownerName?: string;
    ownerMid?: number;
    coverUrl?: string;
  };
  targetDocToken?: string;
}

// Background → Content Script: Feishu write result
export interface WriteFeishuResult {
  type: 'WRITE_FEISHU_RESULT';
  success: boolean;
  docUrl?: string;
  error?: string;
}

// Content Script → Background: request AI summary
export interface SummarizeRequest {
  type: 'SUMMARIZE';
  text: string;
  title: string;
  maxTokens?: number;
}

// Background → Content Script: summary result
export interface SummarizeResult {
  type: 'SUMMARIZE_RESULT';
  success: boolean;
  summary?: string;
  error?: string;
}

export type Message =
  | ExtractRequest
  | SubtitleApiResult
  | TranscriptRequest
  | TranscriptResult
  | WriteFeishuRequest
  | WriteFeishuResult
  | SummarizeRequest
  | SummarizeResult;
