"""The second house: a colonial down the street, laid out from a real first-floor plan.
Authored around its own origin (x east, y up, z south; the front door faces +z); ORIGIN places it in the world."""
import math, bpy
import house_lib as L
from house_lib import box, cyl, lathe, quad, put, prop, pbr, flat, hexc, collider, join, wall, S, log, B
import house_rooms as HR
from house_rooms import rug, cat_tree, scratch_post, floor_lamp, table_lamp, wall_shelf, curtain, bowl, cat_bed, treat, lamp_light, area_light

H, T = 2.6, 0.14
ORIGIN = (24.0, -3.0)
BOUNDS = [-3.5, 19.4, -8.0, 8.4]
# footprint pieces (roofs over them keep the sun out; also "am I indoors here")
ROOFS = [[0, 13.4, 0, 8.4], [-3.5, 0, 0, 3.7], [8.6, 13.4, -8.0, 0], [13.4, 19.4, -3.3, 2.2]]
SKY_STRENGTH = 0.03
PREVIEW_EXPOSURE = 1.6
SPAWN = dict(x=7.75, z=7.4, yaw=3.14)
HERO = {'sofa_03', 'dining_table', 'GothicBed_01'}
VIEWS = {
    'living': ((5.8, 2.3, 8.0), (1.5, 0.5, 4.5), 18),
    'living2': ((0.5, 2.2, 8.0), (5.0, 0.6, 3.9), 18),
    'foyer': ((7.8, 2.3, 8.2), (7.3, 0.6, 2.5), 18),
    'dining': ((9.0, 2.3, 8.0), (12.5, 0.5, 4.5), 18),
    'kitchen': ((13.0, 2.3, 3.6), (9.2, 0.6, 0.3), 18),
    'family': ((13.0, 2.3, -0.4), (9.5, 0.5, -7.5), 18),
    'family2': ((9.0, 2.2, -7.6), (12.5, 0.5, -1.0), 18),
    'office': ((3.1, 2.3, 3.4), (0.5, 0.5, 0.3), 18),
    'bedroom': ((6.0, 2.3, 3.4), (3.8, 0.4, 0.3), 18),
    'bath': ((8.3, 2.4, 1.5), (6.6, 0.4, 0.2), 16),
    'sunroom': ((-0.3, 2.3, 3.4), (-3.0, 0.4, 0.4), 18),
    'garage': ((13.8, 2.3, 1.9), (18.8, 0.5, -2.8), 18),
    'front': ((7.0, 4.0, 22.0), (7.5, 1.6, 8.0), 28),
    'back': ((-4.0, 5.0, -14.0), (6.0, 1.0, 0.0), 24),
}

def lm_weight(ob):
    n = ob.name
    if n.startswith('floor'): return 1.5
    if n.startswith('wall'): return 0.9
    return 1.0

M = {}
def mats():
    M['oak'] = pbr('fl_oak', 'oak_wood_planks', tile=2.2)
    M['oak2'] = pbr('fl_oak2', 'plank_flooring_04', tile=2.0)
    M['ktile'] = pbr('fl_k2tile', 'large_floor_tiles_02', tile=1.6)
    M['btile'] = pbr('fl_b2tile', 'marble_mosaic_tiles', tile=0.8)
    M['terra'] = pbr('fl_terra', 'terracotta_floor_tiles', tile=1.2)
    M['conc'] = pbr('fl_garage', 'concrete_floor_02', tile=3.0)
    M['w_living'] = pbr('w2_living', 'beige_wall_001', tile=2.5, tint=(0.82, 0.88, 0.8))          # sage
    M['w_foyer'] = pbr('w2_foyer', 'white_plaster_02', tile=2.5, tint=(1.0, 0.97, 0.9))
    M['w_dining'] = pbr('w2_dining', 'beige_wall_001', tile=2.5, tint=(0.95, 0.72, 0.62))         # terracotta
    M['w_kitchen'] = pbr('w2_kitchen', 'white_plaster_02', tile=2.5, tint=(0.98, 0.96, 0.86))
    M['w_family'] = pbr('w2_family', 'painted_plaster_wall', tile=2.5, tint=(0.78, 0.86, 0.95))  # pale blue
    M['w_office'] = pbr('w2_office', 'beige_wall_001', tile=2.5, tint=(0.75, 0.78, 0.9))
    M['w_bed'] = pbr('w2_bed', 'painted_plaster_wall', tile=2.5, tint=(0.95, 0.85, 0.9))
    M['w_bath'] = pbr('w2_bath', 'square_tiles', tile=0.9, tint=(0.85, 0.95, 1.0))
    M['w_sun'] = pbr('w2_sun', 'white_plaster_02', tile=2.5, tint=(1.0, 0.98, 0.9))
    M['w_garage'] = pbr('w2_garage', 'white_plaster_02', tile=2.5, tint=(0.85, 0.85, 0.85))
    M['ext'] = pbr('ext_clap', 'white_planks_clean', tile=1.6, nonormal=True)
    M['trim'] = flat('trim_white', hexc(0xF4F1EA), rough=0.45)
    M['ceil'] = flat('ceiling', hexc(0xF2F0EC), rough=0.9)
    M['brick'] = pbr('brick', 'red_brick_03', tile=1.2)
    M['steel'] = flat('k_steel', hexc(0xB8BDC2), rough=0.3, metal=0.9)
    M['dark'] = flat('k_dark', hexc(0x2A2A2E), rough=0.5)
    M['cer'] = flat('b_ceramic', hexc(0xF7F6F2), rough=0.12)

def floor(name, x0, x1, z0, z1, mat):
    return quad([(x0, 0, z1), (x1, 0, z1), (x1, 0, z0), (x0, 0, z0)], mat, name='floor_' + name)

