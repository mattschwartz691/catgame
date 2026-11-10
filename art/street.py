"""The street outside: road, sidewalks, lawns, trees, neighbours, and the roofs / upper storeys ("shells") of both houses.
Nothing here is light-baked; it is lit by the real-time sun.   Run:  blender -b --python art/street.py -- [preview]
World coordinates: x east, y up, z south. The first house sits at the origin, the colonial at house2_rooms.ORIGIN."""
import bpy, bmesh, sys, os, json, math, random
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import house_lib as L
from house_lib import box, cyl, lathe, quad, put, prop, pbr, flat, hexc, collider, join, B, S, log
from mathutils import Vector
import house2_rooms as C

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = '/mnt/data/Games/tools/out'
ASSETS = os.path.join(HERE, '..', 'assets', 'street'); os.makedirs(ASSETS, exist_ok=True)
OX, OZ = C.ORIGIN
OUTER = [-24.0, 50.0, -15.5, 29.2]
ROAD = (15.0, 21.0)            # a narrow road with granite curbs and no sidewalks, lawns right up to it
rng = random.Random(11)
L.reset()
SHELL = {}          # site -> objects that are hidden while the cat is indoors there
_cur = [None]

def grab(fn, *a, **k):
    """Run a builder and return the static objects it created."""
    n = len(L.STATIC); fn(*a, **k); new = L.STATIC[n:]; del L.STATIC[n:]; return new

def shell(site):
    class _S:
        def __enter__(s): s.n = len(L.STATIC)
        def __exit__(s, *e): SHELL.setdefault(site, []).extend(L.STATIC[s.n:]); del L.STATIC[s.n:]
    return _S()

M = {}
def mats():
    M['grass'] = pbr('ext_grass', 'leafy_grass', tile=3.0, tint=(0.6, 0.88, 0.52), nonormal=True)
    M['road'] = pbr('ext_road', 'asphalt_02', tile=4.0, nonormal=True)
    M['walk'] = pbr('ext_walk', 'concrete_pavement', tile=2.0, nonormal=True)
    M['drive'] = pbr('ext_drive', 'asphalt_02', tile=4.0, tint=(0.62, 0.62, 0.64), nonormal=True)
    M['cobble'] = pbr('ext_walk_cobble', 'cobblestone_floor_08', tile=1.6, tint=(0.85, 0.85, 0.88), nonormal=True)
    M['brickpath'] = pbr('ext_brickpath', 'herringbone_brick', tile=1.5, nonormal=True)
    M['clap'] = pbr('ext_clap', 'white_planks_clean', tile=1.6, tint=(0.5, 0.2, 0.17), nonormal=True)
    M['clapw'] = pbr('ext_clap_w', 'white_planks_clean', tile=1.6, tint=(0.93, 0.92, 0.88), nonormal=True)
    M['plaster'] = pbr('ext_wall', 'plastered_wall_04', tile=3.0, tint=(1.0, 0.95, 0.86), nonormal=True)
    M['roof'] = pbr('ext_roof', 'grey_roof_tiles_02', tile=2.4, tint=(0.6, 0.6, 0.64), nonormal=True)
    M['roof2'] = pbr('ext_roof2', 'grey_roof_tiles_02', tile=2.4, tint=(0.78, 0.5, 0.4), nonormal=True)
    M['brick'] = pbr('ext_brick', 'red_brick_03', tile=1.2, nonormal=True)
    M['stone'] = pbr('ext_stone', 'stone_wall_04', tile=2.0, nonormal=True)
    M['white'] = flat('ext_white', hexc(0xF2EFE8), rough=0.6)
    M['taupe'] = flat('ext_taupe', hexc(0xB9AC96), rough=0.6); M['navy'] = flat('ext_navy', hexc(0x2B3444), rough=0.6); M['birch'] = flat('ext_birch', hexc(0xE4E0D6), rough=0.8)
    M['spruce'] = flat('ext_spruce', hexc(0x3A5650), rough=0.95); M['pine'] = flat('ext_pine', hexc(0x2F4A38), rough=0.95); M['maple'] = flat('ext_jmaple', hexc(0x6A2E2A), rough=0.95)
    M['gold'] = flat('ext_gold', hexc(0x9C8A4A), rough=0.95); M['rust'] = flat('ext_rust', hexc(0x8A5E3C), rough=0.95); M['lime'] = flat('ext_lime', hexc(0x76864A), rough=0.95)
    M['shutter'] = flat('ext_shutter', hexc(0x1F2A26), rough=0.6)
    M['glass'] = flat('ext_glassdark', hexc(0x27384A), rough=0.08, metal=0.5)
    M['hedge'] = flat('ext_hedge', hexc(0x34512F), rough=0.95)
    M['leaf'] = flat('ext_leaf', hexc(0x4C6B3A), rough=0.95); M['leaf2'] = flat('ext_leaf2', hexc(0x5E7F46), rough=0.95); M['leaf3'] = flat('ext_leaf3', hexc(0x3A5530), rough=0.95)
    M['autumn'] = flat('ext_autumn', hexc(0x8A7A3A), rough=0.95); M['autumn2'] = flat('ext_autumn2', hexc(0x6B7F3E), rough=0.95)
    M['bark'] = flat('ext_bark', hexc(0x4A3A30), rough=0.95)
    M['metal'] = flat('ext_metal', hexc(0x2A2C30), rough=0.4, metal=0.8)
    M['curb'] = flat('ext_curb', hexc(0xA6A6A2), rough=0.8)

def flatq(x0, x1, z0, z1, y, mat, name='ground'):
    return quad([(x0, y, z1), (x1, y, z1), (x1, y, z0), (x0, y, z0)], mat, name=name)

def tri(pts, mat, name='gable'):
    bm = bmesh.new(); vs = [bm.verts.new(B(*p)) for p in pts]; bm.faces.new(vs); bm.normal_update()
    return L._finish(bm, name, mat)

def gable(x0, x1, z0, z1, y0, rise, axis, roof, wallm, over=0.35, th=0.1):
    """Gable roof over a rectangle. axis = direction of the ridge ('x' or 'z'). Two thick slabs + the two wall triangles."""
    if axis == 'x':
        zm = (z0 + z1) / 2; k = rise / (zm - z0)
        for (za, zb) in ((z0 - over, zm), (z1 + over, zm)):
            ya = y0 - over * k
            bm = bmesh.new()
            p = [(x0 - over, ya, za), (x1 + over, ya, za), (x1 + over, y0 + rise, zb), (x0 - over, y0 + rise, zb)]
            vs = [bm.verts.new(B(*q)) for q in p] + [bm.verts.new(B(q[0], q[1] + th, q[2])) for q in p]
            for f in ((0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)): bm.faces.new([vs[i] for i in f])
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:]); L._finish(bm, 'roof', roof)
        for x, flip in ((x0, False), (x1, True)):
            pts = [(x, y0, z0), (x, y0, z1), (x, y0 + rise, zm)]
            tri(pts if flip else pts[::-1], wallm)
    else:
        xm = (x0 + x1) / 2; k = rise / (xm - x0)
        for (xa, xb) in ((x0 - over, xm), (x1 + over, xm)):
            ya = y0 - over * k
            bm = bmesh.new()
            p = [(xa, ya, z0 - over), (xa, ya, z1 + over), (xb, y0 + rise, z1 + over), (xb, y0 + rise, z0 - over)]
            vs = [bm.verts.new(B(*q)) for q in p] + [bm.verts.new(B(q[0], q[1] + th, q[2])) for q in p]
            for f in ((0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)): bm.faces.new([vs[i] for i in f])
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:]); L._finish(bm, 'roof', roof)
        for z, flip in ((z0, True), (z1, False)):
            pts = [(x0, y0, z), (x1, y0, z), (xm, y0 + rise, z)]
            tri(pts if flip else pts[::-1], wallm)

