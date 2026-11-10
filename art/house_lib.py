"""Blender-side toolkit for building the house: geometry helpers, PBR materials from Poly Haven,
asset placement, colliders, lightmap unwrap/pack/bake and export.
All public helpers take GAME coordinates: x east, y up, z south (Blender = (x, -z, y))."""
import bpy, bmesh, sys, os, json, math, time
import numpy as np
from mathutils import Matrix, Vector
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import ph, xatlas

LIB = '/mnt/data/Games/tools/cache/assets.blend'
CATALOG = json.load(open('/mnt/data/Games/tools/cache/catalog.json'))
T0 = time.time()
def log(*a): print('[house %.0fs]' % (time.time() - T0), *a, flush=True)

S = dict(colliders=[], props=[], scratch=[], spots=[], zones=[], lights=[], windows=[], fades={}, items=[], treats=[], nav=[])
STATIC = []          # objects that get lightmapped + exported
BAKE_ONLY = []       # objects only present for the light bake (ceiling ...)
EXT = []             # exported but not lightmapped (outdoors)
MATS = {}
_lm_cache = {}
_lib_loaded = set()

def B(x, y, z): return Vector((x, -z, y))

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for k in S: S[k] = {} if isinstance(S[k], dict) else []
    WALLS.clear(); STATIC.clear(); BAKE_ONLY.clear(); EXT.clear(); MATS.clear(); _lm_cache.clear(); _lib_loaded.clear(); _IMG.clear()

# ------------------------------------------------------------------ materials
_IMG = {}
def _img(path, colorspace='sRGB'):
    # our own cache: check_existing would also match tinted copies of the same file and tint them twice
    key = (path, colorspace)
    if key not in _IMG or _IMG[key].name not in bpy.data.images:
        im = bpy.data.images.load(path, check_existing=False); im.colorspace_settings.name = colorspace; _IMG[key] = im
    return _IMG[key]

def pbr(name, tex, tile=1.0, tint=None, rough=None, normal=1.0, res='1k', nonormal=False):
    """Tiling PBR material from a Poly Haven texture set. tile = metres covered by one repeat."""
    if name in MATS: return MATS[name]
    t = ph.texture(tex, res)
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    d = nt.nodes.new('ShaderNodeTexImage')
    im = _img(t['Diffuse'])
    if tint is not None:
        im = im.copy(); im.name = name + '_diff'
        px = np.empty(im.size[0] * im.size[1] * 4, dtype=np.float32); im.pixels.foreach_get(px)
        px = px.reshape(-1, 4); px[:, :3] = np.clip(px[:, :3] * np.array(tint, dtype=np.float32), 0, 1)
        im.pixels.foreach_set(px.ravel()); im.pack()
    d.image = im
    nt.links.new(d.outputs['Color'], b.inputs['Base Color'])
    if 'arm' in t:
        a = nt.nodes.new('ShaderNodeTexImage'); a.image = _img(t['arm'], 'Non-Color')
        sp = nt.nodes.new('ShaderNodeSeparateColor'); nt.links.new(a.outputs['Color'], sp.inputs['Color'])
        nt.links.new(sp.outputs['Green'], b.inputs['Roughness']); nt.links.new(sp.outputs['Blue'], b.inputs['Metallic'])
    if rough is not None:
        for l in list(b.inputs['Roughness'].links): nt.links.remove(l)
        b.inputs['Roughness'].default_value = rough
    if 'nor_gl' in t and not nonormal:
        n = nt.nodes.new('ShaderNodeTexImage'); n.image = _img(t['nor_gl'], 'Non-Color')
        nm = nt.nodes.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value = normal
        nt.links.new(n.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
    m['tile'] = tile
    MATS[name] = m
    return m

def flat(name, rgb, rough=0.6, metal=0.0, emit=None, emit_strength=1.0, alpha=1.0):
    if name in MATS: return MATS[name]
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    c = [((v / 255.0) ** 2.2 if max(rgb) > 1 else v) for v in rgb]
    b.inputs['Base Color'].default_value = (*c, 1); b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
    if emit is not None:
        e = [((v / 255.0) ** 2.2 if max(emit) > 1 else v) for v in emit]
        b.inputs['Emission Color'].default_value = (*e, 1); b.inputs['Emission Strength'].default_value = emit_strength
    if alpha < 1: b.inputs['Alpha'].default_value = alpha; m.blend_method = 'BLEND'
    m['tile'] = 1.0
    MATS[name] = m
    return m

def hexc(h): return ((h >> 16) & 255, (h >> 8) & 255, h & 255)

# ------------------------------------------------------------------ geometry
def _finish(bm, name, mat, static=True, smooth=False, uvbox=True):
    me = bpy.data.meshes.new(name)
    if uvbox:
        uv = bm.loops.layers.uv.new('UVMap')
        tile = (mat.get('tile', 1.0) if mat else 1.0) or 1.0
        for f in bm.faces:
            n = f.normal; a = (abs(n.x), abs(n.y), abs(n.z))
            for l in f.loops:
                co = l.vert.co
                if a[2] >= a[0] and a[2] >= a[1]: l[uv].uv = (co.x / tile, co.y / tile)
                elif a[0] >= a[1]: l[uv].uv = (co.y / tile, co.z / tile)
                else: l[uv].uv = (co.x / tile, co.z / tile)
    bm.to_mesh(me); bm.free()
    if smooth:
        for p in me.polygons: p.use_smooth = True
    ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob)
    if mat: me.materials.append(mat)
    if static: STATIC.append(ob)
    return ob

