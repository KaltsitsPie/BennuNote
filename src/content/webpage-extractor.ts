import { Readability } from '@mozilla/readability';

/**
 * Extracts readable text content from the current page.
 * Uses Readability (like Firefox Reader Mode) first; falls back to body.innerText
 * if the extracted content is shorter than 200 characters.
 */
export function extractPageContent(): { text: string; title: string; url: string } {
  const documentClone = document.cloneNode(true) as Document;
  let article: ReturnType<Readability['parse']> | null = null;
  try {
    article = new Readability(documentClone).parse();
  } catch (err) {
    console.warn('BennuNote: Readability.parse() threw:', err);
  }

  let text = article?.textContent?.trim() ?? '';
  const title = article?.title || document.title;

  // Fallback: use full visible text if Readability result is too short
  if (text.length < 200) {
    text = document.body.innerText.trim();
  }

  return { text, title, url: window.location.href };
}
