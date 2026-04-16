import { defineConfig, type Plugin } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json';
import fs from 'fs';
import path from 'path';

/**
 * CRXJS bug workaround: when src/content/index.ts is shared across multiple
 * content_scripts entries (Bilibili + YouTube), CRXJS only adds the compiled
 * module to web_accessible_resources for the FIRST match (Bilibili). The
 * YouTube content script loader then fails silently because it can't import
 * the module. This plugin copies the missing resources into YouTube's WAR entry.
 *
 * Also adds a <all_urls> WAR entry so the content script can be programmatically
 * injected on generic sites (non-Bilibili, non-YouTube) via chrome.scripting.
 */
function fixWebAccessibleResources(): Plugin {
  return {
    name: 'fix-youtube-war',
    apply: 'build',
    closeBundle() {
      const manifestPath = path.resolve(__dirname, 'dist/manifest.json');
      if (!fs.existsSync(manifestPath)) return;

      const mf = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      const war: Array<{ matches: string[]; resources: string[]; use_dynamic_url: boolean }> =
        mf.web_accessible_resources || [];

      const bilibiliEntry = war.find(e => e.matches.some(m => m.includes('bilibili.com')));
      const youtubeEntry = war.find(e => e.matches.some(m => m.includes('youtube.com')));

      if (bilibiliEntry && youtubeEntry) {
        // Add index.ts module and its dependencies (skip the bilibili-only page-bridge)
        const toAdd = bilibiliEntry.resources.filter(r => !r.includes('page-bridge'));
        const before = youtubeEntry.resources.length;
        youtubeEntry.resources = [...new Set([...youtubeEntry.resources, ...toAdd])];
        if (youtubeEntry.resources.length > before) {
          console.log('[fix-youtube-war] Added to YouTube WAR:', toAdd);
        }
      }

      // Add <all_urls> WAR entry for generic site programmatic injection
      const genericEntry = war.find(e => e.matches.some(m => m === '<all_urls>'));
      if (!genericEntry && bilibiliEntry) {
        const genericResources = bilibiliEntry.resources.filter(r => !r.includes('page-bridge'));
        war.push({
          matches: ['<all_urls>'],
          resources: genericResources,
          use_dynamic_url: false,
        });
        console.log('[fix-youtube-war] Added <all_urls> WAR for generic sites:', genericResources);
      }

      fs.writeFileSync(manifestPath, JSON.stringify(mf, null, 2));
    },
  };
}

export default defineConfig({
  plugins: [
    crx({ manifest }),
    fixWebAccessibleResources(),
  ],
  build: {
    rollupOptions: {
      input: {
        options: 'src/options/options.html',
      },
    },
  },
});