def collider(x0, x1, y0, y1, z0, z1, **kw):
    c = dict(b=[round(v, 4) for v in (min(x0, x1), max(x0, x1), y0, y1, min(z0, z1), max(z0, z1))])
    c.update({k: v for k, v in kw.items() if v is not None})
    S['colliders'].append(c)
    return c

def box(x0, x1, y0, y1, z0, z1, mat, bevel=0.006, collide=True, name='box', static=True, segs=2, **ckw):
    x0, x1 = min(x0, x1), max(x0, x1); z0, z1 = min(z0, z1), max(z0, z1)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    c = B((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
    for v in bm.verts:
        v.co = Vector((v.co.x * (x1 - x0), v.co.y * (z1 - z0), v.co.z * (y1 - y0))) + c
    bevel = min(bevel, (x1 - x0) * .45, (y1 - y0) * .45, (z1 - z0) * .45)
    if bevel > 0.0005:
        bmesh.ops.bevel(bm, geom=bm.edges[:], offset=bevel, segments=segs, affect='EDGES', profile=0.5)
    bm.normal_update()
    ob = _finish(bm, name, mat, static, smooth=segs > 2)
    if collide: collider(x0, x1, y0, y1, z0, z1, **ckw)
    return ob

def cyl(x, z, y0, y1, r, mat, r_top=None, seg=24, collide=True, name='cyl', static=True, bevel=0.004, **ckw):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r if r_top is None else r_top, depth=y1 - y0)
    for v in bm.verts: v.co += B(x, (y0 + y1) / 2, z)
    if bevel > 0:
        ed = [e for e in bm.edges if abs(e.verts[0].co.z - e.verts[1].co.z) < 1e-6]
        bmesh.ops.bevel(bm, geom=ed, offset=min(bevel, (y1 - y0) * .4), segments=2, affect='EDGES', profile=0.5)
    bm.normal_update()
    ob = _finish(bm, name, mat, static, smooth=True)
    if collide:
        h = max(r, r_top or r) * 0.8
        collider(x - h, x + h, y0, y1, z - h, z + h, **ckw)
    return ob

def lathe(x, z, y, profile, mat, seg=28, name='lathe', static=True, smooth=True):
    """profile: list of (radius, height) from bottom to top."""
    bm = bmesh.new(); rings = []
    for (r, h) in profile:
        rings.append([bm.verts.new(B(x + math.cos(a) * r, y + h, z + math.sin(a) * r)) for a in [i * 2 * math.pi / seg for i in range(seg)]])
    for i in range(len(rings) - 1):
        for j in range(seg):
            a, b_, c, d = rings[i][j], rings[i][(j + 1) % seg], rings[i + 1][(j + 1) % seg], rings[i + 1][j]
            try: bm.faces.new((a, d, c, b_))
            except ValueError: pass
    if profile[0][0] > 1e-4: bm.faces.new(rings[0])
    if profile[-1][0] > 1e-4: bm.faces.new(list(reversed(rings[-1])))
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return _finish(bm, name, mat, static, smooth=smooth)

def quad(pts, mat, name='quad', static=True, uvs=None):
    """Single quad from 4 game-space points (counter-clockwise seen from the front)."""
    bm = bmesh.new()
    vs = [bm.verts.new(B(*p)) for p in pts]
    f = bm.faces.new(vs); bm.normal_update()
    ob = _finish(bm, name, mat, static, uvbox=uvs is None)
    if uvs is not None:
        l = ob.data.uv_layers.new(name='UVMap')
        for i, uv in enumerate(uvs): l.data[i].uv = uv
    return ob

def join(objs, name):
    objs = [o for o in objs if o]
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1: bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active; ob.name = name
    for o in objs[1:]:
        if o in STATIC: STATIC.remove(o)
    return ob

# ------------------------------------------------------------------ library assets
def _lib(aid):
    if aid not in _lib_loaded:
        with bpy.data.libraries.load(LIB) as (src, dst):
            dst.objects = [aid]
        _lib_loaded.add(aid)
    return bpy.data.objects[aid]

def asset_size(aid): return CATALOG[aid]['size']

def put(aid, x, z, rot=0, y=0.0, scale=1.0, collide='solid', static=True, name=None, **ckw):
    """Place a library model. rot in degrees about the up axis; rot=0 keeps the model's front toward +z (south).
    collide: 'solid' | 'none' | ('table', top_thickness) | ('seat', seatH, backDepthFrac) | ('shelves', [heights...], depthFrac)
    Returns the new object."""
    src = _lib(aid)
    ob = bpy.data.objects.new(name or aid, src.data.copy())
    bpy.context.scene.collection.objects.link(ob)
    ob.matrix_world = Matrix.Translation(B(x, y, z)) @ Matrix.Rotation(math.radians(rot), 4, 'Z') @ Matrix.Scale(scale, 4)
    ob.data.transform(ob.matrix_world); ob.matrix_world = Matrix.Identity(4)
    ob['asset'] = aid
    if static: STATIC.append(ob)
    sx, sy, sz = [v * scale for v in CATALOG[aid]['size']]
    r = round(rot / 90) % 4
    hx, hz = (sx / 2, sz / 2) if r % 2 == 0 else (sz / 2, sx / 2)
    def fwd(d):          # local +z (front) offset d -> world (dx, dz)
        return [(0, d), (d, 0), (0, -d), (-d, 0)][r]
    if collide == 'solid':
        collider(x - hx, x + hx, y, y + sy, z - hz, z + hz, **ckw)
    elif isinstance(collide, tuple) and collide[0] == 'table':
        th = collide[1]; inset = collide[2] if len(collide) > 2 else 0.0
        collider(x - hx + inset, x + hx - inset, y + sy - th, y + sy, z - hz + inset, z + hz - inset, **ckw)
    elif isinstance(collide, tuple) and collide[0] == 'seat':
        seat, backf = collide[1], collide[2]
        arm = collide[3] if len(collide) > 3 else 0
        collider(x - hx, x + hx, y, y + seat, z - hz, z + hz, **ckw)
        d = (hz if r % 2 == 0 else hx)
        bx, bz = fwd(-d * (1 - backf))          # back strip centre
        if r % 2 == 0: collider(x - hx, x + hx, y + seat, y + sy, z + bz - d * backf, z + bz + d * backf, **ckw)
        else: collider(x + bx - d * backf, x + bx + d * backf, y + seat, y + sy, z - hz, z + hz, **ckw)
        if arm:
            ah, aw = arm
            if r % 2 == 0:
                collider(x - hx, x - hx + aw, y + seat, y + ah, z - hz, z + hz); collider(x + hx - aw, x + hx, y + seat, y + ah, z - hz, z + hz)
            else:
                collider(x - hx, x + hx, y + seat, y + ah, z - hz, z - hz + aw); collider(x - hx, x + hx, y + seat, y + ah, z + hz - aw, z + hz)
    elif isinstance(collide, tuple) and collide[0] == 'shelves':
        for h in collide[1]:
            collider(x - hx, x + hx, y + h - 0.03, y + h, z - hz, z + hz, **ckw)
        side = collide[2] if len(collide) > 2 else 0.03
        if r % 2 == 0:
            collider(x - hx, x - hx + side, y, y + sy, z - hz, z + hz, cam=ckw.get('cam')); collider(x + hx - side, x + hx, y, y + sy, z - hz, z + hz, cam=ckw.get('cam'))
        else:
            collider(x - hx, x + hx, y, y + sy, z - hz, z - hz + side, cam=ckw.get('cam')); collider(x - hx, x + hx, y, y + sy, z + hz - side, z + hz, cam=ckw.get('cam'))
    return ob

def prop(aid, x, y, z, rot=0, scale=1.0, **kw):
    """A dynamic (knockable) object: recorded for the game, not part of the static bake."""
    d = dict(asset=aid, p=[round(x, 3), round(y, 3), round(z, 3)], rot=rot, scale=scale); d.update(kw)
    S['props'].append(d); return d

# ------------------------------------------------------------------ lightmap UVs
def _tri_arrays(me):
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.triangulate(bm, faces=bm.faces[:]); bm.to_mesh(me); bm.free()
    n = len(me.vertices); V = np.empty(n * 3, dtype=np.float32); me.vertices.foreach_get('co', V); V = V.reshape(-1, 3)
    F = np.empty(len(me.polygons) * 3, dtype=np.int32); me.polygons.foreach_get('vertices', F); F = F.reshape(-1, 3)
    return V, F

def make_lm_uv(ob):
    """Unique-unwrapped second UV set in [0,1]; returns world surface area."""
    me = ob.data
    key = (ob.get('asset'), len(me.vertices))
    V, F = _tri_arrays(me)
    a = np.linalg.norm(np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]]), axis=1).sum() * 0.5
    if ob.get('asset') and key in _lm_cache:
        luv = _lm_cache[key]
    else:
        at = xatlas.Atlas(); at.add_mesh(V, F.astype(np.uint32))
        co = xatlas.ChartOptions(); co.max_iterations = 1; co.max_cost = 4.0
        po = xatlas.PackOptions(); po.padding = 3; po.resolution = int(np.clip(math.sqrt(a) * 160, 64, 1024)); po.bilinear = True
        at.generate(chart_options=co, pack_options=po)
        vmap, idx, uvs = at[0]
        luv = uvs[idx.reshape(-1)].astype(np.float32)      # per loop (3 per triangle, same face order)
        if ob.get('asset'): _lm_cache[key] = luv
    if 'UVMap' not in me.uv_layers and len(me.uv_layers) == 0: me.uv_layers.new(name='UVMap')
    lm = me.uv_layers.get('LM') or me.uv_layers.new(name='LM')
    lm.data.foreach_set('uv', luv.ravel())
    ob['lm_area'] = float(a)
    return float(a)

