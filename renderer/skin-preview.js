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

class SkinPreview {
  constructor(container) {
    this.box = container;
    this.is3d = false;
    const lib = window.skinview3d;
    if (lib && lib.SkinViewer) {
      try {
        const canvas = document.createElement('canvas');
        container.append(canvas);
        this.viewer = new lib.SkinViewer({ canvas, width: 240, height: 320 });
        this.viewer.autoRotate = true;
        this.viewer.autoRotateSpeed = 0.6;
        if (this.viewer.controls) this.viewer.controls.enableZoom = false;
        if ('zoom' in this.viewer) this.viewer.zoom = 0.85;
        if (lib.WalkingAnimation) {
          this.viewer.animation = new lib.WalkingAnimation();
          this.viewer.animation.speed = 0.55;
        }
        this.is3d = true;
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

  async show(skinDataUrl, slim, capeDataUrl) {
    if (!this.is3d) return drawSkin2D(this.canvas, skinDataUrl, slim);
    try {
      if (skinDataUrl) await this.viewer.loadSkin(skinDataUrl, { model: slim ? 'slim' : 'default' });
      else if (this.viewer.resetSkin) this.viewer.resetSkin();
      if (capeDataUrl) await this.viewer.loadCape(capeDataUrl);
      else this.viewer.loadCape(null);
    } catch (e) {
      console.warn('Błąd podglądu 3D:', e);
    }
  }
}

window.SkinPreview = SkinPreview;
window.drawCapeThumb = drawCapeThumb;
