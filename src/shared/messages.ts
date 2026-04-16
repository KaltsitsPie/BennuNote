import type { SubtitleResult } from './types';

// Popup → Background → Content Script
export interface ExtractRequest {
  type: 'EXTRACT_SUBTITLES';
  language: string;
}

// Popup → Content Script: summarize current web page
export interface SummarizePageRequest {
  type: 'SUMMARIZE_PAGE';
}

// Content Script → Background: request backend transcription
export interface TranscriptRequest {
  type: 'TRANSCRIPT_REQUEST';
  bvid: string;
  language: string;
  videoUrl?: string;  // explicit URL for non-Bilibili sources (e.g. YouTube)
  reqId?: string;     // short correlation ID for log tracing
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
    videoUrl?: string;  // full canonical URL for YouTube (or any non-Bilibili source)
  };
  targetDocToken?: string;
  summary?: string;             // AI-generated summary text
  appendSummaryOnly?: boolean;  // true = only append ## 摘要 to existing doc
}

// Background → Content Script: Feishu write result
export interface WriteFeishuResult {
  type: 'WRITE_FEISHU_RESULT';
  success: boolean;
  docUrl?: string;
  error?: string;
  warning?: string;
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
  | SummarizePageRequest
  | TranscriptRequest
  | TranscriptResult
  | WriteFeishuRequest
  | WriteFeishuResult
  | SummarizeRequest
  | SummarizeResult;