def pack_lightmaps(res, weight=lambda ob: 1.0, pad=3):
    """Give every static object its own square region of the atlas, sized by surface area."""
    items = []
    for ob in STATIC:
        a = make_lm_uv(ob)
        items.append((ob, math.sqrt(max(a, 1e-4)) * weight(ob)))
    def try_pack(k):
        rects = []; x = y = rowh = 0
        for ob, s in sorted(items, key=lambda t: -t[1]):
            w = int(min(max(s * k, 12), res - 2 * pad)) + 2 * pad
            if x + w > res: x = 0; y += rowh; rowh = 0
            if y + w > res: return None
            rects.append((ob, x + pad, y + pad, w - 2 * pad)); x += w; rowh = max(rowh, w)
        return rects
    lo, hi = 1.0, 4000.0
    for _ in range(40):
        mid = (lo + hi) / 2
        if try_pack(mid): lo = mid
        else: hi = mid
    rects = try_pack(lo)
    for ob, x, y, w in rects:
        lm = ob.data.uv_layers['LM']
        uv = np.empty(len(lm.data) * 2, dtype=np.float32); lm.data.foreach_get('uv', uv); uv = uv.reshape(-1, 2)
        uv[:, 0] = (x + uv[:, 0] * w) / res; uv[:, 1] = (y + uv[:, 1] * w) / res
        lm.data.foreach_set('uv', uv.ravel())
    log('lightmap packed: %d objects, %.0f texels per metre' % (len(rects), lo))
    return lo

