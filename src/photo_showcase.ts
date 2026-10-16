/**
 * Photo Showcase Video Studio (Vertical 9:16)
 * Self-contained module for transforming furniture & product photos
 * into luxury showcase videos with Ken Burns zoom, tilt, captions,
 * branding, and closing contact screen.
 */

export interface PhotoItem {
  img: HTMLImageElement;
  url: string;
  name: string;
  price: string;
  extra: string;
  sec: number;
  zs: number;
  zmax: number;
  tin: number;
  hold: number;
  ze: number;
  curve: 'linear' | 'ease_in' | 'ease_out' | 'smooth' | 'dramatic';
  fx: number;
  fy: number;
  fx2: number;
  fy2: number;
  pan: boolean;
  tilt0: number;
  tilt1: number;
  flip: boolean;
  cl: number;
  cr: number;
  ct: number;
  cb: number;
  capPos: 'bottom' | 'middle' | 'top';
  capDelay: number;
}

const W = 720;
const H = 1280;

const E: Record<string, (u: number) => number> = {
  linear: (u) => u,
  ease_in: (u) => u * u,
  ease_out: (u) => 1 - (1 - u) * (1 - u),
  smooth: (u) => u * u * (3 - 2 * u),
  dramatic: (u) => u * u * u
};

export const G = {
  trans: 0.6,
  logo: null as HTMLImageElement | null,
  corner: 'top-right' as 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left',
  logoSize: 0.2,
  accent: '#d4af37',
  text: '#f5efe0',
  barOp: 0.6,
  capSize: 1,
  fps: 30
};

export const C = {
  on: true,
  sec: 4,
  bg: '#111111',
  title: 'Your Brand Name',
  lines: 'Call / WhatsApp: 080XXXXXXXX\nVisit: your address here\nInstagram: @yourhandle'
};

let S: PhotoItem[] = [];
let sel = 0;
let T = 0;
let playing = false;
let raf = 0;
let mode = 'start';
let lastBlob: Blob | null = null;
let lastExt = 'mp4';

let cv: HTMLCanvasElement | null = null;
let cx: CanvasRenderingContext2D | null = null;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

export function mk(img: HTMLImageElement, url: string): PhotoItem {
  return {
    img,
    url,
    name: '',
    price: '',
    extra: '',
    sec: 8,
    zs: 1,
    zmax: 2.5,
    tin: 4,
    hold: 0,
    ze: 1.15,
    curve: 'smooth',
    fx: 0.5,
    fy: 0.5,
    fx2: 0.5,
    fy2: 0.5,
    pan: false,
    tilt0: 0,
    tilt1: 0,
    flip: false,
    cl: 0,
    cr: 0,
    ct: 0,
    cb: 0,
    capPos: 'bottom',
    capDelay: 0.6
  };
}

function zoomAt(s: PhotoItem, t: number): number {
  const tin = clamp(s.tin, 0.1, s.sec);
  const th = clamp(s.tin + s.hold, tin, s.sec);
  const e = E[s.curve] || E.smooth;
  if (t <= tin) return lerp(s.zs, s.zmax, e(t / tin));
  if (t <= th) return s.zmax;
  return lerp(s.zmax, s.ze, e((t - th) / Math.max(0.01, s.sec - th)));
}

function tl() {
  let t = 0;
  const a: Array<{ s?: PhotoItem; c?: number; st: number; d: number }> = S.map(s => {
    const o = { s, st: t, d: s.sec, c: 0 };
    t += s.sec - G.trans;
    return o;
  });
  if (C.on && S.length) {
    a.push({ c: 1, st: t, d: C.sec });
    t += C.sec - G.trans;
  }
  const n = a.length;
  return { a, total: n ? a[n - 1].st + a[n - 1].d : 0 };
}

function wrapT(c: CanvasRenderingContext2D, tx: string, mw: number): string[] {
  const o: string[] = [];
  tx.split('\n').forEach(p => {
    let cur = '';
    p.split(' ').forEach(w => {
      const q = (cur + ' ' + w).trim();
      if (c.measureText(q).width <= mw || !cur) cur = q;
      else {
        o.push(cur);
        cur = w;
      }
    });
    o.push(cur);
  });
  return o;
}

