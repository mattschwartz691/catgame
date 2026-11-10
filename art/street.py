"""The street outside: road, sidewalks, lawns, trees, neighbours, and the roofs / upper storeys ("shells") of both houses.
Nothing here is light-baked; it is lit by the real-time sun.   Run:  blender -b --python art/street.py -- [preview]
World coordinates: x east, y up, z south. The first house sits at the origin, the colonial at house2_rooms.ORIGIN."""
import bpy, bmesh, sys, os, json, math, random
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import house_lib as L
from house_lib import box, cyl, lathe, quad, put, prop, pbr, flat, hexc, collider, join, B, S, log
import house2_rooms as C

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = '/mnt/data/Games/tools/out'
ASSETS = os.path.join(HERE, '..', 'assets', 'street'); os.makedirs(ASSETS, exist_ok=True)
OX, OZ = C.ORIGIN
OUTER = [-24.0, 50.0, -15.5, 24.6]
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
    M['grass'] = pbr('ext_grass', 'leafy_grass', tile=3.0, tint=(0.6, 1.0, 0.6), nonormal=True)
    M['road'] = pbr('ext_road', 'asphalt_02', tile=4.0, nonormal=True)
    M['walk'] = pbr('ext_walk', 'concrete_pavement', tile=2.0, nonormal=True)
    M['drive'] = pbr('ext_drive', 'grooved_concrete_driveway', tile=3.0, nonormal=True)
    M['brickpath'] = pbr('ext_brickpath', 'herringbone_brick', tile=1.5, nonormal=True)
    M['clap'] = pbr('ext_clap', 'white_planks_clean', tile=1.6, nonormal=True)
    M['plaster'] = pbr('ext_wall', 'plastered_wall_04', tile=3.0, tint=(1.0, 0.95, 0.86), nonormal=True)
    M['roof'] = pbr('ext_roof', 'grey_roof_tiles_02', tile=2.4, nonormal=True)
    M['roof2'] = pbr('ext_roof2', 'grey_roof_tiles_02', tile=2.4, tint=(0.78, 0.5, 0.4), nonormal=True)
    M['brick'] = pbr('ext_brick', 'red_brick_03', tile=1.2, nonormal=True)
    M['stone'] = pbr('ext_stone', 'stone_wall_04', tile=2.0, nonormal=True)
    M['white'] = flat('ext_white', hexc(0xF2EFE8), rough=0.6)
    M['shutter'] = flat('ext_shutter', hexc(0x1F2A26), rough=0.6)
    M['glass'] = flat('ext_glassdark', hexc(0x27384A), rough=0.08, metal=0.5)
    M['hedge'] = flat('ext_hedge', hexc(0x3F6B34), rough=0.95)
    M['leaf'] = flat('ext_leaf', hexc(0x4F8A3C), rough=0.9); M['leaf2'] = flat('ext_leaf2', hexc(0x6FA24A), rough=0.9); M['leaf3'] = flat('ext_leaf3', hexc(0x2F6B3A), rough=0.9)
    M['autumn'] = flat('ext_autumn', hexc(0xC9722E), rough=0.9); M['autumn2'] = flat('ext_autumn2', hexc(0xB03A2A), rough=0.9)
    M['bark'] = flat('ext_bark', hexc(0x5A4030), rough=0.95)
    M['metal'] = flat('ext_metal', hexc(0x2A2C30), rough=0.4, metal=0.8)
    M['curb'] = flat('ext_curb', hexc(0xB9B4AA), rough=0.8)

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