# ------------------------------------------------------------------ baking
def bake_lightmap(res, samples, sun, out_npy):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = samples
    sc.cycles.use_denoising = False; sc.cycles.max_bounces = 6; sc.cycles.diffuse_bounces = 4
    sc.cycles.sample_clamp_indirect = 8.0; sc.cycles.caustics_reflective = False; sc.cycles.caustics_refractive = False
    img = bpy.data.images.new('LM', res, res, alpha=False, float_buffer=True)
    img.colorspace_settings.name = 'Non-Color'
    done = set()
    for ob in STATIC:
        ob.data.uv_layers.active = ob.data.uv_layers['LM']        # bake target (render UV stays on UVMap)
        if not ob.data.materials: ob.data.materials.append(flat('default', (0.8, 0.8, 0.8)))
        for m in ob.data.materials:
            if m is None or m.name in done: continue
            done.add(m.name)
            n = m.node_tree.nodes.new('ShaderNodeTexImage'); n.name = 'LMBAKE'; n.image = img
            for x in m.node_tree.nodes: x.select = False
            n.select = True; m.node_tree.nodes.active = n
    bpy.ops.object.select_all(action='DESELECT')
    for ob in STATIC: ob.select_set(True)
    bpy.context.view_layer.objects.active = STATIC[0]
    px = np.empty(res * res * 4, dtype=np.float32)
    def run(pass_filter):
        bpy.ops.object.bake(type='DIFFUSE', pass_filter=pass_filter, margin=6, use_clear=True)
        img.pixels.foreach_get(px)
        return px.reshape(res, res, 4)[:, :, :3].copy()
    sun.hide_render = False
    a = run({'INDIRECT'}); log('baked indirect')
    sun.hide_render = True
    b = run({'DIRECT'}); log('baked direct (sky + lamps)')
    sun.hide_render = False
    lm = a + b
    np.save(out_npy, lm)
    for m in bpy.data.materials:
        if m.use_nodes and 'LMBAKE' in m.node_tree.nodes: m.node_tree.nodes.remove(m.node_tree.nodes['LMBAKE'])
    for ob in STATIC:
        ob.data.uv_layers.active = ob.data.uv_layers[0]
    return lm

