// Arcade Scoreboard logo: SVG generators (neon tube wordmark + LED dot-matrix scoreboard).
export const C = { pink: '#ff2e97', pinkHot: '#ff7cc4', cyan: '#19e6ff', amber: '#ffb000', amberHot: '#ffe08a', violet: '#9b4dff', bg0: '#05030f', bg1: '#1a0533' };

// 5x7 LED font
const G = {
  A: ['01110','10001','10001','11111','10001','10001','10001'],
  B: ['11110','10001','10001','11110','10001','10001','11110'],
  C: ['01110','10001','10000','10000','10000','10001','01110'],
  D: ['11110','10001','10001','10001','10001','10001','11110'],
  E: ['11111','10000','10000','11110','10000','10000','11111'],
  O: ['01110','10001','10001','10001','10001','10001','01110'],
  R: ['11110','10001','10001','11110','10100','10010','10001'],
  S: ['01111','10000','10000','01110','00001','00001','11110'],
  ' ': ['00000','00000','00000','00000','00000','00000','00000'],
};

/** LED dot-matrix text. Returns {lit, unlit} SVG fragments. (x,y)=top-left, pitch=dot spacing. */
export function dotText(str, x, y, pitch, r, { gap = 1 } = {}) {
  let lit = '', unlit = '';
  let cx = x;
  for (const ch of str) {
    const g = G[ch];
    for (let row = 0; row < 7; row++) for (let col = 0; col < 5; col++) {
      const px = (cx + col * pitch + pitch / 2).toFixed(2), py = (y + row * pitch + pitch / 2).toFixed(2);
      if (g[row][col] === '1') lit += `<circle cx="${px}" cy="${py}" r="${r}"/>`;
      else unlit += `<circle cx="${px}" cy="${py}" r="${r}"/>`;
    }
    cx += (5 + gap) * pitch;
  }
  return { lit, unlit, width: cx - x - gap * pitch, height: 7 * pitch };
}
export const dotWidth = (n, pitch, gap = 1) => (n * (5 + gap) - gap) * pitch;

// Seven-segment digit. segs string of letters a-g.
const SEG = { '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg', A: 'abcefg', S: 'afgcd', ':': '' };
export function sevenSeg(ch, x, y, w, h, t, skew = 0.12) {
  const on = SEG[ch] ?? '';
  const k = skew; // italic skew
  const P = (px, py) => `${(x + px + (h - py) * k).toFixed(2)},${(y + py).toFixed(2)}`;
  const hseg = (yy) => [P(t * 0.6, yy), P(t, yy - t / 2), P(w - t, yy - t / 2), P(w - t * 0.6, yy), P(w - t, yy + t / 2), P(t, yy + t / 2)].join(' ');
  const vseg = (xx, y0, y1) => [P(xx, y0 + t * 0.6), P(xx + t / 2, y0 + t), P(xx + t / 2, y1 - t), P(xx, y1 - t * 0.6), P(xx - t / 2, y1 - t), P(xx - t / 2, y0 + t)].join(' ');
  const m = h / 2, segs = {
    a: hseg(t / 2), g: hseg(m), d: hseg(h - t / 2),
    f: vseg(t / 2, 0, m), b: vseg(w - t / 2, 0, m), e: vseg(t / 2, m, h), c: vseg(w - t / 2, m, h),
  };
  let lit = '', unlit = '';
  for (const s of 'abcdefg') (on.includes(s) ? (lit += `<polygon points="${segs[s]}"/>`) : (unlit += `<polygon points="${segs[s]}"/>`));
  return { lit, unlit };
}