def window(axis, at, c, y0, y1, w, d, shutters=True, trim=None, shut=None, bars=1):
    """Dark pane + white frame (+ shutters) on an outside wall face. d = outward direction (+1/-1)."""
    a0, a1 = c - w / 2, c + w / 2; f = at + d * 0.012; t = 0.06
    def bx(s0, s1, yy0, yy1, m, dep=0.03):
        lo, hi = sorted((at, at + d * dep))
        if axis == 'z': box(s0, s1, yy0, yy1, lo, hi, m, bevel=0.004, collide=False)
        else: box(lo, hi, yy0, yy1, s0, s1, m, bevel=0.004, collide=False)
    bx(a0, a1, y0, y1, M['glass'], 0.012)
    for (s0, s1, yy0, yy1) in ((a0 - t, a0, y0 - t, y1 + t), (a1, a1 + t, y0 - t, y1 + t), (a0, a1, y1, y1 + t), (a0 - t * 1.4, a1 + t * 1.4, y0 - t, y0), (c - 0.015, c + 0.015, y0, y1), (a0, a1, (y0 + y1) / 2 - 0.015, (y0 + y1) / 2 + 0.015)):
        bx(s0, s1, yy0, yy1, trim or M['white'])
    for k in range(1, bars):
        xx = a0 + (a1 - a0) * k / bars; bx(xx - 0.03, xx + 0.03, y0, y1, trim or M['white'])
    if shutters:
        sw = w * 0.42
        sw = min(sw, 0.45)
        bx(a0 - t - sw, a0 - t, y0 - 0.02, y1 + 0.02, shut or M['shutter'], 0.035); bx(a1 + t, a1 + t + sw, y0 - 0.02, y1 + 0.02, shut or M['shutter'], 0.035)

def canopy(x, y, z, r, mats, n=16, squash=0.8, seed=0, sub=2, lump=(0.42, 0.22)):
    """A soft mass of foliage: overlapping, gently lumpy spheres in two close greens, darker underneath."""
    r_ = random.Random(seed * 131 + int(x * 17 + z * 29))
    groups = {}
    for k in range(n):
        a = r_.random() * 6.28; e = (r_.random() - 0.35) * 1.4; d = r * (0.25 + 0.5 * r_.random()) if lump[0] > 0.35 else r * (0.35 + 0.6 * r_.random() ** 0.6)
        cx, cy, cz = x + math.cos(a) * math.cos(e) * d, y + math.sin(e) * d * squash, z + math.sin(a) * math.cos(e) * d
        rr = r * (lump[0] + lump[1] * r_.random())
        m = mats[2] if (cy < y - r * 0.15 and len(mats) > 2) else mats[k % 2]
        bm = groups.setdefault(m.name, (bmesh.new(), m))[0]
        f1, f2, f3 = r_.random() * 6, r_.random() * 6, r_.random() * 6
        res = bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1.0)
        for v in res['verts']:
            p = v.co; k_ = 1 + 0.1 * math.sin(p.x * 3.1 + f1) + 0.1 * math.sin(p.y * 2.7 + f2) + 0.08 * math.sin(p.z * 3.7 + f3)
            v.co = Vector((p.x * rr * k_, p.y * rr * k_, p.z * rr * k_ * squash)) + B(cx, cy, cz)
    for bm, m in groups.values():
        bm.normal_update(); L._finish(bm, 'canopy', m, smooth=True)

def limb(p0, p1, r0, r1, mat):
    bm = bmesh.new(); a, b = B(*p0), B(*p1); d = b - a
    bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=r0, radius2=r1, depth=d.length)
    q = d.to_track_quat('Z', 'Y').to_matrix().to_4x4(); mid = (a + b) / 2
    for v in bm.verts: v.co = q @ v.co + mid
    bm.normal_update(); L._finish(bm, 'limb', mat, smooth=True)

def tree(x, z, h, kind=0, collide=True, n=30):
    """A big street hardwood in early-autumn colours."""
    tr = 0.24 if h > 8 else 0.18; fork = h * 0.42
    limb((x, 0, z), (x, fork, z), tr, tr * 0.7, M['bark'])
    for k in range(3):
        a = kind * 1.3 + k * 2.1; limb((x, fork - 0.1, z), (x + math.cos(a) * h * 0.16, h * 0.7, z + math.sin(a) * h * 0.16), tr * 0.6, tr * 0.25, M['bark'])
    if collide: collider(x - 0.2, x + 0.2, 0, 2.6, z - 0.2, z + 0.2)
    cols = [(M['leaf'], M['leaf2'], M['leaf3']), (M['leaf2'], M['lime'], M['leaf']), (M['lime'], M['gold'], M['leaf2']), (M['leaf'], M['lime'], M['leaf3']), (M['gold'], M['rust'], M['lime']), (M['leaf3'], M['leaf'], M['leaf3'])][kind % 6]
    if n >= 20: canopy(x, h * 0.74, z, h * 0.36, cols, n=n, seed=kind + int(x), lump=(0.24, 0.16))
    else: canopy(x, h * 0.74, z, h * 0.36, cols, n=n, seed=kind + int(x), sub=1)

def conifer(x, z, h, mat=None, collide=True):
    """Spruce / arborvitae: stacked drooping tiers."""
    mat = mat or M['spruce']
    limb((x, 0, z), (x, h * 0.9, z), 0.2 if h > 7 else 0.1, 0.03, M['bark'])
    tiers = max(5, int(h / 0.85)); base = h * 0.1
    for i in range(tiers):
        t = i / tiers; y0 = base + (h - base) * t; r = h * 0.19 * (1 - t) ** 0.9 + 0.22
        bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, segments=12, radius1=r, radius2=r * 0.3, depth=(h - base) / tiers * 2.2)
        for v in bm.verts:
            a = math.atan2(v.co.y, v.co.x); k = 1 + 0.12 * math.sin(a * 5 + i * 1.7)
            v.co = Vector((v.co.x * k, v.co.y * k, v.co.z)) + B(x, y0 + (h - base) / tiers * 0.8, z)
        bm.normal_update(); L._finish(bm, 'tier', mat, smooth=True)
    if collide: collider(x - 0.35, x + 0.35, 0, 2.6, z - 0.35, z + 0.35)

def birch(x, z, h=9):
    """A clump of white birch trunks under a light yellow-green crown."""
    for k, (dx, dz) in enumerate(((0, 0), (0.45, 0.2), (-0.2, 0.5))):
        limb((x + dx * 0.4, 0, z + dz * 0.4), (x + dx * 2.2, h * 0.75, z + dz * 2.2), 0.16, 0.06, M['birch'])
    collider(x - 0.3, x + 0.4, 0, 2.6, z - 0.2, z + 0.5)
    canopy(x + 0.3, h * 0.8, z + 0.4, h * 0.3, (M['lime'], M['gold'], M['leaf2']), n=14, seed=int(x))

def shrub(x, z, r=0.5, m=None, collide=True, squash=0.85):
    """Clipped, rounded shrub (boxwood, rhododendron)."""
    canopy(x, r * 0.72, z, r * 0.62, (m or M['hedge'], m or M['leaf3']), n=5, squash=squash, seed=int(x * 13 + z * 7))
    if collide: collider(x - r * 0.55, x + r * 0.55, 0, r * 1.2, z - r * 0.55, z + r * 0.55)

