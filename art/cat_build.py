"""Build the cat: SDF -> mesh -> UVs -> skin weights -> coat textures -> game files.
Run:  blender -b --python art/cat_build.py -- [stage]      stage: shape | full
"""
import bpy, sys, os, json, time, math
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import importlib, sdf, cat_def
from sdf import *
import pyopenvdb as vdb

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
STAGE = ARGS[0] if ARGS else 'full'
OUT = '/mnt/data/Games/tools/out'
ASSETS = os.path.join(HERE, '..', 'assets', 'cat')
VOX = 0.0042 if STAGE == 'shape' else 0.0058
t0 = time.time()
def log(*a): print('[cat %.1fs]' % (time.time() - t0), *a, flush=True)

# ------------------------------------------------------------------ mesh
model = cat_def.build()
lo, hi = V(-.19, -.012, -.62), V(.19, .60, .43)
n = np.ceil((hi - lo) / VOX).astype(int) + 1
ax = [lo[i] + np.arange(n[i], dtype=F) * VOX for i in range(3)]
G = np.stack(np.meshgrid(*ax, indexing='ij'), -1).reshape(-1, 3)
log('grid', n, len(G))
d = model.sdf(G).reshape(n)
grid = vdb.FloatGrid(background=1.0)
grid.copyFromArray(d.astype(np.float32))
grid.transform = vdb.createLinearTransform(voxelSize=VOX)
pts, quads = grid.convertToQuads(isovalue=0.0)
P = (pts + lo).astype(F)
quads = quads.astype(np.int64)
for it in range(4):                      # snap vertices exactly onto the surface
    dd = model.sdf(P); g = model.grad(P)
    P = P - g * (dd / np.maximum(np.einsum('ij,ij->i', g, g), 1e-6))[:, None]
N = model.grad(P); N /= norm(N)[:, None]
# make winding agree with the outward normals
fn = np.cross(P[quads[:, 1]] - P[quads[:, 0]], P[quads[:, 2]] - P[quads[:, 0]])
if np.mean(np.einsum('ij,ij->i', fn, N[quads[:, 0]])) < 0:
    quads = quads[:, ::-1]
log('mesh verts', len(P), 'quads', len(quads))

def to_bl(a):       # cat (x,y,z) -> blender (x,-z,y)
    return np.stack([a[:, 0], -a[:, 2], a[:, 1]], -1)

def make_object(name, P, quads, N):
    me = bpy.data.meshes.new(name)
    me.from_pydata(to_bl(P).tolist(), [], quads.tolist())
    me.update()
    for p in me.polygons: p.use_smooth = True
    me.normals_split_custom_set_from_vertices(to_bl(N).tolist())
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob

# ------------------------------------------------------------------ preview rendering
def setup_preview():
    sc = bpy.context.scene
    for o in list(bpy.data.objects):
        if o.type in ('MESH', 'LIGHT', 'CAMERA') and o.name != 'cat': bpy.data.objects.remove(o)
    sc.render.engine = 'CYCLES'; sc.cycles.samples = 48; sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = 720, 560
    sc.view_settings.view_transform = 'Standard'
    w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (0.75, 0.82, 0.95, 1); w.node_tree.nodes['Background'].inputs[1].default_value = 0.55
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 2.2; sun.data.angle = 0.2
    sun.rotation_euler = (math.radians(50), 0, math.radians(35)); sc.collection.objects.link(sun)
    bpy.ops.mesh.primitive_plane_add(size=8); fl = bpy.context.object
    fm = bpy.data.materials.new('floor'); fm.use_nodes = True; fm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.55, .5, .46, 1); fl.data.materials.append(fm)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.lens = 50
    return cam

def shoot(cam, name, pos, target):
    from mathutils import Vector
    cam.location = Vector((pos[0], -pos[2], pos[1]))
    tgt = Vector((target[0], -target[2], target[1]))
    cam.rotation_euler = (tgt - cam.location).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.render.filepath = os.path.join(OUT, name + '.png')
    bpy.ops.render.render(write_still=True)

VIEWS = [('side', (1.25, .32, .0), (0, .27, -.03)), ('front34', (.75, .42, 1.05), (0, .28, .02)),
         ('face', (.18, .43, .95), (0, .40, .28)), ('back34', (-.8, .6, -1.0), (0, .27, -.05)),
         ('top', (.05, 1.5, .0), (0, .2, -.05)), ('faceside', (.75, .42, .45), (0, .41, .27))]

if STAGE == 'shape':
    ob = make_object('cat', P, quads, N)
    mat = bpy.data.materials.new('clay'); mat.use_nodes = True
    b = mat.node_tree.nodes['Principled BSDF']; b.inputs['Base Color'].default_value = (.8, .62, .45, 1); b.inputs['Roughness'].default_value = .6
    ob.data.materials.append(mat)
    cam = setup_preview()
    for v in VIEWS: shoot(cam, 'cat_' + v[0], v[1], v[2])
    log('done shape')
    sys.exit(0)