/** Neon glow filter: wide soft halo + tight bloom + the source on top. */
export function glowFilter(id, { wide = 6, tight = 1.6, strength = 2 } = {}) {
  const wideNodes = Array.from({ length: strength }, () => '<feMergeNode in="w"/>').join('');
  return `<filter id="${id}" x="-40%" y="-60%" width="180%" height="220%" color-interpolation-filters="sRGB">
    <feGaussianBlur in="SourceGraphic" stdDeviation="${wide}" result="w"/>
    <feGaussianBlur in="SourceGraphic" stdDeviation="${tight}" result="t"/>
    <feMerge>${wideNodes}<feMergeNode in="t"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
}

export function bgDefs(id = 'bg') {
  return `<radialGradient id="${id}" cx="50%" cy="38%" r="75%">
      <stop offset="0" stop-color="#2a0a4a"/><stop offset="0.55" stop-color="#12052a"/><stop offset="1" stop-color="${C.bg0}"/></radialGradient>`;
}

/** Synthwave floor grid inside box (x,y,w,h). */
export function floorGrid(x, y, w, h, color, sw, op = 0.45) {
  let s = `<g stroke="${color}" stroke-width="${sw}" opacity="${op}" fill="none">`;
  const cx = x + w / 2;
  for (let i = -12; i <= 12; i++) s += `<line x1="${(cx + i * w * 0.035).toFixed(2)}" y1="${y}" x2="${(cx + i * w * 0.2).toFixed(2)}" y2="${y + h * 1.0}"/>`;
  let yy = y, step = h * 0.07;
  while (yy < y + h) { s += `<line x1="${x}" y1="${yy.toFixed(2)}" x2="${x + w}" y2="${yy.toFixed(2)}"/>`; yy += step; step *= 1.45; }
  return s + '</g>';
}

const FONTS = {
  monoton: { family: 'Monoton', weight: 400 },
  russo: { family: 'Russo One', weight: 400 },
  bungee: { family: 'Bungee', weight: 400 },
  orbitron: { family: 'Orbitron', weight: 900 },
  pixel: { family: 'Press Start 2P', weight: 400 },
};

/** Neon wordmark text. style: 'tube' (outlined glass tube) or 'fill' (solid neon with white-hot core). */
export function neonText(txt, x, y, size, len, color, font, style, filt) {
  const f = FONTS[font];
  const common = `x="${x}" y="${y}" font-family="${f.family}" font-weight="${f.weight}" font-size="${size}" text-anchor="middle" textLength="${len}" lengthAdjust="spacingAndGlyphs"`;
  if (style === 'tube') {
    const sw = size * 0.075;
    return `<g filter="url(#${filt})"><text ${common} fill="none" stroke="${color}" stroke-width="${sw}" stroke-linejoin="round">${txt}</text></g>
      <text ${common} fill="none" stroke="#fff" stroke-width="${sw * 0.32}" stroke-linejoin="round" opacity="0.9">${txt}</text>`;
  }
  if (style === 'monoton') {
    return `<g filter="url(#${filt})"><text ${common} fill="${color}">${txt}</text></g>
      <text ${common} fill="#fff" opacity="0.55">${txt}</text>`;
  }
  // fill
  return `<g filter="url(#${filt})"><text ${common} fill="${color}">${txt}</text></g>
    <text ${common} fill="none" stroke="#fff" stroke-width="${size * 0.035}" opacity="0.85" transform="translate(0,0)">${txt}</text>`;
}

/** Banner 320x180. */
export function banner({ font = 'russo', style = 'tube', bulbs = true, grid = true, scanlines = false } = {}) {
  const W = 320, H = 180;
  const pitch = 3.72, r = 1.42;
  const dw = dotWidth(10, pitch);
  const px = (W - dw) / 2, py = 112;
  const sb = dotText('SCOREBOARD', px, py, pitch, r);
  let bulbsSvg = '';
  if (bulbs) {
    for (let i = 0; i < 21; i++) {
      const bx = 18 + i * 14.2;
      bulbsSvg += `<circle cx="${bx.toFixed(1)}" cy="13" r="1.5"/><circle cx="${bx.toFixed(1)}" cy="167" r="1.5"/>`;
    }
  }
  const panel = { x: px - 9, y: py - 7, w: dw + 18, h: 7 * pitch + 14 };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>${bgDefs()}
    ${glowFilter('gPink', { wide: 5, tight: 1.4, strength: 2 })}
    ${glowFilter('gCyan', { wide: 3, tight: 1, strength: 2 })}
    ${glowFilter('gAmber', { wide: 2.2, tight: 0.7, strength: 2 })}
    ${glowFilter('gBulb', { wide: 1.6, tight: 0.5, strength: 1 })}
    <linearGradient id="panel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b0716"/><stop offset="1" stop-color="#05030a"/></linearGradient>
    <linearGradient id="floorFade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.0"/></linearGradient>
    <pattern id="scan" width="4" height="3" patternUnits="userSpaceOnUse"><rect width="4" height="1" fill="#000" opacity="0.18"/></pattern>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  ${grid ? floorGrid(8, 136, W - 16, 38, C.violet, 0.7, 0.55) : ''}
  <!-- horizon glow -->
  <ellipse cx="160" cy="136" rx="150" ry="10" fill="${C.pink}" opacity="0.18" filter="url(#gPink)"/>
  <!-- marquee frame -->
  <rect x="6" y="6" width="308" height="168" rx="13" fill="none" stroke="${C.cyan}" stroke-width="2.2" filter="url(#gCyan)"/>
  <rect x="6" y="6" width="308" height="168" rx="13" fill="none" stroke="#e8fdff" stroke-width="0.7" opacity="0.9"/>
  ${bulbs ? `<g fill="${C.amber}" filter="url(#gBulb)">${bulbsSvg}</g><g fill="#fff6d5" opacity="0.9">${bulbsSvg.replace(/r="1.5"/g, 'r="0.6"')}</g>` : ''}
  <!-- ARCADE neon -->
  ${neonText('ARCADE', 160, 86, style === 'monoton' ? 66 : 60, 262, C.pink, font, style, 'gPink')}
  <!-- scoreboard LED panel -->
  <rect x="${panel.x}" y="${panel.y}" width="${panel.w}" height="${panel.h}" rx="4" fill="url(#panel)" stroke="${C.amber}" stroke-opacity="0.45" stroke-width="0.8"/>
  <g fill="#3a2406" opacity="0.9">${sb.unlit}</g>
  <g fill="${C.amber}" filter="url(#gAmber)">${sb.lit}</g>
  <g fill="${C.amberHot}" opacity="0.85">${sb.lit.replace(/r="[\d.]+"/g, `r="${(r * 0.55).toFixed(2)}"`)}</g>
  ${scanlines ? `<rect width="${W}" height="${H}" fill="url(#scan)"/>` : ''}
</svg>`;
}