def window(axis, at, c, y0, y1, w, d, shutters=True):
    """Dark pane + white frame (+ shutters) on an outside wall face. d = outward direction (+1/-1)."""
    a0, a1 = c - w / 2, c + w / 2; f = at + d * 0.012; t = 0.06
    def bx(s0, s1, yy0, yy1, m, dep=0.03):
        lo, hi = sorted((at, at + d * dep))
        if axis == 'z': box(s0, s1, yy0, yy1, lo, hi, m, bevel=0.004, collide=False)
        else: box(lo, hi, yy0, yy1, s0, s1, m, bevel=0.004, collide=False)
    bx(a0, a1, y0, y1, M['glass'], 0.012)
    for (s0, s1, yy0, yy1) in ((a0 - t, a0, y0 - t, y1 + t), (a1, a1 + t, y0 - t, y1 + t), (a0, a1, y1, y1 + t), (a0 - t * 1.4, a1 + t * 1.4, y0 - t, y0), (c - 0.015, c + 0.015, y0, y1), (a0, a1, (y0 + y1) / 2 - 0.015, (y0 + y1) / 2 + 0.015)):
        bx(s0, s1, yy0, yy1, M['white'])
    if shutters:
        sw = w * 0.42
        bx(a0 - t - sw, a0 - t, y0 - 0.02, y1 + 0.02, M['shutter'], 0.035); bx(a1 + t, a1 + t + sw, y0 - 0.02, y1 + 0.02, M['shutter'], 0.035)

def tree(x, z, h, kind=0, collide=True):
    cyl(x, z, 0, h * 0.78, 0.2 if h > 5 else 0.15, M['bark'], r_top=0.1, seg=10, collide=False, name='trunk')
    if collide: collider(x - 0.18, x + 0.18, 0, 2.6, z - 0.18, z + 0.18)
    cols = [(M['leaf'], M['leaf2']), (M['leaf3'], M['leaf']), (M['autumn'], M['autumn2']), (M['leaf2'], M['autumn'])][kind % 4]
    for k in range(10):
        a = rng.random() * 6.28; rr = 0.3 * h * math.sqrt(rng.random())
        o = L.blob(x + math.cos(a) * rr, h * (0.74 + 0.24 * rng.random()), z + math.sin(a) * rr, h * (0.14 + 0.07 * rng.random()), cols[k % 2], squash=0.85, jitter=0.1, seed=k + int(x * 7))
        L.EXT.remove(o); L.STATIC.append(o)

def shrub(x, z, r=0.5, m=None, collide=True):
    o = L.blob(x, r * 0.75, z, r, m or M['hedge'], squash=0.8, seed=int(x * 13 + z * 7)); L.EXT.remove(o); L.STATIC.append(o)
    if collide: collider(x - r * 0.6, x + r * 0.6, 0, r * 1.2, z - r * 0.6, z + r * 0.6)

def hedge(x0, x1, z0, z1, h=1.4, col=True):
    box(x0, x1, 0, h, z0, z1, M['hedge'], bevel=0.16, segs=3, collide=False, name='hedge')
    if col: collider(x0, x1, 0, max(h, 1.6), z0, z1)
    n = int(max(x1 - x0, z1 - z0) / 1.2)
    for i in range(n):
        t = (i + 0.5) / n
        o = L.blob(x0 + (x1 - x0) * t, h - 0.05 + rng.random() * 0.12, z0 + (z1 - z0) * t, min(x1 - x0, z1 - z0) * 0.62, M['hedge'], squash=0.7, seed=i); L.EXT.remove(o); L.STATIC.append(o)

def mailbox(x, z, name):
    cyl(x, z, 0, 1.0, 0.035, M['white'], seg=8, collide=False, bevel=0)
    box(x - 0.11, x + 0.11, 1.0, 1.24, z - 0.24, z + 0.24, M['metal'], bevel=0.08, segs=4, collide=False)
    box(x + 0.11, x + 0.125, 1.1, 1.22, z + 0.05, z + 0.09, flat('ext_red', hexc(0xC0392B), rough=0.5), bevel=0.003, collide=False)
    collider(x - 0.11, x + 0.11, 0, 1.24, z - 0.24, z + 0.24, spot=name)

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
def ground():
    flatq(-70, 100, -50, 70, -0.03, M['grass'])
    flatq(-70, 100, 15.2, 22.2, -0.012, M['road'], 'road')
    for (z0, z1) in ((15.02, 15.2), (22.2, 22.38)): box(-70, 100, -0.02, 0.05, z0, z1, M['curb'], bevel=0.01, collide=False, name='curb')
    for (z0, z1) in ((13.25, 14.55), (22.9, 24.2)): flatq(-70, 100, z0, z1, -0.006, M['walk'], 'sidewalk')
    # the colonial's front walk, steps and driveway
    dx = OX + 7.775
    flatq(dx - 0.65, dx + 0.65, OZ + 9.3, 13.25, -0.008, M['brickpath'], 'walk2')
    box(dx - 1.1, dx + 1.1, -0.02, 0.0, OZ + 8.47, OZ + 9.5, M['brick'], bevel=0.01, collide=False, name='stoop')
    flatq(OX + 13.9, OX + 18.9, OZ + 2.27, 15.02, -0.008, M['drive'], 'driveway')
    # home: short apron where the garden path meets the sidewalk
    for x in range(-64, 96, 9):                                   # dashed centre line
        flatq(x, x + 3.2, 18.62, 18.78, -0.008, flat('ext_line', hexc(0xE8D27A), rough=0.7), 'line')