def bake_probes(x0, x1, z0, z1, y, cell, samples, sun):
    """Ambient light arriving from above on a grid at cat height (sun excluded). Returns (nz, nx, 3)."""
    nx, nz = int(round((x1 - x0) / cell)), int(round((z1 - z0) / cell))
    bm = bmesh.new()
    vs = [bm.verts.new(B(*p)) for p in ((x0, y, z1), (x1, y, z1), (x1, y, z0), (x0, y, z0))]
    bm.faces.new(vs); bm.normal_update()
    me = bpy.data.meshes.new('probe'); bm.to_mesh(me); bm.free()
    uv = me.uv_layers.new(name='UVMap')
    for i, c in enumerate(((0, 0), (1, 0), (1, 1), (0, 1))): uv.data[i].uv = c
    ob = bpy.data.objects.new('probe', me); bpy.context.scene.collection.objects.link(ob)
    for a in ('visible_diffuse', 'visible_glossy', 'visible_transmission', 'visible_shadow', 'visible_volume_scatter'):
        setattr(ob, a, False)
    m = bpy.data.materials.new('probe'); m.use_nodes = True
    img = bpy.data.images.new('PROBE', nx, nz, alpha=False, float_buffer=True)
    n = m.node_tree.nodes.new('ShaderNodeTexImage'); n.image = img; m.node_tree.nodes.active = n
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (1, 1, 1, 1)
    me.materials.append(m)
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active = ob
    sc = bpy.context.scene; sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.use_denoising = False
    sc.cycles.samples = samples
    sun.hide_render = True
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, margin=0, use_clear=True)
    sun.hide_render = False
    px = np.empty(nx * nz * 4, dtype=np.float32); img.pixels.foreach_get(px)
    bpy.data.objects.remove(ob)
    return px.reshape(nz, nx, 4)[:, :, :3]      # row 0 = z1 (south) ... flip so row 0 = z0


