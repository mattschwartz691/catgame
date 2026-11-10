"""Upper floors and basement of the colonial. Each function builds one storey with its floor at y=0;
house2_rooms.build() lifts it to the right height. Same coordinates as the ground floor (x east, z south)."""
import math, bpy
import house_lib as L
from house_lib import box, cyl, lathe, quad, put, prop, pbr, flat, hexc, collider, join, wall, S, B
import house2_rooms as C
from house_rooms import rug, cat_tree, scratch_post, floor_lamp, table_lamp, wall_shelf, curtain, cat_bed, treat, lamp_light, area_light

M = C.M
H, T, D = C.H, C.T, 2.05
floor = C.floor

def W(*a, **k): return wall(*a, H=H, T=T, base=M['trim'], trim=M['trim'], **k)

def ceilings(rects):
    for (x0, x1, z0, z1) in rects:
        c = box(x0 - 0.2, x1 + 0.2, H, H + 0.1, z0 - 0.2, z1 + 0.2, M['ceil'], bevel=0, collide=False, static=False, name='ceiling'); L.BAKE_ONLY.append(c)

# ------------------------------------------------------------------ shared furniture
def bed(x, z, w, l, head, cover, name, pillow=0xF4F1EA):
    """Simple divan bed. (x, z) centre; head = which wall the headboard is on ('n','s','e','w')."""
    wood = pbr('bed_wood', 'walnut_veneer', tile=1.0); sheet = flat('bed_sheet', hexc(0xF4F1EA), rough=0.9)
    cov = flat('bed_%06x' % cover, hexc(cover), rough=0.95); pil = flat('bed_pillow%06x' % pillow, hexc(pillow), rough=0.9)
    ax = head in ('n', 's'); hx, hz = (w / 2, l / 2) if ax else (l / 2, w / 2)
    box(x - hx, x + hx, 0.08, 0.3, z - hz, z + hz, wood, bevel=0.01, collide=False)
    box(x - hx + 0.02, x + hx - 0.02, 0.3, 0.5, z - hz + 0.02, z + hz - 0.02, sheet, bevel=0.05, segs=3, collide=False)
    d = {'n': (0, -1), 's': (0, 1), 'w': (-1, 0), 'e': (1, 0)}[head]
    # cover over the foot two-thirds, headboard and pillows at the head
    if ax:
        zc = z - d[1] * l * 0.17
        box(x - hx - 0.01, x + hx + 0.01, 0.34, 0.52, zc - l * 0.34, zc + l * 0.34, cov, bevel=0.05, segs=3, collide=False)
        zh = z + d[1] * hz
        box(x - hx, x + hx, 0, 1.05, min(zh, zh + d[1] * 0.06), max(zh, zh + d[1] * 0.06), wood, bevel=0.015, collide=False)
        for px in ([-w * 0.24, w * 0.24] if w > 1.2 else [0]): box(x + px - 0.27, x + px + 0.27, 0.5, 0.62, zh - d[1] * 0.12 - 0.17, zh - d[1] * 0.12 + 0.17 - (0 if d[1] < 0 else 0), pil, bevel=0.06, segs=3, collide=False) if False else box(x + px - 0.27, x + px + 0.27, 0.5, 0.62, min(zh - d[1] * 0.08, zh - d[1] * 0.42), max(zh - d[1] * 0.08, zh - d[1] * 0.42), pil, bevel=0.06, segs=3, collide=False)
        collider(x - hx, x + hx, 0, 1.05, min(zh, zh + d[1] * 0.06), max(zh, zh + d[1] * 0.06))
    else:
        xc = x - d[0] * l * 0.17
        box(xc - l * 0.34, xc + l * 0.34, 0.34, 0.52, z - hz - 0.01, z + hz + 0.01, cov, bevel=0.05, segs=3, collide=False)
        xh = x + d[0] * hx
        box(min(xh, xh + d[0] * 0.06), max(xh, xh + d[0] * 0.06), 0, 1.05, z - hz, z + hz, wood, bevel=0.015, collide=False)
        for pz in ([-w * 0.24, w * 0.24] if w > 1.2 else [0]): box(min(xh - d[0] * 0.08, xh - d[0] * 0.42), max(xh - d[0] * 0.08, xh - d[0] * 0.42), 0.5, 0.62, z + pz - 0.27, z + pz + 0.27, pil, bevel=0.06, segs=3, collide=False)
        collider(min(xh, xh + d[0] * 0.06), max(xh, xh + d[0] * 0.06), 0, 1.05, z - hz, z + hz)
    collider(x - hx, x + hx, 0.26, 0.52, z - hz, z + hz, spot=name)
    for (sx, sz) in ((-1, -1), (1, -1), (-1, 1), (1, 1)): collider(x + sx * (hx - 0.05) - 0.05, x + sx * (hx - 0.05) + 0.05, 0, 0.26, z + sz * (hz - 0.05) - 0.05, z + sz * (hz - 0.05) + 0.05)
    S['zones'].append(dict(kind='knead', b=[x - hx + 0.1, x + hx - 0.1, z - hz + 0.1, z + hz - 0.1], y=0.52, name=name))
    S['zones'].append(dict(kind='nap', p=[x, 0.52, z], r=min(hx, hz) * 0.8, name=name))

def toilet(x, z, face):
    """(x, z) = centre of the cistern against the wall; face = direction the seat points."""
    cer = M['cer']; d = {'n': (0, -1), 's': (0, 1), 'w': (-1, 0), 'e': (1, 0)}[face]
    def bx(a0, a1, y0, y1, c0, c1, **k):          # a across, c outward from the wall
        if d[0] == 0: return box(x + a0, x + a1, y0, y1, min(z + d[1] * c0, z + d[1] * c1), max(z + d[1] * c0, z + d[1] * c1), cer, collide=False, **k)
        return box(min(x + d[0] * c0, x + d[0] * c1), max(x + d[0] * c0, x + d[0] * c1), y0, y1, z + a0, z + a1, cer, collide=False, **k)
    bx(-0.27, 0.27, 0.4, 0.85, 0, 0.22, bevel=0.03, segs=3); bx(-0.22, 0.22, 0, 0.4, 0.2, 0.75, bevel=0.08, segs=4); bx(-0.24, 0.24, 0.4, 0.44, 0.18, 0.77, bevel=0.02, segs=3)
    if d[0] == 0:
        collider(x - 0.24, x + 0.24, 0, 0.44, min(z + d[1] * 0.18, z + d[1] * 0.77), max(z + d[1] * 0.18, z + d[1] * 0.77), spot='the upstairs loo'); collider(x - 0.27, x + 0.27, 0.44, 0.85, min(z, z + d[1] * 0.22), max(z, z + d[1] * 0.22))
    else:
        collider(min(x + d[0] * 0.18, x + d[0] * 0.77), max(x + d[0] * 0.18, x + d[0] * 0.77), 0, 0.44, z - 0.24, z + 0.24, spot='the upstairs loo'); collider(min(x, x + d[0] * 0.22), max(x, x + d[0] * 0.22), 0.44, 0.85, z - 0.27, z + 0.27)
    S['items'].append(dict(kind='flush', p=[x + d[0] * 0.1, 0.87, z + d[1] * 0.1], r=0.4))