def architecture():
    W = lambda *a, **k: wall(*a, H=H, T=T, base=M['trim'], trim=M['trim'], **k)
    D = 2.05; E = M['ext']
    floor('living', 0, 6.3, 3.7, 8.4, M['oak']); floor('foyer', 6.3, 8.6, 1.7, 8.4, M['oak'])
    floor('dining', 8.6, 13.4, 3.9, 8.4, M['oak']); floor('kitchen', 8.6, 13.4, 0, 3.9, M['ktile'])
    floor('family', 8.6, 13.4, -8.0, 0, M['oak2']); floor('office', 0, 3.4, 0, 3.7, M['oak2'])
    floor('bedroom', 3.4, 6.3, 0, 3.7, M['oak2']); floor('bath', 6.3, 8.6, 0, 1.7, M['btile'])
    floor('sunroom', -3.5, 0, 0, 3.7, M['terra']); floor('garage', 13.4, 19.4, -3.3, 2.2, M['conc'])
    # ---- front (south) wall
    W('z', 8.4, 0, 6.3, M['w_living'], E, ext='pos', key='c_s_living', openings=[(0.9, 2.5, 0.55, 2.15, 'window'), (3.8, 5.4, 0.55, 2.15, 'window')])
    W('z', 8.4, 6.3, 8.6, M['w_foyer'], E, ext='pos', key='c_s_foyer', openings=[(7.3, 8.25, 0, D + 0.05, 'door')])
    W('z', 8.4, 8.6, 13.4, M['w_dining'], E, ext='pos', key='c_s_dining', openings=[(9.8, 12.2, 0.5, 2.15, 'window')])
    # ---- west side
    W('x', 0, 3.7, 8.4, E, M['w_living'], ext='neg', key='c_w_living', openings=[(5.1, 7.0, 0.55, 2.15, 'window')])
    W('x', 0, 0, 3.7, M['w_sun'], M['w_office'], key='c_sun_office', openings=[(1.4, 2.35, 0, D, 'door')])
    W('x', -3.5, 0, 3.7, E, M['w_sun'], ext='neg', key='c_w_sun', openings=[(0.45, 3.25, 0.45, 2.25, 'window')])
    W('z', 3.7, -3.5, 0, M['w_sun'], E, ext='pos', key='c_s_sun', openings=[(-3.05, -0.45, 0.45, 2.25, 'window')])
    W('z', 0, -3.5, 0, E, M['w_sun'], ext='neg', key='c_n_sun', openings=[(-2.35, -1.25, 0, D, 'door')])
    # ---- north side of the main block
    W('z', 0, 0, 3.4, E, M['w_office'], ext='neg', key='c_n_office', openings=[(0.9, 2.5, 0.75, 2.1, 'window')])
    W('z', 0, 3.4, 6.3, E, M['w_bed'], ext='neg', key='c_n_bed', openings=[(4.1, 5.6, 0.75, 2.1, 'window')])
    W('z', 0, 6.3, 8.6, E, M['w_bath'], ext='neg', key='c_n_bath', openings=[(7.1, 7.8, 1.2, 2.0, 'window')])
    # ---- family room wing
    W('x', 8.6, -8.0, 0, E, M['w_family'], ext='neg', key='c_w_family', openings=[(-7.1, -5.5, 0.55, 2.15, 'window'), (-4.1, -3.0, 0, D, 'door')])
    W('z', -8.0, 8.6, 13.4, E, M['w_family'], ext='neg', key='c_n_family', openings=[(8.95, 9.95, 0.55, 2.15, 'window'), (12.05, 13.05, 0.55, 2.15, 'window')])
    W('x', 13.4, -8.0, -3.3, M['w_family'], E, ext='pos', key='c_e_family', openings=[(-7.2, -5.2, 0.55, 2.15, 'window')])
    W('x', 13.4, -3.3, 0, M['w_family'], M['w_garage'], key='c_fam_garage', openings=[(-2.1, -1.15, 0, D, 'door')])
    W('x', 13.4, 0, 2.2, M['w_kitchen'], M['w_garage'], key='c_kit_garage')
    W('x', 13.4, 2.2, 3.9, M['w_kitchen'], E, ext='pos', key='c_e_kitchen', openings=[(2.55, 3.5, 1.1, 2.05, 'window')])
    W('x', 13.4, 3.9, 8.4, M['w_dining'], E, ext='pos', key='c_e_dining', openings=[(5.3, 7.1, 0.55, 2.15, 'window')])
    # ---- garage
    W('z', -3.3, 13.4, 19.4, E, M['w_garage'], ext='neg', key='c_n_garage', openings=[(15.6, 17.2, 1.1, 2.0, 'window')])
    W('x', 19.4, -3.3, 2.2, M['w_garage'], E, ext='pos', key='c_e_garage', openings=[(-1.5, 0.3, 1.1, 2.0, 'window')])
    W('z', 2.2, 13.4, 19.4, M['w_garage'], E, ext='pos', key='c_s_garage', openings=[(14.1, 18.7, 0, 2.2, 'door')])
    # ---- inner walls
    W('z', 3.7, 0, 3.4, M['w_office'], M['w_living'], key='c_off_liv', openings=[(0.6, 1.55, 0, D, 'door')])
    W('z', 3.7, 3.4, 6.3, M['w_bed'], M['w_living'], key='c_bed_liv')
    W('x', 3.4, 0, 3.7, M['w_office'], M['w_bed'], key='c_off_bed')
    W('x', 6.3, 0, 1.7, M['w_bed'], M['w_bath'], key='c_bed_bath')
    W('x', 6.3, 1.7, 3.7, M['w_bed'], M['w_foyer'], key='c_bed_hall', openings=[(2.3, 3.2, 0, D, 'door')])
    W('x', 6.3, 3.7, 8.4, M['w_living'], M['w_foyer'], key='c_liv_foyer', openings=[(7.35, 8.2, 0, 2.2, 'arch')])
    W('z', 1.7, 6.3, 8.6, M['w_bath'], M['w_foyer'], key='c_bath_hall', openings=[(7.35, 8.2, 0, D, 'door')])
    W('x', 8.6, 0, 1.7, M['w_bath'], M['w_kitchen'], key='c_bath_kit')
    W('x', 8.6, 1.7, 3.9, M['w_foyer'], M['w_kitchen'], key='c_hall_kit', openings=[(2.35, 3.4, 0, D, 'door')])
    W('x', 8.6, 3.9, 8.4, M['w_foyer'], M['w_dining'], key='c_foyer_din', openings=[(5.3, 7.3, 0, 2.2, 'arch')])
    W('z', 3.9, 8.6, 13.4, M['w_kitchen'], M['w_dining'], key='c_kit_din', openings=[(9.2, 10.5, 0, 2.2, 'arch')])
    W('z', 0, 8.6, 13.4, M['w_family'], M['w_kitchen'], key='c_fam_kit', openings=[(9.5, 13.0, 0, 2.3, 'arch')])
    # ceilings for the light bake, and some ground outside for bounce light
    for i, (x0, x1, z0, z1) in enumerate(ROOFS):
        c = box(x0 - 0.2, x1 + 0.2, H, H + 0.1, z0 - 0.2, z1 + 0.2, M['ceil'], bevel=0, collide=False, static=False, name='ceiling'); L.BAKE_ONLY.append(c)
    g = quad([(-30, -0.02, 30), (40, -0.02, 30), (40, -0.02, -30), (-30, -0.02, -30)], flat('bake_ground', hexc(0x6F8F4A), rough=0.9), name='ground', static=False); L.BAKE_ONLY.append(g)
    # the front door stands open
    doorm = flat('door_red', hexc(0x8E2B25), rough=0.4)
    L.EXT.append(box(7.25, 7.3, 0, D + 0.03, 8.47, 9.38, doorm, bevel=0.01, collide=False, static=False, name='frontdoor'))

def counter(x0, x1, z0, z1, face, cab, top, spot='the kitchen counter', h=0.9, doors=True):
    """Base cabinet run with a stone top. face: side the doors are on ('n','s','e','w')."""
    box(x0, x1, 0.1, h - 0.04, z0, z1, cab, bevel=0.004, collide=False)
    box(x0 - 0.015, x1 + 0.015, h - 0.04, h, z0 - 0.015, z1 + 0.015, top, bevel=0.008, collide=False)
    collider(x0, x1, 0, h, z0, z1, spot=spot)
    if not doors: return
    objs = []
    alongx = face in ('n', 's')
    a0, a1 = (x0, x1) if alongx else (z0, z1)
    n = max(1, round((a1 - a0) / 0.6)); w = (a1 - a0) / n
    f = {'n': z0, 's': z1, 'w': x0, 'e': x1}[face]; d = -1 if face in ('n', 'w') else 1
    for i in range(n):
        s0, s1 = a0 + i * w + 0.012, a0 + (i + 1) * w - 0.012; mid = a0 + (i + .5) * w
        for (y0, y1) in ((0.13, 0.68), (0.7, 0.82)):
            if alongx: objs.append(box(s0, s1, y0, y1, f, f + d * 0.018, cab, bevel=0.006, collide=False, static=False))
            else: objs.append(box(f, f + d * 0.018, y0, y1, s0, s1, cab, bevel=0.006, collide=False, static=False))
        if alongx: objs.append(box(mid - 0.06, mid + 0.06, 0.745, 0.76, f + d * 0.018, f + d * 0.04, M['steel'], bevel=0.004, collide=False, static=False))
        else: objs.append(box(f + d * 0.018, f + d * 0.04, 0.745, 0.76, mid - 0.06, mid + 0.06, M['steel'], bevel=0.004, collide=False, static=False))
    L.STATIC.append(join(objs, 'kdoors'))

