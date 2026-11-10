// Touch (virtual stick + look drag + buttons) and keyboard input.
export class Input {
  constructor(canvas) {
    this.jx = 0; this.jy = 0;                 // stick, -1..1 (jy: up is negative)
    this.lookX = 0; this.lookY = 0;           // accumulated look drag in px (consumed each frame)
    this.jump = false; this.paw = false;
    this._pressed = { jump: false, paw: false, meow: false, act: false, tasks: false };
    this.keys = {};
    this.enabled = false;
    this.used = false;
    this.lastLook = -10;

    const stick = document.getElementById('stick'), knob = document.getElementById('stickKnob');
    const R = 52;
    let stickId = null, lookId = null, sx = 0, sy = 0, lx = 0, ly = 0;
    const home = () => { stick.style.left = ''; stick.style.top = ''; stick.style.bottom = ''; knob.style.transform = ''; };

    canvas.addEventListener('pointerdown', e => {
      if (!this.enabled) return;
      e.preventDefault();
      this.used = true;
      const leftSide = e.clientX < window.innerWidth * 0.45;
      if (e.pointerType !== 'mouse' && leftSide && stickId === null) {
        stickId = e.pointerId; sx = e.clientX; sy = e.clientY;
        const half = stick.offsetWidth / 2;
        stick.style.left = (sx - half) + 'px'; stick.style.top = (sy - half) + 'px'; stick.style.bottom = 'auto';
      } else if (lookId === null) {
        lookId = e.pointerId; lx = e.clientX; ly = e.clientY;
      }
      try { canvas.setPointerCapture(e.pointerId); } catch {}
    });
    canvas.addEventListener('pointermove', e => {
      if (e.pointerId === stickId) {
        let dx = e.clientX - sx, dy = e.clientY - sy;
        const d = Math.hypot(dx, dy);
        if (d > R) { dx *= R / d; dy *= R / d; }
        this.jx = dx / R; this.jy = dy / R;
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
      } else if (e.pointerId === lookId) {
        this.lookX += e.clientX - lx; this.lookY += e.clientY - ly;
        lx = e.clientX; ly = e.clientY;
        this.lastLook = performance.now() / 1000;
      }
    });
    const up = e => {
      if (e.pointerId === stickId) { stickId = null; this.jx = this.jy = 0; home(); }
      if (e.pointerId === lookId) lookId = null;
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    const bind = (id, name) => {
      const el = document.getElementById(id);
      const dn = e => { e.preventDefault(); this.used = true; el.classList.add('down'); this._pressed[name] = true; if (name === 'jump' || name === 'paw') this[name] = true; try { el.setPointerCapture(e.pointerId); } catch {} };
      const u = e => { e.preventDefault(); el.classList.remove('down'); if (name === 'jump' || name === 'paw') this[name] = false; };
      el.addEventListener('pointerdown', dn); el.addEventListener('pointerup', u); el.addEventListener('pointercancel', u);
      el.addEventListener('contextmenu', e => e.preventDefault());
    };
    bind('btnJump', 'jump'); bind('btnPaw', 'paw'); bind('btnMeow', 'meow'); bind('btnAct', 'act');

    const keymap = { Space: 'jump', KeyE: 'paw', KeyF: 'act', KeyQ: 'act', KeyM: 'meow', KeyT: 'tasks', Tab: 'tasks' };
    window.addEventListener('keydown', e => {
      if (!this.enabled) return;
      if (e.code.startsWith('Arrow') || e.code === 'Space' || e.code === 'Tab') e.preventDefault();
      if (e.repeat) return;
      this.keys[e.code] = true; this.used = true;
      const a = keymap[e.code];
      if (a) { this._pressed[a] = true; if (a === 'jump' || a === 'paw') this[a] = true; }
    });
    window.addEventListener('keyup', e => {
      this.keys[e.code] = false;
      const a = keymap[e.code];
      if (a === 'jump' || a === 'paw') this[a] = false;
    });
    window.addEventListener('blur', () => { this.keys = {}; this.jump = this.paw = false; });

    // stop iOS rubber-banding, pinch and double-tap zoom
    document.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
    document.addEventListener('gesturestart', e => e.preventDefault());
    document.addEventListener('dblclick', e => e.preventDefault());
  }

  // Movement vector from stick or keys.
  move() {
    const k = this.keys;
    let x = this.jx, y = this.jy;
    const kx = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
    const ky = (k.KeyS || k.ArrowDown ? 1 : 0) - (k.KeyW || k.ArrowUp ? 1 : 0);
    if (kx || ky) { const n = Math.hypot(kx, ky), m = k.ShiftLeft || k.ShiftRight ? 0.5 : 1; x = kx / n * m; y = ky / n * m; }
    return [x, y];
  }
  // Edge-triggered presses; cleared once read.
  take(name) { const v = this._pressed[name]; this._pressed[name] = false; return v; }
}
