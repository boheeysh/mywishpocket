// Vercel 서버 함수: GET /api/preview?url=상품링크
// 브라우저는 보안 정책(CORS) 때문에 다른 쇼핑몰 페이지를 직접 읽을 수 없어서,
// 서버가 대신 페이지를 받아 og:title / og:image / 가격 정보를 뽑아 돌려준다.

const MAX_BYTES = 1_500_000;
const TIMEOUT_MS = 7000;

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, s-maxage=3600');
  const raw = (req.query && req.query.url) || new URL(req.url, 'http://x').searchParams.get('url');
  if (!/^https?:\/\//i.test(raw || '')) return send(res, 400, { error: '올바른 http(s) 링크가 아니에요' });
  const target = parseTarget(raw);
  if (!target) return send(res, 400, { error: '내부망·로컬 주소는 불러올 수 없어요' });

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const r = await fetch(target.href, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        // 일부 쇼핑몰은 일반 브라우저처럼 보이지 않으면 og 태그를 주지 않는다
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
      },
    });
    clearTimeout(timer);
    if (!r.ok) return send(res, 502, { error: `쇼핑몰 응답 오류 (${r.status})` });

    const finalUrl = r.url || target.href;
    if (!parseTarget(finalUrl)) return send(res, 400, { error: '허용되지 않는 주소예요' });
    // 네이버 스마트스토어처럼 로그인 화면으로 넘겨 버리는 경우: 로그인 페이지 제목이 상품명으로 들어가지 않게 한다
    if (isLoginPage(finalUrl)) return send(res, 422, { error: '로그인이 필요한 페이지예요', reason: 'login' });

    const buf = await readLimited(r, MAX_BYTES);
    const html = decode(buf, r.headers.get('content-type'));
    const data = extract(html, finalUrl);
    if (/^(NAVER\s*)?로그인$|^(log ?in|sign ?in)\b/i.test(data.title)) return send(res, 422, { error: '로그인이 필요한 페이지예요', reason: 'login' });
    return send(res, 200, data);
  } catch (e) {
    const msg = e.name === 'AbortError' ? '시간 초과' : '페이지를 불러오지 못했어요';
    return send(res, 502, { error: msg });
  }
};

function isLoginPage(href) {
  const u = new URL(href);
  return u.hostname === 'nid.naver.com' || /^(accounts?|login|auth)\./.test(u.hostname)
    || /\/(login|signin|sign-in|accounts\/login)(\/|\.|$)/i.test(u.pathname);
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

// 내부망 주소로 요청을 보내게 만드는 악용(SSRF) 차단
function parseTarget(raw) {
  if (!raw) return null;
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return null;
  if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)) return null;
  if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return null;
  if (!h.includes('.') && !h.includes(':')) return null;
  return u;
}