def fireplace(xc, zw, d, name, brick=None):
    """Chimney breast on a wall at z=zw, sticking out toward d (+1 = south). Mantel is a ledge for ornaments."""
    brick = brick or M['brick']; black = flat('soot', hexc(0x141210), rough=0.95)
    z0, z1 = sorted((zw, zw + d * 0.42))
    box(xc - 0.85, xc - 0.45, 0, 1.2, z0, z1, brick, bevel=0.008, collide=False); box(xc + 0.45, xc + 0.85, 0, 1.2, z0, z1, brick, bevel=0.008, collide=False)
    box(xc - 0.45, xc + 0.45, 0.78, 1.2, z0, z1, brick, bevel=0.008, collide=False)
    zb0, zb1 = sorted((zw, zw + d * 0.1))
    box(xc - 0.45, xc + 0.45, 0, 0.78, zb0, zb1, black, bevel=0, collide=False)
    box(xc - 0.75, xc + 0.75, 1.2, H, z0 + (0.06 if d > 0 else 0), z1 - (0.06 if d > 0 else 0) if d > 0 else z1, M['w_foyer'] if False else M['trim'], bevel=0.004, collide=False)
    m0, m1 = sorted((zw, zw + d * 0.52))
    box(xc - 0.98, xc + 0.98, 1.2, 1.26, m0, m1, M['trim'], bevel=0.012, collide=False)
    collider(xc - 0.85, xc + 0.85, 0, 1.2, z0, z1, cam=True); collider(xc - 0.98, xc + 0.98, 1.2, 1.26, m0, m1, spot=name)
    collider(xc - 0.75, xc + 0.75, 1.26, H, z0, z1, cam=True)
    h0, h1 = sorted((zw + d * 0.42, zw + d * 0.85))
    box(xc - 0.8, xc + 0.8, 0, 0.03, h0, h1, brick, bevel=0.004, collide=False)
    # logs and a warm glow
    wood = flat('log', hexc(0x4A3020), rough=0.9); ember = flat('ember', hexc(0x4A1508), rough=0.8, emit=hexc(0xFF7A20), emit_strength=3.0)
    zl = zw + d * 0.24
    box(xc - 0.3, xc + 0.3, 0.03, 0.1, zl - 0.05, zl + 0.05, wood, bevel=0.03, segs=3, collide=False); box(xc - 0.25, xc + 0.25, 0.09, 0.15, zl - 0.03, zl + 0.07, ember, bevel=0.025, segs=3, collide=False)
    lamp_light(xc, 0.3, zw + d * 0.5, 22, color=(1.0, 0.55, 0.25), radius=0.12)

def stairs():
    """Up from the foyer along the living-room wall. Drawn as 11 real steps; collides as a fine ramp so paws can walk it."""
    oak = pbr('stair_oak', 'oak_veneer_01', tile=1.0); white = M['trim']; run_col = flat('stair_runner', hexc(0x8A2E2A), rough=0.95)
    x0, x1, zs = 6.37, 7.3, 7.3
    n, rise, run = 11, 2.09 / 11, 0.26
    for i in range(n):
        za, zb = zs - (i + 1) * run, zs - i * run
        box(x0, x1, 0 if i == 0 else i * rise - 0.02, (i + 1) * rise - 0.03, za, zb, white, bevel=0.003, collide=False)
        box(x0, x1 + 0.02, (i + 1) * rise - 0.03, (i + 1) * rise, za - 0.02, zb, oak, bevel=0.006, collide=False)
        box(x0 + 0.2, x1 - 0.2, (i + 1) * rise, (i + 1) * rise + 0.006, za, zb, run_col, bevel=0, collide=False)
    zt = zs - n * run
    box(x0, x1, 0, 2.09, 3.78, zt, white, bevel=0.004, collide=False); box(x0, x1 + 0.02, 2.06, 2.09, 3.78, zt, oak, bevel=0.004, collide=False)
    box(x0, x1, 0, 0.02, zt, zs, white, bevel=0, collide=False)
    side = box(x1 - 0.02, x1, 0, 0.02, zt, zs, white, bevel=0, collide=False)
    nn = 42; r = 2.09 / nn; rr = (zs - zt) / nn
    for i in range(nn): collider(x0, x1, 0, (i + 1) * r, zs - (i + 1) * rr, zs - i * rr, step=True)
    collider(x0, x1, 0, 2.09, 3.78, zt, spot='the top of the stairs')
    # banister
    for i in range(n + 1):
        z = zs - i * run + 0.0; y = i * rise
        cyl(x1 - 0.03, min(z, zs - 0.05), y, y + 0.85, 0.017, white, seg=8, collide=False, bevel=0)
    import bmesh
    bm = bmesh.new()
    p = [(x1 - 0.06, 0.85, zs), (x1, 0.85, zs), (x1, 0.85 + 2.09, zt), (x1 - 0.06, 0.85 + 2.09, zt)]
    vs = [bm.verts.new(B(*q)) for q in p] + [bm.verts.new(B(q[0], q[1] + 0.05, q[2])) for q in p]
    for f in ((0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)): bm.faces.new([vs[i] for i in f])
    bm.normal_update(); L._finish(bm, 'rail', oak)
    cyl(x1 - 0.03, zs + 0.02, 0, 1.0, 0.045, oak, seg=12, collide=True)

def living():
    put('sofa_03', 2.6, 6.9, rot=180, collide=('seat', 0.54, 0.2, (0.76, 0.3)))
    S['scratch'] += [dict(type='wall', axis='x', at=1.23, n=-1, a=[6.45, 7.35], name='sofa', surface='fabric', marks=True),
                     dict(type='wall', axis='x', at=3.97, n=1, a=[6.45, 7.35], name='sofa', surface='fabric', marks=True),
                     dict(type='wall', axis='z', at=7.37, n=1, a=[1.3, 3.9], name='sofa', surface='fabric', marks=True)]
    S['zones'].append(dict(kind='knead', b=[1.4, 3.8, 6.4, 7.0], y=0.54, name='the big sofa'))
    put('coffee_table_round_01', 2.6, 5.45)
    put('ArmChair_01', 0.75, 5.0, rot=90, collide=('seat', 0.49, 0.22, (0.68, 0.14)))
    put('ArmChair_01', 5.1, 5.6, rot=250, collide='none'); collider(4.7, 5.5, 0, 0.49, 5.2, 6.0)
    fireplace(4.6, 3.77, 1, 'the living-room mantel')
    put('vintage_cabinet_01', 1.7, 3.77 + 0.36, rot=0, cam=True, spot='the china cabinet')
    put('side_table_tall_01', 0.4, 7.9, collide=('table', 0.05))
    put('vintage_grandfather_clock_01', 6.3 - 0.07 - 0.23, 4.4, rot=270, cam=True, spot='the hall clock')
    put('potted_plant_02', 5.8, 7.9, collide='none'); collider(5.55, 6.05, 0, 0.4, 7.65, 8.15)
    put('fancy_picture_frame_02', 0.07 + 0.045, 4.3, rot=90, y=1.25, collide='none')
    put('hanging_picture_frame_02', 2.9, 8.4 - 0.07 - 0.02, rot=180, y=1.35, collide='none')
    floor_lamp(0.45, 6.3); table_lamp(0.4, 0.76, 7.9)
    rug('c_living', 0.9, 4.4, 4.5, 6.4, [0x2F4A3A, 0xD9C7A0, 0x8A3B2E, 0xE5B45A], seed=21)
    for a in ((0.9, 2.5), (3.8, 5.4)): curtain('z', 8.4 - 0.07, a[0], a[1], 2.15, -1, (0.5, 0.62, 0.45), 'c_living')
    curtain('x', 0.07, 5.1, 7.0, 2.15, 1, (0.5, 0.62, 0.45), 'c_living')
    S['zones'].append(dict(kind='sun', b=[0.8, 2.8, 6.9, 8.2], name='the front-window sunbeam'))
    prop('mantel_clock_01', 4.6, 1.26, 3.95); prop('ceramic_vase_01', 3.95, 1.26, 3.97); prop('brass_vase_01', 5.3, 1.26, 3.97, scale=0.6); prop('standing_picture_frame_02', 5.0, 1.26, 3.95, rot=0)
    prop('marble_bust_01', 0.4, 0.77, 7.75, rot=90, scale=0.7)
    prop('tea_set_01#8', 2.5, 0.5, 5.4); prop('tea_set_01#0', 2.85, 0.5, 5.6); prop('tea_set_01#1', 2.3, 0.5, 5.7); prop('book_encyclopedia_set_01', 2.8, 0.5, 5.2, rot=30)
    prop('throw_pillows_01#0', 1.7, 0.55, 6.85, rot=180); prop('throw_pillows_01#1', 3.5, 0.55, 6.85, rot=180)
    prop('yarn', 3.3, 0, 4.6, col=0x5FB58A); prop('mouse', 1.2, 0, 5.9); prop('ball', 5.6, 0, 4.9, col=0xF2C14E)
    prop('ceramic_vase_03', 1.2, 2.25, 4.1); prop('antique_ceramic_vase_01', 2.2, 2.25, 4.12, scale=0.7)
    for t in ((4.6, 1.26, 4.1), (1.7, 2.25, 4.1), (2.6, 0.5, 5.45), (2.6, 0.54, 6.75), (0.75, 0.49, 5.0), (5.9, 0, 4.2), (0.4, 0, 4.2), (6.0, 2.2, 4.4), (3.0, 0, 8.0)):
        treat(*t)