def leaves(x0, x1, z0, z1, n, seed=0):
    """Fallen leaves scattered on the ground."""
    r_ = random.Random(seed); bms = [(bmesh.new(), m) for m in (M['gold'], M['rust'], M['lime'])]
    for i in range(n):
        x, z, a, sz = r_.uniform(x0, x1), r_.uniform(z0, z1), r_.random() * 6.28, r_.uniform(0.05, 0.09)
        bm = bms[i % 3][0]; c, s_ = math.cos(a) * sz, math.sin(a) * sz
        vs = [bm.verts.new(B(x + px, 0.004 + (i % 5) * 0.0006, z + pz)) for (px, pz) in ((-c, -s_), (s_ * 0.6, -c * 0.6), (c, s_), (-s_ * 0.6, c * 0.6))]
        bm.faces.new(vs[::-1])
    for bm, m in bms: bm.normal_update(); L._finish(bm, 'leaves', m)

def hedge(x0, x1, z0, z1, h=1.4, col=True):
    """Clipped hedge."""
    box(x0, x1, 0, h, z0, z1, M['hedge'], bevel=0.12, segs=4, collide=False, name='hedge')
    if col: collider(x0, x1, 0, max(h, 1.6), z0, z1)

def mailbox(x, z, name):
    blk = flat('ext_black', hexc(0x1C1D1F), rough=0.5)
    box(x - 0.06, x + 0.06, 0, 1.0, z - 0.06, z + 0.06, blk, bevel=0.01, collide=False)
    box(x - 0.12, x + 0.12, 1.0, 1.26, z - 0.27, z + 0.27, blk, bevel=0.09, segs=4, collide=False)
    box(x + 0.12, x + 0.135, 1.12, 1.24, z + 0.06, z + 0.1, flat('ext_red', hexc(0xA83228), rough=0.5), bevel=0.003, collide=False)
    collider(x - 0.12, x + 0.12, 0, 1.26, z - 0.27, z + 0.27, spot=name)

def bins(x, z):
    """Trash and recycling out at the curb."""
    blk = flat('ext_black', hexc(0x1C1D1F), rough=0.5); grn = flat('ext_bingreen', hexc(0x2F6B45), rough=0.6)
    box(x - 0.33, x + 0.33, 0.06, 1.05, z - 0.36, z + 0.36, blk, bevel=0.04, segs=3, collide=False, name='wheeliebin'); box(x - 0.36, x + 0.36, 1.05, 1.12, z - 0.4, z + 0.38, blk, bevel=0.02, collide=False)
    box(x + 0.75, x + 1.25, 0, 0.36, z - 0.2, z + 0.2, grn, bevel=0.03, segs=3, collide=False, name='recycling')
    collider(x - 0.36, x + 0.36, 0, 1.12, z - 0.4, z + 0.38, spot='the wheelie bin'); collider(x + 0.75, x + 1.25, 0, 0.36, z - 0.2, z + 0.2)

def lamp_post(x, z):
    cyl(x, z, 0, 3.4, 0.05, M['metal'], r_top=0.035, seg=10, collide=False, bevel=0)
    lathe(x, z, 3.4, [(0.05, 0), (0.16, 0.06), (0.13, 0.3), (0.2, 0.34), (0.02, 0.5)], M['metal'], name='lamphead', seg=12)
    cyl(x, z, 3.47, 3.68, 0.1, flat('ext_lampglass', hexc(0xFFF3D0), rough=0.3, emit=hexc(0xFFE2A8), emit_strength=0.6), seg=10, collide=False, bevel=0)
    collider(x - 0.06, x + 0.06, 0, 2.6, z - 0.06, z + 0.06)

def car(cx, zc, col, yaw90=False, name='parked car'):
    """Small rounded car (same build as the one in the colonial's garage). Along z unless yaw90."""
    body = flat('ext_car_%06x' % col, hexc(col), rough=0.25, metal=0.3); glass = flat('ext_car_glass', hexc(0x1A2630), rough=0.05, metal=0.4)
    tyre = flat('ext_car_tyre', hexc(0x17171A), rough=0.9); chrome = flat('ext_car_chrome', hexc(0xD9DCE0), rough=0.15, metal=1.0)
    from mathutils import Matrix
    hw, hl = 0.85, 1.95
    def bx(a0, a1, y0, y1, c0, c1, m, **k):       # a = across, c = along
        if yaw90: return box(cx + c0, cx + c1, y0, y1, zc + a0, zc + a1, m, collide=False, **k)
        return box(cx + a0, cx + a1, y0, y1, zc + c0, zc + c1, m, collide=False, **k)
    bx(-hw, hw, 0.28, 0.82, -hl, hl, body, bevel=0.16, segs=5)
    bx(-hw + 0.1, hw - 0.1, 0.78, 1.36, -hl + 0.75, hl - 1.25, body, bevel=0.2, segs=5)
    bx(-hw + 0.14, hw - 0.14, 0.86, 1.28, hl - 1.27, hl - 1.22, glass, bevel=0.01); bx(-hw + 0.14, hw - 0.14, 0.86, 1.28, -hl + 0.72, -hl + 0.77, glass, bevel=0.01)
    for a in (-hw + 0.08, hw - 0.12): bx(a, a + 0.04, 0.88, 1.26, -hl + 0.95, hl - 1.45, glass, bevel=0.01)
    bx(-hw + 0.05, hw - 0.05, 0.3, 0.42, hl - 0.03, hl + 0.05, chrome, bevel=0.03, segs=3); bx(-hw + 0.05, hw - 0.05, 0.3, 0.42, -hl - 0.05, -hl + 0.03, chrome, bevel=0.03, segs=3)
    for (a, c) in ((-hw + 0.02, -hl + 0.75), (hw - 0.02, -hl + 0.75), (-hw + 0.02, hl - 0.75), (hw - 0.02, hl - 0.75)):
        wx, wz = (cx + c, zc + a) if yaw90 else (cx + a, zc + c)
        for (r, hh, m) in ((0.33, 0.11, tyre), (0.17, 0.12, chrome)):
            w = cyl(wx, wz, 0.33 - hh, 0.33 + hh, r, m, collide=False, name='wheel', seg=18)
            piv = B(wx, 0.33, wz); w.data.transform(Matrix.Translation(piv) @ Matrix.Rotation(math.pi / 2, 4, 'X' if yaw90 else 'Y') @ Matrix.Translation(-piv))
    if yaw90:
        collider(cx - hl, cx + hl, 0.2, 0.82, zc - hw, zc + hw, spot=name); collider(cx - hl + 0.75, cx + hl - 1.25, 0.82, 1.36, zc - hw + 0.1, zc + hw - 0.1, spot=name + ' roof')
        for c in (-hl + 0.75, hl - 0.75): collider(cx + c - 0.3, cx + c + 0.3, 0, 0.3, zc - hw, zc + hw)
    else:
        collider(cx - hw, cx + hw, 0.2, 0.82, zc - hl, zc + hl, spot=name); collider(cx - hw + 0.1, cx + hw - 0.1, 0.82, 1.36, zc - hl + 0.75, zc + hl - 1.25, spot=name + ' roof')
        for c in (-hl + 0.75, hl - 0.75): collider(cx - hw, cx + hw, 0, 0.3, zc + c - 0.3, zc + c + 0.3)

# ------------------------------------------------------------------ the street
def apron(x0, x1, z0, z1):
    flatq(x0, x1, z0, z1, -0.008, M['cobble'], 'apron')