# ================================================================== full build
tp = cat_def.tail_points()
J = cat_def.J
NOSE = cat_def.hs(V(0, .3725, .40))

# ---- triangles (split each quad along its shorter diagonal)
q = quads
d02 = norm(P[q[:, 0]] - P[q[:, 2]]); d13 = norm(P[q[:, 1]] - P[q[:, 3]])
a = d02 <= d13
T = np.concatenate([
    np.stack([q[a, 0], q[a, 1], q[a, 2]], 1), np.stack([q[a, 0], q[a, 2], q[a, 3]], 1),
    np.stack([q[~a, 0], q[~a, 1], q[~a, 3]], 1), np.stack([q[~a, 1], q[~a, 2], q[~a, 3]], 1)])
log('tris', len(T))
# ---- decimate: the fur shells multiply every triangle, so keep the skin light
_me = bpy.data.meshes.new('dec'); _me.from_pydata(to_bl(P).tolist(), [], T.tolist()); _me.update()
_ob = bpy.data.objects.new('dec', _me); bpy.context.scene.collection.objects.link(_ob)
bpy.context.view_layer.objects.active = _ob; _ob.select_set(True)
_m = _ob.modifiers.new('d', 'DECIMATE'); _m.ratio = 0.38
bpy.ops.object.modifier_apply(modifier='d')
_me = _ob.data; _me.calc_loop_triangles()
_v = np.empty(len(_me.vertices) * 3, dtype=np.float32); _me.vertices.foreach_get('co', _v); _v = _v.reshape(-1, 3)
P = np.stack([_v[:, 0], _v[:, 2], -_v[:, 1]], -1).astype(F)
T = np.empty(len(_me.loop_triangles) * 3, dtype=np.int32); _me.loop_triangles.foreach_get('vertices', T); T = T.reshape(-1, 3).astype(np.int64)
bpy.data.objects.remove(_ob)
for it in range(3):
    dd = model.sdf(P); g = model.grad(P)
    P = P - g * (dd / np.maximum(np.einsum('ij,ij->i', g, g), 1e-6))[:, None]
N = model.grad(P); N /= norm(N)[:, None]
log('decimated to', len(P), 'verts', len(T), 'tris')

# ---- UV unwrap (xatlas: few large charts, tightly packed)
import xatlas
atlas = xatlas.Atlas(); atlas.add_mesh(P.astype(np.float32), T.astype(np.uint32))
co = xatlas.ChartOptions(); co.max_iterations = 4; co.max_cost = 6.0; co.normal_deviation_weight = 1.0
po = xatlas.PackOptions(); po.resolution = 2048; po.padding = 8; po.bilinear = True
atlas.generate(chart_options=co, pack_options=po)
vmap, TRI, VUV = atlas[0]
vsrc = vmap.astype(np.int64); TRI = TRI.astype(np.uint32); VUV = VUV.astype(F)
VP, VN = P[vsrc], N[vsrc]
log('atlas verts', len(VP), 'tris', len(TRI), 'charts', atlas.chart_count)

# ---- rasterise UV space -> 3D rest position per texel
RES = 2048
pos = np.zeros((RES, RES, 3), dtype=F); filled = np.zeros((RES, RES), dtype=bool)
uvp = VUV * RES
for t in TRI:
    a, b, c = uvp[t[0]], uvp[t[1]], uvp[t[2]]
    x0 = max(int(math.floor(min(a[0], b[0], c[0]) - 1)), 0); x1 = min(int(math.ceil(max(a[0], b[0], c[0]) + 1)), RES - 1)
    y0 = max(int(math.floor(min(a[1], b[1], c[1]) - 1)), 0); y1 = min(int(math.ceil(max(a[1], b[1], c[1]) + 1)), RES - 1)
    if x1 < x0 or y1 < y0: continue
    xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + .5, np.arange(y0, y1 + 1) + .5)
    den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
    if abs(den) < 1e-12: continue
    w0 = ((b[1] - c[1]) * (xs - c[0]) + (c[0] - b[0]) * (ys - c[1])) / den
    w1 = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / den
    w2 = 1 - w0 - w1
    e = -0.6 / max(1.0, math.sqrt(abs(den)))        # slightly conservative so seams are covered
    m = (w0 >= e) & (w1 >= e) & (w2 >= e)
    if not m.any(): continue
    pp = w0[m][:, None] * VP[t[0]] + w1[m][:, None] * VP[t[1]] + w2[m][:, None] * VP[t[2]]
    yy = (ys[m] - .5).astype(int); xx = (xs[m] - .5).astype(int)
    pos[yy, xx] = pp; filled[yy, xx] = True
