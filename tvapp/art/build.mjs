// Arcade Scoreboard art: writes the SVG sources (art/svg/) and every launcher PNG/WebP under app/src/main/res.
// Run from repo root:  node tvapp/art/build.mjs
// Needs headless Chrome + puppeteer-core (from the site's tools/ - run `npm ci` there - or
// PUPPETEER_FROM=<any package.json whose node_modules has it>), Pillow (python3), and the Russo One font installed (fc-list | grep "Russo One").
// Outputs are committed; re-run only when the art changes.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import * as D from './design.mjs';
import { open, close, render } from './render.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const RES = path.join(HERE, '..', 'app', 'src', 'main', 'res');
const SVG = path.join(HERE, 'svg');
const svgs = {
  banner: D.banner({ font: 'russo', style: 'tube' }),
  icon: D.iconSvg('badge'),
  icon_foreground: D.iconSvg('badge', { mode: 'fg' }),
  icon_background: D.iconSvg('badge', { mode: 'bg' }),
  wordmark: D.wordmarkSvg({ font: 'russo', style: 'tube' }),
};
fs.mkdirSync(SVG, { recursive: true });
for (const [k, v] of Object.entries(svgs)) fs.writeFileSync(path.join(SVG, `${k}.svg`), v + '\n');
await open();
await render(svgs.banner, path.join(RES, 'drawable-xhdpi', 'tv_banner.png'), 320, 180);
for (const [d, s] of [['mdpi', 48], ['hdpi', 72], ['xhdpi', 96], ['xxhdpi', 144], ['xxxhdpi', 192]]) {
  await render(svgs.icon, path.join(RES, `mipmap-${d}`, 'ic_launcher.png'), s, s, { transparent: true });
}
// Adaptive icon layers (API 26+): one xxxhdpi file each (108dp = 432px); the system scales for other densities.
await render(svgs.icon_foreground, path.join(RES, 'mipmap-xxxhdpi', 'ic_launcher_foreground.png'), 432, 432, { transparent: true });
await render(svgs.icon_background, path.join(RES, 'mipmap-xxxhdpi', 'ic_launcher_background.webp'), 432, 432);
// Splash / SIGNAL LOST wordmark: 600x250 px at xhdpi = 300x125 dp, on the splash colour #06041A (opaque = tiny lossy WebP).
await render(svgs.wordmark, path.join(RES, 'drawable-xhdpi', 'logo_wordmark.webp'), 600, 250, { bg: '#06041a', quality: 85 });
await close();
console.log('art written under', path.normalize(RES));