def ground():
    bx0, bx1, bz0, bz1 = OX, OX + 13.4, OZ - 8.0, OZ + 8.4            # the colonial's basement: no lawn over it
    for (a, b, c, d) in ((-70, bx0, -50, 70), (bx1, 100, -50, 70), (bx0, bx1, -50, bz0), (bx0, bx1, bz1, 70), (bx0, OX + 8.6, bz0, OZ)):
        flatq(a, b, c, d, -0.03, M['grass'])
    flatq(-70, 100, ROAD[0], ROAD[1], -0.012, M['road'], 'road')
    for (z0, z1) in ((ROAD[0] - 0.16, ROAD[0]), (ROAD[1], ROAD[1] + 0.16)): box(-70, 100, -0.02, 0.05, z0, z1, M['curb'], bevel=0.012, collide=False, name='curb')
    # the red colonial: asphalt drive on the right with a cobbled apron, and a walk curving from the drive to the front door
    dx = OX + 7.775
    box(dx - 1.0, dx + 1.0, -0.02, 0.0, OZ + 8.47, OZ + 9.6, M['walk'], bevel=0.01, collide=False, name='stoop')
    flatq(dx - 0.6, dx + 0.6, OZ + 9.6, OZ + 11.4, -0.008, M['walk'], 'walk2'); flatq(dx - 0.6, OX + 13.9, OZ + 11.4, OZ + 12.6, -0.008, M['walk'], 'walk2')
    flatq(OX + 13.9, OX + 18.9, OZ + 2.27, ROAD[0] - 1.8, -0.009, M['drive'], 'driveway'); apron(OX + 13.9, OX + 18.9, ROAD[0] - 1.8, ROAD[0] - 0.16)
    # next door (the brick house): drive on its right up to the garage
    flatq(9.8, 14.3, 6.0, ROAD[0] - 1.8, -0.009, M['drive'], 'driveway'); apron(9.8, 14.3, ROAD[0] - 1.8, ROAD[0] - 0.16)
    flatq(-0.3, 1.1, 13.2, ROAD[0] - 0.16, -0.008, M['walk'], 'walk1')

def greenery():
    z0, z1 = ROAD
    # big old trees close to the road on both sides, their crowns meeting overhead
    for i, x in enumerate((-21, -9.5, 5.0, 18.5, 45.5, 57)): tree(x, z0 - 2.6 - (i % 2) * 1.2, 10.5 + rng.random() * 2.5, kind=i)
    for i, x in enumerate((-27, -13, 4, 16, 39, 52, 63)): tree(x, z1 + 2.6 + (i % 2) * 1.5, 10.5 + rng.random() * 3, kind=i + 3, collide=x > -24 and x < 50)
    # the first house's garden
    for i, (x, z, h) in enumerate(((-11.5, 8.5, 8.4), (-12.5, -2.0, 9.0), (12.3, -7.5, 8.6), (0.5, -10.2, 8.9), (-9.0, -9.5, 8.2))): tree(x, z, h, kind=i + 2, n=22)
    conifer(-5.5, 10.2, 6.5, M['pine']); shrub(-3.2, 6.4, 0.8); shrub(2.6, 6.4, 0.7, M['leaf3']); shrub(4.6, 6.3, 0.9); shrub(-6.6, 6.3, 0.8, M['leaf3']); shrub(6.8, 6.4, 0.7)
    # the red colonial's front garden: blue spruce on the lawn, Japanese maple by the mailbox, clipped shrubs along the foundation
    conifer(OX + 1.2, 10.6, 12.5, M['spruce'])
    limb((OX + 1.6, 0, 13.3), (OX + 1.6, 0.8, 13.3), 0.07, 0.05, M['bark']); canopy(OX + 1.6, 1.25, 13.3, 1.25, (M['maple'], flat('ext_jmaple2', hexc(0x7E3A30), rough=0.95)), n=9, squash=0.55, seed=3); collider(OX + 1.4, OX + 1.8, 0, 1.0, 13.1, 13.5)
    limb((OX + 10.6, 0, OZ + 11.0), (OX + 10.4, 2.0, OZ + 11.0), 0.09, 0.05, M['bark']); canopy(OX + 10.4, 3.0, OZ + 11.0, 1.9, (M['rust'], M['maple'], M['gold']), n=10, seed=5); collider(OX + 10.4, OX + 10.8, 0, 2.0, OZ + 10.8, OZ + 11.2)
    for (x, r) in ((0.6, 0.7), (2.9, 0.95), (5.6, 1.1), (9.6, 1.2), (11.4, 0.8), (12.9, 0.9)): shrub(OX + x, OZ + 9.25, r, M['leaf3'] if int(x) % 2 else M['hedge'])
    for z in range(-14, 13, 2): conifer(46.8, z + 0.5, 5.4 + (z % 3) * 0.5, M['pine'], collide=False)          # arborvitae screen on the lot line
    collider(46.3, 47.3, 0, 2.6, -15.5, 13.2)
    tree(OX - 1.5, OZ - 6.5, 9.5, kind=0, n=22); tree(OX + 3.0, OZ - 10.0, 10.5, kind=3, n=22); conifer(OX + 17.5, OZ - 9.5, 10, M['pine'])
    hedge(16.4, 47.3, -16.4, -15.5); hedge(16.4, 17.3, -15.5, -13.2)
    # woods behind the houses, and beyond the ends of the road
    for i in range(16):
        x = -52 + i * 8 + rng.uniform(-2, 2)
        if i % 3 == 2: conifer(x, 46 + rng.uniform(-2, 2), 13 + rng.random() * 4, M['pine'], collide=False)
        else: tree(x, 46 + rng.uniform(-2, 3), 12 + rng.random() * 4, kind=i, collide=False, n=10)
    for i in range(13):
        x = -50 + i * 9 + rng.uniform(-2, 2)
        if i % 3 == 1: conifer(x, -22 + rng.uniform(-2, 2), 13 + rng.random() * 4, M['pine'], collide=False)
        else: tree(x, -22 + rng.uniform(-3, 2), 12 + rng.random() * 4, kind=i + 2, collide=False, n=10)
    # edges of the playable world: the road simply carries on
    for x in (-24.6, 50.6): collider(x - 0.3, x + 0.3, 0, 2.6, 12.6, 30.5)
    collider(-70, 100, 0, 2.6, 29.3, 29.9)
    hedge(-25.0, -24.2, -15.5, 12.6); hedge(-24.2, -15.6, -16.4, -15.5)
    # autumn: leaves along the curbs and under the trees
    leaves(-24, 50, z0 - 2.4, z0 + 0.5, 420, 1); leaves(-24, 50, z1 - 0.5, z1 + 2.6, 420, 2); leaves(OX - 2, OX + 13, 8, 13, 160, 3); leaves(-12, 8, 7, 13, 160, 4); leaves(-24, 50, z0, z1, 120, 5)

def furniture():
    mailbox(-1.6, ROAD[0] - 0.8, 'the mailbox'); mailbox(OX + 2.6, ROAD[0] - 0.8, 'the red house mailbox'); mailbox(33.5, ROAD[1] + 0.8, 'the blue house mailbox')
    bins(8.2, ROAD[0] - 1.0); bins(OX + 19.6, ROAD[0] - 1.0); bins(18.4, ROAD[1] + 1.0)
    # the fieldstone wall at the brick house's driveway
    box(3.6, 9.2, 0, 0.7, ROAD[0] - 3.4, ROAD[0] - 2.7, M['stone'], bevel=0.05, segs=3, collide=False, name='stonewall'); collider(3.6, 9.2, 0, 0.7, ROAD[0] - 3.4, ROAD[0] - 2.7, spot='the stone wall')
    car(OX + 16.4, 8.6, 0x8E949A, name='the grey car'); car(11.0, 9.6, 0x6A6E74, name='the silver car'); car(12.9, 10.4, 0x3E4654, name='the dark car'); car(23.0, 26.2, 0x23262B, name='the black car')
    lamp_post(-14, ROAD[0] - 0.8)