log('raster filled', filled.mean())

# ---- shared analysis
def analyse(Pq):
    W, parts = model.analyse(Pq)
    W = W / np.maximum(W.sum(1, keepdims=True), 1e-9)
    n = model.grad(Pq); n /= np.maximum(norm(n), 1e-9)[:, None]
    return W, parts, n

BI = cat_def.BI
def masks(Pq, W, parts, n):
    x, y, z = Pq[:, 0], Pq[:, 1], Pq[:, 2]
    ax = np.abs(x)
    m = {}
    tailw = W[:, BI['tail0']:BI['tail8'] + 1]
    m['tail'] = tailw.sum(1)
    m['tailt'] = (tailw * np.arange(9, dtype=F)).sum(1) / np.maximum(m['tail'], 1e-6) / 8.0
    m['ear'] = W[:, BI['earL']] + W[:, BI['earR']]
    m['earin'] = 1 - sstep(.0, .004, parts['earin'])
    m['nose'] = 1 - sstep(.0008, .0028, parts['nose'])
    m['muzzle'] = 1 - sstep(.0, .012, np.minimum(parts['muzzle'], parts['chin']))
    m['legf'] = W[:, BI['FLu']] + W[:, BI['FLl']] + W[:, BI['FLp']] + W[:, BI['FRu']] + W[:, BI['FRl']] + W[:, BI['FRp']]
    m['legh'] = sum(W[:, BI[k]] for k in ('HLt', 'HLs', 'HLm', 'HLp', 'HRt', 'HRs', 'HRm', 'HRp'))
    m['leg'] = np.clip(m['legf'] + m['legh'], 0, 1)
    m['legd'] = 1 - sstep(.0, .012, np.minimum.reduce([parts[k] for k in ('legfu', 'legfl', 'leght', 'leghs', 'leghm')]))
    m['paw'] = 1 - sstep(.0, .01, np.minimum(parts['pawf'], parts['pawh']))
    m['pad'] = m['paw'] * sstep(.55, .85, -n[:, 1]) * (y < .02)
    m['head'] = W[:, BI['head']] + W[:, BI['jaw']] + m['ear']
    m['torso'] = np.clip(W[:, BI['hips']] + W[:, BI['chest']], 0, 1)
    ed = np.minimum(norm(Pq - J['eye']), norm(Pq - cat_def.mx(J['eye'])))
    m['eyerim'] = 1 - sstep(cat_def.EYE_R + .001, cat_def.EYE_R + .007, ed)
    m['eyed'] = ed
    m['under'] = sstep(.25, .75, -n[:, 1])
    m['top'] = sstep(.2, .8, n[:, 1])
    return m

def mix(a, b, t):
    return a + (np.asarray(b, dtype=F) - a) * t[:, None]

def rgb(h):
    c = np.array([(h >> 16) & 255, (h >> 8) & 255, h & 255], dtype=F) / 255.0
    return c

def coat_mango(Pq, W, parts, n, m):
    x, y, z = Pq[:, 0], Pq[:, 1], Pq[:, 2]; ax = np.abs(x)
    nz = fbm(Pq, 9.0, 4, 3); nz2 = fbm(Pq, 30.0, 3, 9)
    base = np.tile(rgb(0xE08A30), (len(Pq), 1))
    base = mix(base, rgb(0xC9701C), m['top'] * m['torso'] * .8)            # deeper along the back
    base = mix(base, rgb(0xEFA552), sstep(.35, .0, n[:, 1]) * .5)
    stripe = rgb(0x9C4E10)
    # mackerel stripes: bands across the body that lean back toward the belly
    ph = (z + .22 * (.34 - y) + (nz - .5) * .07) / .05
    s = sstep(.45, .72, np.sin(ph * 2 * np.pi) * .5 + .5 + (nz2 - .5) * .35)
    body = np.clip(m['torso'] * 1.3 - m['legd'] * .6, 0, 1) * (1 - m['under']) * sstep(.22, .15, z) * sstep(-.25, -.2, z)
    col = mix(base, stripe, s * body * .9)
    # dorsal line
    col = mix(col, stripe, (1 - sstep(.006, .02, ax)) * m['top'] * m['torso'] * sstep(.2, .1, z) * .9)
    # leg bars
    lb = sstep(.5, .8, np.sin((y + (nz - .5) * .03) / .042 * 2 * np.pi) * .5 + .5)
    col = mix(col, stripe, lb * m['legd'] * sstep(.2, .16, y) * sstep(.07, .1, y) * .8)
    # tail rings
    tr = sstep(.45, .75, np.sin(m['tailt'] * 2 * np.pi * 4.2 + 1.0) * .5 + .5)
    col = mix(col, stripe, tr * m['tail'] * .9)
    # head: forehead "M" + cheek streaks
    fh = m['head'] * sstep(.44, .465, y) * sstep(.26, .30, z) * (1 - m['ear'])
    ms = sstep(.5, .8, np.sin(ax / .024 * 2 * np.pi + 1.2) * .5 + .5) * (1 - sstep(.055, .07, ax))
    col = mix(col, stripe, ms * fh * .85)
    ck = m['head'] * sstep(.055, .075, ax) * sstep(.42, .39, y) * sstep(.33, .30, z) * (1 - m['ear'])
    cs = sstep(.5, .8, np.sin((y - z * .5) / .024 * 2 * np.pi) * .5 + .5)
    col = mix(col, stripe, cs * ck * .7)
    cream = rgb(0xFBEBD0)
    belly = m['under'] * m['torso'] * sstep(.08, .03, ax) * sstep(-.24, -.16, z)
    col = mix(col, cream, np.clip(belly * 1.2, 0, 1))
    bib = (1 - sstep(.0, .03, parts['bib'])) * sstep(.1, .5, n[:, 2]) * sstep(.33, .28, y)
    col = mix(col, cream, bib * .9)
    col = mix(col, cream, m['muzzle'])
    col = mix(col, cream, m['paw'] * sstep(.07, .04, y))
    col = mix(col, cream, sstep(.86, .97, m['tailt']) * m['tail'])
    col = mix(col, rgb(0xF6C9A0), sstep(.03, .0, parts['cheek']) * sstep(.37, .35, y) * .5)
    col = mix(col, rgb(0xF2A9A0), m['earin'])
    col = mix(col, rgb(0x7A3A12), m['eyerim'] * .8)
    col = mix(col, rgb(0xE07F86), m['nose'])
    col = mix(col, rgb(0xE9968F), m['pad'])
    return col