# ------------------------------------------------------------------ walls
def slab(axis, inner, outer, a0, a1, y0, y1, mat, name='wall'):
    """Half-thickness wall panel: a box from the wall's centre plane (inner) to its face (outer), without the hidden inner face."""
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    lo, hi = min(inner, outer), max(inner, outer)
    if axis == 'x': mn, mx = (lo, y0, a0), (hi, y1, a1)
    else: mn, mx = (a0, y0, lo), (a1, y1, hi)
    c = B((mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2)
    for v in bm.verts:
        v.co = Vector((v.co.x * (mx[0] - mn[0]), v.co.y * (mx[2] - mn[2]), v.co.z * (mx[1] - mn[1]))) + c
    bm.normal_update()
    n_in = B(*((inner - outer, 0, 0) if axis == 'x' else (0, 0, inner - outer))).normalized()
    kill = [f for f in bm.faces if f.normal.dot(n_in) > 0.9]
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    return _finish(bm, name, mat, static=False)

WALLS = []        # (axis, at, a0, a1, fade key) of every wall built, newest last
def wall_key(axis, at, a0, a1):
    """Fade key of the most recently built wall that this stretch lies against (so wall-hung things fade with it)."""
    for (ax, w_at, w0, w1, key) in reversed(WALLS):
        if ax == axis and abs(w_at - at) < 0.2 and a0 >= w0 - 0.4 and a1 <= w1 + 0.4: return key
    return None

def wall(axis, at, a0, a1, mat_neg, mat_pos, H, T, openings=(), key=None, ext=None, base=None, trim=None):
    """Wall on the plane axis=at from a0..a1. mat_neg faces the lower-coordinate side. openings: (b0, b1, y0, y1, kind).
    ext: 'neg' | 'pos' marks that side as outdoors (not lightmapped). Returns nothing; registers colliders."""
    ops = sorted(openings)
    WALLS.append((axis, at, a0, a1, key))
    for side, mat in (('neg', mat_neg), ('pos', mat_pos)):
        outer = at - T / 2 if side == 'neg' else at + T / 2
        pieces = []; cur = a0
        for (b0, b1, y0, y1, kind) in ops:
            if b0 > cur: pieces.append((cur, b0, 0, H))
            if y0 > 0: pieces.append((b0, b1, 0, y0))
            if y1 < H: pieces.append((b0, b1, y1, H))
            cur = b1
        if cur < a1: pieces.append((cur, a1, 0, H))
        objs = [slab(axis, at, outer, p[0], p[1], p[2], p[3], mat) for p in pieces]
        is_ext = ext == side
        if base is not None and not is_ext:        # skirting board on the room side
            d = -1 if side == 'neg' else 1
            for p in pieces:
                if p[2] == 0:
                    if axis == 'x': objs.append(box(outer, outer + d * 0.014, 0, 0.09, p[0], p[1], base, bevel=0.003, collide=False, static=False))
                    else: objs.append(box(p[0], p[1], 0, 0.09, outer, outer + d * 0.014, base, bevel=0.003, collide=False, static=False))
        ob = join(objs, 'wall')
        if is_ext:
            EXT.append(ob)
            if key: ob['fade'] = key
        else:
            STATIC.append(ob)
            if key: ob['fade'] = key
    # collision: doors and arches split the wall, windows do not
    cur = a0
    def col(s0, s1, y0, y1):
        if s1 - s0 < 1e-4: return
        if axis == 'x': collider(at - T / 2, at + T / 2, y0, y1, s0, s1, cam=True, fade=key)
        else: collider(s0, s1, y0, y1, at - T / 2, at + T / 2, cam=True, fade=key)
    for (b0, b1, y0, y1, kind) in ops:
        if kind in ('door', 'arch'):
            col(cur, b0, 0, H)
            if y1 < H: col(b0, b1, y1, H)
            cur = b1
    col(cur, a1, 0, H)
    # trims
    if trim is not None:
        for (b0, b1, y0, y1, kind) in ops:
            for side in ('neg', 'pos'):
                if ext == side: continue
                d = -1 if side == 'neg' else 1
                f0 = at + d * T / 2; f1 = f0 + d * 0.018
                w = 0.07
                parts = [(b0 - w, b0, y0 if kind == 'window' else 0, y1), (b1, b1 + w, y0 if kind == 'window' else 0, y1), (b0 - w, b1 + w, y1, y1 + w)]
                if kind == 'arch': parts = []
                objs = []
                for (s0, s1, yy0, yy1) in parts:
                    if axis == 'x': objs.append(box(f0, f1, yy0, yy1, s0, s1, trim, bevel=0.004, collide=False, static=False))
                    else: objs.append(box(s0, s1, yy0, yy1, f0, f1, trim, bevel=0.004, collide=False, static=False))
                if kind == 'window':
                    sd = 0.2            # sill: a ledge the cat can sit on
                    if axis == 'x':
                        objs.append(box(f0, f0 + d * sd, y0 - 0.04, y0, b0 - w, b1 + w, trim, bevel=0.008, collide=False, static=False))
                        collider(min(at, f0 + d * sd), max(at, f0 + d * sd), y0 - 0.04, y0, b0 - w, b1 + w, spot='windowsill')
                    else:
                        objs.append(box(b0 - w, b1 + w, y0 - 0.04, y0, f0, f0 + d * sd, trim, bevel=0.008, collide=False, static=False))
                        collider(b0 - w, b1 + w, y0 - 0.04, y0, min(at, f0 + d * sd), max(at, f0 + d * sd), spot='windowsill')
                if objs:
                    ob = join(objs, 'trim'); STATIC.append(ob)
                    if key: ob['fade'] = key
            if kind == 'window':
                # glazing bars in the wall plane + record the pane for the game
                bars = []
                mid = (b0 + b1) / 2; bw = 0.022
                for (s0, s1, yy0, yy1) in ((mid - bw, mid + bw, y0, y1), (b0, b1, (y0 + y1) / 2 + 0.25 - bw, (y0 + y1) / 2 + 0.25 + bw),
                                           (b0, b0 + bw * 2, y0, y1), (b1 - bw * 2, b1, y0, y1), (b0, b1, y0, y0 + bw * 2), (b0, b1, y1 - bw * 2, y1)):
                    if axis == 'x': bars.append(box(at - 0.02, at + 0.02, yy0, yy1, s0, s1, trim, bevel=0.003, collide=False, static=False))
                    else: bars.append(box(s0, s1, yy0, yy1, at - 0.02, at + 0.02, trim, bevel=0.003, collide=False, static=False))
                ob = join(bars, 'glazing'); STATIC.append(ob)
                if key: ob['fade'] = key
                S['windows'].append(dict(axis=axis, at=at, a=[b0, b1], y=[y0, y1], fade=key, ext=ext))


def blob(x, y, z, r, mat, squash=1.0, jitter=0.18, seed=0, name='blob'):
    """Lumpy sphere for foliage and bushes (outdoor dressing, not lightmapped)."""
    import random
    rng = random.Random(seed * 7919 + int(x * 31 + z * 17))
    bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=2, radius=r)
    for v in bm.verts:
        k = 1 + (rng.random() - 0.5) * 2 * jitter
        v.co = Vector((v.co.x * k, v.co.y * k, v.co.z * k * squash)) + B(x, y, z)
    bm.normal_update()
    ob = _finish(bm, name, mat, static=False, smooth=True)
    EXT.append(ob)
    return ob