/** Square icon art. variant: 'monogram' | 'joystick' | 'digits'. size in viewBox units = 108 (adaptive canvas); content kept in the central 66. */
export function iconArt(variant, { bg = true, frame = true, canvas = 108, inset = 0 } = {}) {
  const S = canvas, c = S / 2;
  let body = '';
  if (variant === 'monogram') {
    // Neon tube "A" + LED bar underneath
    const pitch = 3.0, r = 1.15;
    const bar = dotText('SCORE', 0, 0, pitch, r);
    const bw = dotWidth(5, pitch);
    const bx = c - bw / 2, by = c + 12;
    const b2 = dotText('SCORE', bx, by, pitch, r);
    body = `<g filter="url(#gPink)"><text x="${c}" y="${c + 8}" font-family="Russo One" font-size="46" text-anchor="middle" fill="none" stroke="${C.pink}" stroke-width="3.6" stroke-linejoin="round">A</text></g>
      <text x="${c}" y="${c + 8}" font-family="Russo One" font-size="46" text-anchor="middle" fill="none" stroke="#fff" stroke-width="1.2" stroke-linejoin="round">A</text>
      <g fill="${C.amber}" filter="url(#gAmber)">${b2.lit}</g>`;
  } else if (variant === 'joystick') {
    body = `
      <g filter="url(#gCyan)" fill="none" stroke="${C.cyan}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M${c - 22} ${c + 16} L${c + 22} ${c + 16} L${c + 26} ${c + 26} L${c - 26} ${c + 26} Z"/>
      </g>
      <g filter="url(#gCyan)" stroke="#dffcff" stroke-width="3.2" stroke-linecap="round"><line x1="${c - 4}" y1="${c + 15}" x2="${c - 10}" y2="${c - 6}"/></g>
      <g filter="url(#gPink)"><circle cx="${c - 11}" cy="${c - 12}" r="10" fill="${C.pink}"/></g>
      <circle cx="${c - 14}" cy="${c - 15}" r="3.2" fill="#fff" opacity="0.85"/>
      <g filter="url(#gAmber)" fill="${C.amber}"><ellipse cx="${c + 10}" cy="${c + 11}" rx="4.6" ry="2.6"/><ellipse cx="${c + 19}" cy="${c + 8}" rx="4.6" ry="2.6"/></g>`;
  } else if (variant === 'digits') {
    // mini scoreboard: two LED windows "A" "S" with colon, neon frame
    const w = 17, h = 30, t = 4.2;
    const d1 = sevenSeg('A', c - 24, c - 15, w, h, t), d2 = sevenSeg('S', c + 5, c - 15, w, h, t);
    body = `<rect x="${c - 31}" y="${c - 22}" width="62" height="44" rx="6" fill="#07040e" stroke="${C.cyan}" stroke-width="2.2" filter="url(#gCyan)"/>
      <g fill="#2a1a05">${d1.unlit}${d2.unlit}</g>
      <g fill="${C.pink}" filter="url(#gPink)">${d1.lit}</g><g fill="${C.amber}" filter="url(#gAmber)">${d2.lit}</g>
      <g fill="#fff" opacity="0.35">${d1.lit}${d2.lit}</g>
      <g fill="${C.cyan}" filter="url(#gCyan)"><circle cx="${c + 0.5}" cy="${c - 5}" r="1.8"/><circle cx="${c - 1}" cy="${c + 6}" r="1.8"/></g>`;
  } else if (variant === 'badge') {
    // Banner in miniature: pink neon tube "A" with amber marquee bulbs, inside the cyan tube frame.
    let bulbs = '';
    for (let i = 0; i < 6; i++) { const bx = c - 21 + i * 8.4; bulbs += `<circle cx="${bx.toFixed(1)}" cy="${c - 26.5}" r="1.6"/><circle cx="${bx.toFixed(1)}" cy="${c + 26.5}" r="1.6"/>`; }
    body = `<g filter="url(#gPink)"><text x="${c}" y="${c + 15.5}" font-family="Russo One" font-size="44" text-anchor="middle" fill="none" stroke="${C.pink}" stroke-width="3.4" stroke-linejoin="round">A</text></g>
      <text x="${c}" y="${c + 15.5}" font-family="Russo One" font-size="44" text-anchor="middle" fill="none" stroke="#fff" stroke-width="1.1" stroke-linejoin="round" opacity="0.92">A</text>
      <g fill="${C.amber}" filter="url(#gAmber)">${bulbs}</g><g fill="#fff6d5" opacity="0.9">${bulbs.replace(/r="1.6"/g, 'r="0.7"')}</g>`;
  } else if (variant === 'marquee') {
    // A over an LED "SB" scoreboard — big pink neon A in a rounded cyan tube square
    const pitch = 3.3, r = 1.3;
    const dw = dotWidth(2, pitch);
    const sb = dotText('SB', c - dw / 2, c + 10, pitch, r);
    body = `<g filter="url(#gPink)"><text x="${c}" y="${c + 5}" font-family="Russo One" font-size="40" text-anchor="middle" fill="${C.pink}">A</text></g>
      <text x="${c}" y="${c + 5}" font-family="Russo One" font-size="40" text-anchor="middle" fill="none" stroke="#fff" stroke-width="1.1" opacity="0.85">A</text>
      <g fill="${C.amber}" filter="url(#gAmber)">${sb.lit}</g>`;
  }
  const fr = frame ? `<rect x="${c - 33 + inset}" y="${c - 33 + inset}" width="${66 - 2 * inset}" height="${66 - 2 * inset}" rx="13" fill="none" stroke="${C.cyan}" stroke-width="2.2" filter="url(#gCyan)"/>
      <rect x="${c - 33 + inset}" y="${c - 33 + inset}" width="${66 - 2 * inset}" height="${66 - 2 * inset}" rx="13" fill="none" stroke="#e8fdff" stroke-width="0.7"/>` : '';
  return { body, frame: fr };
}

