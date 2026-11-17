// Motywy launchera – wspólny plik dla launchera i panelu (panel/app/public/theme.js to kopia).
// Z 4 kolorów (tło, kafelki, akcent, drugi kolor) wylicza wszystkie zmienne CSS launchera.
(function (root) {
  const PRESETS = {
    amber: { name: 'Nocny bursztyn', bg: '#110f15', card: '#1a171f', accent: '#ffae1a', second: '#a98bff' },
    violet: { name: 'Fiolet', bg: '#120e1f', card: '#1b1530', accent: '#9b7bff', second: '#f5c542' },
    gold: { name: 'Fiolet i złoto', bg: '#120e1f', card: '#1b1530', accent: '#f5c542', second: '#9b7bff' },
    sunset: { name: 'Zachód słońca', bg: '#140f26', card: '#1e1738', accent: '#ffb03d', second: '#c08bff' },
    lemon: { name: 'Lawenda i cytryna', bg: '#1a1530', card: '#241d40', accent: '#e6f25a', second: '#c6bde3' },
    peach: { name: 'Ametyst i brzoskwinia', bg: '#170d1f', card: '#22132d', accent: '#ffa27a', second: '#d68cff' },
    forest: { name: 'Las', bg: '#0e1411', card: '#16201a', accent: '#5fd38d', second: '#e3c26b' },
    ocean: { name: 'Ocean', bg: '#0c1220', card: '#141c2e', accent: '#4fb3ff', second: '#7ee0c3' },
  };
  const HEX = /^#[0-9a-f]{6}$/i;

  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const hex = (c) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
  const mix = (a, b, t) => { const x = rgb(a); const y = rgb(b); return hex(x.map((v, i) => v + (y[i] - v) * t)); };
  const rgba = (h, a) => `rgba(${rgb(h).join(', ')}, ${a})`;
  /** Jasność względna (WCAG). */
  function lum(h) {
    const [r, g, b] = rgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  /** Kontrast dwóch kolorów (1–21). */
  function contrast(a, b) { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }

  /** Poprawne kolory motywu (gdy coś jest nie tak – kolory domyślnego motywu). */
  function normalize(c) {
    const d = PRESETS.amber;
    const ok = (v, def) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : def);
    c = c || {};
    return { bg: ok(c.bg, d.bg), card: ok(c.card, d.card), accent: ok(c.accent, d.accent), second: ok(c.second, d.second) };
  }

  /** Wszystkie zmienne CSS launchera z 4 kolorów. */
  function vars(colors) {
    const { bg, card, accent, second } = normalize(colors);
    const dark = lum(bg) < 0.35;
    const text = dark ? mix('#ffffff', bg, 0.07) : mix('#000000', bg, 0.12);
    const onAccent = contrast(accent, '#ffffff') >= contrast(accent, '#14100a') ? '#ffffff' : mix(accent, '#000000', 0.86);
    return {
      '--bg': bg,
      '--card': card,
      '--inner': mix(bg, card, 0.25),
      '--line': mix(card, text, 0.1),
      '--line-soft': mix(card, text, 0.05),
      '--border-strong': mix(card, text, 0.13),
      '--btn': mix(card, text, 0.07),
      '--chip': mix(card, text, 0.09),
      '--text': text,
      '--muted': mix(text, bg, 0.4),
      '--muted-2': mix(text, bg, 0.26),
      '--accent': accent,
      '--accent-strong': accent,
      '--accent-hover': mix(accent, dark ? '#ffffff' : '#000000', 0.3),
      '--on-accent': onAccent,
      '--accent-soft': rgba(accent, 0.14),
      '--accent-line': rgba(accent, 0.4),
      '--accent-glow': rgba(accent, 0.18),
      '--accent-tint': rgba(accent, 0.08),
      '--accent-tint-line': rgba(accent, 0.32),
      '--second': second,
      '--second-soft': rgba(second, 0.14),
      '--second-text': mix(second, text, 0.35),
      '--card-glass': rgba(card, 0.82),
      '--overlay': rgba(mix(bg, '#000000', 0.5), 0.72),
    };
  }

  /** Ostrzeżenia o czytelności (dla panelu). */
  function warnings(colors) {
    const c = normalize(colors);
    const v = vars(c);
    const out = [];
    if (contrast(c.accent, v['--on-accent']) < 3) out.push('Tekst na przycisku „Graj” będzie słabo czytelny – wybierz jaśniejszy albo ciemniejszy akcent.');
    if (contrast(c.accent, c.card) < 2) out.push('Akcent słabo odróżnia się od kafelków – linki i aktywne ikonki będą mało widoczne.');
    if (contrast(v['--text'], c.card) < 4.5) out.push('Tekst na kafelkach będzie słabo czytelny – kafelki są za jasne albo za podobne do tekstu.');
    if (contrast(c.bg, c.card) < 1.06) out.push('Kafelki prawie nie odróżniają się od tła.');
    return out;
  }

  /** Ustawia zmienne na elemencie (domyślnie <html>). */
  function apply(colors, el) {
    const target = el || (typeof document !== 'undefined' ? document.documentElement : null);
    if (!target) return;
    for (const [k, v] of Object.entries(vars(colors))) target.style.setProperty(k, v);
  }

  const api = { PRESETS, normalize, vars, warnings, apply, contrast, mix };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MelinaTheme = api;
})(typeof window !== 'undefined' ? window : globalThis);
