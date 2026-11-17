# Stock

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 19.0.5.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Karma](https://karma-runner.github.io) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.

## 部署到 Cloudflare Pages（給 WordPress.com 免費／個人方案用）

WordPress.com 免費／個人方案不能裝外掛、不能嵌 iframe，所以把工具放在 Cloudflare Pages（免費），WordPress 頁面放連結按鈕。

1. 到 https://dash.cloudflare.com/sign-up 註冊帳號（免費）
2. 第一次部署前登入：`npx wrangler@3 login`（會開瀏覽器按允許）
3. 部署：`npm run deploy:cf`，完成後會印出網址（例如 `https://twse-screener.pages.dev`）
4. WordPress.com 編輯頁面 → 加「按鈕」區塊 → 連結填上一步的網址

說明：
- `functions/` 是 Cloudflare 的 API 代理，路徑和 `proxy.conf.json` 一樣（`/twse-api`、`/twse-data`、`/yahoo-api`），程式不用改。
- 代理邏輯在 `cloudflare/proxy.js`，只允許白名單路徑，快取 10 分鐘。
- 更新畫面後重跑 `npm run deploy:cf` 即可。

## 部署到 WordPress（自架站）

1. 打包：`npm run build:wp`，產出 `dist/twse-screener.zip`
2. WordPress 後台 →「外掛」→「安裝外掛」→「上傳外掛」，選這個 zip，安裝後啟用
3. 在任一頁面或文章插入短代碼：`[twse_screener]`（可加 `height="900"` 設定初始高度）

說明：
- 畫面用 iframe 嵌入，樣式不會和佈景主題互相干擾，高度會自動跟著內容調整。
- 外掛提供 `/wp-json/twse-screener/v1/proxy` 代理 TWSE / Yahoo API（只允許白名單路徑，快取 10 分鐘），取代開發時的 `proxy.conf.json`。
- 外掛原始碼在 `wordpress/twse-screener/`；更新畫面時重新打包、上傳覆蓋即可。