def foyer():
    stairs()
    put('ClassicConsole_01', 8.6 - 0.07 - 0.3, 4.6, rot=270, collide=('table', 0.1))
    put('ornate_mirror_01', 8.6 - 0.07 - 0.014, 4.6, rot=270, y=1.3, scale=1.2, collide='none')
    put('painted_wooden_bench', 8.6 - 0.07 - 0.26, 7.75, rot=270, collide=('seat', 0.66, 0.15))
    put('hanging_picture_frame_01', 6.3 + 0.07 + 0.012, 2.75, rot=90, y=1.1, collide='none') if False else None
    put('hanging_picture_frame_03', 8.6 - 0.07 - 0.016, 1.98, rot=270, y=1.25, collide='none') if False else None
    rug('c_foyer', 7.4, 8.3, 4.6, 7.9, [0x7A2E2A, 0x1F3D4F, 0xE8D3A8, 0xC98A3A], seed=23)
    table_lamp(8.25, 0.95, 4.2)
    area_light(7.6, 2.55, 6.3, 0.9, 1.6, 95); area_light(7.4, 2.55, 2.8, 0.9, 1.2, 60)
    wall_shelf(8.6 - 0.07 - 0.22, 8.6 - 0.07, 1.75, 5.9, 6.9, spot='the foyer shelf') if False else None
    prop('rubber_boots#2', 8.1, 0, 8.05, rot=90); prop('rubber_boots#3', 8.12, 0, 7.3, rot=80)
    prop('ceramic_vase_04', 8.2, 0.95, 4.9); prop('standing_picture_frame_01', 8.25, 0.95, 4.5, rot=270); prop('binder_notebook#1', 8.2, 0.66, 7.6, rot=90)
    prop('ball', 7.9, 0, 3.4, col=0xE8556A); prop('pingpong', 6.8, 2.09, 4.0)
    for t in ((6.83, 2.09, 4.05), (6.83, 1.1, 5.9), (7.9, 0, 7.9), (8.25, 0.66, 7.9), (7.5, 0, 2.2), (8.2, 0.95, 4.3)):
        treat(*t)

def dining():
    put('dining_table', 11.0, 6.15, rot=0, collide=('table', 0.07), spot='the long dining table')
    for (x, z, r) in ((10.3, 5.25, 0), (11.0, 5.25, 0), (11.7, 5.25, 0), (10.3, 7.05, 180), (11.0, 7.05, 180), (11.7, 7.05, 180)):
        put('dining_chair_02', x, z, rot=r, collide=('seat', 0.45, 0.12))
    put('vintage_wooden_drawer_01', 11.6, 3.9 + 0.07 + 0.52, rot=0, spot='the sideboard')
    put('painted_wooden_cabinet_02', 13.4 - 0.07 - 0.37, 4.55, rot=270, cam=True, spot='the tall pantry cupboard') if False else None
    put('fancy_picture_frame_01', 8.6 + 0.07 + 0.012, 4.6, rot=90, y=1.5, collide='none')
    # brass chandelier
    brass = flat('brass', hexc(0xB08A3A), rough=0.3, metal=0.9); glow = flat('lamp_shade', hexc(0xF3E3C0), rough=0.8, emit=hexc(0xFFD9A0), emit_strength=2.2)
    cyl(11.0, 6.15, 2.05, H, 0.012, brass, seg=8, collide=False, bevel=0); lathe(11.0, 6.15, 1.92, [(0.02, 0), (0.07, 0.04), (0.03, 0.1), (0.02, 0.14)], brass, name='chand')
    for k in range(6):
        a = k * math.pi / 3; x, z = 11.0 + math.cos(a) * 0.32, 6.15 + math.sin(a) * 0.32
        cyl(x, z, 1.98, 2.0, 0.035, brass, seg=10, collide=False, bevel=0); cyl(x, z, 2.0, 2.09, 0.014, glow, seg=8, collide=False, bevel=0)
    lamp_light(11.0, 1.9, 6.15, 110)
    rug('c_dining', 9.4, 12.6, 4.9, 7.4, [0x1F3D4F, 0xE8D3A8, 0x7A2E2A, 0xC98A3A], seed=25)
    curtain('z', 8.4 - 0.07, 9.8, 12.2, 2.15, -1, (0.85, 0.75, 0.55), 'c_dining'); curtain('x', 13.4 - 0.07, 5.3, 7.1, 2.15, -1, (0.85, 0.75, 0.55), 'c_dining')
    S['zones'].append(dict(kind='sun', b=[9.9, 12.1, 7.3, 8.25], name='the bay-window sunbeam'))
    prop('strawberry_chocolate_cake', 11.0, 0.88, 6.15); prop('brass_goblets#0', 10.4, 0.88, 5.9); prop('brass_goblets#1', 11.6, 0.88, 6.4); prop('brass_goblets#2', 10.5, 0.88, 6.5)
    prop('tea_set_01#6', 11.5, 0.88, 5.8); prop('tea_set_01#9', 10.2, 0.88, 6.2); prop('wine_bottles_01#3', 11.9, 0.88, 6.1); prop('food_apple_01', 10.8, 0.88, 5.7)
    prop('ceramic_vase_02', 11.1, 1.09, 4.5); prop('jug_01', 12.1, 1.09, 4.45); prop('antique_ceramic_vase_01', 11.6, 1.09, 4.5, scale=0.8); prop('wine_bottles_01#0', 10.95, 1.09, 4.35)
    prop('planter_pot_clay', 10.3, 0.5, 8.28); prop('potted_plant_04', 11.7, 0.5, 8.28)
    for t in ((11.0, 0.0, 6.15), (11.0, 0.88, 5.7), (12.2, 1.09, 4.5), (9.1, 0, 8.0), (13.0, 0, 7.9), (11.0, 0.5, 8.27), (13.0, 0, 4.4)):
        treat(*t)