function photo(c: CanvasRenderingContext2D, s: PhotoItem, t: number) {
  const im = s.img;
  const w0 = im.naturalWidth || im.width || 1;
  const h0 = im.naturalHeight || im.height || 1;
  const sx = w0 * s.cl / 100;
  const sy = h0 * s.ct / 100;
  const sw = Math.max(1, w0 * (1 - (s.cl + s.cr) / 100));
  const sh = Math.max(1, h0 * (1 - (s.ct + s.cb) / 100));
  const s0 = Math.max(W / sw, H / sh);
  const z = Math.max(0.3, zoomAt(s, t));
  const e = E[s.curve] || E.smooth;
  const u = e(clamp(t / s.sec, 0, 1));
  const ang = lerp(s.tilt0, s.tilt1, u);
  const fx = lerp(s.fx, s.pan ? s.fx2 : s.fx, u) * w0;
  const fy = lerp(s.fy, s.pan ? s.fy2 : s.fy, u) * h0;
  const hw = W / (2 * s0 * z);
  const hh = H / (2 * s0 * z);
  const cxp = hw >= sw / 2 ? sx + sw / 2 : clamp(fx, sx + hw, sx + sw - hw);
  const cyp = hh >= sh / 2 ? sy + sh / 2 : clamp(fy, sy + hh, sy + sh - hh);

  c.fillStyle = '#000';
  c.fillRect(0, 0, W, H);

  try {
    c.filter = 'blur(24px)';
  } catch (_) {}
  c.drawImage(im, sx, sy, sw, sh, (W - sw * s0) / 2, (H - sh * s0) / 2, sw * s0, sh * s0);
  try {
    c.filter = 'none';
  } catch (_) {}

  c.save();
  c.translate(W / 2, H / 2);
  c.rotate(-ang * Math.PI / 180);
  c.scale((s.flip ? -1 : 1) * s0 * z, s0 * z);
  c.translate(-cxp, -cyp);
  c.drawImage(im, sx, sy, sw, sh, sx, sy, sw, sh);
  c.restore();

  caption(c, s, t);
  logo(c);
}

function caption(c: CanvasRenderingContext2D, s: PhotoItem, t: number) {
  const a = clamp((t - s.capDelay) / 0.5, 0, 1) * clamp((s.sec - t) / 0.4, 0, 1);
  if (a <= 0) return;
  const k = G.capSize;
  const rows: Array<[string, number, string]> = [];
  ([
    [s.name, 56, G.text],
    [s.price, 50, G.accent],
    [s.extra, 34, G.text]
  ] as Array<[string, number, string]>).forEach(([tx, sz, col]) => {
    if (!tx) return;
    c.font = `600 ${sz * k}px Georgia, serif`;
    wrapT(c, tx, W * 0.86 - 56).forEach(l => rows.push([l, sz * k, col]));
  });

  if (!rows.length) return;
  const gap = 8;
  const pad = 28;
  const th = rows.reduce((q, r) => q + r[1] * 1.2, 0) + gap * (rows.length - 1) + 2 * pad;
  const y0 = s.capPos === 'top' ? H * 0.12 : s.capPos === 'middle' ? (H - th) / 2 : H * 0.84 - th;
  const x0 = W * 0.07;
  const bw = W * 0.86;

  c.save();
  c.globalAlpha *= a;
  c.fillStyle = `rgba(0,0,0,${G.barOp})`;
  c.beginPath();
  if (typeof (c as any).roundRect === 'function') {
    (c as any).roundRect(x0, y0, bw, th, 24);
  } else {
    c.rect(x0, y0, bw, th);
  }
  c.fill();

  c.textAlign = 'center';
  c.textBaseline = 'top';
  let y = y0 + pad;
  rows.forEach(r => {
    c.font = `600 ${r[1]}px Georgia, serif`;
    c.fillStyle = r[2];
    c.fillText(r[0], W / 2, y);
    y += r[1] * 1.2 + gap;
  });
  c.restore();
}

function logoRect(w: number): [number, number, number, number] {
  const l = G.logo!;
  const h = (l.naturalHeight || l.height || 100) * w / (l.naturalWidth || l.width || 100);
  const m = W * 0.04;
  const r = G.corner.endsWith('right');
  return [r ? W - w - m : m, G.corner.startsWith('top') ? H * 0.05 : H * 0.78 - h, w, h];
}

function logo(c: CanvasRenderingContext2D) {
  if (G.logo && G.logo.complete) {
    c.drawImage(G.logo, ...logoRect(W * G.logoSize));
  }
}

