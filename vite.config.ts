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
 */
function fixYouTubeWebAccessibleResources(): Plugin {
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
          fs.writeFileSync(manifestPath, JSON.stringify(mf, null, 2));
          console.log('[fix-youtube-war] Added to YouTube WAR:', toAdd);
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [
    crx({ manifest }),
    fixYouTubeWebAccessibleResources(),
  ],
  build: {
    rollupOptions: {
      input: {
        options: 'src/options/options.html',
      },
    },
  },
});