def hip(x0, x1, z0, z1, y0, rise, roof, over=0.4):
    """Hip roof over a rectangle (ridge along x)."""
    a0, a1, c0, c1 = x0 - over, x1 + over, z0 - over, z1 + over; zm = (c0 + c1) / 2; d = (c1 - c0) / 2; yb = y0 - 0.05
    r0, r1 = (a0 + d, y0 + rise, zm), (a1 - d, y0 + rise, zm)
    for pts in (((a0, yb, c1), (a1, yb, c1), r1, r0), ((a1, yb, c0), (a0, yb, c0), r0, r1)): quad(list(pts), roof, name='roof')
    tri([(a0, yb, c0), (a0, yb, c1), r0], roof, 'roof'); tri([(a1, yb, c1), (a1, yb, c0), r1], roof, 'roof')
    quad([(a0, yb, c0), (a1, yb, c0), (a1, yb, c1), (a0, yb, c1)], M['white'], name='soffit')

def home_shell():
    """Upper storey and roof for the first house: the brick colonial next door, hip-roofed, with two white chimneys and a white garage."""
    H1, H2 = 2.6, 5.3; x0, x1, z0, z1 = -8.07, 8.07, -5.57, 5.57; W = M['brick']
    with shell('home'):
        quad([(x0, H1, z1), (x1, H1, z1), (x1, H2, z1), (x0, H2, z1)], W, name='wall2'); quad([(x1, H1, z0), (x0, H1, z0), (x0, H2, z0), (x1, H2, z0)], W, name='wall2')
        quad([(x0, H1, z0), (x0, H1, z1), (x0, H2, z1), (x0, H2, z0)], W, name='wall2'); quad([(x1, H1, z1), (x1, H1, z0), (x1, H2, z0), (x1, H2, z1)], W, name='wall2')
        blk = flat('ext_black', hexc(0x1C1D1F), rough=0.5)
        for x in (-6.0, -2.9, 0.4, 3.6, 6.4): window('z', z1, x, 3.35, 4.7, 1.0, 1, shut=blk)
        for z in (-2.6, 2.6): window('x', x0, z, 3.35, 4.7, 1.0, -1, shut=blk); window('x', x1, z, 3.35, 4.7, 1.0, 1, shut=blk)
        for x in (-5.0, 0.0, 5.0): window('z', z0, x, 3.35, 4.7, 1.0, -1, shutters=False)
        box(x0 - 0.05, x1 + 0.05, H2 - 0.12, H2 + 0.05, z0 - 0.05, z1 + 0.05, M['white'], bevel=0.01, collide=False, name='cornice')
        hip(x0, x1, z0, z1, H2, 2.3, M['roof'])
        for x in (-5.0, 1.8): box(x, x + 0.95, H2, 8.6, -0.6, 0.45, M['white'], bevel=0.01, collide=False, name='chimney'); box(x - 0.08, x + 1.03, 8.6, 8.72, -0.68, 0.53, M['curb'], bevel=0.01, collide=False)
        # ground-floor shutters and the white pedimented doorway
        for (a, b) in ((-7.0, -5.0), (-3.9, -1.9), (3.3, 5.3)):
            for xs in (a - 0.5, b + 0.07): box(xs, xs + 0.43, 0.5, 2.17, z1, z1 + 0.035, blk, bevel=0.004, collide=False, name='shutter')
        for xs in (-0.45, 1.05): box(xs, xs + 0.2, 0, 2.25, z1, z1 + 0.1, M['white'], bevel=0.01, collide=False, name='pilaster')
        box(-0.6, 1.4, 2.25, 2.45, z1, z1 + 0.16, M['white'], bevel=0.015, collide=False, name='entablature')
        tri([(-0.6, 2.45, z1 + 0.12), (1.4, 2.45, z1 + 0.12), (0.4, 2.95, z1 + 0.12)], M['white'], 'pediment')
    # white clapboard garage beside the house, two doors, a little dormer above
    gx0, gx1, gz0, gz1 = 9.8, 14.3, 0.6, 6.0; Wc = M['clapw']
    box(gx0, gx1, 0, 2.7, gz0, gz1, Wc, bevel=0, name='garage'); gable(gx0, gx1, gz0, gz1, 2.7, 1.6, 'x', M['roof'], Wc, over=0.25)
    for xa in (gx0 + 0.25, gx0 + 2.35): box(xa, xa + 1.9, 0, 2.1, gz1, gz1 + 0.04, M['white'], bevel=0.01, collide=False, name='garagedoor'); box(xa + 0.2, xa + 1.7, 1.6, 1.9, gz1 + 0.04, gz1 + 0.05, M['glass'], bevel=0, collide=False)
    box(11.4, 12.7, 3.2, 4.1, 4.6, 5.6, Wc, bevel=0, collide=False, name='gdormer'); gable(11.4, 12.7, 4.2, 5.6, 4.1, 0.45, 'z', M['roof'], Wc, over=0.1, th=0.05); window('z', 5.6, 12.05, 3.35, 4.0, 0.8, 1, shutters=False)