def kitchen():
    cab = flat('k2_cab', hexc(0xF1EEE6), rough=0.45); isl = flat('k2_island', hexc(0x3F5A6B), rough=0.45)
    top = pbr('k2_top', 'granite_tile', tile=1.2, rough=0.2, nonormal=True); steel = M['steel']; dark = M['dark']
    # west wall run with the cooker; south wall run toward the east
    counter(8.67, 9.27, 0.07, 0.75, 'e', cab, top); counter(8.67, 9.27, 1.42, 2.25, 'e', cab, top)
    put('electric_stove', 8.67 + 0.33, 1.08, rot=90, scale=1.03, spot='the cooker')
    counter(10.75, 12.6, 3.25, 3.83, 'n', cab, top)
    put('vintage_microwave', 11.2, 3.52, rot=180, y=0.9, scale=0.5)
    # wall cabinets above the south run
    box(10.75, 12.6, 1.45, 2.2, 3.5, 3.83, cab, bevel=0.005, cam=True, spot='the top of the kitchen cupboards')
    # fridge on the garage wall
    fr = flat('k2_fridge', hexc(0xC9CDD2), rough=0.25, metal=0.6)
    box(12.6, 13.33, 0.03, 1.85, 0.3, 1.1, fr, bevel=0.02, segs=3, cam=True, spot='the top of the big fridge')
    box(12.59, 12.6, 1.0, 1.008, 0.32, 1.08, dark, bevel=0, collide=False); box(12.56, 12.6, 1.1, 1.5, 0.36, 0.39, steel, bevel=0.008, collide=False); box(12.56, 12.6, 0.45, 0.9, 0.36, 0.39, steel, bevel=0.008, collide=False)
    # island with stools
    counter(10.5, 12.0, 1.35, 2.25, 's', isl, top, spot='the kitchen island')
    for x in (10.9, 11.6): put('bar_chair_round_01', x, 2.62, collide=('table', 0.04))
    # peninsula with the sink, between kitchen and family room
    counter(8.67, 9.35, -2.3, -0.2, 'e', cab, top, spot='the breakfast bar')
    box(8.77, 9.25, 0.905, 0.91, -1.6, -0.8, steel, bevel=0.003, collide=False); box(8.82, 9.2, 0.8, 0.906, -1.55, -0.85, dark, bevel=0.01, collide=False)
    lathe(8.76, -1.2, 0.9, [(0.022, 0), (0.018, 0.02), (0.012, 0.22), (0.012, 0.26)], steel, name='faucet', seg=12)
    box(8.76, 8.97, 1.14, 1.165, -1.212, -1.188, steel, bevel=0.008, collide=False)
    S['items'].append(dict(kind='faucet', p=[8.97, 1.12, -1.2], r=0.45, basin=[8.97, 0.9, -1.2]))
    # bowls on a mat by the garage wall
    mat_ = flat('k2_mat', hexc(0xC98A3A), rough=0.9)
    box(12.75, 13.3, 0, 0.012, 1.3, 2.15, mat_, bevel=0.004, collide=False)
    bowl(13.05, 1.55, 0x4F9BD9, 0x8A5A2B); bowl(13.05, 1.93, 0xF2C14E, 0x9FD4F0)
    S['items'].append(dict(kind='food', p=[13.05, 0.06, 1.55], stand=[12.7, 1.55], yaw=math.pi / 2))
    S['items'].append(dict(kind='water', p=[13.05, 0.06, 1.93], stand=[12.7, 1.93], yaw=math.pi / 2))
    put('wall_clock', 13.4 - 0.07 - 0.027, 3.0, rot=270, y=2.2, collide='none')
    area_light(11.0, 2.55, 1.9, 2.4, 1.6, 200)
    prop('vintage_electric_kettle', 8.95, 0.9, 0.4, scale=0.8); prop('pot_enamel_01', 8.98, 0.89, 1.0, scale=0.9); prop('brass_pot_01', 8.95, 0.9, 1.95, scale=0.8)
    prop('wooden_spoon', 9.0, 0.9, 1.6, rot=40); prop('croissant', 11.5, 0.9, 1.75); prop('carrot_cake', 11.0, 0.9, 1.8); prop('bananas#2', 10.75, 0.9, 1.65)
    prop('mug', 11.8, 0.9, 1.6, col=0x5FB58A); prop('mug', 12.2, 0.9, 3.5, col=0xE8785A); prop('glass', 9.0, 0.9, -0.5); prop('glass', 9.05, 0.9, -1.9)
    prop('cereal', 12.95, 1.85, 0.7); prop('flour', 11.3, 2.2, 3.65); prop('lemon', 11.9, 0.9, 2.0); prop('food_lime_01', 12.0, 0.9, 1.9); prop('yellow_onion', 11.95, 0.9, 3.45)
    prop('wine_bottles_01#1', 12.4, 0.9, 3.6); prop('wooden_bowl_01', 11.25, 0.9, 1.75) if False else None
    for t in ((11.25, 0.9, 1.6), (12.95, 1.85, 0.5), (12.0, 2.2, 3.65), (8.97, 0.9, -0.4), (9.0, 0.89, 1.08), (9.9, 0, 0.6), (11.25, 0, 3.0), (12.3, 0.9, 3.5)):
        treat(*t)

def family():
    fireplace(11.0, -8.0 + 0.07, 1, 'the family-room mantel')
    put('Sofa_01', 11.0, -4.2, rot=180, collide=('seat', 0.42, 0.25))
    S['scratch'] += [dict(type='wall', axis='z', at=-3.87, n=1, a=[10.25, 11.75], name='sofa', surface='fabric', marks=True)]
    S['zones'].append(dict(kind='knead', b=[10.3, 11.7, -4.5, -4.05], y=0.42, name='the family-room sofa'))
    put('mid_century_lounge_chair', 9.5, -5.6, rot=60, collide='none'); collider(9.1, 9.9, 0, 0.42, -6.0, -5.2)
    put('Rockingchair_01', 12.6, -5.8, rot=300, collide='none'); collider(12.3, 12.9, 0, 0.42, -6.1, -5.5)
    put('modern_coffee_table_01', 11.0, -5.6, rot=90)
    put('wooden_table_02', 12.85, -2.6, rot=270, collide=('table', 0.05))
    put('television_02', 12.85, -2.6, rot=270, y=0.8)
    S['items'].append(dict(kind='tv', p=[12.66, 1.02, -2.6], n=[-1, 0], size=[0.27, 0.2]))
    put('wooden_bookshelf_worn', 13.4 - 0.07 - 0.3, -4.3, rot=270, collide=('shelves', [0.1, 0.4, 0.68, 0.96, 1.28, 1.66, 2.06]), cam=True, spot='the family-room bookshelf')
    put('Ottoman_01', 9.6, -3.4, rot=0)
    cat_tree(9.35, -7.3)
    scratch_post(12.9, -7.4)
    floor_lamp(12.95, -0.6)
    put('potted_plant_01', 9.2, -0.75, collide='none') if False else None
    rug('c_family', 9.6, 12.5, -6.6, -4.9, [0x35506B, 0xE9DCC3, 0xC98A3A, 0xF7F3EC], seed=27)
    curtain('x', 13.4 - 0.07, -7.2, -5.2, 2.15, -1, (0.35, 0.45, 0.6), 'c_family'); curtain('x', 8.6 + 0.07, -7.1, -5.5, 2.15, 1, (0.35, 0.45, 0.6), 'c_family')
    area_light(11.0, 2.55, -4.0, 2.0, 2.4, 150)
    S['zones'].append(dict(kind='sun', b=[11.6, 13.2, -7.2, -5.2], name='the family-room sunbeam'))
    prop('concrete_cat_statue', 10.35, 1.26, -7.75, rot=0); prop('ceramic_vase_04', 11.6, 1.26, -7.75); prop('alarm_clock_01', 11.0, 1.26, -7.75); prop('carved_wooden_elephant', 10.7, 1.26, -7.72, scale=1.6)
    prop('gamepad', 11.0, 0.39, -5.6, scale=0.5); prop('mug', 11.0, 0.39, -5.2, col=0xFFFFFF); prop('binder_notebook#0', 11.0, 0.39, -6.0, rot=70)
    prop('garden_gnome', 13.05, 1.28, -4.0, rot=270, scale=0.55); prop('ceramic_vase_03', 13.05, 1.66, -4.6, scale=0.8); prop('brass_vase_01', 13.05, 2.06, -4.3) ; prop('jug_01', 13.05, 0.96, -4.5, rot=90)
    prop('throw_pillows_01#1', 11.0, 0.45, -4.25, rot=180); prop('american_football', 10.2, 0, -2.6, scale=0.6); prop('yarn', 12.2, 0, -3.3, col=0xD9534F); prop('mouse', 9.8, 0, -6.9); prop('bell', 12.0, 0, -6.9); prop('baseball_01', 10.6, 0, -1.2)
    for t in ((11.0, 1.26, -7.6), (9.07, 1.83, -7.5), (13.05, 2.06, -4.6), (12.85, 0.8, -2.2), (11.0, 0.42, -4.2), (9.6, 0.62, -3.4), (12.6, 0, -7.6), (9.5, 0, -1.8), (11.0, 0.39, -5.9), (13.0, 0, -1.6)):
        treat(*t)

