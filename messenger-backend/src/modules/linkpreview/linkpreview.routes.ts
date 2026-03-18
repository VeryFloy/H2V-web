import { Router, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { isIP } from 'net';
import dns from 'dns/promises';
import * as cheerio from 'cheerio';
import { authMiddleware } from '../../middleware/auth.middleware';
import { AuthRequest } from '../../types';
import { ok, fail } from '../../utils/response';

const router = Router();
router.use(authMiddleware);

const previewLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, code: 'RATE_LIMIT', message: 'Too many preview requests' },
});

const PREVIEW_TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 512 * 1024;

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true;
  return (
    parts[0] === 0 ||
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
  );
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (normalized === '::1' || normalized === '::' || normalized === '0:0:0:0:0:0:0:1') return true;
  if (normalized.startsWith('fe80:') || normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (normalized.startsWith('::ffff:')) {
    const v4 = normalized.slice(7);
    return isPrivateIPv4(v4);
  }
  return false;
}

function isPrivateIP(ip: string): boolean {
  if (ip.includes(':')) return isPrivateIPv6(ip);
  return isPrivateIPv4(ip);
}

const BLOCKED_HOSTS = new Set(['localhost', 'metadata.google.internal']);

async function isBlockedUrl(parsed: URL): Promise<boolean> {
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  if (BLOCKED_HOSTS.has(hostname.toLowerCase())) return true;
  if (hostname === '::1' || hostname === '0:0:0:0:0:0:0:1') return true;

  let ips: string[];
  if (isIP(hostname)) {
    ips = [hostname];
  } else {
    const [v4, v6] = await Promise.allSettled([
      dns.resolve4(hostname),
      dns.resolve6(hostname),
    ]);
    ips = [
      ...(v4.status === 'fulfilled' ? v4.value : []),
      ...(v6.status === 'fulfilled' ? v6.value : []),
    ];
    if (ips.length === 0) return true;
  }
  return ips.some(isPrivateIP);
}

interface LinkPreview {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
  videoEmbed?: string | null;
  duration?: string | null;
}

// ─── oEmbed providers ───────────────────────────────────────────────────────
const OEMBED_PROVIDERS: { test: RegExp; endpoint: string }[] = [
  {
    test: /^https?:\/\/(www\.)?(youtube\.com\/watch|youtu\.be\/|youtube\.com\/shorts\/)/,
    endpoint: 'https://www.youtube.com/oembed',
  },
  {
    test: /^https?:\/\/(www\.)?vimeo\.com\//,
    endpoint: 'https://vimeo.com/api/oembed.json',
  },
];

interface OEmbedResult {
  title?: string;
  author_name?: string;
  provider_name?: string;
  thumbnail_url?: string;
  html?: string;
}

async function tryOEmbed(url: string): Promise<LinkPreview | null> {
  const provider = OEMBED_PROVIDERS.find((p) => p.test.test(url));
  if (!provider) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);

  try {
    const oembedUrl = `${provider.endpoint}?url=${encodeURIComponent(url)}&format=json`;
    const res = await fetch(oembedUrl, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;

    const data = (await res.json()) as OEmbedResult;
    if (!data.title) return null;

    let image = data.thumbnail_url ?? null;
    if (image) {
      image = image.replace(/\/hqdefault\.jpg/, '/maxresdefault.jpg');
    }

    return {
      url,
      title: data.title.slice(0, 200),
      description: data.author_name ? `${data.author_name}` : null,
      image,
      siteName: data.provider_name ?? null,
    };
  } catch {
    clearTimeout(timer);
    return null;
  }
}

// ─── YouTube thumbnail: extract video ID → maxresdefault ────────────────────
function youtubeThumb(url: string): string | null {
  let m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([\w-]{11})/);
  if (!m) return null;
  return `https://i.ytimg.com/vi/${m[1]}/maxresdefault.jpg`;
}