def greenery():
    # street trees on the verges
    for i, x in enumerate((-20, -9, 8, 19, 27.5, 46, 58)): tree(x, 12.4 if i % 2 else 12.0, 6.6 + rng.random() * 1.6, kind=i)
    for i, x in enumerate((-26, -14, -2, 12, 24, 36, 47, 60)): tree(x + 1.5, 25.4, 5.0 + rng.random() * 2.0, kind=i + 1, collide=False)
    # the colonial's yard: foundation planting, a big maple on the lawn, back-garden trees, hedges on the lot lines
    for x in (0.5, 1.7, 3.2, 4.6, 5.8): shrub(OX + x, OZ + 9.0, 0.5, M['leaf3'] if int(x * 2) % 2 else M['hedge'])
    for x in (9.2, 12.6, 13.0): shrub(OX + x, OZ + 9.05, 0.5)
    for x in (10.2, 11.0, 11.8): shrub(OX + x, OZ + 9.0, 0.36, flat('ext_flpink', hexc(0xE889A8), rough=0.8))
    tree(OX + 2.5, 10.4, 7.5, kind=2); tree(OX - 1.5, OZ - 6.5, 6.8, kind=0); tree(OX + 3.0, OZ - 9.5, 7.0, kind=3); tree(OX + 17.5, OZ - 9.0, 6.8, kind=1)
    hedge(47.0, 47.9, -15.5, 12.6); hedge(16.4, 47.9, -16.4, -15.5); hedge(16.4, 17.3, -15.5, -13.2)
    hedge(17.4, 22.9, 11.7, 12.5, h=0.9); hedge(34.0, 36.9, 11.7, 12.5, h=0.9)
    # across the road: low stone wall + hedge as the edge of the world
    box(-70, 100, 0, 0.55, 24.75, 25.05, M['stone'], bevel=0.02, collide=False, name='wall'); hedge(-30, 56, 25.05, 25.9, h=1.3, col=False)
    collider(-70, 100, 0, 2.6, 24.72, 25.9, cam=False)
    # home's back and side yards are hedged already; close the ends of the street with planters and barriers
    for x in (-24.6, 50.6):
        for z in (15.9, 17.6, 19.3, 21.0):
            box(x - 0.2, x + 0.2, 0, 0.5, z - 0.5, z + 0.5, M['curb'], bevel=0.04, collide=False, name='planter'); shrub(x, z, 0.42, M['leaf2'], collide=False)
        collider(x - 0.3, x + 0.3, 0, 2.6, 12.6, 25.0)
    hedge(-25.0, -24.2, -15.5, 12.6); hedge(-24.2, -15.6, -16.4, -15.5)
    hedge(49.2, 50.0, 12.7, 13.2, h=0.01, col=False) if False else None