def office():
    put('metal_office_desk', 1.7, 0.07 + 0.5, rot=0, collide=('table', 0.06), spot='the office desk')
    collider(0.72, 1.15, 0, 0.73, 0.1, 1.0); collider(2.25, 2.68, 0, 0.73, 0.1, 1.0)
    put('classic_laptop', 1.5, 0.55, rot=0, y=0.79, scale=0.8, collide='none')
    S['items'].append(dict(kind='laptop', p=[1.5, 0.82, 0.6], r=0.3, screen=[1.5, 1.03, 0.43], size=[0.3, 0.2]))
    put('desk_lamp_arm_01', 2.4, 0.4, rot=120, y=0.79, collide='none'); lamp_light(2.2, 1.35, 0.6, 30)
    put('modern_arm_chair_01', 1.7, 1.75, rot=180, collide=('seat', 0.42, 0.25))
    put('drawer_cabinet', 3.4 - 0.07 - 0.25, 2.6, rot=270, collide='none'); collider(2.84, 3.33, 0, 1.88, 2.03, 3.17, cam=True, spot='the filing cabinet')
    put('wooden_display_shelves_01', 2.6, 3.7 - 0.07 - 0.19, rot=90, collide=('shelves', [0.06, 0.42, 0.78, 1.16, 1.54]), cam=True, spot='the office shelves') if False else None
    put('small_wooden_table_01', 0.07 + 0.25, 3.0, rot=90, collide=('table', 0.05))
    put('chess_set', 0.33, 3.0, rot=0, y=0.533, scale=0.7, collide='none')
    S['items'].append(dict(kind='chess', p=[0.33, 0.6, 3.0], r=0.35))
    put('dartboard', 3.4 - 0.07 - 0.02, 1.0, rot=270, y=1.4, collide='none')
    wall_shelf(0.07, 0.3, 1.55, 0.3, 1.2, spot='the office shelf')
    rug('c_office', 0.8, 2.7, 1.3, 3.0, [0x4A3A5A, 0xD8C39A, 0xB8483E, 0xE5B45A], seed=29)
    curtain('z', 0.07, 0.9, 2.5, 2.1, 1, (0.45, 0.4, 0.6), 'c_office')
    area_light(1.7, 2.55, 2.0, 1.4, 1.0, 70)
    prop('paper', 1.9, 0.79, 0.45); prop('paper', 2.05, 0.79, 0.75); prop('ink', 1.15, 0.79, 0.4); prop('mug', 2.1, 0.79, 0.35, col=0x3F5A6B); prop('round_spectacles', 1.9, 0.79, 0.8)
    prop('standing_picture_frame_01', 0.18, 1.55, 0.5, rot=90); prop('ceramic_vase_02', 0.18, 1.55, 0.95); prop('marble_bust_01', 3.08, 1.88, 2.6, rot=270, scale=0.8)
    prop('Ukulele_01', 0.3, 0, 2.2, rot=80, lean=1) if False else None
    prop('baseball_01', 2.4, 0, 2.6); prop('sock', 0.9, 0, 3.2)
    for t in ((1.7, 0, 0.55), (1.2, 0.79, 0.7), (3.08, 1.88, 2.9), (0.18, 1.55, 0.75), (1.7, 0.42, 1.75), (0.33, 0.53, 3.25), (3.0, 0, 0.4)):
        treat(*t)

def bedroom():
    put('GothicBed_01', 4.85, 0.07 + 1.05, rot=0, collide='none', name='bed2')
    collider(4.13, 5.57, 0.3, 0.46, 0.2, 2.0, spot='the guest bed'); collider(4.1, 5.6, 0, 1.53, 0.07, 0.2); collider(4.1, 5.6, 0, 0.9, 2.0, 2.12)
    for (x, z) in ((4.16, 0.25), (5.54, 0.25), (4.16, 2.05), (5.54, 2.05)): collider(x - 0.05, x + 0.05, 0, 0.3, z - 0.05, z + 0.05)
    S['zones'].append(dict(kind='knead', b=[4.2, 5.5, 0.4, 1.95], y=0.46, name='the guest bed'))
    S['zones'].append(dict(kind='nap', p=[4.85, 0.46, 1.2], r=0.65, name='the guest bed'))
    S['zones'].append(dict(kind='under', b=[4.2, 5.5, 0.3, 1.95], name='the secret spot under the bed'))
    put('ClassicNightstand_01', 3.75, 0.32, rot=0); table_lamp(3.75, 0.7, 0.3)
    put('GothicCommode_01', 4.6, 3.7 - 0.07 - 0.3, rot=180, spot='the bedroom dresser')
    put('ornate_mirror_01', 4.6, 3.7 - 0.07 - 0.014, rot=180, y=1.45, collide='none')
    put('GreenChair_01', 3.85, 2.9, rot=45, collide='none'); collider(3.55, 4.15, 0, 0.45, 2.6, 3.2)
    put('vintage_suitcase#4', 5.95, 3.35, rot=0, collide='solid') if False else None
    cat_bed(5.75, 2.75, col=(0.55, 0.65, 0.8)) if False else None
    rug('c_bed', 3.7, 6.0, 2.15, 3.0, [0xE9DCC3, 0xC98A9A, 0x7D8FD1, 0xF7F3EC], seed=31, kind='plain')
    curtain('z', 0.07, 4.1, 5.6, 2.1, 1, (0.8, 0.6, 0.7), 'c_bed') if False else None
    area_light(4.85, 2.55, 2.4, 1.2, 0.9, 55)
    prop('throw_pillows_01#0', 4.5, 0.47, 0.6, rot=0); prop('alarm_clock_01', 3.85, 0.7, 0.42); prop('perfume', 4.3, 1.21, 3.35); prop('ceramic_vase_01', 5.0, 1.21, 3.3); prop('standing_picture_frame_02', 4.65, 1.21, 3.4, rot=180)
    prop('sock', 5.9, 0, 1.2); prop('sock', 3.8, 0, 2.0); prop('bell', 5.9, 0, 3.2)
    for t in ((4.85, 0, 1.1), (4.85, 0.46, 1.5), (4.6, 1.21, 3.25), (3.85, 0.45, 2.9), (5.95, 0, 0.4)):
        treat(*t)