def vanity(x0, x1, z0, z1, tap_side, name):
    """Cabinet with a basin; tap_side = wall side the tap stands on ('n','s','e','w')."""
    wood = pbr('b2_vanity', 'walnut_veneer', tile=1.0); cer = M['cer']; steel = M['steel']
    box(x0, x1, 0.08, 0.8, z0, z1, wood, bevel=0.006, collide=False); box(x0 - 0.01, x1 + 0.01, 0.8, 0.84, z0 - 0.01, z1 + 0.01, cer, bevel=0.01, collide=False)
    collider(x0, x1, 0, 0.84, z0, z1, spot=name)
    cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
    lathe(cx, cz, 0.84, [(0.17, 0.0), (0.18, 0.012), (0.14, 0.014), (0.09, -0.05), (0.0, -0.06)], cer, name='basin', seg=24)
    d = {'n': (0, -1), 's': (0, 1), 'w': (-1, 0), 'e': (1, 0)}[tap_side]
    tx, tz = cx + d[0] * 0.2, cz + d[1] * 0.2
    lathe(tx, tz, 0.84, [(0.018, 0), (0.012, 0.02), (0.01, 0.16)], steel, name='tap', seg=10)
    box(min(tx, tx - d[0] * 0.13) - 0.012 * abs(d[1]), max(tx, tx - d[0] * 0.13) + 0.012 * abs(d[1]), 0.98, 1.0, min(tz, tz - d[1] * 0.13) - 0.012 * abs(d[0]), max(tz, tz - d[1] * 0.13) + 0.012 * abs(d[0]), steel, bevel=0.006, collide=False)
    S['items'].append(dict(kind='faucet', p=[cx + d[0] * 0.07, 0.98, cz + d[1] * 0.07], r=0.4, basin=[cx, 0.84, cz]))

def tub(x0, x1, z0, z1, tap_end, name='the upstairs bath'):
    cer = M['cer']; steel = M['steel']; hh, th = 0.56, 0.075
    box(x0, x1, 0.08, 0.2, z0, z1, cer, bevel=0.03, segs=3, collide=False); collider(x0, x1, 0, 0.2, z0, z1, spot=name)
    box(x0, x1, 0.15, hh, z0, z0 + th, cer, bevel=0.03, segs=3); box(x0, x1, 0.15, hh, z1 - th, z1, cer, bevel=0.03, segs=3)
    box(x0, x0 + th, 0.15, hh, z0 + th, z1 - th, cer, bevel=0.03, segs=3); box(x1 - th, x1, 0.15, hh, z0 + th, z1 - th, cer, bevel=0.03, segs=3)
    tx = x1 - 0.06 if tap_end == 'e' else x0 + 0.06; zc = (z0 + z1) / 2; dd = -1 if tap_end == 'e' else 1
    lathe(tx, zc, hh, [(0.02, 0), (0.014, 0.02), (0.012, 0.14)], steel, name='tap', seg=10); box(min(tx, tx + dd * 0.17), max(tx, tx + dd * 0.17), hh + 0.12, hh + 0.145, zc - 0.012, zc + 0.012, steel, bevel=0.008, collide=False)
    S['items'].append(dict(kind='faucet', p=[tx + dd * 0.17, hh + 0.1, zc], r=0.45, basin=[tx + dd * 0.22, 0.2, zc]))

def boxes_stack(x, z, n=3, seed=0):
    import random; r = random.Random(seed)
    for i in range(n):
        put('cardboard_box_01', x + r.uniform(-0.06, 0.06), z + r.uniform(-0.06, 0.06), rot=r.choice((0, 20, 80, 100)), y=i * 0.34, scale=1.0 - i * 0.06, collide='none')
    collider(x - 0.24, x + 0.24, 0, n * 0.33, z - 0.26, z + 0.26, spot='a stack of boxes')

