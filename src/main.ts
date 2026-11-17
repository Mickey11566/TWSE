import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

bootstrapApplication(AppComponent, appConfig)
  .then(() => reportHeightToParent())
  .catch((err) => console.error(err));

/**
 * 被 WordPress 用 iframe 嵌入時，把內容高度告訴外層頁面，
 * 讓 iframe 自動長高，不會出現內層捲軸。
 */
function reportHeightToParent(): void {
  if (window.parent === window) return;
  const root = document.querySelector('app-root') as HTMLElement | null;
  if (!root) return;
  root.style.display = 'block';

  // min-h-screen 在 iframe 裡等於 iframe 自己的高度，會讓 iframe 只長不縮，嵌入時關掉
  const style = document.createElement('style');
  style.textContent = 'app-root > * { min-height: 0 !important; }';
  document.head.appendChild(style);

  const send = () =>
    window.parent.postMessage(
      { type: 'twse-screener-height', height: Math.ceil(root.getBoundingClientRect().height) },
      window.location.origin,
    );

  new ResizeObserver(send).observe(root);
  send();
}