def coat_domino(Pq, W, parts, n, m):
    x, y, z = Pq[:, 0], Pq[:, 1], Pq[:, 2]; ax = np.abs(x)
    nz = fbm(Pq, 10.0, 4, 5)
    black = rgb(0x2B2B33); white = rgb(0xF7F5F0)
    col = np.tile(black, (len(Pq), 1))
    col = mix(col, rgb(0x3C3C48), m['top'] * .5 + (nz - .5) * .3)
    e = (nz - .5) * .03
    bib = sstep(.12 + e, .16 + e, z) * sstep(.068 + e, .045 + e, ax) * sstep(.345 + e, .32 + e, y) * (m['torso'] + (1 - m['head']) * (1 - m['leg'])).clip(0, 1) * sstep(-.3, .2, n[:, 2] - n[:, 1] * .3)
    col = mix(col, white, np.clip(bib, 0, 1))
    belly = m['under'] * m['torso'] * sstep(.06 + e, .025 + e, ax)
    col = mix(col, white, np.clip(belly * 1.2, 0, 1))
    # muzzle + blaze up the nose bridge
    col = mix(col, white, m['muzzle'])
    bl = m['head'] * sstep(.335, .35, z) * sstep(.022 + e - (y - .36) * .22, .012 + e - (y - .36) * .22, ax) * sstep(.43, .41, y) * sstep(.33, .345, y)
    col = mix(col, white, np.clip(bl, 0, 1))
    col = mix(col, white, m['legf'] * sstep(.075 + e, .06 + e, y))
    col = mix(col, white, m['legh'] * sstep(.115 + e, .1 + e, y))
    col = mix(col, white, sstep(.84, .9, m['tailt'] + e * 2) * m['tail'])
    col = mix(col, rgb(0xD99A9E), m['earin'])
    col = mix(col, rgb(0x0E0E12), m['eyerim'] * .9)
    col = mix(col, rgb(0xE8A0AA), m['nose'])
    col = mix(col, rgb(0xE9A3A8), m['pad'])
    return col

def coat_miso(Pq, W, parts, n, m):
    x, y, z = Pq[:, 0], Pq[:, 1], Pq[:, 2]; ax = np.abs(x)
    nz = fbm(Pq, 9.0, 4, 11)
    col = np.tile(rgb(0xF1E6D2), (len(Pq), 1))
    col = mix(col, rgb(0xDCC8A6), m['top'] * m['torso'] * .75 + (nz - .5) * .15)
    col = mix(col, rgb(0xFAF3E6), m['under'] * m['torso'])
    seal = rgb(0x3A281E); seal2 = rgb(0x5A4030)
    dn = norm(Pq - cat_def.hs(V(0, .385, .37)))
    mask = (1 - sstep(.056, .118 + (nz - .5) * .03, dn)) * m['head']
    col = mix(col, seal2, np.clip(mask * .7, 0, 1)); col = mix(col, seal, np.clip(mask * 1.6 - .6, 0, 1))
    col = mix(col, seal, np.clip(m['ear'] * 1.3, 0, 1))
    lg = m['leg'] * sstep(.2 + (nz - .5) * .06, .07, y)
    col = mix(col, seal2, np.clip(lg * 1.2, 0, 1) * .8); col = mix(col, seal, np.clip(lg * 2 - 1, 0, 1))
    col = mix(col, seal, np.clip(m['tail'] * sstep(-.02, .12, m['tailt']) * 1.1, 0, 1))
    col = mix(col, rgb(0x6B4A44), m['earin'] * .8)
    col = mix(col, rgb(0x1E1410), m['eyerim'] * .85)
    col = mix(col, rgb(0x2A1C18), m['nose'])
    col = mix(col, rgb(0x4A3430), m['pad'])
    return col