def bath():
    cer = M['cer']; steel = M['steel']; wood = pbr('b2_vanity', 'walnut_veneer', tile=1.0)
    # toilet against the north wall
    box(7.9, 8.35, 0, 0.4, 0.3, 0.85, cer, bevel=0.08, segs=4, collide=False); box(7.88, 8.37, 0.4, 0.44, 0.28, 0.87, cer, bevel=0.02, segs=3, collide=False)
    box(7.85, 8.4, 0.4, 0.85, 0.07, 0.3, cer, bevel=0.03, segs=3, collide=False)
    collider(7.88, 8.37, 0, 0.44, 0.28, 0.87, spot='the downstairs loo'); collider(7.85, 8.4, 0.44, 0.85, 0.07, 0.3)
    box(8.05, 8.13, 0.85, 0.87, 0.16, 0.2, steel, bevel=0.005, collide=False)
    S['items'].append(dict(kind='flush', p=[8.09, 0.87, 0.18], r=0.4))
    S['items'].append(dict(kind='tp', p=[8.6 - 0.07 - 0.07, 0.72, 1.1], n=[-1, 0]))
    # vanity on the west wall
    box(6.37, 6.87, 0.08, 0.8, 0.35, 1.3, wood, bevel=0.006, collide=False); box(6.37, 6.89, 0.8, 0.84, 0.33, 1.32, cer, bevel=0.01, collide=False)
    collider(6.37, 6.89, 0, 0.84, 0.33, 1.32, spot='the washbasin')
    lathe(6.64, 0.82, 0.84, [(0.17, 0.0), (0.18, 0.012), (0.14, 0.014), (0.09, -0.05), (0.0, -0.06)], cer, name='basin', seg=24)
    lathe(6.43, 0.82, 0.84, [(0.018, 0), (0.012, 0.02), (0.01, 0.16)], steel, name='tap', seg=10); box(6.43, 6.56, 0.98, 1.0, 0.808, 0.832, steel, bevel=0.006, collide=False)
    S['items'].append(dict(kind='faucet', p=[6.56, 0.98, 0.82], r=0.4, basin=[6.62, 0.84, 0.82]))
    put('ornate_mirror_01', 6.3 + 0.07 + 0.014, 0.82, rot=90, y=1.2, scale=1.1, collide='none')
    rug('c_bath', 7.0, 7.8, 0.6, 1.3, [0xF2C14E, 0xF7F6F2, 0xC98A3A], kind='plain', scratch=True)
    lamp_light(7.4, 2.3, 0.9, 70, color=(1.0, 0.92, 0.82), radius=0.15)
    prop('tproll', 8.09, 0.87, 0.2) if False else None
    prop('soap', 6.6, 0.84, 1.15); prop('plunger', 7.65, 0, 0.25); prop('glass', 6.5, 0.84, 0.5); prop('rubber_duck_toy', 6.6, 0.84, 0.48, scale=0.3) if False else None
    for t in ((7.4, 0, 1.3), (8.12, 0.44, 0.6), (6.6, 0.84, 1.2)):
        treat(*t)

def sunroom():
    put('Rockingchair_01', -2.6, 0.9, rot=40, collide='none'); collider(-2.95, -2.25, 0, 0.42, 0.55, 1.25)
    put('round_wooden_table_02', -1.6, 2.5, collide=('table', 0.05))
    put('painted_wooden_chair_02', -2.45, 2.6, rot=90, collide='none'); collider(-2.75, -2.15, 0, 0.45, 2.3, 2.9)
    put('potted_plant_01', -3.05, 3.25, collide='none'); collider(-3.3, -2.8, 0, 0.45, 3.0, 3.5)
    put('potted_plant_02', -0.5, 3.2, collide='none'); collider(-0.75, -0.25, 0, 0.4, 2.95, 3.45)
    put('potted_plant_02', -3.0, 0.45, rot=120, scale=0.8, collide='none') if False else None
    cat_bed(-0.75, 0.7, col=(0.85, 0.7, 0.45))
    put('wicker_basket_01', -0.6, 2.2, scale=1.4, collide='none'); collider(-0.86, -0.34, 0, 0.16, 2.0, 2.4)
    rug('c_sun', -2.7, -0.9, 1.3, 2.0, [0xD9B36A, 0x7A9A5A, 0xF1E6D2], kind='stripes', scratch=True)
    S['zones'].append(dict(kind='sun', b=[-3.3, -0.3, 0.3, 3.4], name='the sunroom'))
    prop('watering_can_metal_01', -1.9, 0, 3.3, rot=60); prop('planter_pot_clay', -1.6, 0.75, 2.5); prop('potted_plant_04', -1.3, 0.75, 2.7); prop('tea_set_01#8', -1.75, 0.75, 2.25)
    prop('potted_plant_04', -3.4, 0.45, 1.0); prop('planter_pot_clay', -3.4, 0.45, 2.4); prop('ceramic_vase_02', -1.8, 0.45, 3.62); prop('yarn', -1.9, 0, 0.9, col=0xB07FD9); prop('sock', -0.6, 0.18, 2.2)
    for t in ((-0.75, 0.06, 0.7), (-1.6, 0.75, 2.75), (-3.4, 0.45, 1.8), (-1.2, 0.45, 3.62), (-3.1, 0, 2.0), (-0.6, 0.16, 2.2)):
        treat(*t)