def furniture():
    mailbox(-1.3, 14.8, 'the mailbox'); mailbox(OX + 6.5, 14.8, 'the colonial mailbox')
    for x in (-14, 14, 44): lamp_post(x, 14.8)
    lamp_post(2, 22.6); lamp_post(30, 22.6)
    # fire hydrant
    red = flat('ext_red', hexc(0xC0392B), rough=0.5)
    lathe(21.5, 14.8, 0, [(0.11, 0), (0.11, 0.05), (0.08, 0.07), (0.08, 0.45), (0.1, 0.47), (0.1, 0.52), (0.06, 0.6), (0.02, 0.64)], red, name='hydrant', seg=12)
    box(21.5 - 0.15, 21.5 + 0.15, 0.3, 0.4, 14.76, 14.84, red, bevel=0.03, segs=3, collide=False); collider(21.38, 21.62, 0, 0.64, 14.68, 14.92, spot='the fire hydrant')
    car(10.0, 16.15, 0xB8433A, yaw90=True, name='the red car'); car(OX + 16.4, 8.2, 0x3D6B4F, name='the green car'); car(41.0, 21.25, 0xE0C060, yaw90=True, name='the yellow car')
    # bins out for collection
    for i, x in enumerate((5.2, 6.1)):
        box(x - 0.3, x + 0.3, 0, 1.0, 12.75, 13.2, flat('ext_bin%d' % i, hexc((0x2F5D50, 0x34495E)[i]), rough=0.6), bevel=0.04, segs=3, collide=False, name='wheeliebin')
        collider(x - 0.3, x + 0.3, 0, 1.0, 12.75, 13.2, spot='the wheelie bins')

def home_shell():
    """Roof and chimney for the first house (a single-storey cottage)."""
    with shell('home'):
        gable(-8.07, 8.07, -5.57, 5.57, 2.6, 2.5, 'x', M['roof2'], M['plaster'], over=0.45)
        box(-5.2, -4.3, 2.6, 6.0, -1.0, -0.2, M['brick'], bevel=0.01, collide=False, name='chimney'); box(-5.3, -4.2, 6.0, 6.12, -1.1, -0.1, M['curb'], bevel=0.01, collide=False)
        # little porch roof over the front door
        gable(-0.5, 1.3, 5.57, 6.6, 2.25, 0.5, 'z', M['roof2'], M['white'], over=0.1, th=0.06)
        for x in (-0.42, 1.22): cyl(x, 6.52, 0, 2.25, 0.05, M['white'], seg=10, collide=False, bevel=0)
    for x in (-0.42, 1.22): collider(x - 0.05, x + 0.05, 0, 2.3, 6.47, 6.57)

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
        for x in (0.3, 3.4, 6.3, 8.6, 13.1): box(X(x) - 0.07, X(x) + 0.07, H1 - 0.16, H1, Z(8.47), Z(zf), M['white'], bevel=0.02, collide=False, name='bracket')
        # windows: five across the front upstairs, two on each end, three at the back
        for x in (1.7, 4.6, 7.775, 11.0, 12.6)[:4] + (12.55,): pass
        for x in (1.7, 4.6, 7.775, 10.2, 12.2): window('z', Z(zf), X(x), 3.3, 4.75, 0.95, 1)
        for z in (2.0, 6.2):
            window('x', X(x0), Z(z), 3.3, 4.75, 0.95, -1); window('x', X(x1), Z(z), 3.3, 4.75, 0.95, 1)
        for x in (1.7, 4.85, 7.4): window('z', Z(zb), X(x), 3.3, 4.75, 0.95, -1, shutters=False)
        # main roof with two front dormers and attic windows in the gable ends
        gable(X(x0), X(x1), Z(zb), Z(zf), H2, 2.9, 'x', M['roof'], M['clap'], over=0.3)
        zm = (zb + zf) / 2
        window('x', X(x0), Z(zm), 5.9, 6.9, 0.8, -1, shutters=False); window('x', X(x1), Z(zm), 5.9, 6.9, 0.8, 1, shutters=False)
        for x in (3.6, 9.8):
            box(X(x) - 0.7, X(x) + 0.7, 6.2, 7.2, Z(6.2), Z(7.6), M['clap'], bevel=0, collide=False, name='dormer')
            gable(X(x) - 0.7, X(x) + 0.7, Z(5.6), Z(7.6), 7.2, 0.55, 'z', M['roof'], M['clap'], over=0.12, th=0.06)
            window('z', Z(7.6), X(x), 6.35, 7.1, 0.8, 1, shutters=False)
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
        for s in (-1, 1): box(X(dxl + s * 0.62) - 0.09, X(dxl + s * 0.62) + 0.09, 0, 2.3, Z(8.47), Z(8.56), M['white'], bevel=0.01, collide=False, name='pilaster')
        box(X(dxl - 0.85), X(dxl + 0.85), 2.3, 2.52, Z(8.47), Z(8.6), M['white'], bevel=0.015, collide=False, name='entablature')
        box(X(14.1), X(18.7), 2.2, 2.45, Z(2.0), Z(2.27), M['white'], bevel=0.01, collide=False, name='garagedoor')