def offset_data(S, ox, oz):
    """Move every recorded game coordinate by (ox, oz): lets a house be authored around its own origin."""
    if not ox and not oz: return
    def p3(p): p[0] = round(p[0] + ox, 4); p[2] = round(p[2] + oz, 4)
    def p2(p): p[0] = round(p[0] + ox, 4); p[1] = round(p[1] + oz, 4)
    def b4(b): b[0] += ox; b[1] += ox; b[2] += oz; b[3] += oz
    def plane(d):
        if d['axis'] == 'x': d['at'] += ox; d['a'] = [d['a'][0] + oz, d['a'][1] + oz]
        else: d['at'] += oz; d['a'] = [d['a'][0] + ox, d['a'][1] + ox]
    for c in S['colliders']: b = c['b']; b[0] += ox; b[1] += ox; b[4] += oz; b[5] += oz
    for d in S['props']: p3(d['p'])
    for d in S['scratch']:
        if d['type'] == 'floor': b4(d['b'])
        elif d['type'] == 'post': p2(d['p'])
        else: plane(d)
    for d in S['zones']:
        if 'b' in d: b4(d['b'])
        if 'p' in d: p3(d['p'])
    for d in S['lights']: p3(d['p'])
    for d in S['windows']: plane(d)
    for d in S['items']:
        for k in ('p', 'basin', 'screen'):
            if k in d: p3(d[k])
        if 'stand' in d: p2(d['stand'])
        if 'b' in d: b4(d['b'])
    for t in S['treats']: p3(t)
    for n in S['nav']: p2(n)