# ------------------------------------------------------------------ second floor: four bedrooms and two baths
def second():
    E = M['ext']; up = M['w_up']; blue = M['w_blue']; green = M['w_green']; bed_ = M['w_bed']; bath_ = M['w_bath']
    floor('master', 0, 6.3, 3.7, 8.4, M['oak2']); floor('nw', 0, 3.9, 0, 3.7, M['carpet2']); floor('bathb', 3.9, 6.3, 0, 1.9, M['btile'])
    floor('whall', 3.9, 6.3, 1.9, 3.7, M['oak']); floor('batha', 6.3, 8.6, 0, 1.9, M['btile']); C.hall_floor('uphall', 1.9, M['oak'])
    floor('ne', 8.6, 13.4, 0, 3.9, M['carpet']); floor('se', 8.6, 13.4, 3.9, 8.4, M['oak2'])
    ceilings([(0, 13.4, 0, 8.4)])
    W('z', 8.4, 0, 6.3, bed_, E, ext='pos', key='u_s_master', openings=[(0.9, 2.5, 0.7, 2.1, 'window'), (3.8, 5.4, 0.7, 2.1, 'window')])
    W('z', 8.4, 6.3, 8.6, up, E, ext='pos', key='u_s_hall', openings=[(7.25, 8.3, 0.9, 2.1, 'window')])
    W('z', 8.4, 8.6, 13.4, green, E, ext='pos', key='u_s_se', openings=[(9.5, 10.9, 0.7, 2.1, 'window'), (11.5, 12.9, 0.7, 2.1, 'window')])
    W('z', 0, 0, 3.9, E, blue, ext='neg', key='u_n_nw', openings=[(1.0, 2.6, 0.75, 2.1, 'window')])
    W('z', 0, 3.9, 6.3, E, bath_, ext='neg', key='u_n_bathb', openings=[(4.7, 5.5, 1.2, 2.0, 'window')])
    W('z', 0, 6.3, 8.6, E, bath_, ext='neg', key='u_n_batha', openings=[(7.1, 7.8, 1.2, 2.0, 'window')])
    W('z', 0, 8.6, 13.4, E, up, ext='neg', key='u_n_ne', openings=[(10.2, 11.8, 0.75, 2.1, 'window')])
    W('x', 0, 0, 3.7, E, blue, ext='neg', key='u_w_nw', openings=[(1.2, 2.6, 0.75, 2.1, 'window')])
    W('x', 0, 3.7, 8.4, E, bed_, ext='neg', key='u_w_master', openings=[(5.1, 7.0, 0.7, 2.1, 'window')])
    W('x', 13.4, 0, 3.9, up, E, ext='pos', key='u_e_ne', openings=[(1.2, 2.8, 0.75, 2.1, 'window')])
    W('x', 13.4, 3.9, 8.4, green, E, ext='pos', key='u_e_se', openings=[(5.3, 7.1, 0.7, 2.1, 'window')])
    W('z', 3.7, 0, 3.9, blue, bed_, key='u_nw_master')
    W('z', 3.7, 3.9, 6.3, up, bed_, key='u_whall_master', openings=[(4.6, 5.5, 0, D, 'door')])
    W('x', 3.9, 0, 1.9, blue, bath_, key='u_nw_bathb', openings=[(0.6, 1.45, 0, D, 'door')])
    W('x', 3.9, 1.9, 3.7, blue, up, key='u_nw_whall', openings=[(2.4, 3.3, 0, D, 'door')])
    W('z', 1.9, 3.9, 6.3, bath_, up, key='u_bathb_whall')
    W('x', 6.3, 0, 1.9, bath_, bath_, key='u_baths')
    W('z', 1.9, 6.3, 8.6, bath_, up, key='u_batha_hall', openings=[(7.4, 8.25, 0, D, 'door')])
    W('x', 6.3, 1.9, 3.7, up, up, key='u_whall_hall', openings=[(2.2, 3.4, 0, 2.2, 'arch')])
    W('x', 6.3, 3.7, 8.4, bed_, up, key='u_master_hall')
    W('x', 8.6, 0, 1.9, bath_, up, key='u_batha_ne')
    W('x', 8.6, 1.9, 3.9, up, up, key='u_hall_ne', openings=[(2.5, 3.4, 0, D, 'door')])
    W('x', 8.6, 3.9, 8.4, up, green, key='u_hall_se', openings=[(4.5, 5.4, 0, D, 'door')])
    W('z', 3.9, 8.6, 13.4, up, green, key='u_ne_se')
    C.flight()
    # ---- master bedroom
    put('GothicBed_01', 3.1, 3.77 + 1.05, rot=0, collide='none', name='bed_master')
    collider(2.38, 3.82, 0.3, 0.46, 3.9, 5.7, spot='the master bed'); collider(2.35, 3.85, 0, 1.53, 3.77, 3.9); collider(2.35, 3.85, 0, 0.9, 5.7, 5.82)
    for (x, z) in ((2.41, 3.95), (3.79, 3.95), (2.41, 5.75), (3.79, 5.75)): collider(x - 0.05, x + 0.05, 0, 0.3, z - 0.05, z + 0.05)
    S['zones'].append(dict(kind='knead', b=[2.45, 3.75, 4.1, 5.65], y=0.46, name='the master bed')); S['zones'].append(dict(kind='nap', p=[3.1, 0.46, 4.9], r=0.65, name='the master bed'))
    S['zones'].append(dict(kind='under', b=[2.45, 3.75, 4.0, 5.65], name='the dusty spot under the master bed'))
    for x in (1.95, 4.25): put('ClassicNightstand_01', x, 4.0, rot=0)
    table_lamp(1.95, 0.7, 4.0); table_lamp(4.25, 0.7, 4.0)
    put('vintage_wooden_drawer_01', 0.07 + 0.52, 4.9, rot=90, spot='the tall dresser')
    put('ArmChair_01', 5.4, 7.6, rot=215, collide='none'); collider(5.0, 5.8, 0, 0.49, 7.2, 8.0)
    put('ornate_mirror_01', 6.3 - 0.07 - 0.014, 6.2, rot=270, y=1.2, scale=1.4, collide='none')
    put('wicker_basket_01', 0.5, 7.9, scale=1.5, collide='none'); collider(0.22, 0.78, 0, 0.17, 7.68, 8.12)
    cat_bed(5.6, 4.3, col=(0.6, 0.62, 0.7))
    rug('u_master', 1.6, 4.6, 5.9, 7.7, [0xD8D2C4, 0x8A94A0, 0x5A6470, 0xEFEAE0], seed=41, kind='plain')
    for a in ((0.9, 2.5), (3.8, 5.4)): curtain('z', 8.4 - 0.07, a[0], a[1], 2.1, -1, (0.82, 0.8, 0.74), 'u_master')
    area_light(3.1, 2.55, 6.3, 1.6, 1.2, 80)
    S['zones'].append(dict(kind='sun', b=[0.8, 2.8, 6.9, 8.2], name='the master-bedroom sunbeam'))
    prop('throw_pillows_01#0', 2.8, 0.47, 4.4); prop('throw_pillows_01#1', 3.45, 0.47, 4.4); prop('alarm_clock_01', 4.25, 0.7, 4.15); prop('glass', 1.85, 0.7, 4.15); prop('round_spectacles', 2.05, 0.7, 4.18)
    prop('perfume', 0.5, 1.09, 4.5); prop('ceramic_vase_01', 0.5, 1.09, 5.3); prop('standing_picture_frame_02', 0.45, 1.09, 4.9, rot=90); prop('sock', 4.9, 0, 6.6); prop('sock', 0.5, 0.18, 7.9); prop('mouse', 4.8, 0, 5.2)
    for t in ((3.1, 0, 4.9), (3.1, 0.46, 5.2), (0.55, 1.09, 5.6), (5.4, 0.49, 7.6), (5.6, 0.06, 4.3), (0.5, 0, 6.6), (1.6, 0.5, 8.27)): treat(*t)
    # ---- north-west bedroom (a child's room)
    bed(0.07 + 1.0, 0.07 + 0.5, 0.95, 1.95, 'w', 0x6F8FB0, 'the bunk')
    put('WoodenTable_03', 3.9 - 0.07 - 0.3, 2.9, rot=270, collide=('table', 0.05)); put('painted_wooden_chair_01', 3.05, 2.9, rot=270, collide=('seat', 0.45, 0.12))
    put('wooden_display_shelves_01', 0.07 + 0.2, 3.0, rot=0, collide=('shelves', [0.06, 0.42, 0.78, 1.16, 1.54]), cam=True, spot='the toy shelves')
    rug('u_nw', 1.2, 3.0, 1.2, 2.4, [0x6F8FB0, 0xEFEAE0, 0xC9A66B], seed=43, kind='stripes')
    curtain('z', 0.07, 1.0, 2.6, 2.1, 1, (0.55, 0.65, 0.78), 'u_nw')
    area_light(2.0, 2.55, 1.9, 1.4, 1.0, 60)
    prop('football', 2.9, 0, 0.6, scale=0.45); prop('yarn', 1.6, 0, 2.9, col=0xE0A040); prop('ball', 2.2, 0, 1.6, col=0x4F9BD9); prop('gamepad', 3.5, 0.83, 2.9, scale=0.45); prop('carved_wooden_elephant', 0.27, 0.78, 2.8, scale=1.8)
    prop('rubber_duck_toy', 0.27, 1.16, 3.2, scale=0.4); prop('concrete_cat_statue', 0.27, 1.54, 3.0, rot=90); prop('baseball_01', 0.27, 0.42, 2.7); prop('binder_notebook#0', 3.5, 0.83, 2.6, rot=100)
    for t in ((1.07, 0.52, 0.6), (0.27, 1.54, 3.3), (3.5, 0.83, 3.2), (3.4, 0, 0.5), (2.0, 0, 3.3)): treat(*t)
    # ---- bath B (shower room off the child's room) and bath A (family bath off the hall)
    glassm = flat('shower_glass', hexc(0xBFD8DE), rough=0.05, alpha=0.35)
    box(5.3, 6.23, 0, 0.06, 0.07, 1.0, M['cer'], bevel=0.01, collide=False); collider(5.3, 6.23, 0, 0.06, 0.07, 1.0, spot='the shower')
    box(5.28, 5.3, 0.06, 2.0, 0.07, 1.0, M['steel'], bevel=0, collide=False, static=False) if False else None
    for (a0, a1, c0, c1) in ((5.28, 5.3, 0.07, 1.0), (5.3, 5.75, 0.99, 1.01)): L.EXT.append(box(a0, a1, 0.06, 2.0, c0, c1, glassm, bevel=0, static=False))
    toilet(4.35, 0.07, 's'); vanity(4.0, 4.9, 1.3, 1.83, 's', 'the shower-room basin')
    lamp_light(5.0, 2.3, 1.0, 60, color=(1.0, 0.95, 0.88), radius=0.15)
    tub(6.45, 8.5, 0.12, 0.9, 'e'); toilet(8.1, 1.83 - 0.0, 'n') if False else toilet(6.75, 1.83, 'n')
    vanity(7.95, 8.53, 1.05, 1.83, 'e', 'the family-bath basin')
    S['items'].append(dict(kind='tp', p=[6.3 + 0.07 + 0.07, 0.72, 1.35], n=[1, 0]))
    rug('u_batha', 7.1, 8.2, 1.0, 1.6, [0xB8C4C8, 0xF7F6F2, 0x8A9AA0], kind='plain', scratch=True)
    lamp_light(7.4, 2.3, 1.0, 70, color=(1.0, 0.95, 0.88), radius=0.15)
    prop('rubber_duck_toy', 7.0, 0.56, 0.16, scale=0.45, rot=160); prop('soap', 7.6, 0.56, 0.16); prop('tproll', 6.75, 0.87, 1.75); prop('plunger', 4.0, 0, 0.3); prop('glass', 4.2, 0.84, 1.6)
    for t in ((7.4, 0.2, 0.5), (5.75, 0.06, 0.5), (4.45, 0.84, 1.75), (8.3, 0, 1.6)): treat(*t)
    # ---- west hall + stair hall
    put('ClassicConsole_01', 5.1, 1.9 + 0.07 + 0.3, rot=0, collide=('table', 0.1))
    put('hanging_picture_frame_02', 5.1, 1.9 + 0.07 + 0.02, rot=0, y=1.45, collide='none')
    rug('u_hall', 7.5, 8.4, 3.9, 7.9, [0x4A5560, 0xD8CDB8, 0x8A6A4A, 0xB8A888], seed=45)
    put('potted_plant_02', 8.2, 8.0, collide='none'); collider(7.95, 8.45, 0, 0.4, 7.75, 8.25)
    area_light(7.9, 2.55, 5.5, 0.8, 1.6, 80); area_light(5.1, 2.55, 2.8, 1.2, 0.8, 50)
    prop('ceramic_vase_02', 4.7, 0.95, 2.25); prop('mantel_clock_01', 5.2, 0.95, 2.25); prop('brass_goblets#1', 5.6, 0.95, 2.25); prop('ball', 7.9, 0, 2.6, col=0x9BDB5A)
    for t in ((6.83, 0, 7.9), (5.1, 0.95, 2.4), (7.9, 0, 3.0), (6.83, 1.55, 5.4), (4.3, 0, 3.3)): treat(*t)
    # ---- north-east bedroom (guest) and south-east bedroom (teenager)
    bed(11.0, 0.07 + 1.0, 1.4, 1.95, 'n', 0x7A8A6A, 'the guest-room bed')
    put('painted_wooden_nightstand', 12.2, 0.4, rot=0); table_lamp(12.2, 0.62, 0.4)
    put('drawer_cabinet', 8.6 + 0.07 + 0.25, 0.9, rot=90, collide='none'); collider(8.67, 9.16, 0, 1.88, 0.33, 1.47, cam=True, spot='the guest-room wardrobe')
    put('Rockingchair_01', 12.6, 3.2, rot=225, collide='none'); collider(12.3, 12.9, 0, 0.42, 2.9, 3.5)
    rug('u_ne', 9.8, 12.2, 2.2, 3.4, [0x7A8A6A, 0xEFEAE0, 0xB8A888], seed=47, kind='plain')
    curtain('z', 0.07, 10.2, 11.8, 2.1, 1, (0.78, 0.8, 0.72), 'u_ne'); area_light(11.0, 2.55, 2.4, 1.4, 1.0, 60)
    put('vintage_suitcase#0', 9.6, 3.6, rot=10, collide='solid'); prop('alarm_clock_01', 12.2, 0.62, 0.55); prop('ceramic_vase_04', 8.9, 1.88, 0.6); prop('sock', 10.2, 0, 3.0); prop('bell', 12.8, 0, 1.6)
    for t in ((11.0, 0.52, 1.2), (8.9, 1.88, 1.2), (12.6, 0.42, 3.2), (9.6, 0.56, 3.6), (13.0, 0, 0.4)): treat(*t)
    bed(13.4 - 0.07 - 1.0, 7.5, 1.4, 1.95, 'e', 0x4A5568, 'the corner bed', pillow=0xD9C9A8)
    put('metal_office_desk', 10.6, 3.9 + 0.07 + 0.5, rot=0, collide=('table', 0.06), spot='the homework desk'); collider(9.62, 10.05, 0, 0.73, 4.0, 4.9); collider(11.15, 11.58, 0, 0.73, 4.0, 4.9)
    put('classic_laptop', 10.8, 4.45, rot=0, y=0.79, scale=0.8, collide='none'); put('dining_chair_02', 10.6, 5.3, rot=180, collide=('seat', 0.45, 0.12))
    put('boombox', 10.0, 4.3, rot=0, y=0.79, scale=0.7, collide='none'); put('Ukulele_01', 12.9, 4.1, rot=0, y=0.0, collide='none') if False else None
    put('modern_wooden_cabinet', 8.6 + 0.07 + 0.27, 6.9, rot=90, spot='the low bookcase'); put('television_02', 8.95, 6.9, rot=90, y=0.68)
    S['items'].append(dict(kind='tv', p=[9.14, 0.9, 6.9], n=[1, 0], size=[0.27, 0.2]))
    put('dartboard', 13.4 - 0.07 - 0.02, 4.8, rot=270, y=1.45, collide='none')
    rug('u_se', 9.9, 12.1, 5.6, 7.0, [0x4A5568, 0xC9BFAE, 0x8A6A4A], seed=49, kind='plain')
    for a in ((9.5, 10.9), (11.5, 12.9)): curtain('z', 8.4 - 0.07, a[0], a[1], 2.1, -1, (0.45, 0.5, 0.58), 'u_se')
    area_light(11.0, 2.55, 6.2, 1.4, 1.2, 70)
    prop('Ukulele_01', 12.95, 0, 4.2, rot=20, lean=1); prop('gamepad', 9.6, 0, 6.2, scale=0.5); prop('american_football', 12.6, 0, 5.4, scale=0.6); prop('mug', 11.3, 0.79, 4.3, col=0x3F5A6B); prop('paper', 10.3, 0.79, 4.6); prop('ink', 11.4, 0.79, 4.6)
    prop('sock', 11.6, 0, 6.3); prop('sock', 9.4, 0, 5.4); prop('baseball_01', 9.0, 0.68, 7.6); prop('standing_picture_frame_01', 9.0, 0.68, 6.2, rot=90)
    for t in ((12.3, 0.52, 7.5), (10.6, 0, 4.45), (10.2, 0.79, 4.7), (8.95, 0.68, 7.7), (13.0, 0, 5.6), (9.2, 0, 8.0)): treat(*t)