def neighbour(x, z, w, d, wallm, roofm, storeys=2, ridge='x', face=-1, door=0xF2EFE8):
    """A house you cannot enter: simple massing with windows. face = -1 looks north (toward the road from the far side)."""
    h = 2.7 * storeys
    box(x - w / 2, x + w / 2, 0, h, z - d / 2, z + d / 2, wallm, bevel=0, collide=False, name='nb')
    gable(x - w / 2, x + w / 2, z - d / 2, z + d / 2, h, min(w, d) * 0.3, ridge, roofm, wallm, over=0.3)
    zf = z + face * d / 2
    for s in range(storeys):
        for k in (-0.34, 0.34) if s == 0 else (-0.34, 0.0, 0.34):
            window('z', zf, x + k * w, 0.75 + s * 2.7, 2.05 + s * 2.7, 1.0, face)
    box(x - 0.5, x + 0.5, 0, 2.1, min(zf, zf + face * 0.04), max(zf, zf + face * 0.04), flat('ext_door%06x' % door, hexc(door), rough=0.5), bevel=0.01, collide=False, name='nbdoor')
    box(x + w * 0.3, x + w * 0.3 + 0.7, h, h + min(w, d) * 0.3 + 0.9, z - 0.35, z + 0.35, M['brick'], bevel=0.01, collide=False, name='nbch')

def neighbours():
    yel = pbr('ext_clap_y', 'white_planks_clean', tile=1.6, tint=(0.95, 0.86, 0.6), nonormal=True); blu = pbr('ext_clap_b', 'white_planks_clean', tile=1.6, tint=(0.62, 0.72, 0.8), nonormal=True)
    grn = pbr('ext_clap_g', 'white_planks_clean', tile=1.6, tint=(0.66, 0.76, 0.62), nonormal=True)
    neighbour(-18, 34, 13, 9, yel, M['roof'], door=0x8E2B25); neighbour(2, 35, 12, 9.5, M['brick'], M['roof2'], door=0x1F2A26)
    neighbour(21, 34, 14, 9, blu, M['roof'], door=0xF2EFE8); neighbour(41, 35, 12, 9, M['clap'], M['roof2'], door=0x2F5D50)
    neighbour(62, 34, 13, 9, grn, M['roof']); neighbour(-40, 34.5, 12, 9, M['plaster'], M['roof2'])
    neighbour(-38, 2, 12, 10, grn, M['roof'], face=1); neighbour(62, 0, 13, 10, yel, M['roof2'], face=1, door=0x1F2A26)
    for x in (-18, 2, 21, 41): flatq(x - 0.6, x + 0.6, 25.9, 29.5 if x != 2 else 30.2, -0.008, M['walk'], 'nbpath')

def treats_and_toys():
    for t in ((0.4, 0, 10.5), (-1.3, 1.24, 14.8), (10.0, 1.36, 16.15), (21.5, 0.64, 14.8), (OX + 7.775, 0, 11.0), (OX + 16.4, 0.82, 9.6), (OX + 2.5, 0, 9.0), (36.0, 0, 18.7), (5.65, 1.0, 12.97), (OX + 16.4, 0, 12.0), (OX - 1.8, 0, OZ + 6.0), (OX + 4.0, 0, OZ - 6.0)):
        S['treats'].append([round(t[0], 2), round(t[1] + 0.14, 2), round(t[2], 2)])
    prop('football', 26.5, 0, 9.5, scale=0.45); prop('ball', 3.5, 0, 10.5, col=0xE8556A); prop('baseball_01', 33.0, 0, 14.0); prop('garden_gnome', OX + 9.0, 0, OZ + 9.9, rot=180); prop('ball', OX + 1.0, 0, OZ - 5.0, col=0xF2C14E)

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
