// Free data sources: company website text, Reddit public search, YouTube Data API v3.
const UA = 'gtm-copilot/0.1 (research tool)';

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchText(url, ms = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

// Reads the homepage plus a few high-signal internal pages (about, how it works, FAQ, guarantee, sell).
export async function crawlSite(rawUrl, maxPages = 5) {
  if (!rawUrl) return { pages: [], error: 'No website set' };
  const base = new URL(/^https?:/.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
  const pages = [];
  try {
    const html = await fetchText(base.href);
    pages.push({ url: base.href, text: htmlToText(html).slice(0, 8000) });
    const links = [...html.matchAll(/href=["']([^"'#]+)["']/gi)]
      .map((m) => {
        try { return new URL(m[1], base).href; } catch { return null; }
      })
      .filter((u) => u && new URL(u).host === base.host)
      .filter((u) => /about|how|faq|guarantee|sell|verify|trust|story|career|press|blog/i.test(u));
    for (const u of [...new Set(links)].slice(0, maxPages - 1)) {
      try {
        pages.push({ url: u, text: htmlToText(await fetchText(u)).slice(0, 5000) });
      } catch { /* skip page */ }
    }
    return { pages };
  } catch (e) {
    return { pages, error: `Could not read ${base.href}: ${e.message}. Many sites render with JavaScript; research falls back to Google Search grounding.` };
  }
}

// Reddit public JSON search (no key). Best-effort: Reddit sometimes blocks unauthenticated requests.
export async function redditSearch(query, limit = 25) {
  const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&limit=${limit}&sort=relevance&t=year`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Reddit returned HTTP ${res.status}. Reddit sometimes blocks anonymous requests; try again later or paste threads manually.`);
  const data = await res.json();
  return (data.data?.children || []).map(({ data: d }) => ({
    platform: 'reddit',
    title: d.title,
    caption: (d.selftext || '').slice(0, 600),
    subreddit: d.subreddit,
    likes: d.ups || 0,
    comments: d.num_comments || 0,
    url: `https://www.reddit.com${d.permalink}`,
    date: new Date(d.created_utc * 1000).toISOString().slice(0, 10),
  }));
}

// ---------- YouTube Data API v3 ----------
const YT = 'https://www.googleapis.com/youtube/v3';
async function yt(endpoint, params) {
  if (!process.env.YOUTUBE_API_KEY) throw new Error('YOUTUBE_API_KEY is not set in .env');
  const q = new URLSearchParams({ ...params, key: process.env.YOUTUBE_API_KEY });
  const res = await fetch(`${YT}/${endpoint}?${q}`);
  const data = await res.json();
  if (!res.ok) throw new Error(`YouTube API: ${data?.error?.message || res.status}`);
  return data;
}

function isoDurationToSec(d = '') {
  const m = d.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/) || [];
  return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
}

async function videoDetails(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 50) {
    const d = await yt('videos', { part: 'snippet,statistics,contentDetails', id: ids.slice(i, i + 50).join(',') });
    out.push(...d.items);
  }
  return out.map((v) => {
    const sec = isoDurationToSec(v.contentDetails?.duration);
    return {
      platform: 'youtube',
      title: v.snippet.title,
      caption: (v.snippet.description || '').slice(0, 500),
      channel: v.snippet.channelTitle,
      date: v.snippet.publishedAt.slice(0, 10),
      format: sec <= 180 ? 'short' : 'long-form video',
      duration_sec: sec,
      views: +v.statistics.viewCount || 0,
      likes: +v.statistics.likeCount || 0,
      comments: +v.statistics.commentCount || 0,
      language: v.snippet.defaultAudioLanguage || v.snippet.defaultLanguage || '',
      url: `https://www.youtube.com/watch?v=${v.id}`,
    };
  });
}

// No API key: YouTube's public channel feed (latest 15 uploads with view counts; no likes/comments).
const xmlText = (s = '') => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
async function youtubeFeed(handle) {
  let id = handle.startsWith('UC') ? handle : null;
  if (!id) {
    const page = await fetch(`https://www.youtube.com/${handle.startsWith('@') ? handle : `@${handle}`}`, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'en' } });
    id = (await page.text()).match(/"externalId":"(UC[\w-]+)"/)?.[1];
  }
  if (!id) throw new Error(`No YouTube channel found for "${handle}"`);
  const xml = await (await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`)).text();
  const title = xmlText(xml.match(/<title>([^<]*)<\/title>/)?.[1] || handle);
  const posts = xml.split('<entry>').slice(1).map((e) => {
    const vid = e.match(/<yt:videoId>([^<]+)/)?.[1];
    return {
      platform: 'youtube',
      title: xmlText(e.match(/<title>([^<]*)<\/title>/)?.[1] || ''),
      caption: xmlText(e.match(/<media:description>([\s\S]*?)<\/media:description>/)?.[1] || '').slice(0, 500),
      channel: title,
      date: (e.match(/<published>([^<]{10})/)?.[1]) || '',
      format: /\/shorts\//.test(e) ? 'short' : 'video',
      views: +(e.match(/views="(\d+)"/)?.[1] || 0),
      url: `https://www.youtube.com/watch?v=${vid}`,
    };
  });
  return { channel: { title, channel_id: id, note: 'From the public feed (latest 15 videos, views only). Add YOUTUBE_API_KEY for full history, likes and comments.' }, posts };
}

// Latest uploads of a channel. Accepts "@handle", channel ID "UC...", or a channel URL.
export async function youtubeChannel(input, max = 50) {
  let handle = input.trim();
  const m = handle.match(/youtube\.com\/(@[\w.-]+|channel\/(UC[\w-]+))/);
  if (m) handle = m[2] || m[1];
  if (!process.env.YOUTUBE_API_KEY) return youtubeFeed(handle);
  const params = { part: 'snippet,statistics,contentDetails' };
  if (handle.startsWith('UC')) params.id = handle;
  else params.forHandle = handle.startsWith('@') ? handle : `@${handle}`;
  const ch = (await yt('channels', params)).items?.[0];
  if (!ch) throw new Error(`No YouTube channel found for "${input}"`);
  const uploads = ch.contentDetails.relatedPlaylists.uploads;
  const ids = [];
  let pageToken;
  while (ids.length < max) {
    const pl = await yt('playlistItems', { part: 'contentDetails', playlistId: uploads, maxResults: 50, ...(pageToken ? { pageToken } : {}) });
    ids.push(...pl.items.map((i) => i.contentDetails.videoId));
    if (!pl.nextPageToken) break;
    pageToken = pl.nextPageToken;
  }
  return {
    channel: { title: ch.snippet.title, subscribers: +ch.statistics.subscriberCount || 0, videos: +ch.statistics.videoCount || 0, views: +ch.statistics.viewCount || 0 },
    posts: await videoDetails(ids.slice(0, max)),
  };
}

// Top videos for a topic in a region, e.g. "second hand iphone bangalore" — shows what content wins in the category.
export async function youtubeSearch(query, max = 25, regionCode = 'IN') {
  const s = await yt('search', { part: 'snippet', q: query, type: 'video', maxResults: Math.min(max, 50), regionCode, order: 'relevance' });
  return videoDetails(s.items.map((i) => i.id.videoId));
}