def colonial_shell():
    """Second storey, attic gables, dormers and wing roofs of the colonial (garrison style: the upper floor overhangs the front)."""
    X = lambda x: OX + x; Z = lambda z: OZ + z
    H1, H2 = 2.6, 5.35
    with shell('colonial'):
        # second-storey walls (front overhang 0.3)
        zf = 8.4 + 0.07 + 0.3; zb = -0.07; x0, x1 = -0.07, 13.47
        quad([(X(x0), H1, Z(zf)), (X(x1), H1, Z(zf)), (X(x1), H2, Z(zf)), (X(x0), H2, Z(zf))], M['clap'], name='wall2')
        quad([(X(x1), H1, Z(zb)), (X(x0), H1, Z(zb)), (X(x0), H2, Z(zb)), (X(x1), H2, Z(zb))], M['clap'], name='wall2')
        quad([(X(x0), H1, Z(zb)), (X(x0), H1, Z(zf)), (X(x0), H2, Z(zf)), (X(x0), H2, Z(zb))], M['clap'], name='wall2')
        quad([(X(x1), H1, Z(zf)), (X(x1), H1, Z(zb)), (X(x1), H2, Z(zb)), (X(x1), H2, Z(zf))], M['clap'], name='wall2')
        quad([(X(x0), H1, Z(8.47)), (X(x1), H1, Z(8.47)), (X(x1), H1, Z(zf)), (X(x0), H1, Z(zf))], M['white'], name='soffit')
        for x in (0.3, 3.4, 6.3, 8.6, 13.1): box(X(x) - 0.07, X(x) + 0.07, H1 - 0.16, H1, Z(8.47), Z(zf), M['taupe'], bevel=0.02, collide=False, name='bracket')
        # windows: five across the front upstairs, two on each end, three at the back
        for x in (1.7, 4.6, 7.775, 11.0, 12.6)[:4] + (12.55,): pass
        T_ = M['taupe']
        window('z', Z(zf), X(3.2), 3.35, 4.7, 2.3, 1, trim=T_, bars=3); window('z', Z(zf), X(7.9), 3.45, 4.6, 0.85, 1, trim=T_); window('z', Z(zf), X(11.0), 3.35, 4.7, 1.5, 1, trim=T_, bars=2)
        for z in (2.0, 6.2):
            window('x', X(x0), Z(z), 3.3, 4.75, 0.95, -1); window('x', X(x1), Z(z), 3.3, 4.75, 0.95, 1)
        for x in (1.7, 4.85, 7.4): window('z', Z(zb), X(x), 3.3, 4.75, 0.95, -1, shutters=False)
        # main roof with two front dormers and attic windows in the gable ends
        gable(X(x0), X(x1), Z(zb), Z(zf), H2, 2.9, 'x', M['roof'], M['clap'], over=0.3)
        zm = (zb + zf) / 2
        window('x', X(x0), Z(zm), 5.9, 6.9, 0.8, -1, shutters=False); window('x', X(x1), Z(zm), 5.9, 6.9, 0.8, 1, shutters=False)
        for x in (3.0, 6.7, 10.4):
            box(X(x) - 0.7, X(x) + 0.7, 6.2, 7.2, Z(6.2), Z(7.6), M['clap'], bevel=0, collide=False, name='dormer')
            gable(X(x) - 0.7, X(x) + 0.7, Z(5.6), Z(7.6), 7.2, 0.55, 'z', M['roof'], M['clap'], over=0.12, th=0.06)
            window('z', Z(7.6), X(x), 6.35, 7.1, 0.8, 1, shutters=False, trim=M['taupe'])
        box(X(1.2), X(2.1), H2, 9.4, Z(3.3), Z(4.2), M['brick'], bevel=0.01, collide=False, name='chimney'); box(X(1.1), X(2.2), 9.4, 9.52, Z(3.2), Z(4.3), M['curb'], bevel=0.01, collide=False)
        # family-room wing, garage and sunroom roofs
        gable(X(8.53), X(13.47), Z(-8.07), Z(-0.07), H1, 1.9, 'z', M['roof'], M['clap'], over=0.3)
        box(X(10.55), X(11.45), H1, 5.6, Z(-8.5), Z(-8.07), M['brick'], bevel=0.01, collide=False, name='chimney2')
        gable(X(13.47), X(19.47), Z(-3.37), Z(2.27), H1, 1.7, 'x', M['roof'], M['clap'], over=0.3)
        box(X(-3.6), X(0.0), H1, H1 + 0.14, Z(-0.1), Z(3.8), M['white'], bevel=0.02, collide=False, name='sunroof')
        for (a, b, c, d) in ((-3.6, 0, 3.74, 3.8), (-3.6, 0, -0.1, -0.04), (-3.6, -3.54, -0.1, 3.8)):
            box(X(a), X(b), H1 + 0.55, H1 + 0.61, Z(c), Z(d), M['white'], bevel=0.01, collide=False, name='balustrade')
            n = int(max(b - a, d - c) / 0.18)
            for i in range(n + 1):
                t = i / n; box(X(a + (b - a) * t) - 0.02, X(a + (b - a) * t) + 0.02, H1 + 0.14, H1 + 0.56, Z(c + (d - c) * t) - 0.02, Z(c + (d - c) * t) + 0.02, M['white'], bevel=0, collide=False, name='bal')
        # ground-floor dressing that would get in the way of the indoor camera: shutters, door surround, garage door rolled up
        for (x, w) in ((1.7, 1.6), (4.6, 1.6)):
            for s in (-1, 1): box(X(x + s * (w / 2 + 0.07 + 0.3)) - 0.3, X(x + s * (w / 2 + 0.07 + 0.3)) + 0.3, 0.53, 2.17, Z(8.47), Z(8.505), M['shutter'], bevel=0.004, collide=False, name='shutter')
        dxl = 7.775
        for s in (-1, 1): box(X(dxl + s * 0.62) - 0.09, X(dxl + s * 0.62) + 0.09, 0, 2.3, Z(8.47), Z(8.56), M['taupe'], bevel=0.01, collide=False, name='pilaster')
        box(X(dxl - 0.85), X(dxl + 0.85), 2.3, 2.52, Z(8.47), Z(8.6), M['taupe'], bevel=0.015, collide=False, name='entablature')
        box(X(14.1), X(18.7), 2.2, 2.45, Z(2.0), Z(2.27), M['white'], bevel=0.01, collide=False, name='garagedoor')

def neighbour(x, z, w, d, wallm, roofm, storeys=2, ridge='x', face=-1, door=0xF2EFE8, wing=0, cross=False, timber=False, shutters=True, base=None, chimney=True):
    """A house you cannot enter: massing, roof, windows. face = -1 looks north (toward the road from the far side).
    wing: width of a one-storey garage wing (+ east / - west); cross: a front cross-gable; timber: dark half-timbering upstairs; base: ground-floor material."""
    h = 2.75 * storeys; zf = z + face * d / 2; steep = 0.42 if (timber or cross) else 0.3
    if base and storeys > 1:
        box(x - w / 2, x + w / 2, 0, 2.75, z - d / 2, z + d / 2, base, bevel=0, collide=False, name='nb'); box(x - w / 2, x + w / 2, 2.75, h, z - d / 2, z + d / 2, wallm, bevel=0, collide=False, name='nb')
    else: box(x - w / 2, x + w / 2, 0, h, z - d / 2, z + d / 2, wallm, bevel=0, collide=False, name='nb')
    gable(x - w / 2, x + w / 2, z - d / 2, z + d / 2, h, min(w, d) * steep, ridge, roofm, wallm, over=0.3)
    cols = (-0.34, 0.34) if not cross else (-0.36,)
    for st in range(storeys):
        ks = (-0.34, 0.34) if st == 0 else ((-0.34, 0.0, 0.34) if not cross else (-0.36, -0.08))
        for k in ks: window('z', zf, x + k * w, 0.8 + st * 2.75, 2.1 + st * 2.75, 1.0, face, shutters=shutters)
    if cross:                                            # projecting front gable
        cw = w * 0.34; cx = x + w * 0.26; zc0, zc1 = sorted((zf, zf + face * 1.2))
        box(cx - cw / 2, cx + cw / 2, 0, h, zc0, zc1, wallm if not base else wallm, bevel=0, collide=False, name='nbx')
        gable(cx - cw / 2, cx + cw / 2, zc0 - (0 if face > 0 else 0), zc1, h, cw * 0.55, 'z', roofm, wallm, over=0.2)
        zfc = zf + face * 1.2
        window('z', zfc, cx, 0.8, 2.1, 1.3, face, shutters=False); window('z', zfc, cx, 3.5, 4.8, 1.0, face, shutters=False)
        if timber:
            dk = flat('ext_timber', hexc(0x2E241E), rough=0.8)
            for k in (-0.42, -0.2, 0.2, 0.42): box(cx + k * cw - 0.05, cx + k * cw + 0.05, 2.75, h + (0.5 - abs(k)) * cw * 1.0, min(zfc, zfc + face * 0.03), max(zfc, zfc + face * 0.03), dk, bevel=0, collide=False, name='timber')
            box(cx - cw / 2, cx + cw / 2, 2.7, 2.82, min(zfc, zfc + face * 0.03), max(zfc, zfc + face * 0.03), dk, bevel=0, collide=False, name='timber')
    if timber:
        dk = flat('ext_timber', hexc(0x2E241E), rough=0.8)
        for k in (-0.48, -0.2, 0.02): box(x + k * w - 0.05, x + k * w + 0.05, 2.75, h, min(zf, zf + face * 0.03), max(zf, zf + face * 0.03), dk, bevel=0, collide=False, name='timber')
        box(x - w / 2, x + w / 2, 2.7, 2.82, min(zf, zf + face * 0.03), max(zf, zf + face * 0.03), dk, bevel=0, collide=False, name='timber')
    dxr = x if not cross else x - w * 0.08
    box(dxr - 0.5, dxr + 0.5, 0, 2.1, min(zf, zf + face * 0.04), max(zf, zf + face * 0.04), flat('ext_door%06x' % door, hexc(door), rough=0.5), bevel=0.01, collide=False, name='nbdoor')
    box(dxr - 0.75, dxr + 0.75, 2.1, 2.3, min(zf, zf + face * 0.12), max(zf, zf + face * 0.12), M['white'], bevel=0.01, collide=False, name='nbhood')
    if chimney: box(x - w * 0.5 - 0.02, x - w * 0.5 + 0.75, 0, h + min(w, d) * steep + 0.8, z - 0.45, z + 0.45, M['brick'], bevel=0.01, collide=False, name='nbch')
    if wing:
        sgn = 1 if wing > 0 else -1; gx0, gx1 = sorted((x + sgn * w / 2, x + sgn * (w / 2 + abs(wing))))
        gz0, gz1 = sorted((zf - face * 0.8, zf - face * 6.4))
        box(gx0, gx1, 0, 2.6, gz0, gz1, wallm, bevel=0, collide=False, name='nbwing'); gable(gx0, gx1, gz0, gz1, 2.6, 1.5, 'x', roofm, wallm, over=0.25)
        zg = zf - face * 0.8
        box(gx0 + 0.5, gx1 - 0.5, 0, 2.1, min(zg, zg + face * 0.04), max(zg, zg + face * 0.04), M['white'], bevel=0.01, collide=False, name='nbgarage')
        for yy in (0.52, 1.05, 1.58): box(gx0 + 0.5, gx1 - 0.5, yy, yy + 0.02, min(zg, zg + face * 0.05), max(zg, zg + face * 0.05), M['curb'], bevel=0, collide=False, name='nbgl')
        return (gx0 + gx1) / 2
    return None

