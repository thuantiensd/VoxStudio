/**
 * Adapters — per-site config cho hidden browser ingest.
 *
 * Mỗi adapter cung cấp:
 *   match(url)           : bool — URL thuộc platform này?
 *   platform             : string
 *   isMediaURL(url, ct)  : bool — URL response này có phải video cần lấy?
 *   pickBest(candidates) : URL — chọn URL tốt nhất từ nhiều candidate (HD > SD)
 *   pageScripts          : [jsExpr] — chạy trong page sau khi DOM ready để
 *                          trigger media playback (auto-play muted)
 *   getMeta              : jsExpr → obj { title, author, thumbnail, duration? }
 *   waitMs               : timeout chờ media URL (default 15s)
 */

// Helper filters
const anyMp4 = (u) => /\.(mp4|m3u8|webm|mov)(\?|$)/i.test(u);

const tiktok = {
  platform: "tiktok",
  match: (u) => /(?:tiktok\.com|vt\.tiktok\.com|vm\.tiktok\.com|douyin\.com|iesdouyin\.com|b23\.tv)/i.test(u),
  isMediaURL: (url, ct) => {
    // TikTok CDN patterns
    if (/\.tiktokcdn[^\/]*\/.*\.mp4|\.tiktokv\.com.*\.mp4|\.douyinvod\.com|\.douyinpic\.com.*video/i.test(url)) return true;
    if (ct && ct.startsWith("video/")) return true;
    return false;
  },
  pickBest: (urls) => {
    // Prefer "nwm" (no watermark) when available
    const nwm = urls.find((u) => /nwm|playwm=0|play_no_watermark/i.test(u));
    if (nwm) return nwm;
    // Prefer HD indicators
    const hd = urls.find((u) => /hd|h264|bytevc1/i.test(u));
    if (hd) return hd;
    return urls[urls.length - 1]; // latest captured
  },
  pageScripts: [
    // Try multiple triggers — TikTok's player is finicky
    "document.querySelector('video')?.play().catch(() => {})",
    "setTimeout(() => document.querySelector('video')?.play().catch(() => {}), 800)",
    "setTimeout(() => document.querySelector('video')?.play().catch(() => {}), 2000)",
    // Click center of viewport to dismiss age gate if any
    `setTimeout(() => {
      const m = document.querySelector('[data-e2e="modal-content"]');
      if (m) m.querySelector('button')?.click();
    }, 1500)`,
  ],
  getMeta: `({
    title: document.querySelector('meta[property="og:title"]')?.content
         || document.title,
    author: document.querySelector('[data-e2e="browse-username"]')?.textContent
         || document.querySelector('meta[name="author"]')?.content,
    thumbnail: document.querySelector('meta[property="og:image"]')?.content
            || document.querySelector('video')?.poster,
    duration: document.querySelector('video')?.duration,
  })`,
  waitMs: 20000,
};

const youtube = {
  platform: "youtube",
  match: (u) => /youtube\.com\/watch|youtu\.be\/|youtube\.com\/shorts\//i.test(u),
  isMediaURL: (url, ct) =>
    /googlevideo\.com\/videoplayback.*mime=video\/mp4/i.test(url)
    || (ct && ct === "video/mp4"),
  pickBest: (urls) => {
    // itag 22 = 720p mp4 progressive (video+audio)
    // itag 18 = 360p mp4 progressive
    const i22 = urls.find((u) => /itag=22(?:&|$)/.test(u));
    if (i22) return i22;
    const i18 = urls.find((u) => /itag=18(?:&|$)/.test(u));
    if (i18) return i18;
    // Fallback — longest URL likely has most params + highest quality
    return urls.sort((a, b) => b.length - a.length)[0];
  },
  pageScripts: [
    "document.querySelector('video')?.play().catch(() => {})",
    "setTimeout(() => document.querySelector('.ytp-play-button')?.click(), 1200)",
  ],
  getMeta: `({
    title: document.querySelector('ytd-watch-metadata h1')?.textContent?.trim()
         || document.querySelector('meta[property="og:title"]')?.content
         || document.title,
    author: document.querySelector('ytd-channel-name a')?.textContent?.trim()
         || document.querySelector('meta[name="author"]')?.content,
    thumbnail: (() => {
      const v = new URLSearchParams(location.search).get('v')
              || location.pathname.match(/shorts\\/([\\w-]+)/)?.[1]
              || location.pathname.split('/').pop();
      return v ? 'https://i.ytimg.com/vi/' + v + '/maxresdefault.jpg' : null;
    })(),
    duration: document.querySelector('video')?.duration,
  })`,
  waitMs: 20000,
};