# ------------------------------------------------------------------ attic: a den and a store room under the roof
def attic():
    E = M['ext']; up = M['w_up']; z0, z1 = 2.0, 6.4
    floor('den', 0, 6.3, z0, z1, M['carpet']); floor('store', 7.3, 13.4, z0, z1, M['oak2']); floor('alanding', 6.3, 7.3, z0, C.HOLE[2], M['oak2'])
    ceilings([(0, 13.4, z0, z1)])
    W('z', z0, 0, 13.4, E, up, ext='neg', key='a_n')
    W('z', z1, 0, 6.3, up, E, ext='pos', key='a_s_den', openings=[(3.0, 4.2, 0.7, 1.9, 'window')])
    W('z', z1, 6.3, 7.3, up, E, ext='pos', key='a_s_stair')
    W('z', z1, 7.3, 13.4, up, E, ext='pos', key='a_s_store', openings=[(9.2, 10.4, 0.7, 1.9, 'window')])
    W('x', 0, z0, z1, E, up, ext='neg', key='a_w', openings=[(3.5, 4.9, 0.8, 2.0, 'window')])
    W('x', 13.4, z0, z1, up, E, ext='pos', key='a_e', openings=[(3.5, 4.9, 0.8, 2.0, 'window')])
    W('x', 6.3, z0, z1, up, up, key='a_den_stair', openings=[(2.45, 3.35, 0, D, 'door')])
    W('x', 7.3, z0, z1, up, up, key='a_stair_store', openings=[(2.45, 3.35, 0, D, 'door')])
    area_light(6.8, 2.55, 2.8, 0.6, 0.8, 45)
    # den
    put('Sofa_01', 3.2, 2.0 + 0.07 + 0.36, rot=0, collide=('seat', 0.42, 0.25))
    S['zones'].append(dict(kind='knead', b=[2.5, 3.9, 2.25, 2.7], y=0.42, name='the attic sofa'))
    put('modern_coffee_table_01', 3.2, 3.6, rot=90); put('Ottoman_01', 1.6, 3.6, rot=0)
    bag = flat('beanbag', hexc(0x9A6A4A), rough=0.95)
    lathe(5.2, 5.4, 0, [(0.2, 0), (0.42, 0.06), (0.45, 0.22), (0.36, 0.4), (0.2, 0.5), (0.0, 0.52)], bag, name='beanbag', seg=20); collider(4.85, 5.55, 0, 0.45, 5.05, 5.75, spot='the beanbag')
    S['zones'].append(dict(kind='nap', p=[5.2, 0.45, 5.4], r=0.4, name='the beanbag'))
    cat_tree(0.75, 5.75)
    put('wooden_bookshelf_worn', 0.07 + 0.3, 2.8, rot=90, collide=('shelves', [0.1, 0.4, 0.68, 0.96, 1.28, 1.66, 2.06]), cam=True, spot='the attic bookshelf')
    floor_lamp(5.9, 2.4)
    rug('a_den', 1.9, 4.6, 3.0, 4.6, [0x5A4A3A, 0xD8CDB8, 0x8A6A4A, 0xB8A888], seed=51)
    area_light(3.2, 2.55, 4.2, 1.6, 1.2, 70)
    S['zones'].append(dict(kind='sun', b=[2.8, 4.4, 5.2, 6.2], name='the dormer sunbeam'))
    prop('chess_set', 3.2, 0.39, 3.6, scale=0.6) if False else None
    prop('tea_set_01#0', 3.0, 0.39, 3.4); prop('book_encyclopedia_set_01', 3.3, 0.39, 3.8, rot=20); prop('yarn', 4.6, 0, 4.9, col=0x8A6FB0); prop('mouse', 2.0, 0, 5.2); prop('pingpong', 4.0, 0, 2.9)
    prop('brass_vase_01', 0.37, 2.06, 2.6, scale=0.7); prop('ceramic_vase_03', 0.37, 1.66, 3.0); prop('garden_gnome', 0.37, 1.28, 2.7, rot=90, scale=0.5); prop('throw_pillows_01#1', 3.2, 0.45, 2.5)
    for t in ((0.47, 1.83, 5.52), (0.37, 2.06, 3.1), (5.2, 0.45, 5.4), (3.2, 0.42, 2.45), (3.6, 0.5, 6.27), (1.6, 0.62, 3.6), (5.9, 0, 6.0)): treat(*t)
    # store room
    boxes_stack(8.0, 2.5, 3, 1); boxes_stack(8.7, 2.45, 2, 2); boxes_stack(12.9, 2.5, 3, 3); boxes_stack(12.95, 5.9, 2, 4); boxes_stack(12.3, 2.45, 1, 5)
    put('cardboard_box_01', 10.2, 4.3, rot=30, spot='the attic box'); S['zones'].append(dict(kind='box', p=[10.2, 0.342, 4.3], r=0.3, name='the attic box'))
    put('vintage_suitcase#0', 11.6, 2.25, rot=0, collide='solid'); put('vintage_suitcase#4', 11.0, 2.3, rot=10, collide='solid'); put('vintage_suitcase#3', 11.6, 2.25, rot=0, y=0.56, collide='none')
    put('Rockingchair_01', 8.3, 5.5, rot=140, collide='none'); collider(8.0, 8.6, 0, 0.42, 5.2, 5.8)
    put('painted_wooden_cabinet', 7.3 + 0.07 + 0.31, 4.6, rot=90, spot='the old cupboard')
    put('vintage_oil_lamp', 7.7, 4.6, y=1.18, collide='none'); lamp_light(7.9, 1.6, 4.6, 25)
    put('wooden_stool_01', 9.8, 5.9, collide=('table', 0.04)); put('fancy_picture_frame_02', 11.3, 6.4 - 0.07 - 0.06, rot=180, y=0.02, collide='none')
    scratch_post(11.9, 4.9)
    area_light(10.4, 2.55, 4.2, 1.6, 1.2, 55)
    S['zones'].append(dict(kind='sun', b=[9.0, 10.6, 5.2, 6.2], name='the attic sunbeam'))
    prop('marble_bust_01', 7.65, 1.18, 4.2, rot=90, scale=0.7); prop('antique_ceramic_vase_01', 7.65, 1.18, 5.0, scale=0.7); prop('football', 9.2, 0, 3.4, scale=0.45); prop('baseball_01', 11.2, 0, 3.6)
    prop('mantel_clock_01', 8.0, 0.99, 2.5); prop('brass_pot_01', 12.9, 0.99, 2.5, scale=0.7); prop('bell', 10.8, 0, 5.4); prop('sock', 9.0, 0, 5.0); prop('mouse', 12.2, 0, 4.0)
    for t in ((8.0, 0.99, 2.7), (12.9, 0.99, 2.7), (10.2, 0.342, 4.3), (11.6, 1.1, 2.25), (7.65, 1.18, 4.6), (9.8, 0.44, 5.9), (12.95, 0.66, 5.9), (6.8, 0, 2.5)): treat(*t)