# ---- coats painted from photos of the user's own cats (images/)
def head_coords(Pq):
    Ph = cat_def.HEAD_PIVOT + (Pq - cat_def.HEAD_PIVOT) / cat_def.HEAD_S     # un-scaled head space, as in cat_def
    return np.abs(Ph[:, 0]), Ph[:, 1], Ph[:, 2], Ph

def tabby(Pq, n, m, base, light, dark, seed, body_s=.8, head_s=.8, leg_s=.8):
    """Ticked mackerel tabby: agouti speckle, broken body stripes, leg bars, ringed tail, forehead M."""
    x, y, z = Pq[:, 0], Pq[:, 1], Pq[:, 2]; ax = np.abs(x)
    hx, hy, hz, Ph = head_coords(Pq)
    nz = fbm(Pq, 9.0, 4, seed); nz2 = fbm(Pq, 30.0, 3, seed + 6); brk = fbm(Pq, 15.0, 3, seed + 21)
    tick = fbm(Pq, 170.0, 2, seed + 13); tick2 = fbm(Pq, 70.0, 2, seed + 17)
    col = np.tile(base, (len(Pq), 1))
    col = mix(col, light, sstep(.35, -.35, n[:, 1]) * .55 + (nz - .5) * .25)
    col = mix(col, dark, m['top'] * m['torso'] * .3)
    col = col * (.74 + .34 * tick + .2 * tick2)[:, None]
    ph = (z + .25 * (.34 - y) + (nz - .5) * .09) / .043
    s = sstep(.58, .8, np.sin(ph * 2 * np.pi) * .5 + .5 + (nz2 - .5) * .55) * sstep(.34, .52, brk + .1)
    body = np.clip(m['torso'] * 1.3 - m['legd'] * .6, 0, 1) * (1 - m['under']) * sstep(.24, .16, z) * sstep(-.27, -.2, z)
    col = mix(col, dark, s * body * body_s)
    col = mix(col, dark, (1 - sstep(.008, .028, ax)) * m['top'] * m['torso'] * sstep(.2, .1, z) * .8)
    lb = sstep(.5, .78, np.sin((y + (nz - .5) * .03) / .038 * 2 * np.pi) * .5 + .5)
    col = mix(col, dark, lb * m['legd'] * sstep(.22, .17, y) * sstep(.05, .08, y) * sstep(.25, .5, brk + .15) * leg_s)
    tr = sstep(.42, .7, np.sin(m['tailt'] * 2 * np.pi * 5.2 + 1.0) * .5 + .5)
    col = mix(col, dark, tr * m['tail'] * .92)
    col = mix(col, dark, sstep(.8, .88, m['tailt']) * m['tail'])
    # head: forehead lines running back over the crown, cheek streaks, a line back from each eye
    hd = np.clip(m['head'], 0, 1) * (1 - m['ear'])
    fh = hd * sstep(.412, .43, hy) * sstep(.17, .24, hz)
    ms = sstep(.6, .84, np.sin((hx + (nz - .5) * .012) / .0175 * 2 * np.pi + 1.25) * .5 + .5 + (nz2 - .5) * .3) * (1 - sstep(.058, .072, hx))
    col = mix(col, dark, ms * fh * head_s)
    ck = hd * sstep(.05, .07, hx) * sstep(.405, .385, hy) * sstep(.335, .30, hz)
    cs = sstep(.52, .8, np.sin((hy - hz * .55) / .021 * 2 * np.pi) * .5 + .5 + (nz2 - .5) * .25)
    col = mix(col, dark, cs * ck * head_s * .75)
    Pa = np.stack([hx, hy, hz], -1)
    de, _ = sd_roundcone(Pa, V(.068, .402, .318), V(.1, .388, .25), .0, .0)
    col = mix(col, dark, (1 - sstep(.003, .008, de)) * hd * head_s)
    col = mix(col, dark, np.clip(m['ear'] - m['earin'], 0, 1) * sstep(.5, .56, hy) * .6)       # dark ear tips
    return col