async function readLimited(r, limit) {
  if (!r.body || !r.body.getReader) return Buffer.from(await r.arrayBuffer()).subarray(0, limit);
  const reader = r.body.getReader();
  const chunks = [];
  let size = 0;
  while (size < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  reader.cancel().catch(() => {});
  return Buffer.concat(chunks).subarray(0, limit);
}

// 국내 쇼핑몰 중에는 EUC-KR 페이지가 아직 있어서 글자가 깨지지 않게 인코딩을 맞춘다
function decode(buf, contentType) {
  let charset = (/charset=([\w-]+)/i.exec(contentType || '') || [])[1];
  if (!charset) {
    const head = buf.subarray(0, 4096).toString('latin1');
    charset = (/<meta[^>]+charset=["']?([\w-]+)/i.exec(head) || [])[1];
  }
  charset = (charset || 'utf-8').toLowerCase();
  if (charset === 'ks_c_5601-1987' || charset === 'cp949') charset = 'euc-kr';
  try { return new TextDecoder(charset).decode(buf); } catch { return new TextDecoder('utf-8').decode(buf); }
}

function extract(html, baseUrl) {
  const metas = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const key = attr(tag, 'property') || attr(tag, 'name') || attr(tag, 'itemprop');
    const content = attr(tag, 'content');
    if (key && content != null && !(key.toLowerCase() in metas)) metas[key.toLowerCase()] = content;
  }

  const ld = jsonLdProduct(html);

  let title = metas['og:title'] || metas['twitter:title'] || (ld && ld.name)
    || (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || '';
  title = tidyTitle(clean(title), clean(metas['og:site_name'] || '')).slice(0, 120);

  let image = metas['og:image'] || metas['og:image:url'] || metas['twitter:image'] || (ld && firstImage(ld.image)) || '';
  image = absolutize(clean(image), baseUrl);

  const priceRaw = metas['product:price:amount'] || metas['og:price:amount'] || metas['product:sale_price:amount']
    || metas['price'] || (ld && ldPrice(ld)) || '';
  const price = toPrice(priceRaw);

  // 세일 중이면 쇼핑몰이 원래 가격(취소선 가격)도 함께 알려 준다 (무신사 normal_price, 29CM StrikethroughPrice 등)
  let originalPrice = toPrice(metas['product:price:normal_price'] || metas['product:original_price:amount']
    || metas['og:original_price:amount'] || (ld && ldListPrice(ld)) || '');
  if (price == null || originalPrice == null || originalPrice <= price) originalPrice = null;

  return { title, image, price, originalPrice, url: baseUrl };
}

// 상품명 끝에 붙는 쇼핑몰 꼬리말(" - 사이즈 & 후기 | 무신사", " - 모든 취향 곁에, 29CM" 등)을 떼고,
// 쇼핑몰 이름만 있는 제목("Instagram", "11번가")은 상품명이 아니므로 비운다
const SITE_SUFFIX = /\s+[-|:·]\s*(?:(?:사이즈\s*&\s*)?후기\s*\|\s*)?(?:무신사|MUSINSA|모든 취향 곁에,\s*29CM|29CM|텐바이텐|10x10|KREAM|크림|카카오톡\s*선물하기|선물하기)\s*$/i;
const GENERIC_TITLE = /^(instagram|11번가|쿠팡!?|coupang|naver|네이버|오늘의집|zara|g마켓|gmarket|ssg\.com|올리브영)$/i;
function tidyTitle(title, siteName) {
  let t = title;
  for (let i = 0; i < 2; i++) t = t.replace(SITE_SUFFIX, '').trim();
  if (siteName && t.length > siteName.length && t.endsWith(siteName)) {
    t = t.slice(0, -siteName.length).replace(/[\s\-|:·,]+$/, '').trim() || t;
  }
  if (GENERIC_TITLE.test(t) || (siteName && t === siteName)) return '';
  return t;
}

function attr(tag, name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? (m[2] ?? m[3] ?? m[4]) : null;
}

function jsonLdProduct(html) {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const found = findProduct(JSON.parse(m[1].trim()));
      if (found) return found;
    } catch { /* 잘못된 JSON-LD는 건너뜀 */ }
  }
  return null;
}
function findProduct(node) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) { for (const n of node) { const f = findProduct(n); if (f) return f; } return null; }
  const t = node['@type'];
  if (t === 'Product' || (Array.isArray(t) && t.includes('Product'))) return node;
  return findProduct(node['@graph']);
}
function ldPrice(p) {
  const o = Array.isArray(p.offers) ? p.offers[0] : p.offers;
  return o && (o.price ?? o.lowPrice);
}
function ldListPrice(p) {
  const o = Array.isArray(p.offers) ? p.offers[0] : p.offers;
  const specs = o && o.priceSpecification;
  for (const sp of Array.isArray(specs) ? specs : specs ? [specs] : []) {
    if (/StrikethroughPrice|ListPrice/i.test(sp.priceType || '')) return sp.price;
  }
  return null;
}
function firstImage(img) {
  if (!img) return '';
  if (Array.isArray(img)) return firstImage(img[0]);
  return typeof img === 'object' ? img.url || '' : img;
}

function toPrice(v) {
  if (v == null || v === '') return null;
  const n = Math.round(Number(String(v).replace(/[^\d.]/g, '')));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function absolutize(src, base) {
  if (!src) return '';
  try {
    const u = new URL(src, base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : '';
  } catch { return ''; }
}

function clean(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
}

module.exports._test = { extract, parseTarget, decode, toPrice, tidyTitle, isLoginPage };
