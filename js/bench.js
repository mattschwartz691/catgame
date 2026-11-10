// ?bench=1 : a one-minute on-device measurement. Switches parts of the picture off in turn and
// reports the frame rate for each, so a slow phone can say exactly what it is slow at.
export async function runBench(g) {
  const { R, cat, world, props, scene } = g;
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;left:8px;right:8px;top:8px;z-index:99;background:rgba(0,0,0,.82);color:#fff;font:12px/1.45 ui-monospace,Menlo,monospace;padding:10px;border-radius:10px;white-space:pre-wrap;user-select:text;-webkit-user-select:text;pointer-events:auto';
  document.body.appendChild(box);
  const lines = []; const say = s => { lines.push(s); box.textContent = lines.join('\n'); };
  const gl = R.r.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
  say('Measuring, about a minute. Please leave the phone alone…');
  say(`gpu: ${ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '?'}`);
  say(`screen ${innerWidth}x${innerHeight} dpr ${devicePixelRatio}  tier ${R.tierName}`);
  R.locked = true;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  let cpu = 0; const render = R.render.bind(R);
  R.render = (a, b) => { const t = performance.now(); render(a, b); cpu += performance.now() - t; };
  const measure = (label) => new Promise(res => {
    let n = 0, worst = 0, slow = 0, prev = 0, t0 = 0; cpu = 0;
    const f = (now) => {
      if (!t0) { t0 = prev = now; return requestAnimationFrame(f); }
      const d = now - prev; prev = now; n++; if (d > worst) worst = d; if (d > 34) slow++;
      if (now - t0 < 4000) return requestAnimationFrame(f);
      const i = R.r.info.render;
      say(`${label.padEnd(15)} ${(n * 1000 / (now - t0)).toFixed(0).padStart(3)} fps  worst ${worst.toFixed(0)}ms  slow ${slow}  draw ${(cpu / n).toFixed(1)}ms  ${i.calls}c ${(i.triangles / 1000).toFixed(0)}k`);
      res();
    };
    setTimeout(() => requestAnimationFrame(f), 1500);          // let any shader rebuild settle first
  });
  g.input.keys = {}; cat.teleport(-3.6, 0, 3.3, 0); await wait(1500);
  await measure('as played');
  const s0 = R.scale; R.scale = s0 * 0.5; R.resize(); await measure('half resolution'); R.scale = s0; R.resize();
  const n0 = cat.model.nShells; cat.model.setShells(1); await measure('no fur'); cat.model.setShells(n0);
  world.sun.castShadow = false; await measure('no shadows'); world.sun.castShadow = true;
  const ps = props.list.map(p => p.g).filter(o => o.parent === scene); ps.forEach(o => scene.remove(o)); await measure('no small props'); ps.forEach(o => scene.add(o));
  const rooms = [world.street, ...world.areas.map(a => a.scene || a.root).filter(Boolean)].filter(o => o && o.parent); const par = rooms.map(o => o.parent);
  rooms.forEach(o => o.parent.remove(o)); await measure('cat alone'); rooms.forEach((o, k) => par[k].add(o));
  cat.model.group.visible = false; await measure('no cat'); cat.model.group.visible = true;
  g.input.keys = { KeyW: true, KeyD: true }; await measure('running about'); g.input.keys = {};
  R.render = render;
  say('Done. Screenshot this and send it over.');
}