def garage():
    # a small round car to climb on
    body = flat('car_body', hexc(0x5E8FA8), rough=0.25, metal=0.3); glass = flat('car_glass', hexc(0x1A2630), rough=0.05, metal=0.4)
    tyre = flat('car_tyre', hexc(0x17171A), rough=0.9); chrome = flat('car_chrome', hexc(0xD9DCE0), rough=0.15, metal=1.0); lamp = flat('car_lamp', hexc(0xFFF2C8), rough=0.2)
    cx, x0, x1, z0, z1 = 16.6, 15.75, 17.45, -2.6, 1.3
    box(x0, x1, 0.28, 0.82, z0, z1, body, bevel=0.16, segs=5, collide=False)
    box(x0 + 0.1, x1 - 0.1, 0.78, 1.36, z0 + 0.75, z1 - 1.25, body, bevel=0.2, segs=5, collide=False)
    box(x0 + 0.14, x1 - 0.14, 0.86, 1.28, z1 - 1.27, z1 - 1.22, glass, bevel=0.01, collide=False); box(x0 + 0.14, x1 - 0.14, 0.86, 1.28, z0 + 0.72, z0 + 0.77, glass, bevel=0.01, collide=False)
    for xs in (x0 + 0.08, x1 - 0.12): box(xs, xs + 0.04, 0.88, 1.26, z0 + 0.95, z1 - 1.45, glass, bevel=0.01, collide=False)
    from mathutils import Matrix
    for (wx, wz) in ((x0 + 0.02, z0 + 0.75), (x1 - 0.02, z0 + 0.75), (x0 + 0.02, z1 - 0.75), (x1 - 0.02, z1 - 0.75)):
        w = cyl(wx, wz, 0.33 - 0.11, 0.33 + 0.11, 0.33, tyre, collide=False, name='wheel', seg=20)
        piv = B(wx, 0.33, wz); w.data.transform(Matrix.Translation(piv) @ Matrix.Rotation(math.pi / 2, 4, 'Y') @ Matrix.Translation(-piv))
        h = cyl(wx, wz, 0.33 - 0.12, 0.33 + 0.12, 0.17, chrome, collide=False, name='hub', seg=14)
        h.data.transform(Matrix.Translation(piv) @ Matrix.Rotation(math.pi / 2, 4, 'Y') @ Matrix.Translation(-piv))
    box(x0 + 0.05, x1 - 0.05, 0.3, 0.42, z1 - 0.03, z1 + 0.05, chrome, bevel=0.03, segs=3, collide=False); box(x0 + 0.05, x1 - 0.05, 0.3, 0.42, z0 - 0.05, z0 + 0.03, chrome, bevel=0.03, segs=3, collide=False)
    for xs in (x0 + 0.2, x1 - 0.42): box(xs, xs + 0.22, 0.56, 0.7, z1 - 0.02, z1 + 0.02, lamp, bevel=0.03, segs=3, collide=False)
    collider(x0, x1, 0.2, 0.82, z0, z1, spot='the car bonnet'); collider(x0 + 0.1, x1 - 0.1, 0.82, 1.36, z0 + 0.75, z1 - 1.25, cam=True, spot='the car roof')
    for (wx, wz) in ((x0 + 0.1, z0 + 0.75), (x1 - 0.1, z0 + 0.75), (x0 + 0.1, z1 - 0.75), (x1 - 0.1, z1 - 0.75)): collider(wx - 0.12, wx + 0.12, 0, 0.3, wz - 0.3, wz + 0.3)
    S['zones'].append(dict(kind='under', b=[x0 + 0.2, x1 - 0.2, z0 + 0.2, z1 - 0.2], name='the oily spot under the car'))
    # workbench + shelves on the north wall
    woodm = pbr('bench_wood', 'oak_veneer_01', tile=1.0)
    box(13.6, 15.3, 0.82, 0.88, -3.22, -2.6, woodm, bevel=0.008, collide=False)
    for (x, z) in ((13.66, -3.16), (15.24, -3.16), (13.66, -2.66), (15.24, -2.66)): box(x - 0.04, x + 0.04, 0, 0.82, z - 0.04, z + 0.04, woodm, bevel=0.004, collide=False)
    collider(13.6, 15.3, 0.78, 0.88, -3.22, -2.6, spot='the workbench')
    wall_shelf(17.6, 19.3, 1.5, -3.22, -2.9, spot='the garage shelf'); wall_shelf(17.6, 19.3, 0.85, -3.22, -2.85)
    put('cardboard_box_01', 18.9, -2.2, rot=20, spot='the garage box'); put('cardboard_box_01', 18.85, -1.55, rot=80); put('cardboard_box_01', 18.88, -1.9, rot=50, y=0.34, scale=0.9)
    S['zones'].append(dict(kind='box', p=[18.9, 0.342, -2.2], r=0.3, name='the garage box')) if False else None
    put('plastic_broom', 13.75, 1.9, rot=30, collide='none'); put('wooden_bucket_01', 14.2, 1.85, collide='solid')
    put('vintage_suitcase#0', 18.95, 0.6, rot=90, collide='solid'); put('vintage_suitcase#3', 18.95, 1.0, rot=90, collide='solid')
    # litter tray in the corner
    tray = flat('u_tray', hexc(0x6FA8C9), rough=0.5); sand = pbr('u_sand', 'terrazzo_tiles', tile=0.3, tint=(1.0, 0.92, 0.75), rough=1.0, nonormal=True)
    lx0, lx1, lz0, lz1 = 13.55, 14.25, -1.0, -0.45
    box(lx0, lx1, 0, 0.03, lz0, lz1, tray, bevel=0.01, collide=False); box(lx0 + 0.03, lx1 - 0.03, 0.03, 0.075, lz0 + 0.03, lz1 - 0.03, sand, bevel=0.004, collide=False)
    for (a0, a1, c0, c1) in ((lx0, lx1, lz0, lz0 + 0.03), (lx0, lx1, lz1 - 0.03, lz1), (lx0, lx0 + 0.03, lz0, lz1), (lx1 - 0.03, lx1, lz0, lz1)):
        box(a0, a1, 0.02, 0.14, c0, c1, tray, bevel=0.012, collide=False)
    collider(lx0, lx1, 0, 0.055, lz0, lz1)
    S['zones'].append(dict(kind='litter', b=[lx0, lx1, lz0, lz1], name='the garage litter tray'))
    area_light(16.4, 2.55, -0.6, 2.0, 1.4, 120)
    prop('football', 14.6, 0, 0.9, scale=0.45); prop('american_football', 17.9, 0, 1.4, scale=0.6); prop('watering_can_metal_01', 14.3, 0.88, -2.9, rot=30); prop('bleach', 18.0, 1.5, -3.05); prop('catfood', 18.6, 1.5, -3.05)
    prop('brass_pot_01', 14.9, 0.88, -2.95, scale=0.7); prop('garden_gnome', 18.9, 1.5, -3.05, scale=0.5); prop('pingpong', 17.9, 0.85, -3.0); prop('baseball_01', 18.4, 0.85, -3.0); prop('bin', 13.75, 0, 0.6)
    for t in ((16.6, 1.36, -0.9), (16.6, 0.82, 0.9), (16.6, 0, -0.6), (14.45, 0.88, -2.9), (18.3, 1.5, -3.05), (18.88, 0.65, -1.9), (19.0, 0, 1.8), (13.9, 0.055, -0.72)):
        treat(*t)

def deck():
    """Back deck off the sunroom and family room (outdoors: sun-lit only)."""
    wood = pbr('ext_deck', 'wood_floor_deck', tile=2.0, nonormal=True); white = flat('ext_white', hexc(0xF2EFE8), rough=0.6)
    def ext(o): L.EXT.append(o); return o
    for (x0, x1, z0, z1) in ((-3.5, 8.53, -2.9, -0.07), (4.6, 8.53, -8.0, -2.9)):
        ext(quad([(x0, 0.0, z1), (x1, 0.0, z1), (x1, 0.0, z0), (x0, 0.0, z0)], wood, name='deck', static=False))
    # railing with a gap for the steps down to the lawn
    def rail(x0, x1, z0, z1):
        ext(box(x0, x1, 0.82, 0.88, z0, z1, white, bevel=0.01, collide=False, static=False)); ext(box(x0, x1, 0.12, 0.16, z0, z1, white, bevel=0.006, collide=False, static=False))
        n = int(max(x1 - x0, z1 - z0) / 0.14)
        for i in range(n + 1):
            t = i / max(n, 1); x = x0 + (x1 - x0) * t; z = z0 + (z1 - z0) * t
            ext(box(x - 0.018, x + 0.018, 0.14, 0.84, z - 0.018, z + 0.018, white, bevel=0, collide=False, static=False))
        collider(min(x0, x1) - 0.02, max(x0, x1) + 0.02, 0, 0.88, min(z0, z1) - 0.02, max(z0, z1) + 0.02)
    rail(-3.5, -3.44, -2.9, -0.07); rail(-3.5, 1.2, -2.96, -2.9); rail(2.4, 4.6, -2.96, -2.9); rail(4.54, 4.6, -8.0, -2.9); rail(4.6, 8.53, -8.06, -8.0)
    ext(put('painted_wooden_bench', 6.9, -7.6, rot=0, collide=('seat', 0.66, 0.15), static=False))
    prop('planter_pot_clay', 4.9, 0, -3.3); prop('potted_plant_04', 5.2, 0, -7.6); prop('ball', 0.5, 0, -1.6, col=0x4F9BD9); prop('watering_can_metal_01', 7.9, 0, -3.4, rot=200)
    for t in ((6.9, 0.66, -7.6), (-2.8, 0, -1.5), (1.8, 0, -1.5), (5.6, 0, -5.2), (7.6, 0, -0.9)):
        treat(*t)

def build():
    mats(); HR.M.update(M)
    architecture()
    living(); foyer(); dining(); kitchen(); family(); office(); bedroom(); bath(); sunroom(); garage(); deck()
    S['nav'] = []