def contemporary(x, z, w, d, face=-1):
    """A low 1950s contemporary: long shallow roof, wide glass, vertical wood siding."""
    wood = pbr('ext_cedar', 'wood_plank_wall', tile=2.0, tint=(0.75, 0.62, 0.5), nonormal=True)
    box(x - w / 2, x + w / 2, 0, 2.9, z - d / 2, z + d / 2, wood, bevel=0, collide=False, name='nb')
    box(x - w / 2 - 0.9, x + w / 2 + 0.9, 2.9, 3.12, z - d / 2 - 0.9, z + d / 2 + 0.9, M['curb'], bevel=0.02, collide=False, name='nbroof')
    box(x - w * 0.2, x + w * 0.5, 3.12, 4.3, z - d / 2 + 1, z + d / 2 - 1, wood, bevel=0, collide=False, name='nb2'); box(x - w * 0.2 - 0.7, x + w * 0.5 + 0.7, 4.3, 4.5, z - d / 2 + 0.3, z + d / 2 - 0.3, M['curb'], bevel=0.02, collide=False, name='nbroof')
    zf = z + face * d / 2
    for (c, ww) in ((-0.28, 3.2), (0.22, 2.4)): window('z', zf, x + c * w, 0.4, 2.5, ww, face, shutters=False)
    window('z', z + face * (d / 2 - 1), x + w * 0.15, 3.35, 4.1, 3.0, face, shutters=False)
    box(x - 0.1, x + 0.9, 0, 2.2, min(zf, zf + face * 0.04), max(zf, zf + face * 0.04), flat('ext_doorc', hexc(0xC47A2C), rough=0.5), bevel=0.01, collide=False, name='nbdoor')
    box(x - w / 2 - 0.3, x - w / 2 + 0.8, 0, 5.2, z - 0.6, z + 0.6, M['stone'], bevel=0.01, collide=False, name='nbch')

def blue_house(x, zf):
    """Across the street: blue-grey clapboard colonial, navy shutters, brick steps with iron rails, garage on its left."""
    blue = pbr('ext_clap_b', 'white_planks_clean', tile=1.6, tint=(0.66, 0.76, 0.86), nonormal=True); w, d, h = 10.5, 8.5, 5.5
    box(x - w / 2, x + w / 2, 0, h, zf, zf + d, blue, bevel=0, collide=False, name='nb'); gable(x - w / 2, x + w / 2, zf, zf + d, h, 2.6, 'x', M['roof'], blue, over=0.3)
    for k in (-3.4, 0.0, 3.4): window('z', zf, x + k, 3.4, 4.75, 0.95, -1, shut=M['navy'])
    for k in (-3.4, 3.4): window('z', zf, x + k, 0.85, 2.2, 0.95, -1, shut=M['navy'])
    box(x - 0.5, x + 0.5, 0.35, 2.45, zf - 0.04, zf, M['navy'], bevel=0.01, collide=False, name='nbdoor')
    for sx in (-0.78, 0.5): box(x + sx, x + sx + 0.28, 0.35, 2.45, zf - 0.05, zf, M['white'], bevel=0.01, collide=False, name='sidelight')
    box(x - 0.95, x + 0.95, 2.45, 2.7, zf - 0.14, zf, M['white'], bevel=0.015, collide=False, name='hood')
    for i in range(3): box(x - 1.3 - i * 0.0, x + 1.3, 0, 0.35 - i * 0.117, zf - 0.9 - i * 0.3, zf - 0.6 - i * 0.3 + (0.6 if i == 0 else 0), M['brick'], bevel=0.01, collide=False, name='steps')
    iron = flat('ext_black', hexc(0x1C1D1F), rough=0.5)
    for sx in (-1.25, 1.25):
        box(x + sx - 0.015, x + sx + 0.015, 0.9, 0.93, zf - 1.5, zf - 0.1, iron, bevel=0, collide=False, name='rail')
        for zz in (zf - 1.45, zf - 0.8, zf - 0.15): box(x + sx - 0.012, x + sx + 0.012, 0.1, 0.9, zz - 0.012, zz + 0.012, iron, bevel=0, collide=False, name='rail')
    box(x + w / 2 - 0.8, x + w / 2 - 0.1, h, h + 3.4, zf + 3.6, zf + 4.4, M['brick'], bevel=0.01, collide=False, name='nbch')
    for k in (-4.4, -2.5, 1.9, 2.9, 4.5): conifer(x + k, zf - 0.9, 1.2 + (int(k * 3) % 3) * 0.35, M['pine'], collide=False) if abs(k) > 2 else None
    for k in (-3.5, 3.6): shrub(x + k, zf - 0.8, 0.7, collide=False)
    # garage wing and drive
    gx0, gx1 = x - w / 2 - 5.6, x - w / 2
    box(gx0, gx1, 0, 2.6, zf + 0.8, zf + 6.6, blue, bevel=0, collide=False, name='nbwing'); gable(gx0, gx1, zf + 0.8, zf + 6.6, 2.6, 1.5, 'x', M['roof'], blue, over=0.25)
    box(gx0 + 0.4, gx1 - 0.4, 0, 2.15, zf + 0.76, zf + 0.8, M['white'], bevel=0.01, collide=False, name='nbgarage')
    flatq(gx0 + 0.1, gx1 - 0.1, ROAD[1] + 1.8, zf + 0.8, -0.009, M['drive'], 'nbdrive'); apron(gx0 + 0.1, gx1 - 0.1, ROAD[1] + 0.16, ROAD[1] + 1.8)
    flatq(x - 0.7, x + 0.7, zf - 2.9, zf - 1.5, -0.008, M['walk'], 'nbpath'); flatq(gx1 - 0.1, x + 0.7, zf - 3.9, zf - 2.9, -0.008, M['walk'], 'nbpath')
    birch(x + 3.4, zf - 5.0)

