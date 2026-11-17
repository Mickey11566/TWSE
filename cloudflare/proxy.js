// Cloudflare Pages Functions 用的 API 代理（取代開發時的 proxy.conf.json）
// 只允許白名單路徑，避免被當成開放代理亂用。

export const SOURCES = {
  'twse-api': {
    host: 'https://openapi.twse.com.tw',
    paths: /^\/v1\/(opendata\/t187ap14_L|exchangeReport\/(STOCK_DAY_ALL|FMTQIK))(\?[A-Za-z0-9=&_.%-]*)?$/,
  },
  'twse-data': {
    host: 'https://www.twse.com.tw',
    paths: /^\/rwd\/zh\/fund\/T86(\?[A-Za-z0-9=&_.%-]*)?$/,
  },
  'yahoo-api': {
    host: 'https://query1.finance.yahoo.com',
    paths: /^\/v8\/finance\/chart\/[0-9A-Z]{4,6}\.TW(\?[A-Za-z0-9=&_.%-]*)?$/,
  },
};

const json = (body, status) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

export async function proxy({ request }, src) {
  const url = new URL(request.url);
  // /twse-api/v1/... → /v1/...
  const path = url.pathname.slice(src.length + 1) + url.search;
  const source = SOURCES[src];

  if (!source || !source.paths.test(path)) {
    return json({ error: '不允許的路徑' }, 403);
  }

  let res;
  try {
    res = await fetch(source.host + path, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'application/json',
      },
      // Cloudflare 邊緣快取 10 分鐘，減少打外部 API 的次數
      cf: { cacheTtl: 600, cacheEverything: true },
    });
  } catch (err) {
    return json({ error: '連不到外部 API' }, 502);
  }

  if (!res.ok) {
    return json({ error: `外部 API 回應 ${res.status}` }, res.status === 404 ? 404 : 502);
  }

  return new Response(res.body, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=600',
    },
  });
}