# ------------------------------------------------------------------ basement: rec room, utility, play room, laundry, billiards
def basement():
    wb = M['w_base']; cz = M['conc']
    floor('rec', 0, 6.3, 4.2, 8.4, M['carpet']); floor('utility', 0, 6.3, 0, 4.2, cz); floor('bhall', 6.3, 13.4, 0, 4.6, cz) if False else None
    floor('bhall1', 7.4, 13.4, 0, 4.6, cz); floor('bhall2', 6.3, 7.4, 0, C.HOLE[2], cz); floor('blanding', 6.3, 7.4, C.HOLE[3], 8.4, cz)
    floor('play', 7.4, 13.4, 4.6, 8.4, M['carpet2']); floor('billiards', 8.6, 13.4, -8.0, 0, M['oak2'])
    ceilings([(0, 13.4, 0, 8.4), (8.6, 13.4, -8.0, 0)])
    W('z', 8.4, 0, 13.4, wb, cz, ext='pos'); W('x', 0, 0, 8.4, cz, wb, ext='neg'); W('z', 0, 0, 8.6, cz, wb, ext='neg')
    W('x', 8.6, -8.0, 0, cz, wb, ext='neg'); W('z', -8.0, 8.6, 13.4, cz, wb, ext='neg'); W('x', 13.4, -8.0, 8.4, wb, cz, ext='pos')
    W('z', 4.2, 0, 6.3, wb, wb, key='b_util_rec', openings=[(4.8, 5.7, 0, D, 'door')])
    W('x', 6.3, 0, C.HOLE[2], wb, wb, key='b_util_hall', openings=[(1.2, 2.1, 0, D, 'door')])
    W('x', 6.3, C.HOLE[2], 8.4, wb, wb, key='b_rec_stair', openings=[(7.5, 8.3, 0, D, 'door')])
    W('z', C.HOLE[2], 6.3, 7.4, wb, wb, key='b_stair_n')
    W('x', 7.4, C.HOLE[2], C.HOLE[3], wb, wb, key='b_stair_e')
    W('z', 4.6, 7.4, 13.4, wb, wb, key='b_hall_play', openings=[(8.0, 8.9, 0, D, 'door')])
    W('z', 0, 8.6, 13.4, wb, wb, key='b_bill_hall', openings=[(9.8, 11.6, 0, 2.2, 'arch')])
    C.flight(side=False)
    # ---- rec room
    put('sofa_03', 3.0, 7.75, rot=180, collide=('seat', 0.54, 0.2, (0.76, 0.3)))
    S['scratch'] += [dict(type='wall', axis='z', at=7.28, n=-1, a=[1.7, 4.3], name='sofa', surface='fabric', marks=True)]
    S['zones'].append(dict(kind='knead', b=[1.8, 4.2, 7.3, 7.9], y=0.54, name='the basement sofa'))
    put('CoffeeTable_01', 3.0, 6.3, rot=0)
    put('ClassicConsole_01', 3.0, 4.2 + 0.07 + 0.3, rot=0, collide=('table', 0.1)); put('Television_01', 3.0, 4.6, rot=0, y=0.949)
    S['items'].append(dict(kind='tv', p=[3.0, 1.18, 4.84], n=[0, 1], size=[0.34, 0.26]))
    put('mid_century_lounge_chair', 0.9, 6.1, rot=60, collide='none'); collider(0.5, 1.3, 0, 0.42, 5.7, 6.5)
    put('wooden_bookshelf_worn', 0.07 + 0.3, 7.6, rot=90, collide=('shelves', [0.1, 0.4, 0.68, 0.96, 1.28, 1.66, 2.06]), cam=True, spot='the basement bookshelf')
    floor_lamp(5.7, 7.9); floor_lamp(0.5, 4.7)
    rug('b_rec', 1.5, 4.5, 5.4, 7.1, [0x3A4650, 0xC9BFAE, 0x8A6A4A, 0xB8A888], seed=61)
    area_light(3.0, 2.55, 6.2, 2.0, 1.4, 150)
    prop('throw_pillows_01#0', 2.2, 0.55, 7.7, rot=180); prop('tea_set_01#8', 2.7, 0.53, 6.2); prop('gamepad', 3.3, 0.53, 6.4, scale=0.5); prop('mug', 3.4, 0.53, 6.1, col=0xC9A66B); prop('bananas#2', 2.8, 0.53, 6.5)
    prop('standing_picture_frame_01', 2.4, 0.95, 4.6); prop('ceramic_vase_04', 3.7, 0.95, 4.55); prop('jug_01', 0.37, 0.96, 7.5, rot=90); prop('brass_vase_01', 0.37, 2.06, 7.7, scale=0.7); prop('yarn', 4.9, 0, 5.2, col=0xB8483E); prop('mouse', 1.6, 0, 5.0)
    for t in ((3.0, 0.54, 7.6), (3.0, 0.523, 6.3), (0.37, 2.06, 7.3), (0.9, 0.42, 6.1), (5.8, 0, 4.7), (3.8, 0.95, 4.6), (5.9, 0, 6.6)): treat(*t)
    # ---- utility / storage
    steel = M['steel']; grey = flat('b_grey', hexc(0x8A8F94), rough=0.5, metal=0.4); white = flat('u_white', hexc(0xF2F2F0), rough=0.25)
    box(0.3, 1.2, 0, 1.5, 0.3, 1.2, grey, bevel=0.02, cam=True, spot='the furnace'); cyl(0.75, 0.75, 1.5, H, 0.12, steel, seg=14, collide=False, bevel=0)
    cyl(2.0, 0.6, 0.05, 1.5, 0.3, white, seg=22, spot='the boiler'); cyl(2.0, 0.6, 1.5, H, 0.04, steel, seg=10, collide=False, bevel=0)
    woodm = pbr('bench_wood', 'oak_veneer_01', tile=1.0)
    for y in (0.4, 0.95, 1.5): box(3.2, 6.1, y - 0.03, y, 0.1, 0.55, woodm, bevel=0.005, spot='the storage shelves' if y > 1 else None)
    for x in (3.22, 4.65, 6.08): box(x - 0.03, x + 0.03, 0, 1.5, 0.1, 0.55, woodm, bevel=0.004, collide=False)
    box(0.15, 0.75, 0.82, 0.88, 2.2, 4.0, woodm, bevel=0.008, collide=False); collider(0.15, 0.75, 0.78, 0.88, 2.2, 4.0, spot='the basement workbench')
    for (x, z) in ((0.2, 2.25), (0.7, 2.25), (0.2, 3.95), (0.7, 3.95)): box(x - 0.04, x + 0.04, 0, 0.82, z - 0.04, z + 0.04, woodm, bevel=0.004, collide=False)
    boxes_stack(5.6, 3.6, 3, 7); boxes_stack(4.9, 3.65, 2, 8); put('plastic_broom', 2.8, 3.95, rot=160, collide='none'); put('wooden_bucket_01', 2.2, 3.7, collide='solid')
    area_light(3.2, 2.55, 2.2, 1.6, 1.0, 110)
    prop('bleach', 3.6, 0.95, 0.3); prop('catfood', 4.2, 0.95, 0.3); prop('brass_pot_01', 5.2, 0.95, 0.32, scale=0.7); prop('watering_can_metal_01', 5.7, 0.4, 0.3, rot=90); prop('cereal', 3.5, 1.5, 0.3); prop('flour', 4.9, 1.5, 0.3); prop('wine_bottles_01#2', 5.6, 1.5, 0.3)
    prop('pot_enamel_01', 0.45, 0.88, 2.6); prop('wooden_spoon', 0.45, 0.88, 3.2); prop('baseball_01', 0.45, 0.88, 3.7); prop('ball', 2.6, 0, 2.2, col=0xE0A040)
    for t in ((0.75, 1.5, 0.75), (4.6, 1.5, 0.32), (5.9, 0.95, 0.32), (0.45, 0.88, 3.0), (5.6, 0.99, 3.6), (2.0, 0, 3.0), (5.2, 0, 1.6)): treat(*t)
    # ---- hall with the laundry along the east wall
    dark = M['dark']; glassd = flat('u_glass', hexc(0x223040), rough=0.05, metal=0.3)
    from mathutils import Matrix
    for z in (1.0, 1.65):
        box(12.71, 13.33, 0.02, 0.87, z - 0.3, z + 0.3, white, bevel=0.02, segs=3, collide=False)
        d = cyl(12.71, z, 0.45 - 0.015, 0.45 + 0.015, 0.2, steel, collide=False, name='door'); piv = B(12.71, 0.45, z)
        d.data.transform(Matrix.Translation(piv) @ Matrix.Rotation(math.pi / 2, 4, 'Y') @ Matrix.Translation(-piv))
        g = cyl(12.7, z, 0.45 - 0.012, 0.45 + 0.012, 0.15, glassd, collide=False, name='doorglass'); piv = B(12.7, 0.45, z)
        g.data.transform(Matrix.Translation(piv) @ Matrix.Rotation(math.pi / 2, 4, 'Y') @ Matrix.Translation(-piv))
    collider(12.71, 13.33, 0, 0.87, 0.7, 1.95, spot='the tumble dryer')
    vanity(12.75, 13.33, 2.4, 3.2, 'e', 'the laundry sink'); wall_shelf(13.0, 13.33, 1.5, 0.6, 2.0, spot='the detergent shelf')
    put('wicker_basket_01', 12.0, 3.9, scale=1.6, collide='none'); collider(11.7, 12.3, 0, 0.18, 3.66, 4.14)
    rug('b_hall', 8.2, 11.0, 1.6, 2.8, [0x6A7078, 0xD8CDB8, 0x8A6A4A], seed=63, kind='stripes', scratch=False)
    area_light(10.0, 2.55, 2.3, 2.2, 1.2, 130)
    prop('sock', 12.0, 0.2, 3.9); prop('sock', 11.2, 0, 3.2); prop('sock', 12.3, 0, 2.2); prop('bleach', 13.15, 1.5, 0.9); prop('soap', 13.15, 1.5, 1.6); prop('tproll', 13.0, 0.87, 1.3); prop('ball', 9.2, 0, 3.6, col=0x4F9BD9)
    for t in ((13.0, 0.87, 1.65), (13.15, 1.5, 1.3), (12.0, 0.18, 3.9), (7.9, 0, 0.6), (6.85, 0, 1.5), (9.6, 0, 0.5)): treat(*t)
    # ---- play room
    put('round_wooden_table_02', 11.6, 6.9, collide=('table', 0.05))
    for (x, z, r) in ((10.85, 6.9, 90), (12.35, 6.9, 270)): put('painted_wooden_chair_01', x, z, rot=r, collide=('seat', 0.45, 0.12))
    put('cardboard_box_01', 8.6, 7.7, rot=15, scale=1.3, spot='the play fort'); put('cardboard_box_01', 9.3, 7.75, rot=75, scale=1.3)
    put('wooden_display_shelves_01', 13.4 - 0.07 - 0.2, 5.4, rot=180, collide=('shelves', [0.06, 0.42, 0.78, 1.16, 1.54]), cam=True, spot='the games shelf')
    cat_bed(7.95, 5.1, col=(0.8, 0.6, 0.4)); scratch_post(9.4, 5.0)
    rug('b_play', 9.2, 12.4, 5.5, 8.0, [0x5A7A8A, 0xE8E0D0, 0xC9A66B, 0x8A4A3A], seed=65)
    area_light(10.4, 2.55, 6.6, 2.0, 1.4, 150)
    prop('chess_set', 11.6, 0.75, 6.9, scale=0.6) if False else None
    prop('football', 10.0, 0, 6.2, scale=0.45); prop('yarn', 8.4, 0, 6.2, col=0x5FB58A); prop('ball', 12.6, 0, 7.9, col=0xE8556A); prop('mouse', 9.9, 0, 7.6); prop('bell', 11.0, 0, 5.2); prop('pingpong', 12.0, 0, 5.6)
    prop('tea_set_01#1', 11.4, 0.75, 6.8); prop('tea_set_01#8', 11.75, 0.75, 7.05); prop('strawberry_chocolate_cake', 11.6, 0.75, 6.65); prop('rubber_duck_toy', 13.13, 0.78, 5.2, scale=0.4, rot=270); prop('concrete_cat_statue', 13.13, 1.16, 5.6, rot=270)
    for t in ((11.6, 0, 6.9), (13.13, 1.54, 5.4), (8.6, 0.45, 7.7), (7.95, 0.06, 5.1), (12.9, 0, 8.0), (6.85, 0, 8.0)): treat(*t)
    # ---- billiards room under the family room
    felt = flat('felt', hexc(0x2E6B4A), rough=0.95); wood = pbr('piano_wood', 'walnut_veneer', tile=1.2, rough=0.3, tint=(0.6, 0.45, 0.38))
    tx0, tx1, tz0, tz1 = 10.2, 11.8, -5.6, -2.8
    box(tx0, tx1, 0.62, 0.8, tz0, tz1, wood, bevel=0.01, collide=False); box(tx0 + 0.1, tx1 - 0.1, 0.8, 0.806, tz0 + 0.1, tz1 - 0.1, felt, bevel=0, collide=False)
    for (a0, a1, c0, c1) in ((tx0, tx1, tz0, tz0 + 0.1), (tx0, tx1, tz1 - 0.1, tz1), (tx0, tx0 + 0.1, tz0 + 0.1, tz1 - 0.1), (tx1 - 0.1, tx1, tz0 + 0.1, tz1 - 0.1)):
        box(a0, a1, 0.8, 0.845, c0, c1, wood, bevel=0.008)
    for (x, z) in ((tx0 + 0.15, tz0 + 0.15), (tx1 - 0.15, tz0 + 0.15), (tx0 + 0.15, tz1 - 0.15), (tx1 - 0.15, tz1 - 0.15)): box(x - 0.07, x + 0.07, 0, 0.62, z - 0.07, z + 0.07, wood, bevel=0.01, collide=False)
    collider(tx0, tx1, 0.62, 0.806, tz0, tz1, spot='the billiard table')
    brass = flat('brass', hexc(0xB08A3A), rough=0.3, metal=0.9); glow = flat('lamp_shade', hexc(0xF3E3C0), rough=0.8, emit=hexc(0xFFD9A0), emit_strength=2.2)
    box(10.5, 11.5, 1.95, 2.0, -4.6, -3.8, brass, bevel=0.01, collide=False); box(10.55, 11.45, 1.93, 1.95, -4.55, -3.85, glow, bevel=0, collide=False)
    for x in (10.6, 11.4): cyl(x, -4.2, 2.0, H, 0.008, brass, seg=6, collide=False, bevel=0)
    lamp_light(11.0, 1.8, -4.2, 130)
    for x in (9.0, 9.7): put('bar_chair_round_01', x, -7.3, collide=('table', 0.04))
    box(8.75, 10.4, 1.02, 1.08, -7.9, -7.55, wood, bevel=0.01, collide=False); box(8.8, 10.35, 0, 1.02, -7.88, -7.6, wood, bevel=0.006, collide=False); collider(8.75, 10.4, 0, 1.08, -7.9, -7.55, spot='the bar')
    put('dartboard', 13.4 - 0.07 - 0.02, -6.0, rot=270, y=1.45, collide='none'); put('Ottoman_01', 12.8, -1.0, rot=0)
    rug('b_bill', 9.6, 12.4, -6.3, -2.1, [0x5A2E2A, 0xC9BFAE, 0x3A2A22], seed=67, kind='plain', scratch=True)
    area_light(11.0, 2.55, -1.2, 1.6, 1.0, 70)
    for i, (x, z) in enumerate(((11.0, -4.9), (10.85, -5.1), (11.15, -5.1), (11.0, -3.4), (10.7, -4.2), (11.4, -3.9))):
        prop('ball', x, 0.806, z, col=(0xF4F1EA, 0xC0392B, 0xE0B020, 0x1F2A26, 0x2C5AA0, 0x2E8B57)[i], scale=0.55)
    prop('wine_bottles_01#0', 9.0, 1.08, -7.72); prop('wine_bottles_01#3', 9.3, 1.08, -7.75); prop('brass_goblets#0', 9.8, 1.08, -7.72); prop('brass_goblets#2', 10.1, 1.08, -7.72); prop('mug', 9.55, 1.08, -7.7, col=0x8A4A3A)
    for t in ((11.0, 0.806, -4.2), (11.0, 0, -4.2), (9.5, 1.08, -7.72), (12.8, 0.62, -1.0), (13.0, 0, -7.5), (9.0, 0, -0.6), (9.35, 0.75, -7.3)): treat(*t)