const previewCache = new Map<string, { data: LinkPreview; ts: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000;

router.get('/', previewLimiter, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const url = req.query.url as string;
    if (!url || typeof url !== 'string') {
      fail(res, 'url query param required', 400);
      return;
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      fail(res, 'Invalid URL', 400);
      return;
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      fail(res, 'Only http/https URLs are supported', 400);
      return;
    }

    if (await isBlockedUrl(parsed)) {
      fail(res, 'URL not allowed', 403);
      return;
    }

    const cached = previewCache.get(url);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      ok(res, cached.data);
      return;
    }

    // Try oEmbed first (YouTube, Vimeo)
    const oembed = await tryOEmbed(url);
    if (oembed) {
      previewCache.set(url, { data: oembed, ts: Date.now() });
      ok(res, oembed);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PREVIEW_TIMEOUT_MS);

    let fetchResponse: globalThis.Response;
    try {
      fetchResponse = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        redirect: 'manual',
      });
    } catch (fetchErr: any) {
      clearTimeout(timer);
      fail(res, 'fetch_failed', fetchErr?.name === 'AbortError' ? 504 : 502);
      return;
    }

    if (fetchResponse.status >= 300 && fetchResponse.status < 400) {
      const location = fetchResponse.headers.get('location');
      // Consume the redirect response body to free the connection
      try { await fetchResponse.arrayBuffer(); } catch {}
      if (!location) { clearTimeout(timer); fail(res, 'fetch_failed', 502); return; }
      let redirectParsed: URL;
      try { redirectParsed = new URL(location, url); } catch { clearTimeout(timer); fail(res, 'Invalid redirect URL', 400); return; }
      if (await isBlockedUrl(redirectParsed)) { clearTimeout(timer); fail(res, 'URL not allowed', 403); return; }
      try {
        fetchResponse = await fetch(redirectParsed.href, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
          },
          redirect: 'manual',
        });
      } catch (fetchErr: any) {
        clearTimeout(timer);
        fail(res, 'fetch_failed', fetchErr?.name === 'AbortError' ? 504 : 502);
        return;
      }
    }
    clearTimeout(timer);

    const contentType = fetchResponse.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      const preview: LinkPreview = { url, title: null, description: null, image: null, siteName: parsed.hostname };
      ok(res, preview);
      return;
    }

    let html: string;
    try {
      const buf = await fetchResponse.arrayBuffer();
      html = Buffer.from(buf.slice(0, MAX_BODY_BYTES)).toString('utf-8');
    } catch {
      fail(res, 'body_read_failed', 502);
      return;
    }

    const $ = cheerio.load(html);

    const title = $('meta[property="og:title"]').attr('content')
      || $('meta[name="twitter:title"]').attr('content')
      || $('title').text()
      || null;

    const description = $('meta[property="og:description"]').attr('content')
      || $('meta[name="twitter:description"]').attr('content')
      || $('meta[name="description"]').attr('content')
      || null;

    let image = $('meta[property="og:image"]').attr('content')
      || $('meta[name="twitter:image"]').attr('content')
      || null;

    if (image && !image.startsWith('http')) {
      try {
        image = new URL(image, url).href;
      } catch {
        image = null;
      }
    }

    // Fallback for YouTube if OG tags are missing
    if (!image) {
      const ytThumb = youtubeThumb(url);
      if (ytThumb) image = ytThumb;
    }

    const siteName = $('meta[property="og:site_name"]').attr('content')
      || parsed.hostname;

    const preview: LinkPreview = {
      url,
      title: title?.slice(0, 200) ?? null,
      description: description?.slice(0, 400) ?? null,
      image,
      siteName,
    };

    previewCache.set(url, { data: preview, ts: Date.now() });

    const MAX_CACHE_SIZE = 500;
    if (previewCache.size > MAX_CACHE_SIZE) {
      const cutoff = Date.now() - CACHE_TTL_MS;
      for (const [key, val] of previewCache) {
        if (val.ts < cutoff) previewCache.delete(key);
      }
      if (previewCache.size > MAX_CACHE_SIZE) {
        const entries = [...previewCache.entries()].sort((a, b) => a[1].ts - b[1].ts);
        const toRemove = entries.slice(0, previewCache.size - MAX_CACHE_SIZE);
        for (const [key] of toRemove) previewCache.delete(key);
      }
    }

    ok(res, preview);
  } catch (err) {
    next(err);
  }
});

export default router;
