// 把 Angular build 結果放進 WordPress 外掛，並打包成 dist/twse-screener.zip
// 用法：npm run build:wp
import { cpSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const root = process.cwd();
const built = join(root, 'dist/wp/browser');
const pluginSrc = join(root, 'wordpress/twse-screener');
const stage = join(root, 'dist/wp-plugin');
const zip = join(root, 'dist/twse-screener.zip');

if (!existsSync(join(built, 'index.html'))) {
  console.error('找不到 dist/wp/browser/index.html，請先跑 ng build');
  process.exit(1);
}

rmSync(stage, { recursive: true, force: true });
rmSync(zip, { force: true });
mkdirSync(stage, { recursive: true });

cpSync(pluginSrc, join(stage, 'twse-screener'), { recursive: true });
cpSync(built, join(stage, 'twse-screener/app'), { recursive: true });

// Windows 內建的 tar.exe 可以產生 zip（路徑用 /，上傳到 Linux 主機也沒問題）
const tar = process.platform === 'win32' ? 'C:\\Windows\\System32\\tar.exe' : 'zip';
if (process.platform === 'win32') {
  execFileSync(tar, ['-a', '-c', '-f', zip, 'twse-screener'], { cwd: stage, stdio: 'inherit' });
} else {
  execFileSync(tar, ['-r', zip, 'twse-screener'], { cwd: stage, stdio: 'inherit' });
}

console.log(`完成：${zip}`);
