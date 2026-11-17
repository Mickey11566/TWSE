// 處理 /twse-data/* 的請求，轉送到外部 API
import { proxy } from '../../cloudflare/proxy.js';

export const onRequestGet = (context) => proxy(context, 'twse-data');