def coat_moons(Pq, W, parts, n, m):
    """Moons: brown mackerel tabby, pale muzzle, brick nose, black-tipped ringed tail."""
    x, y, z = Pq[:, 0], Pq[:, 1], Pq[:, 2]
    hx, hy, hz, Ph = head_coords(Pq)
    col = tabby(Pq, n, m, rgb(0x6F5F4B), rgb(0x907E65), rgb(0x221A15), 31, body_s=.5, leg_s=.6)
    tan = rgb(0xC4AD8A); pale = rgb(0xDCCBB0)
    belly = m['under'] * m['torso']
    col = mix(col, tan, np.clip(belly, 0, 1) * .75)
    bib = (1 - sstep(.0, .03, parts['bib'])) * sstep(.1, .5, n[:, 2]) * sstep(.33, .28, y)
    col = mix(col, tan, bib * .45)
    col = mix(col, tan, sstep(.006, .016, m['eyed'] - cat_def.EYE_R) * sstep(.03, .016, m['eyed'] - cat_def.EYE_R) * .55)   # pale spectacles
    col = mix(col, pale, m['muzzle'] * .9)
    chin = np.clip(m['head'], 0, 1) * sstep(.362, .345, hy) * sstep(.30, .34, hz) * sstep(.05, .03, hx)
    col = mix(col, pale, chin * .9)
    dn = norm(Ph - V(0, .385, .375))
    col = mix(col, rgb(0xC6946A), (1 - sstep(.012, .034, dn)) * sstep(.37, .378, hy) * .6)      # warm nose bridge
    col = mix(col, rgb(0xD9A9A0), m['earin'] * .85)
    col = mix(col, rgb(0x17110E), m['eyerim'] * .9)
    col = mix(col, rgb(0xA4584E), m['nose'])
    col = mix(col, rgb(0x3A2A27), m['pad'])
    return col

def coat_noons(Pq, W, parts, n, m):
    """Noons: dark tabby cap, saddle and tail over white; white blaze, muzzle, chest, legs and belly."""
    x, y, z = Pq[:, 0], Pq[:, 1], Pq[:, 2]; ax = np.abs(x)
    hx, hy, hz, Ph = head_coords(Pq)
    dark = rgb(0x1B1715)
    tab = tabby(Pq, n, m, rgb(0x40372F), rgb(0x6C5E49), dark, 47, body_s=.7)
    hd = np.clip(m['head'], 0, 1)
    tab = mix(tab, dark, hd * sstep(.418, .45, hy) * (1 - sstep(.055, .095, hx)) * .88)      # near-black crown
    e = (fbm(Pq, 6.0, 3, 53) - .5) * .075; e2 = (fbm(Pq, 22.0, 3, 59) - .5) * .02
    yb = np.interp(z, [-.3, -.2, -.06, .08, .16, .27], [.13, .17, .255, .30, .335, .42]).astype(F) + e + e2
    w = sstep(yb + .01, yb - .01, y)
    w = np.maximum(w, np.clip(m['legf'] * 1.6, 0, 1))                                          # white forelegs and shoulders
    patch = m['legf'] * (x > 0) * sstep(.065, .08, y) * sstep(.15, .13, y) * sstep(.52, .58, fbm(Pq, 14.0, 3, 61))
    w = w * (1 - np.clip(patch, 0, 1))                                                         # one tabby smudge on a foreleg
    w = w * (1 - np.clip(m['tail'] * 1.5, 0, 1))
    eh = e * .12 + e2 * .25
    lower = sstep(.394 - hx * .56 + eh + .006, .394 - hx * .56 + eh - .006, hy)
    wd = .0125 + .022 * sstep(.398, .376, hy) + eh
    blaze = sstep(wd + .003, wd - .003, hx) * sstep(.447, .435, hy + hx * .25) * sstep(.3, .32, hz)
    wh = np.clip(np.maximum.reduce([lower, blaze, m['muzzle']]), 0, 1)
    smudge = 1 - sstep(.0065, .0115, norm(Ph - V(-.019, .367, .388)))                            # the tabby freckle beside the nose
    wh = wh * (1 - smudge)
    tab = mix(tab, rgb(0x8C6E50), smudge * .7)
    w = w * (1 - hd) + wh * hd
    white = mix(np.tile(rgb(0xF7F4EE), (len(Pq), 1)), rgb(0xECE4D8), fbm(Pq, 12.0, 3, 67) * .6)
    col = mix(tab, white, np.clip(w, 0, 1))
    col = mix(col, rgb(0xDDA8A4), m['earin'] * .85)
    col = mix(col, mix(np.tile(dark, (len(Pq), 1)), rgb(0x8A7466), np.clip(w, 0, 1)), m['eyerim'] * .85)
    col = mix(col, rgb(0xE29A92), m['nose'])
    col = mix(col, rgb(0xE8A6A6), m['pad'])
    return col

