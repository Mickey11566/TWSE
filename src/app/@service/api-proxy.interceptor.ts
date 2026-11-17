import { HttpInterceptorFn, HttpParams } from '@angular/common/http';

/**
 * 部署到 WordPress 時，網址會帶 ?api=<WordPress 代理網址>。
 * 這時把 /twse-api、/twse-data、/yahoo-api 的請求改送到 WordPress 外掛的 PHP 代理。
 * 本機開發（沒有 ?api=）就不改，照舊走 proxy.conf.json。
 */
const PROXY_PREFIX = /^\/(twse-api|twse-data|yahoo-api)(\/.*)$/;

function getProxyBase(): string | null {
  const api = new URLSearchParams(window.location.search).get('api');
  if (!api) return null;
  try {
    // 只接受同網域，避免有人塞別的網址進來
    const url = new URL(api, window.location.href);
    return url.origin === window.location.origin ? url.toString() : null;
  } catch {
    return null;
  }
}

const proxyBase = getProxyBase();

export const apiProxyInterceptor: HttpInterceptorFn = (req, next) => {
  const match = proxyBase ? req.urlWithParams.match(PROXY_PREFIX) : null;
  if (!proxyBase || !match) return next(req);

  const [, src, path] = match;
  const joiner = proxyBase.includes('?') ? '&' : '?';
  const url = `${proxyBase}${joiner}src=${src}&path=${encodeURIComponent(path)}`;

  return next(req.clone({ url, params: new HttpParams() }));
};
