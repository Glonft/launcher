// Podgląd postaci: 3D przez skinview3d (dołączany przy budowaniu do renderer/vendor),
// a jeśli biblioteki nie ma albo WebGL nie działa – prosty podgląd 2D od przodu.

/** Rysuje postać od przodu z pliku skina (64×64 lub stary 64×32) na canvasie 16×32. */
function drawSkin2D(canvas, dataUrl, slim) {
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!dataUrl) return;
  const img = new Image();
  img.onload = () => {
    const legacy = img.height === 32;
    const aw = slim ? 3 : 4;
    const part = (sx, sy, w, h, dx, dy, mirror = false) => {
      if (!mirror) return ctx.drawImage(img, sx, sy, w, h, dx, dy, w, h);
      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(img, sx, sy, w, h, -dx - w, dy, w, h);
      ctx.restore();
    };
    ctx.clearRect(0, 0, 16, 32);
    part(8, 8, 8, 8, 4, 0);
    part(20, 20, 8, 12, 4, 8);
    part(44, 20, aw, 12, 4 - aw, 8);
    if (legacy) part(44, 20, aw, 12, 12, 8, true); else part(36, 52, aw, 12, 12, 8);
    part(4, 20, 4, 12, 4, 20);
    if (legacy) part(4, 20, 4, 12, 8, 20, true); else part(20, 52, 4, 12, 8, 20);
    part(40, 8, 8, 8, 4, 0);
    if (!legacy) {
      part(20, 36, 8, 12, 4, 8);
      part(44, 36, aw, 12, 4 - aw, 8);
      part(52, 52, aw, 12, 12, 8);
      part(4, 36, 4, 12, 4, 20);
      part(4, 52, 4, 12, 8, 20);
    }
  };
  img.src = dataUrl;
}

/** Miniatura peleryny (przód, 10×16 z tekstury 64×32) na canvasie. */
function drawCapeThumb(canvas, dataUrl) {
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!dataUrl) return;
  const img = new Image();
  img.onload = () => {
    const k = img.width / 64; // peleryny HD mają większą rozdzielczość
    ctx.drawImage(img, 1 * k, 1 * k, 10 * k, 16 * k, 0, 0, canvas.width, canvas.height);
  };
  img.src = dataUrl;
}

// Animacje podglądu (z biblioteki skinview3d, licencja MIT). Pokazujemy tylko te, które biblioteka ma.
const ANIMS = [
  ['idle', 'Spokój', 'IdleAnimation', 1],
  ['walk', 'Chodzenie', 'WalkingAnimation', 0.6],
  ['run', 'Bieganie', 'RunningAnimation', 0.7],
  ['wave', 'Machanie', 'WaveAnimation', 1],
  ['crouch', 'Kucanie', 'CrouchAnimation', 1],
  ['hit', 'Uderzenie', 'HitAnimation', 1],
  ['fly', 'Latanie', 'FlyingAnimation', 1],
];
const store = {
  get(k, d) { try { const v = localStorage.getItem(`skin-preview:${k}`); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`skin-preview:${k}`, JSON.stringify(v)); } catch { /* bez znaczenia */ } },
};

class SkinPreview {
  constructor(container) {
    this.box = container;
    this.is3d = false;
    this.lib = window.skinview3d;
    const lib = this.lib;
    if (lib && lib.SkinViewer) {
      try {
        const canvas = document.createElement('canvas');
        container.append(canvas);
        this.viewer = new lib.SkinViewer({ canvas, width: 240, height: 320 });
        this.viewer.autoRotate = store.get('rotate', true);
        this.viewer.autoRotateSpeed = 0.6;
        if (this.viewer.controls) {
          this.viewer.controls.enableZoom = true; // kółko myszy przybliża
          this.viewer.controls.enablePan = false;
        }
        if ('zoom' in this.viewer) this.viewer.zoom = 0.85;
        // trochę ładniejsze światło
        if (this.viewer.globalLight) this.viewer.globalLight.intensity = 3;
        if (this.viewer.cameraLight) this.viewer.cameraLight.intensity = 0.6;
        if ('fov' in this.viewer) this.viewer.fov = 45;
        this.elytra = store.get('elytra', false);
        this.setAnimation(store.get('anim', 'walk'));
        this.is3d = true;
        this.buildControls();
        return;
      } catch (e) {
        console.warn('Podgląd 3D niedostępny, używam 2D:', e);
        container.replaceChildren();
      }
    }
    this.canvas = document.createElement('canvas');
    this.canvas.width = 16;
    this.canvas.height = 32;
    this.canvas.className = 'preview-2d';
    container.append(this.canvas);
  }

  animations() { return ANIMS.filter(([, , cls]) => this.lib && typeof this.lib[cls] === 'function'); }

  setAnimation(key) {
    const a = this.animations().find(([k]) => k === key) || this.animations().find(([k]) => k === 'walk');
    if (!a) { this.viewer.animation = null; this.anim = 'none'; return; }
    this.viewer.animation = new this.lib[a[2]]();
    if ('speed' in this.viewer.animation) this.viewer.animation.speed = a[3];
    this.anim = a[0];
    store.set('anim', a[0]);
  }

  /** Pasek pod podglądem: animacje, obracanie, elytra. */
  buildControls() {
    const bar = document.createElement('div');
    bar.className = 'skin-anim-bar';
    const btns = [];
    for (const [key, label] of this.animations()) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `anim-chip${key === this.anim ? ' active' : ''}`;
      b.textContent = label;
      b.onclick = () => {
        this.setAnimation(key);
        btns.forEach((x) => x.classList.toggle('active', x === b));
      };
      btns.push(b);
      bar.append(b);
    }
    const toggle = (label, get, set) => {
      const l = document.createElement('label');
      l.className = 'anim-toggle';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = get();
      cb.onchange = () => set(cb.checked);
      l.append(cb, ` ${label}`);
      return l;
    };
    const opts = document.createElement('div');
    opts.className = 'skin-anim-opts';
    opts.append(
      toggle('Obracanie', () => this.viewer.autoRotate, (v) => { this.viewer.autoRotate = v; store.set('rotate', v); }),
      toggle('Elytra', () => this.elytra, (v) => { this.elytra = v; store.set('elytra', v); this.reloadCape(); }),
    );
    this.box.after(bar, opts);
    const hint = document.getElementById('viewer-hint');
    if (hint) hint.textContent = 'Przeciągnij, żeby obrócić · kółko myszy przybliża';
  }

  async reloadCape() {
    if (!this.is3d) return;
    try {
      if (this.cape) await this.viewer.loadCape(this.cape, { backEquipment: this.elytra ? 'elytra' : 'cape' });
      else this.viewer.loadCape(null);
    } catch (e) { console.warn('Błąd peleryny:', e); }
  }

  /** Napis nad głową (nick). */
  setName(name) {
    if (!this.is3d || !('nameTag' in this.viewer)) return;
    try { this.viewer.nameTag = name || null; } catch { /* starsza wersja biblioteki */ }
  }

  async show(skinDataUrl, slim, capeDataUrl) {
    if (!this.is3d) return drawSkin2D(this.canvas, skinDataUrl, slim);
    try {
      if (skinDataUrl) await this.viewer.loadSkin(skinDataUrl, { model: slim ? 'slim' : 'default' });
      else if (this.viewer.resetSkin) this.viewer.resetSkin();
      this.cape = capeDataUrl || null;
      await this.reloadCape();
    } catch (e) {
      console.warn('Błąd podglądu 3D:', e);
    }
  }
}

window.SkinPreview = SkinPreview;
window.drawCapeThumb = drawCapeThumb;