COATS = {'noons': coat_noons, 'moons': coat_moons, 'mango': coat_mango, 'domino': coat_domino, 'miso': coat_miso}
ONLY = [a[5:] for a in ARGS if a.startswith('only=')]
if ONLY: COATS = {k: v for k, v in COATS.items() if k in ONLY[0].split(',')}

def dilate(img, filled, n=12):
    img = img.copy(); f = filled.copy()
    for _ in range(n):
        acc = np.zeros_like(img); cnt = np.zeros(f.shape, dtype=F)
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            sf = np.roll(f, (dy, dx), (0, 1)); si = np.roll(img, (dy, dx), (0, 1))
            acc += si * sf[..., None]; cnt += sf
        new = (~f) & (cnt > 0)
        img[new] = acc[new] / cnt[new][:, None]; f |= new
    return img

idx = np.argwhere(filled)
Pt = pos[filled]
log('analysing texels', len(Pt))
Wt, partst, nt = analyse(Pt)
mt = masks(Pt, Wt, partst, nt)
# soft ambient occlusion-ish shading from concavity: darken creases a little
cav = np.clip(model.sdf(Pt + nt * .012) / .012, 0, 1)
shade = (0.72 + 0.28 * cav)[:, None]
os.makedirs(ASSETS, exist_ok=True)
tex = {}
for name, fn in COATS.items():
    c = np.clip(fn(Pt, Wt, partst, nt, mt), 0, 1)
    # the little "Y" of the mouth under the nose
    H_ = cat_def.hs
    dm = np.full(len(Pt), 1e3, dtype=F)
    for (a_, b_) in ((V(0, .364, .398), V(0, .349, .392)), (V(0, .349, .392), V(.021, .341, .384)), (V(0, .349, .392), V(-.021, .341, .384))):
        dd, _ = sd_roundcone(Pt, H_(a_), H_(b_), .0, .0); dm = np.minimum(dm, dd)
    mouth = (1 - sstep(.0016, .0034, dm)) * (Pt[:, 2] > H_(V(0, 0, .36))[2])
    c = mix(c, rgb(0x2A1612) if name != 'miso' else rgb(0x120A08), mouth * .85) * shade
    img = np.zeros((RES, RES, 3), dtype=F); img[filled] = c
    img = dilate(img, filled)
    tex[name] = img
    bi = bpy.data.images.new('coat_' + name, RES, RES, alpha=False)
    rgba = np.concatenate([img, np.ones((RES, RES, 1), dtype=F)], -1)
    bi.pixels.foreach_set(rgba.ravel()); bi.filepath_raw = os.path.join(OUT, 'coat_%s.png' % name); bi.file_format = 'PNG'; bi.save()
    log('coat', name)

# ---- per-vertex data: skin weights, fur groom
Wv, partsv, nv = analyse(VP)
mv = masks(VP, Wv, partsv, nv)
order = np.argsort(-Wv, axis=1)[:, :4]
sw = np.take_along_axis(Wv, order, 1); sw = sw / sw.sum(1, keepdims=True)
x, y, z = VP[:, 0], VP[:, 1], VP[:, 2]
L = np.full(len(VP), .015, dtype=F)
L = L + .004 * mv['under'] * mv['torso'] + .006 * (1 - sstep(0, .03, partsv['bib']))
L = np.where(mv['head'] > .5, .011, L)
L = L + .008 * (1 - sstep(0, .02, partsv['cheek'])) * sstep(.38, .35, y)
L = L * (1 - .55 * mv['leg'] * sstep(.2, .08, y))
L = L * (1 - .75 * mv['paw'])
L = np.where(mv['tail'] > .5, .021, L)
L = L * (1 - .7 * mv['ear']); L = L * (1 - .9 * mv['earin'])
L = L * (1 - .7 * mv['muzzle']) * (1 - mv['nose']) * (1 - mv['pad'])
L = L * sstep(cat_def.EYE_R - .001, cat_def.EYE_R + .012, mv['eyed'])
# flow field the fur is combed along
flow = np.tile(V(0, -.45, -1), (len(VP), 1))
hd = VP - NOSE; hd /= np.maximum(norm(hd), 1e-6)[:, None]
flow = mix(flow, hd, np.clip(mv['head'], 0, 1))
flow = mix(flow, V(0, -1, -.25), np.clip(mv['leg'], 0, 1))
tdir = np.zeros_like(VP)
for i in range(9):
    dseg = tp[i + 1] - tp[i]; tdir += Wv[:, BI['tail%d' % i]][:, None] * (dseg / np.linalg.norm(dseg))
flow = mix(flow, tdir, np.clip(mv['tail'], 0, 1))
flow = flow - nv * np.einsum('ij,ij->i', flow, nv)[:, None]
flow /= np.maximum(norm(flow), 1e-6)[:, None]
groom = nv * .62 + flow * .38; groom /= norm(groom)[:, None]