const facebook = {
  platform: "facebook",
  match: (u) => /facebook\.com\/.*(?:videos|reel|watch)|fb\.watch\//i.test(u),
  isMediaURL: (url, ct) =>
    /\.xx\.fbcdn\.net\/.*\.mp4|video.*fbcdn|scontent.*\.mp4/i.test(url)
    || (ct && ct.startsWith("video/")),
  pickBest: (urls) => urls.sort((a, b) => b.length - a.length)[0],
  pageScripts: [
    "document.querySelector('video')?.play().catch(() => {})",
  ],
  getMeta: `({
    title: document.querySelector('meta[property="og:title"]')?.content
         || document.title,
    author: document.querySelector('meta[property="og:site_name"]')?.content,
    thumbnail: document.querySelector('meta[property="og:image"]')?.content,
    duration: document.querySelector('video')?.duration,
  })`,
  waitMs: 18000,
};

const instagram = {
  platform: "instagram",
  match: (u) => /instagram\.com\/(?:p|reel|tv)\//i.test(u),
  isMediaURL: (url, ct) =>
    /\.cdninstagram\.com\/.*\.mp4|scontent.*\.mp4/i.test(url)
    || (ct && ct.startsWith("video/")),
  pickBest: (urls) => urls.sort((a, b) => b.length - a.length)[0],
  pageScripts: [
    "document.querySelector('video')?.play().catch(() => {})",
  ],
  getMeta: `({
    title: document.querySelector('meta[property="og:title"]')?.content
         || document.title,
    author: (document.querySelector('meta[property="og:title"]')?.content || '').split(' on Instagram')[0].replace(/^.*from /, ''),
    thumbnail: document.querySelector('meta[property="og:image"]')?.content,
    duration: document.querySelector('video')?.duration,
  })`,
  waitMs: 18000,
};

const bilibili = {
  platform: "bilibili",
  match: (u) => /bilibili\.com\/video\/|b23\.tv\//i.test(u),
  isMediaURL: (url, ct) =>
    /\.bilivideo\.com|upos-sz.*\.acgvideo\.com/i.test(url)
    || (ct && ct.startsWith("video/")),
  pickBest: (urls) => urls.sort((a, b) => b.length - a.length)[0],
  pageScripts: [
    "document.querySelector('video')?.play().catch(() => {})",
  ],
  getMeta: `({
    title: document.querySelector('h1.video-title')?.textContent?.trim()
         || document.querySelector('meta[property="og:title"]')?.content
         || document.title,
    author: document.querySelector('.up-name')?.textContent?.trim(),
    thumbnail: document.querySelector('meta[property="og:image"]')?.content,
    duration: document.querySelector('video')?.duration,
  })`,
  waitMs: 20000,
};

const twitter = {
  platform: "twitter",
  match: (u) => /(?:twitter|x)\.com\/\w+\/status\//i.test(u),
  isMediaURL: (url, ct) =>
    /video\.twimg\.com\/.*\.mp4/i.test(url)
    || (ct && ct.startsWith("video/")),
  pickBest: (urls) => urls.sort((a, b) => b.length - a.length)[0],
  pageScripts: [
    "document.querySelector('video')?.play().catch(() => {})",
  ],
  getMeta: `({
    title: document.querySelector('meta[property="og:title"]')?.content
         || document.title,
    author: document.querySelector('meta[property="og:title"]')?.content?.match(/^(.+?) on (?:X|Twitter)/)?.[1],
    thumbnail: document.querySelector('meta[property="og:image"]')?.content,
    duration: document.querySelector('video')?.duration,
  })`,
  waitMs: 18000,
};

const generic = {
  platform: "generic",
  match: () => true,
  isMediaURL: (url, ct) => anyMp4(url) || (ct && ct.startsWith("video/")),
  pickBest: (urls) => urls.sort((a, b) => b.length - a.length)[0],
  pageScripts: [
    "document.querySelector('video')?.play().catch(() => {})",
  ],
  getMeta: `({
    title: document.querySelector('meta[property="og:title"]')?.content
         || document.title,
    author: document.querySelector('meta[name="author"]')?.content,
    thumbnail: document.querySelector('meta[property="og:image"]')?.content,
    duration: document.querySelector('video')?.duration,
  })`,
  waitMs: 15000,
};

const ADAPTERS = [tiktok, youtube, facebook, instagram, bilibili, twitter, generic];

function pickAdapter(url) {
  return ADAPTERS.find((a) => a.match(url)) || generic;
}

module.exports = { pickAdapter, ADAPTERS };