export function iconSvg(variant, { mode = 'legacy' } = {}) {
  // legacy: full-bleed square icon (rounded) using the central 66 of a 108 canvas scaled up
  // fg: transparent adaptive foreground (108 canvas); bg: background only
  const S = 108;
  const defs = `<defs>${bgDefs()}${glowFilter('gPink', { wide: 3.2, tight: 1, strength: 2 })}${glowFilter('gCyan', { wide: 2, tight: 0.7, strength: 2 })}${glowFilter('gAmber', { wide: 1.6, tight: 0.5, strength: 2 })}</defs>`;
  const art = iconArt(variant, { frame: variant !== 'digits' });
  const bgLayer = `<rect width="${S}" height="${S}" fill="url(#bg)"/>${floorGrid(0, 78, S, 30, C.violet, 0.6, 0.5)}`;
  if (mode === 'bg') return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">${defs}${bgLayer}</svg>`;
  if (mode === 'fg') {
    // Adaptive foreground: launchers mask to a circle / squircle / square, so the cyan tube becomes a ring that
    // stays inside the 66dp safe zone for every mask; the A and bulbs sit inside it.
    const c = S / 2;
    let bulbs = '';
    for (let i = 0; i < 5; i++) { const bx = c - 13.6 + i * 6.8; bulbs += `<circle cx="${bx.toFixed(1)}" cy="${c - 21.5}" r="1.5"/><circle cx="${bx.toFixed(1)}" cy="${c + 21.5}" r="1.5"/>`; }
    const ring = `<circle cx="${c}" cy="${c}" r="30.5" fill="none" stroke="${C.cyan}" stroke-width="2.2" filter="url(#gCyan)"/><circle cx="${c}" cy="${c}" r="30.5" fill="none" stroke="#e8fdff" stroke-width="0.7"/>`;
    const A = `<g filter="url(#gPink)"><text x="${c}" y="${c + 13}" font-family="Russo One" font-size="38" text-anchor="middle" fill="none" stroke="${C.pink}" stroke-width="3" stroke-linejoin="round">A</text></g>
      <text x="${c}" y="${c + 13}" font-family="Russo One" font-size="38" text-anchor="middle" fill="none" stroke="#fff" stroke-width="1" stroke-linejoin="round" opacity="0.92">A</text>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">${defs}${ring}${A}<g fill="${C.amber}" filter="url(#gAmber)">${bulbs}</g><g fill="#fff6d5" opacity="0.9">${bulbs.replace(/r="1.5"/g, 'r="0.65"')}</g></svg>`;
  }
  // legacy: crop to central 76 (72dp visible + bit) and round the corners
  const v = 74, o = (S - v) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${o} ${o} ${v} ${v}" width="${v}" height="${v}">${defs}
    <clipPath id="rr"><rect x="${o + 1}" y="${o + 1}" width="${v - 2}" height="${v - 2}" rx="14"/></clipPath>
    <g clip-path="url(#rr)">${bgLayer}${art.frame}${art.body}</g></svg>`;
}

/** Transparent wordmark for splash / offline screen (aspect 2.4:1). */
export function wordmarkSvg({ font = 'russo', style = 'tube' } = {}) {
  const W = 300, H = 125;
  const pitch = 3.9, r = 1.5;
  const dw = dotWidth(10, pitch);
  const px = (W - dw) / 2, py = 78;
  const sb = dotText('SCOREBOARD', px, py, pitch, r);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>${glowFilter('gPink', { wide: 5, tight: 1.4, strength: 2 })}${glowFilter('gAmber', { wide: 2.2, tight: 0.7, strength: 2 })}</defs>
  ${neonText('ARCADE', W / 2, 62, 60, 262, C.pink, font, style, 'gPink')}
  <g fill="#3a2406" opacity="0.7">${sb.unlit}</g>
  <g fill="${C.amber}" filter="url(#gAmber)">${sb.lit}</g>
  <g fill="${C.amberHot}" opacity="0.85">${sb.lit.replace(/r="[\d.]+"/g, `r="${(r * 0.55).toFixed(2)}"`)}</g>
</svg>`;
}
