// MAIN world — access to window.ytInitialPlayerResponse
// Responds on demand to BENNUNOTE_GET_YT_STATE postMessage requests from the ISOLATED world.
(() => {
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.type !== 'BENNUNOTE_GET_YT_STATE') return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = (window as any).ytInitialPlayerResponse;
      if (r?.videoDetails) {
        const captionTracks =
          r.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
        const translationLanguages =
          r.captions?.playerCaptionsTracklistRenderer?.translationLanguages ?? [];
        const thumbnails = r.videoDetails.thumbnail?.thumbnails ?? [];
        window.postMessage(
          {
            type: 'BENNUNOTE_YT_STATE_RESULT',
            state: {
              videoId: r.videoDetails.videoId,
              title: r.videoDetails.title,
              author: r.videoDetails.author ?? '',
              thumbnail: thumbnails[thumbnails.length - 1]?.url ?? null,
              captionTracks,
              translationLanguages,
            },
          },
          '*',
        );
      } else {
        window.postMessage({ type: 'BENNUNOTE_YT_STATE_RESULT', state: null }, '*');
      }
    } catch {
      window.postMessage({ type: 'BENNUNOTE_YT_STATE_RESULT', state: null }, '*');
    }
  });
})();