def neighbours():
    """The rest of the block, in the styles seen along the real street: clapboard and brick colonials set back on deep lawns."""
    cream = M['clapw']; sage = pbr('ext_clap_g', 'white_planks_clean', tile=1.6, tint=(0.66, 0.7, 0.62), nonormal=True)
    yel = pbr('ext_clap_y', 'white_planks_clean', tile=1.6, tint=(0.88, 0.84, 0.7), nonormal=True); shingle = pbr('ext_shingle', 'weathered_plank_siding', tile=2.0, tint=(0.72, 0.62, 0.52), nonormal=True)
    zf = ROAD[1] + 10.5
    blue_house(31, zf)
    g = neighbour(3, zf + 5.0, 12.5, 9.5, cream, M['roof'], door=0x1F2A26, wing=-5.5)
    flatq(3 - 0.6, 3 + 0.6, ROAD[1] + 0.16, zf + 0.2, -0.008, M['walk'], 'nbpath'); flatq(g - 2.3, g + 2.3, ROAD[1] + 1.8, zf + 1.0, -0.009, M['drive'], 'nbdrive'); apron(g - 2.3, g + 2.3, ROAD[1] + 0.16, ROAD[1] + 1.8)
    neighbour(-22, zf + 5.5, 13, 9.5, shingle, M['roof'], door=0x7A2E2A, cross=True, wing=5.5, shutters=False)
    neighbour(56, zf + 5.0, 13, 9.5, M['brick'], M['roof'], door=0xF2EFE8, wing=-5.5); neighbour(-44, zf + 5.0, 12, 9, sage, M['roof'], door=0xF2EFE8)
    # our side of the road, beyond the two playable lots
    neighbour(-39, 1, 12.5, 10, yel, M['roof'], face=1, door=0x1F2A26, wing=-5.5); neighbour(64, 0, 13, 10, cream, M['roof'], face=1, door=0x2B3444, wing=5.5)
    for (x, z) in ((-10, zf - 3), (12, zf - 2.5), (46, zf - 3)): shrub(x, z, 1.1, M['leaf3'], collide=False)
    conifer(14, zf + 1.0, 11, M['spruce'], collide=False); conifer(-12, zf + 2.0, 10, M['pine'], collide=False); conifer(44, zf + 3, 12, M['pine'], collide=False)

def treats_and_toys():
    for t in ((0.4, 0, 10.5), (-1.6, 1.26, ROAD[0] - 0.8), (11.0, 1.36, 8.85), (6.4, 0.7, ROAD[0] - 3.05), (OX + 7.775, 0, 8.0), (OX + 16.4, 0.82, 10.0), (OX + 1.6, 0, 12.2), (36.0, 0, 18.0), (8.2, 1.12, ROAD[0] - 1.0), (OX + 16.4, 0, 12.6),
              (OX - 1.8, 0, OZ + 6.0), (OX + 4.0, 0, OZ - 6.0), (31.0, 0.35, ROAD[1] + 9.3), (34.5, 0, ROAD[1] + 5.0), (23.0, 1.36, 25.45), (3.0, 0, ROAD[1] + 6.0)):
        S['treats'].append([round(t[0], 2), round(t[1] + 0.14, 2), round(t[2], 2)])
    collider(29.7, 32.3, 0, 0.35, ROAD[1] + 8.9, ROAD[1] + 10.5)
    prop('football', 26.5, 0, 9.5, scale=0.45); prop('ball', 3.5, 0, 10.5, col=0xE8556A); prop('baseball_01', 33.0, 0, 14.0); prop('ball', OX + 1.0, 0, OZ - 5.0, col=0xF2C14E)

mats(); ground(); greenery(); furniture(); home_shell(); colonial_shell(); neighbours(); treats_and_toys()
main = list(L.STATIC) + list(L.EXT)
log('street: %d objects, %d colliders, shells %s' % (len(main), len(S['colliders']), {k: len(v) for k, v in SHELL.items()}))

if ARGS and ARGS[0] == 'preview':
    sc = bpy.context.scene
    import numpy as np
    w = bpy.data.worlds.new('sky'); sc.world = w; w.use_nodes = True; nt = w.node_tree; bg = nt.nodes['Background']
    sky = nt.nodes.new('ShaderNodeTexSky'); sky.sky_type = 'NISHITA'; sky.sun_elevation = 0.55; sky.sun_rotation = 2.3; nt.links.new(sky.outputs['Color'], bg.inputs['Color']); bg.inputs['Strength'].default_value = 0.12
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
    sc.render.engine = 'CYCLES'; sc.cycles.samples = 32; sc.cycles.use_denoising = True; sc.render.resolution_x, sc.render.resolution_y = 1400, 800
    sc.view_settings.view_transform = 'AgX'; sc.view_settings.exposure = -1.2
    views = {'colonial': ((OX + 5, 3.2, 24), (OX + 8, 3.0, 4), 24), 'home': ((-3, 3.0, 24), (0, 2.0, 5), 24), 'street': ((-20, 9, 30), (22, 0, 8), 20), 'air': ((14, 55, 40), (14, 0, 6), 28), 'back': ((OX - 8, 7, OZ - 20), (OX + 8, 1, OZ), 24)}
    for v in ARGS[1:] or views:
        pos, tgt, lens = views[v]
        cam.data.lens = lens; cam.location = B(*pos); cam.rotation_euler = (B(*tgt) - cam.location).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = os.path.join(OUT, 'street_%s.png' % v); bpy.ops.render.render(write_still=True)
    log('preview done'); sys.exit(0)

# ---- export: one object for the street, one per house shell
def merged(objs, name):
    for o in objs:
        if len(o.data.uv_layers) == 0: o.data.uv_layers.new(name='UVMap')
    return join(objs, name)
exp = [merged(main, 'street')] + [merged(objs, 'shell_' + k) for k, objs in SHELL.items()]
for m in bpy.data.materials:
    if not m.use_nodes: continue
    bs = m.node_tree.nodes.get('Principled BSDF')
    for l in bs.inputs['Base Color'].links:
        if l.from_node.type == 'TEX_IMAGE' and l.from_node.image.size[0] > 512: l.from_node.image.scale(512, 512)
    for sock, val in (('Roughness', 0.8), ('Metallic', 0.0)):
        if bs.inputs[sock].links:
            for l in list(bs.inputs[sock].links): m.node_tree.links.remove(l)
            bs.inputs[sock].default_value = val
bpy.ops.object.select_all(action='DESELECT')
for o in exp: o.select_set(True)
out = os.path.join(ASSETS, 'street.glb')
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_materials='EXPORT', export_image_format='AUTO',
                          export_yup=True, export_cameras=False, export_lights=False, export_animations=False, export_extras=False)
json.dump(dict(colliders=S['colliders'], props=S['props'], treats=S['treats'], outer=OUTER), open(os.path.join(ASSETS, 'street.json'), 'w'))
log('exported street.glb %.1f MB' % (os.path.getsize(out) / 1e6))
