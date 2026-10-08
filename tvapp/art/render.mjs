// Render SVG strings to PNG/WebP via headless Chrome at 4x, then downsample with Pillow (Lanczos) + optional pngquant.
import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';
// puppeteer-core comes from the site's test tools (repo-root tools/node_modules) unless PUPPETEER_FROM points elsewhere.
const req = createRequire(process.env.PUPPETEER_FROM || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'tools', 'package.json'));
const puppeteer = req('puppeteer-core');
let browser;
export async function open() { browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'] }); }
export async function close() { await browser.close(); }
/** svg -> png file of exactly outW x outH. transparent keeps alpha. */
export async function render(svg, out, outW, outH, { scale = 4, transparent = false, bg = '#000', quality = 88 } = {}) {
  const page = await browser.newPage();
  const W = outW * scale, H = outH * scale;
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  const sized = svg.replace(/<svg ([^>]*?)width="[\d.]+" height="[\d.]+"/, `<svg $1width="${W}" height="${H}"`);
  await page.setContent(`<!doctype html><html><body style="margin:0;background:${transparent ? 'transparent' : bg}">${sized}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await new Promise(r => setTimeout(r, 50));
  const tmp = out + '.big.png';
  await page.screenshot({ path: tmp, omitBackground: transparent, clip: { x: 0, y: 0, width: W, height: H } });
  await page.close();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  execFileSync('python3', ['-c', `
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGBA' if sys.argv[5]=='1' else 'RGB')
im = im.resize((int(sys.argv[3]), int(sys.argv[4])), Image.LANCZOS)
out = sys.argv[2]
if out.endswith('.webp'): im.save(out, 'WEBP', quality=int(sys.argv[6]), method=6)
else: im.save(out, optimize=True)
`, tmp, out, String(outW), String(outH), transparent ? '1' : '0', String(quality)]);
  fs.unlinkSync(tmp);
  // Optional lossy palette pass (pngquant, if installed) keeps the APK small; glows survive fine at q80-98.
  if (out.endsWith('.png')) {
    try { execFileSync('pngquant', ['--force', '--skip-if-larger', '--strip', '--speed', '1', '--quality', '80-98', '--output', out, out]); } catch (e) { /* not installed or no gain */ }
  }
}