function closing(c: CanvasRenderingContext2D) {
  c.fillStyle = C.bg;
  c.fillRect(0, 0, W, H);
  let y = H * 0.22;
  if (G.logo) {
    const w = W * 0.5;
    const h = (G.logo.naturalHeight || G.logo.height || 100) * w / (G.logo.naturalWidth || G.logo.width || 100);
    c.drawImage(G.logo, (W - w) / 2, y, w, h);
    y += h + 50;
  }
  c.textAlign = 'center';
  c.textBaseline = 'top';
  c.font = '600 54px Georgia, serif';
  c.fillStyle = G.accent;
  wrapT(c, C.title, W * 0.88).forEach(l => {
    c.fillText(l, W / 2, y);
    y += 70;
  });
  y += 14;
  c.font = '34px Georgia, serif';
  c.fillStyle = G.text;
  wrapT(c, C.lines, W * 0.88).forEach(l => {
    c.fillText(l, W / 2, y);
    y += 48;
  });
}

export function render() {
  if (!cx) return;
  const { a } = tl();
  cx.fillStyle = '#000';
  cx.fillRect(0, 0, W, H);
  if (!a.length) {
    cx.fillStyle = '#64748b';
    cx.font = '32px system-ui, -apple-system, sans-serif';
    cx.textAlign = 'center';
    cx.fillText('Add photos to begin showcase', W / 2, H / 2);
    return;
  }
  let first = true;
  a.forEach(o => {
    const lt = T - o.st;
    if (lt < 0 || lt >= o.d) return;
    cx!.globalAlpha = first ? 1 : clamp(lt / Math.max(G.trans, 0.01), 0, 1);
    first = false;
    if (o.c) {
      closing(cx!);
    } else if (o.s) {
      photo(cx!, o.s, lt);
    }
    cx!.globalAlpha = 1;
  });

  const tt = document.getElementById('sc-tt');
  if (tt) tt.textContent = T.toFixed(1) + 's';
}

export function upd() {
  const { total } = tl();
  const sc = document.getElementById('sc-sc') as HTMLInputElement | null;
  if (sc) {
    sc.max = String(total || 1);
    sc.value = String(T);
  }
  render();
}

function goSel() {
  const o = tl().a[sel];
  if (o && (T < o.st || T >= o.st + o.d)) {
    T = o.st;
  }
  upd();
}

export function stopShowcase() {
  playing = false;
  cancelAnimationFrame(raf);
}

export function playShowcase(from: number, to: number, done?: () => void, onProgress?: (t: number) => void) {
  stopShowcase();
  playing = true;
  const t0 = performance.now();
  (function f(n) {
    if (!playing) return;
    T = from + (n - t0) / 1000;
    if (T >= to) {
      T = to;
      const sc = document.getElementById('sc-sc') as HTMLInputElement | null;
      if (sc) sc.value = String(T);
      render();
      playing = false;
      onProgress && onProgress(T);
      done && setTimeout(done, 250);
      return;
    }
    const sc = document.getElementById('sc-sc') as HTMLInputElement | null;
    if (sc) sc.value = String(T);
    render();
    onProgress && onProgress(T);
    raf = requestAnimationFrame(f);
  })(t0);
}

const obj = (sc: string): any => (sc === 's' ? S[sel] : sc === 'g' ? G : C);

export function sync() {
  const container = document.getElementById('modal-photo-showcase');
  if (!container) return;

  container.querySelectorAll('[data-k]').forEach(elNode => {
    const el = elNode as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    const o = obj(el.dataset.sc || '');
    if (!o) return;
    const v = o[el.dataset.k || ''];
    if (el.type === 'checkbox') {
      (el as HTMLInputElement).checked = !!v;
    } else {
      el.value = v;
    }
    const out = el.parentElement?.querySelector('output');
    if (out) out.textContent = String(v);
  });

  const s = S[sel];
  const pk = document.getElementById('sc-pk');
  if (pk) {
    const img = pk.querySelector('img');
    if (s && img) {
      img.src = s.url;
      const d1 = pk.querySelector('.d1') as HTMLElement | null;
      const d2 = pk.querySelector('.d2') as HTMLElement | null;
      if (d1) {
        d1.style.left = s.fx * 100 + '%';
        d1.style.top = s.fy * 100 + '%';
      }
      if (d2) {
        d2.classList.toggle('hidden', !s.pan);
        d2.style.left = s.fx2 * 100 + '%';
        d2.style.top = s.fy2 * 100 + '%';
      }
    } else if (img) {
      img.src = '';
    }
    const parent = pk.parentElement;
    if (parent) parent.style.opacity = s ? '1' : '0.4';
  }
}