class level:
    """Build one storey as if its floor were at y=0, then lift everything made inside the block to floor height y."""
    def __init__(self, y): self.y = y
    def __enter__(self):
        self.objs = set(o.name for o in bpy.context.scene.collection.all_objects)
        self.n = {k: len(v) for k, v in S.items() if isinstance(v, list)}
        return self
    def __exit__(self, *e):
        y = self.y
        new = lambda k: S[k][self.n[k]:]
        for d in new('scratch') + new('zones'): d['y0'] = y
        for o in list(bpy.context.scene.collection.all_objects):
            if o.name not in self.objs: o['lv'] = float(y)
        if not y: return
        for o in list(bpy.context.scene.collection.all_objects):
            if o.name in self.objs: continue
            if o.type == 'MESH': o.data.transform(Matrix.Translation((0, 0, y)))
            else: o.location.z += y
        r = lambda v: round(v + y, 4)
        for c in new('colliders'): c['b'][2] = r(c['b'][2]); c['b'][3] = r(c['b'][3])
        for d in new('props') + new('lights'): d['p'][1] = r(d['p'][1])
        for d in new('scratch'):
            if 'y' in d: d['y'] = [r(d['y'][0]), r(d['y'][1])]
        for d in new('zones'):
            if 'p' in d: d['p'][1] = r(d['p'][1])
            if 'y' in d: d['y'] = r(d['y'])
        for d in new('windows'): d['y'] = [r(d['y'][0]), r(d['y'][1])]
        for d in new('items'):
            for k in ('p', 'basin', 'screen'):
                if k in d: d[k][1] = r(d[k][1])
            if 'y' in d: d['y'] = r(d['y'])
        for t in new('treats'): t[1] = r(t[1])
