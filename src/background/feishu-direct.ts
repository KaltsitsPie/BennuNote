/**
 * Direct Feishu (Lark) REST API calls for offline fallback.
 * Replicates server/services/feishu_service.py logic.
 */

import type { BennuNoteConfig } from '../shared/types';

const FEISHU_BASE = 'https://open.feishu.cn/open-apis';

// In-memory token cache
let cachedToken = '';
let cachedTokenExpiry = 0;

async function getAccessToken(appId: string, appSecret: string): Promise<string> {
  if (cachedToken && Date.now() < cachedTokenExpiry) return cachedToken;

  const resp = await fetch(`${FEISHU_BASE}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const data = await resp.json();
  if (data.code !== 0) throw new Error(`Feishu auth failed: ${data.msg}`);

  cachedToken = data.tenant_access_token;
  // Token expires in ~2h, cache for 1.5h
  cachedTokenExpiry = Date.now() + 90 * 60 * 1000;
  return cachedToken;
}

async function createDocument(
  token: string, title: string, folderToken?: string
): Promise<string> {
  const body: Record<string, string> = { title };
  if (folderToken) body.folder_token = folderToken;

  const resp = await fetch(`${FEISHU_BASE}/docx/v1/documents`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  if (data.code !== 0) throw new Error(`Create document failed: ${data.code} - ${data.msg}`);
  return data.data.document.document_id;
}

async function createBlockChildren(
  token: string, docId: string, children: unknown[]
): Promise<void> {
  const resp = await fetch(
    `${FEISHU_BASE}/docx/v1/documents/${docId}/blocks/${docId}/children`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ children }),
    },
  );
  const data = await resp.json();
  if (data.code !== 0) throw new Error(`Write blocks failed: ${data.code} - ${data.msg}`);
}

function textBlock(text: string) {
  return {
    block_type: 2,
    text: {
      elements: [{ text_run: { content: text } }],
      style: {},
    },
  };
}

function headingBlock(text: string) {
  return {
    block_type: 4,
    heading: {
      elements: [{ text_run: { content: text } }],
      level: 3,
    },
  };
}

function splitContent(content: string): string[] {
  const MAX_CHUNK = 400;
  const lines = content.split('\n');
  const chunks: string[] = [];
  let current = '';
  for (const line of lines) {
    if (current.length + line.length + 1 > MAX_CHUNK) {
      if (current) chunks.push(current);
      current = line;
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export async function writeFeishuDirect(
  config: BennuNoteConfig,
  title: string,
  text: string,
  mode: string,
  docToken: string,
  folderToken: string,
): Promise<{ doc_url: string }> {
  const { feishuAppId, feishuAppSecret } = config;
  if (!feishuAppId || !feishuAppSecret) {
    throw new Error('Feishu credentials not configured.');
  }

  const accessToken = await getAccessToken(feishuAppId, feishuAppSecret);

  let docId: string;
  if (mode === 'append') {
    if (!docToken) throw new Error('doc_token required for append mode');
    docId = docToken;
  } else {
    docId = await createDocument(accessToken, title, folderToken || undefined);
  }

  // Build blocks
  const chunks = splitContent(text);
  const children = [headingBlock(title), ...chunks.map(c => textBlock(c))];
  await createBlockChildren(accessToken, docId, children);

  return { doc_url: `https://bytedance.larkoffice.com/docx/${docId}` };
}