export function strip() {
  const stripEl = document.getElementById('sc-strip');
  if (!stripEl) return;
  if (!S.length) {
    stripEl.innerHTML = `<div class="text-xs text-zinc-500 py-6 px-4 border border-dashed border-zinc-800 rounded-xl w-full text-center">No photos in showcase yet. Tap <b>"Add photos"</b> above.</div>`;
    return;
  }
  stripEl.innerHTML = S.map(
    (s, i) => `
    <button type="button" class="sc-th relative flex-none w-16 h-24 rounded-lg overflow-hidden border-2 transition-all cursor-pointer ${
      i === sel ? 'border-amber-400 scale-105 shadow-lg' : 'border-zinc-700/80 hover:border-zinc-500 opacity-80'
    }" data-i="${i}" aria-label="Photo ${i + 1}">
      <img src="${s.url}" alt="" class="w-full h-full object-cover">
      <b class="absolute left-1 top-1 text-[11px] bg-black/70 text-white font-mono px-1.5 py-0.5 rounded">${i + 1}</b>
    </button>
  `
  ).join('');
}

function addFiles(files: FileList | File[]) {
  const upn = document.getElementById('sc-upn');
  if (upn) upn.textContent = `Loading ${files.length} photo(s)...`;
  Array.from(files).forEach(f => {
    const url = URL.createObjectURL(f);
    const im = new Image();
    im.onload = () => {
      S.push(mk(im, url));
      sel = S.length - 1;
      strip();
      sync();
      goSel();
      if (upn) upn.textContent = `${S.length} photo(s) in showcase`;
    };
    im.onerror = () => {
      if (upn) upn.textContent = 'Could not read ' + f.name + ' - try JPG or PNG';
    };
    im.src = url;
  });
}

export function switchTab(k: string) {
  document.querySelectorAll('.sc-pn').forEach(p => {
    const match = p.id === 'sc-p-' + k;
    p.classList.toggle('hidden', !match);
    p.classList.toggle('grid', match);
  });
  document.querySelectorAll('#sc-tabs button').forEach(b => {
    const btn = b as HTMLElement;
    const match = btn.dataset.t === k;
    btn.classList.toggle('bg-amber-500', match);
    btn.classList.toggle('text-black', match);
    btn.classList.toggle('font-bold', match);
    btn.classList.toggle('border-amber-500', match);
    btn.classList.toggle('bg-zinc-900', !match);
    btn.classList.toggle('text-zinc-300', !match);
  });

  if (k === 'close') {
    const { a } = tl();
    const closeItem = a.find(item => item.c);
    if (closeItem) {
      T = closeItem.st + 0.2;
      upd();
    }
  } else if (k === 'cap' || k === 'motion' || k === 'crop') {
    const o = tl().a[sel];
    if (o) {
      T = o.st + (k === 'cap' ? Math.min(o.d - 0.5, (o.s?.capDelay || 0.6) + 0.5) : 0);
      upd();
    }
  }
}

/**
 * Initializes Photo Showcase Studio
 */