meta = dict(nVerts=int(len(VP)), nTris=int(len(TRI)), bones=cat_def.BONES,
            joints={k: [float(c) for c in v] for k, v in J.items()}, tail=[[float(c) for c in p] for p in tp],
            eyeR=cat_def.EYE_R, tailSeg=cat_def.TAIL_SEG, nose=[float(c) for c in NOSE],
            layout=['position:f32x3', 'normal:f32x3', 'uv:f32x2', 'skinIndex:u8x4', 'skinWeight:f32x4', 'groom:f32x4', 'index:u32x3'])
with open(os.path.join(ASSETS, 'cat.bin'), 'wb') as f:
    f.write(VP.astype('<f4').tobytes()); f.write(VN.astype('<f4').tobytes()); f.write(VUV.astype('<f4').tobytes())
    f.write(order.astype(np.uint8).tobytes()); f.write(sw.astype('<f4').tobytes())
    f.write(np.concatenate([groom, L[:, None]], 1).astype('<f4').tobytes()); f.write(TRI.astype('<u4').tobytes())
json.dump(meta, open(os.path.join(ASSETS, 'cat.json'), 'w'))
log('exported', meta['nVerts'], meta['nTris'])

# ---- look-dev renders
if 'norender' not in ARGS:
    cam = setup_preview()
    def tex_obj(name, dx):
        me = bpy.data.meshes.new(name)
        me.from_pydata(to_bl(VP + V(dx, 0, 0)).tolist(), [], TRI.tolist()); me.update()
        for p in me.polygons: p.use_smooth = True
        me.normals_split_custom_set_from_vertices(to_bl(VN).tolist())
        uvl = me.uv_layers.new(name='uv'); li = np.empty(len(me.loops), dtype=np.int32); me.loops.foreach_get('vertex_index', li)
        uvl.data.foreach_set('uv', VUV[li].ravel())
        o = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(o)
        mat = bpy.data.materials.new(name); mat.use_nodes = True; nt_ = mat.node_tree
        b = nt_.nodes['Principled BSDF']; b.inputs['Roughness'].default_value = .75
        b.inputs['Sheen Weight'].default_value = .6; b.inputs['Sheen Roughness'].default_value = .5
        ti = nt_.nodes.new('ShaderNodeTexImage'); ti.image = bpy.data.images['coat_' + name]
        nt_.links.new(ti.outputs['Color'], b.inputs['Base Color'])
        me.materials.append(mat)
        eyec = {'mango': (.35, .6, .12, 1), 'domino': (.85, .62, .08, 1), 'miso': (.15, .45, .85, 1), 'noons': (.5, .5, .1, 1), 'moons': (.45, .6, .15, 1)}[name]
        for sx in (1, -1):
            e = J['eye'] * V(sx, 1, 1) + V(dx, 0, 0)
            bpy.ops.mesh.primitive_uv_sphere_add(radius=cat_def.EYE_R, location=(e[0], -e[2], e[1])); eo = bpy.context.object
            bpy.ops.object.shade_smooth()
            em = bpy.data.materials.new('eye'); em.use_nodes = True; eb = em.node_tree.nodes['Principled BSDF']
            eb.inputs['Base Color'].default_value = eyec; eb.inputs['Roughness'].default_value = .05; eb.inputs['Coat Weight'].default_value = 1
            eo.data.materials.append(em)
            bpy.ops.mesh.primitive_uv_sphere_add(radius=.012, location=(e[0], -e[2] - cat_def.EYE_R + .003, e[1])); po = bpy.context.object
            po.scale = (.55, .5, 1.25); pm = bpy.data.materials.new('pupil'); pm.use_nodes = True
            pm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0, 0, 0, 1); pm.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = .05
            po.data.materials.append(pm)
    for i, name in enumerate(COATS): tex_obj(name, (i - 1) * .5)
    R = bpy.context.scene.render
    R.resolution_x, R.resolution_y = 760, 520
    for i, name in enumerate(COATS):
        dx = (i - 1) * .5
        for o in bpy.data.objects:
            if o.type == 'MESH' and o.name != 'Plane': o.hide_render = abs(o.location.x - dx) > .2 if o.name.startswith('Sphere') else (o.name != name)
        shoot(cam, 'coat_side_' + name, (dx + 1.5, .4, .1), (dx, .27, -.05))
        shoot(cam, 'coat_face_' + name, (dx + .28, .44, .85), (dx, .40, .27))
        shoot(cam, 'coat_front_' + name, (dx + .02, .5, 1.1), (dx, .30, .2))
        shoot(cam, 'coat_back_' + name, (dx - .9, 1.0, -.9), (dx, .25, -.05))
log('done')