export function initPhotoShowcase(options?: {
  defaultBrandTitle?: string;
  onSendToEditor?: (blob: Blob, name: string) => void;
}) {
  cv = document.getElementById('sc-cv') as HTMLCanvasElement;
  if (!cv) return;
  cx = cv.getContext('2d');

  if (options?.defaultBrandTitle) {
    C.title = options.defaultBrandTitle;
  }

  // Hook Playback
  document.getElementById('sc-pS')?.addEventListener('click', () => {
    const o = tl().a[sel];
    if (o) playShowcase(o.st, o.st + o.d);
  });
  document.getElementById('sc-pA')?.addEventListener('click', () => {
    T = 0;
    playShowcase(0, tl().total);
  });
  document.getElementById('sc-pX')?.addEventListener('click', stopShowcase);

  const scRange = document.getElementById('sc-sc') as HTMLInputElement | null;
  scRange?.addEventListener('input', e => {
    stopShowcase();
    T = +(e.target as HTMLInputElement).value;
    render();
  });

  // Photo Add buttons
  const addBtn = document.getElementById('sc-addb');
  const fileInput = document.getElementById('sc-up') as HTMLInputElement | null;
  addBtn?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', e => {
    const target = e.target as HTMLInputElement;
    if (target.files) addFiles(target.files);
    target.value = '';
  });

  // Strip Selection Click
  const stripEl = document.getElementById('sc-strip');
  stripEl?.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('.sc-th') as HTMLElement | null;
    if (b && b.dataset.i !== undefined) {
      sel = +b.dataset.i;
      strip();
      sync();
      goSel();
    }
  });

  // Operations: Earlier, Later, Duplicate, Remove
  document.getElementById('sc-ops')?.addEventListener('click', e => {
    const target = e.target as HTMLElement;
    const op = target.dataset.op;
    if (!op || !S.length) return;

    if (op === 'del') {
      S.splice(sel, 1);
      sel = clamp(sel, 0, S.length - 1);
    } else if (op === 'dup') {
      const clone = { ...S[sel] };
      S.splice(sel + 1, 0, clone);
      sel++;
    } else {
      const j = op === 'up' ? sel - 1 : sel + 1;
      if (j >= 0 && j < S.length) {
        const tmp = S[sel];
        S[sel] = S[j];
        S[j] = tmp;
        sel = j;
      }
    }
    T = 0;
    strip();
    sync();
    goSel();
  });

  // Tabs
  document.getElementById('sc-tabs')?.addEventListener('click', e => {
    const t = (e.target as HTMLElement).dataset.t;
    if (t) switchTab(t);
  });

  // Form Controls Input Synchronization
  const modal = document.getElementById('modal-photo-showcase');
  modal?.addEventListener('input', e => {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    const k = el.dataset.k;
    if (!k) return;
    const o = obj(el.dataset.sc || '');
    if (!o) return;

    if (el.type === 'checkbox') {
      o[k] = (el as HTMLInputElement).checked;
    } else if (el.type === 'range' || k === 'fps') {
      o[k] = +el.value;
    } else {
      o[k] = el.value;
    }

    const out = el.parentElement?.querySelector('output');
    if (out) out.textContent = String(o[k]);

    if (k === 'pan') sync();
    if (el.dataset.sc === 's') {
      goSel();
    } else {
      upd();
    }
  });

  // Tap-the-Photo Crosshair Target Picker
  const pk = document.getElementById('sc-pk');
  if (pk) {
    pk.addEventListener('pointerdown', e => {
      const s = S[sel];
      if (!s) return;
      const r = pk.getBoundingClientRect();
      const x = clamp((e.clientX - r.left) / r.width, 0, 1);
      const y = clamp((e.clientY - r.top) / r.height, 0, 1);

      if (mode === 'end') {
        s.pan = true;
        s.fx2 = x;
        s.fy2 = y;
      } else {
        s.fx = x;
        s.fy = y;
        if (!s.pan) {
          s.fx2 = x;
          s.fy2 = y;
        }
      }
      sync();
      goSel();
    });
  }

  // Radio button for Target mode
  modal?.addEventListener('change', e => {
    const target = e.target as HTMLInputElement;
    if (target.name === 'sc-m') {
      mode = target.value;
    }
  });

  // Presets Click (Deep dramatic, Luxury slow, Extreme detail)
  modal?.addEventListener('click', e => {
    const target = e.target as HTMLElement;
    const p = target.dataset.pre;
    if (!p || !S[sel]) return;
    const s = S[sel];

    if (p === 'B') {
      // Deep dramatic
      Object.assign(s, {
        sec: 12,
        zs: 1,
        zmax: 4,
        tin: 5,
        hold: 0,
        ze: 1.15,
        tilt0: 15,
        tilt1: 15,
        curve: 'dramatic'
      });
    } else if (p === 'A') {
      // Luxury slow
      Object.assign(s, {
        sec: 12,
        zs: 1,
        zmax: 2.5,
        tin: 7,
        hold: 0,
        ze: 1,
        tilt0: 5,
        tilt1: 5,
        curve: 'smooth'
      });
    } else {
      // Extreme detail
      Object.assign(s, {
        sec: 8,
        zs: 1,
        zmax: 5,
        tin: 2,
        hold: 2,
        ze: 1,
        tilt0: 10,
        tilt1: 10,
        curve: 'dramatic'
      });
    }
    sync();
    goSel();
  });

  // Logo upload
  const lgInput = document.getElementById('sc-lg') as HTMLInputElement | null;
  lgInput?.addEventListener('change', e => {
    const target = e.target as HTMLInputElement;
    const f = target.files?.[0];
    if (!f) return;
    const im = new Image();
    im.onload = () => {
      G.logo = im;
      upd();
    };
    im.src = URL.createObjectURL(f);
  });

  // Export / Video Creation
  const exBtn = document.getElementById('sc-ex') as HTMLButtonElement | null;
  const exn = document.getElementById('sc-exn');
  const resEl = document.getElementById('sc-res');

  exBtn?.addEventListener('click', () => {
    const { total } = tl();
    if (!total) {
      if (exn) exn.textContent = 'Add at least one photo first.';
      return;
    }
    if (!cv || !cv.captureStream || typeof MediaRecorder === 'undefined') {
      if (exn) exn.textContent = 'This browser cannot record video. Try Chrome or Safari 16+.';
      return;
    }

    const mimeTypes = [
      'video/mp4;codecs=avc1',
      'video/mp4',
      'video/webm;codecs=vp9',
      'video/webm'
    ];
    const mt = mimeTypes.find(m => MediaRecorder.isTypeSupported(m)) || 'video/webm';
    lastExt = mt.includes('mp4') ? 'mp4' : 'webm';

    const ch: BlobPart[] = [];
    const stream = cv.captureStream(G.fps);
    const rec = new MediaRecorder(stream, { mimeType: mt, videoBitsPerSecond: 8e6 });

    rec.ondataavailable = ev => {
      if (ev.data.size) ch.push(ev.data);
    };

    rec.onstop = () => {
      lastBlob = new Blob(ch, { type: mt });
      if (exBtn) exBtn.disabled = false;
      if (exn) exn.textContent = `Done. ${lastExt.toUpperCase()} video ready!`;

      if (resEl) {
        const blobUrl = URL.createObjectURL(lastBlob);
        resEl.innerHTML = `
          <div class="mt-4 p-4 rounded-xl bg-zinc-900 border border-zinc-700/80 space-y-3">
            <video controls playsinline class="w-full max-w-[260px] mx-auto rounded-xl border border-zinc-700 shadow-xl" src="${blobUrl}"></video>
            <div class="flex flex-col sm:flex-row gap-2 pt-1">
              <a href="${blobUrl}" download="furniture_showcase.${lastExt}" class="flex-1 py-3 px-4 bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs rounded-xl shadow transition-colors flex items-center justify-center gap-2 cursor-pointer text-center">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                <span>Save video (${lastExt.toUpperCase()})</span>
              </a>
              <button id="sc-btn-send-editor" type="button" class="flex-1 py-3 px-4 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl shadow transition-colors flex items-center justify-center gap-2 cursor-pointer">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                <span>Send to editor timeline</span>
              </button>
            </div>
          </div>
        `;

        document.getElementById('sc-btn-send-editor')?.addEventListener('click', () => {
          if (lastBlob && options?.onSendToEditor) {
            options.onSendToEditor(lastBlob, `Showcase_${Date.now()}.${lastExt}`);
            closePhotoShowcase();
          }
        });
      }
    };

    if (exBtn) exBtn.disabled = true;
    if (exn) exn.textContent = 'Recording in real-time… please keep this screen open.';
    T = 0;
    rec.start(250);
    playShowcase(
      0,
      total,
      () => {
        if (rec.state === 'recording') rec.stop();
      },
      (curT) => {
        if (exn) {
          const pct = Math.min(100, Math.round((curT / total) * 100));
          exn.textContent = `Recording showcase video: ${curT.toFixed(1)}s / ${total.toFixed(1)}s (${pct}%)`;
        }
      }
    );
  });

  // Close Button
  document.getElementById('sc-btn-close')?.addEventListener('click', closePhotoShowcase);

  // Initial State Sync
  switchTab('motion');
  strip();
  sync();
  upd();
}

/**
 * Open Photo Showcase Studio Modal
 */
export function openPhotoShowcase(brandTitle?: string) {
  if (brandTitle && (!C.title || C.title === 'Your Brand Name')) {
    C.title = brandTitle;
  }
  const modal = document.getElementById('modal-photo-showcase');
  if (modal) {
    modal.classList.remove('hidden');
    sync();
    upd();
  }
}

/**
 * Close Photo Showcase Studio Modal
 */
export function closePhotoShowcase() {
  stopShowcase();
  const modal = document.getElementById('modal-photo-showcase');
  if (modal) {
    modal.classList.add('hidden');
  }
}
