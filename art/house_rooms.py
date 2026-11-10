"""Room-by-room contents of the house (game coordinates: x east, y up, z south)."""
import math
import house_lib as L
from house_lib import box, cyl, lathe, quad, put, prop, pbr, flat, hexc, collider, join, wall, S, log

H, T = 2.6, 0.14
BOUNDS = [-8.0, 8.0, -5.5, 5.5]
SKY_STRENGTH = 0.03
PREVIEW_EXPOSURE = 1.6
SPAWN = dict(x=-5.3, z=3.3, yaw=1.2)
HERO = {'sofa_03', 'GothicBed_01', 'wooden_bookshelf_worn', 'CoffeeTable_01', 'ArmChair_01', 'ClassicConsole_01', 'painted_wooden_table', 'metal_office_desk', 'vintage_wooden_drawer_01', 'vintage_cabinet_01'}
VIEWS = {
    'living': ((-1.2, 2.3, 5.0), (-5.5, 0.5, 0.5), 20),
    'living2': ((-7.5, 1.6, -0.8), (-3.0, 0.4, 3.5), 20),
    'kitchen': ((-1.2, 2.2, -1.6), (-6.0, 0.6, -4.5), 20),
    'bedroom': ((1.9, 2.2, 1.3), (6.0, 0.4, 4.5), 20),
    'study': ((1.9, 2.2, -2.4), (6.0, 0.5, -5.0), 20),
    'bath': ((1.8, 2.3, 0.6), (3.6, 0.4, -1.6), 18),
    'utility': ((7.6, 2.3, 0.6), (5.4, 0.4, -1.6), 18),
    'hall': ((0.4, 2.2, 5.0), (0.4, 0.6, -3.0), 20),
    'cat': ((-3.2, 0.45, 4.6), (-4.6, 0.4, 1.0), 28),
}

def lm_weight(ob):
    n = ob.name
    if n.startswith('floor'): return 1.5
    if n.startswith('wall'): return 0.9
    return 1.0

M = {}
def mats():
    M['parquet'] = pbr('fl_parquet', 'herringbone_parquet', tile=1.6)
    M['planks'] = pbr('fl_planks', 'plank_flooring_02', tile=2.0)
    M['laminate'] = pbr('fl_laminate', 'laminate_floor_02', tile=2.0)
    M['ktile'] = pbr('fl_ktile', 'floor_tiles_06', tile=1.2)
    M['btile'] = pbr('fl_btile', 'marble_tiles', tile=1.2)
    M['terrazzo'] = pbr('fl_terrazzo', 'terrazzo_tiles', tile=1.5)
    M['w_living'] = pbr('w_living', 'beige_wall_001', tile=2.5, tint=(1.0, 0.96, 0.9))
    M['w_kitchen'] = pbr('w_kitchen', 'painted_plaster_wall', tile=2.5, tint=(0.86, 0.95, 0.88))
    M['w_hall'] = pbr('w_hall', 'white_plaster_02', tile=2.5, tint=(1.0, 0.98, 0.94))
    M['w_bed'] = pbr('w_bed', 'painted_plaster_wall', tile=2.5, tint=(0.8, 0.86, 1.0))
    M['w_study'] = pbr('w_study', 'beige_wall_001', tile=2.5, tint=(0.72, 0.85, 0.74))
    M['w_bath'] = pbr('w_bath', 'long_white_tiles', tile=1.0)
    M['w_util'] = pbr('w_util', 'white_plaster_02', tile=2.5, tint=(0.98, 0.93, 0.82))
    M['ext'] = pbr('ext_clap_w', 'white_planks_clean', tile=1.6, tint=(0.93, 0.92, 0.88), nonormal=True)
    M['trim'] = flat('trim_white', hexc(0xF4F1EA), rough=0.45)
    M['ceil'] = flat('ceiling', hexc(0xF2F0EC), rough=0.9)
    M['grass'] = pbr('ext_grass', 'leafy_grass', tile=3.0, nonormal=True)

def floor(name, x0, x1, z0, z1, mat):
    ob = quad([(x0, 0, z1), (x1, 0, z1), (x1, 0, z0), (x0, 0, z0)], mat, name='floor_' + name)
    return ob

def architecture():
    W = lambda *a, **k: wall(*a, H=H, T=T, base=M['trim'], trim=M['trim'], **k)
    DOOR = 2.05
    # floors
    floor('living', -8, -0.6, -1.2, 5.5, M['parquet'])
    floor('kitchen', -8, -0.6, -5.5, -1.2, M['ktile'])
    floor('hall', -0.6, 1.4, -5.5, 5.5, M['planks'])
    floor('bedroom', 1.4, 8, 0.9, 5.5, M['laminate'])
    floor('bath', 1.4, 4.6, -2.0, 0.9, M['btile'])
    floor('utility', 4.6, 8, -2.0, 0.9, M['terrazzo'])
    floor('study', 1.4, 8, -5.5, -2.0, M['planks'])
    # ---- outer walls
    W('z', 5.5, -8, -0.6, M['w_living'], M['ext'], ext='pos', key='s_living', openings=[(-7.0, -5.0, 0.5, 2.15, 'window'), (-3.9, -1.9, 0.5, 2.15, 'window')])
    W('z', 5.5, -0.6, 1.4, M['w_hall'], M['ext'], ext='pos', key='s_hall', openings=[(-0.05, 0.85, 0, DOOR + 0.05, 'door')])
    W('z', 5.5, 1.4, 8, M['w_bed'], M['ext'], ext='pos', key='s_bed', openings=[(3.3, 5.3, 0.6, 2.15, 'window')])
    W('z', -5.5, -8, -0.6, M['ext'], M['w_kitchen'], ext='neg', key='n_kitchen', openings=[(-5.3, -3.5, 1.1, 2.1, 'window')])
    W('z', -5.5, -0.6, 1.4, M['ext'], M['w_hall'], ext='neg', key='n_hall', openings=[(-0.05, 0.85, 1.0, 2.1, 'window')])
    W('z', -5.5, 1.4, 8, M['ext'], M['w_study'], ext='neg', key='n_study', openings=[(3.6, 5.6, 0.75, 2.1, 'window')])
    W('x', -8, -1.2, 5.5, M['ext'], M['w_living'], ext='neg', key='w_living', openings=[(1.2, 3.6, 0.5, 2.15, 'window')])
    W('x', -8, -5.5, -1.2, M['ext'], M['w_kitchen'], ext='neg', key='w_kitchen', openings=[(-4.3, -2.7, 1.05, 2.1, 'window')])
    W('x', 8, 0.9, 5.5, M['w_bed'], M['ext'], ext='pos', key='e_bed', openings=[(2.2, 4.0, 0.75, 2.1, 'window')])
    W('x', 8, -2.0, 0.9, M['w_util'], M['ext'], ext='pos', key='e_util', openings=[(-1.0, -0.1, 1.2, 2.0, 'window')])
    W('x', 8, -5.5, -2.0, M['w_study'], M['ext'], ext='pos', key='e_study', openings=[(-4.6, -3.0, 0.75, 2.1, 'window')])
    # ---- inner walls
    W('z', -1.2, -8, -0.6, M['w_kitchen'], M['w_living'], key='liv_kit', openings=[(-5.6, -2.2, 0, 2.2, 'arch')])
    W('x', -0.6, -1.2, 5.5, M['w_living'], M['w_hall'], key='liv_hall', openings=[(2.6, 3.7, 0, DOOR, 'door')])
    W('x', -0.6, -5.5, -1.2, M['w_kitchen'], M['w_hall'], key='kit_hall', openings=[(-3.9, -2.9, 0, DOOR, 'door')])
    W('x', 1.4, 0.9, 5.5, M['w_hall'], M['w_bed'], key='hall_bed', openings=[(2.4, 3.4, 0, DOOR, 'door')])
    W('x', 1.4, -2.0, 0.9, M['w_hall'], M['w_bath'], key='hall_bath', openings=[(-1.0, -0.1, 0, DOOR, 'door')])
    W('x', 1.4, -5.5, -2.0, M['w_hall'], M['w_study'], key='hall_study', openings=[(-4.4, -3.4, 0, DOOR, 'door')])
    W('z', 0.9, 1.4, 4.6, M['w_bath'], M['w_bed'], key='bath_bed')
    W('z', 0.9, 4.6, 8, M['w_util'], M['w_bed'], key='util_bed', openings=[(6.2, 7.1, 0, DOOR, 'door')])
    W('z', -2.0, 1.4, 4.6, M['w_study'], M['w_bath'], key='study_bath')
    W('z', -2.0, 4.6, 8, M['w_study'], M['w_util'], key='study_util', openings=[(5.8, 6.7, 0, DOOR, 'door')])
    W('x', 4.6, -2.0, 0.9, M['w_bath'], M['w_util'], key='bath_util')
    # ceiling exists only for the light bake; the game looks in from above
    c = box(-8.2, 8.2, H, H + 0.1, -5.7, 5.7, M['ceil'], bevel=0, collide=False, static=False, name='ceiling'); L.BAKE_ONLY.append(c)
    g = quad([(-40, -0.02, 40), (40, -0.02, 40), (40, -0.02, -40), (-40, -0.02, -40)], M['grass'], name='ground', static=False); L.BAKE_ONLY.append(g)     # the street scene supplies the real lawn
    L.EXT.append(box(-0.1, -0.05, 0, DOOR + 0.03, 5.57, 6.45, flat('door_green', hexc(0x2F5D50), rough=0.4), bevel=0.01, collide=False, static=False, name='frontdoor'))

# ------------------------------------------------------------------ procedural bits
import bpy, numpy as np
from house_lib import B

def lamp_light(x, y, z, watts, color=(1.0, 0.78, 0.55), radius=0.06):
    """Bake-only warm point light (the visible bulb/shade is separate emissive geometry)."""
    ld = bpy.data.lights.new('lamp', 'POINT'); ld.energy = watts; ld.color = color; ld.shadow_soft_size = radius
    o = bpy.data.objects.new('lamp', ld); o.location = B(x, y, z); bpy.context.scene.collection.objects.link(o)
    S['lights'].append(dict(p=[x, y, z], color=list(color), watts=watts))
    return o

def area_light(x, y, z, sx, sz, watts, color=(1.0, 0.9, 0.8)):
    ld = bpy.data.lights.new('area', 'AREA'); ld.energy = watts; ld.color = color; ld.shape = 'RECTANGLE'; ld.size = sx; ld.size_y = sz
    o = bpy.data.objects.new('area', ld); o.location = B(x, y, z); bpy.context.scene.collection.objects.link(o)   # points down by default
    return o

def rug_image(name, w, h, pal, seed=0, kind='persian'):
    """Paint a rug pattern into a Blender image (w,h in pixels)."""
    rng = np.random.RandomState(seed)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    u, v = xx / w, yy / h
    c = [np.array(hexc(p), dtype=np.float32) / 255.0 for p in pal]
    img = np.zeros((h, w, 3), dtype=np.float32) + c[0]
    du, dv = np.minimum(u, 1 - u) * w, np.minimum(v, 1 - v) * h          # pixels from the edge
    d = np.minimum(du, dv)
    if kind == 'persian':
        img[d < 0.11 * h] = c[1]
        img[(d > 0.02 * h) & (d < 0.035 * h)] = c[2]
        img[(d > 0.075 * h) & (d < 0.09 * h)] = c[2]
        bz = ((np.floor(du / (0.04 * h)) + np.floor(dv / (0.04 * h))) % 2 == 0) & (d > 0.04 * h) & (d < 0.07 * h)
        img[bz] = c[3]
        cx, cy = (u - .5) * w / h, v - .5
        r = np.abs(cx) * 0.9 + np.abs(cy) * 1.7
        img[r < 0.34] = c[1]; img[r < 0.29] = c[3]; img[r < 0.22] = c[0]; img[r < 0.12] = c[2]
        lat = (np.abs(((cx * 9) % 1) - .5) + np.abs(((cy * 9) % 1) - .5) < 0.2) & (d > 0.13 * h) & (r > 0.38)
        img[lat] = c[2]
    elif kind == 'stripes':
        band = np.floor(u * 14).astype(int) % len(c)
        for i in range(len(c)): img[band == i] = c[i]
        img[d < 0.02 * h] = c[0]
    elif kind == 'plain':
        img[d < 0.06 * h] = c[1]; img[(d > 0.07 * h) & (d < 0.085 * h)] = c[2]
    img *= (0.88 + 0.12 * rng.rand(h, w, 1).astype(np.float32))                  # woven speckle
    img *= (0.94 + 0.06 * np.sin(yy * 3.1)[..., None])
    import os
    tmp = bpy.data.images.new(name + '_gen', w, h, alpha=False)
    tmp.pixels.foreach_set(np.concatenate([np.clip(img[::-1], 0, 1), np.ones((h, w, 1), dtype=np.float32)], -1).ravel())
    os.makedirs('/mnt/data/Games/tools/cache/gen', exist_ok=True)
    path = '/mnt/data/Games/tools/cache/gen/%s.png' % name
    tmp.filepath_raw = path; tmp.file_format = 'PNG'; tmp.save(); bpy.data.images.remove(tmp)
    im = bpy.data.images.load(path); im.colorspace_settings.name = 'sRGB'
    return im

def rug(name, x0, x1, z0, z1, pal, seed=0, kind='persian', scratch=True):
    w = 512; h = max(128, int(512 * (z1 - z0) / (x1 - x0)))
    if h > 1024: w, h = int(w * 1024 / h), 1024
    im = rug_image('rug_' + name, w, h, pal, seed, kind)
    m = bpy.data.materials.new('rug_' + name); m.use_nodes = True
    t = m.node_tree.nodes.new('ShaderNodeTexImage'); t.image = im
    b = m.node_tree.nodes['Principled BSDF']; m.node_tree.links.new(t.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.95; b.inputs['Sheen Weight'].default_value = 0.3
    y = 0.012
    ob = quad([(x0, y, z1), (x1, y, z1), (x1, y, z0), (x0, y, z0)], m, name='rug_' + name, uvs=[(0, 0), (1, 0), (1, 1), (0, 1)])
    if scratch: S['scratch'].append(dict(type='floor', b=[x0, x1, z0, z1], name='rug', surface='carpet'))
    return ob

def cat_tree(x, z):
    rope = pbr('sisal', 'rough_linen', tile=0.25, tint=(0.95, 0.8, 0.55)); plush = pbr('plush', 'knitted_fleece', tile=0.5, tint=(0.95, 0.88, 0.76), nonormal=True)
    box(x - 0.55, x + 0.55, 0, 0.05, z - 0.5, z + 0.5, plush, bevel=0.02)
    def post(px, pz, y0, y1):
        cyl(px, pz, y0, y1, 0.062, rope, name='post')
        S['scratch'].append(dict(type='post', p=[px, pz], r=0.062, y=[y0, y1], name='cat tree', surface='rope'))
    post(x - 0.3, z + 0.25, 0.05, 0.62); post(x + 0.3, z - 0.2, 0.05, 1.2); post(x - 0.3, z - 0.25, 0.66, 1.78)
    box(x - 0.55, x + 0.02, 0.62, 0.67, z - 0.02, z + 0.5, plush, bevel=0.02)
    box(x - 0.02, x + 0.55, 1.2, 1.25, z - 0.5, z + 0.1, plush, bevel=0.02)
    box(x - 0.58, x + 0.02, 1.78, 1.83, z - 0.52, z + 0.06, plush, bevel=0.02, spot='cat tree top')
    for (a0, a1, c0, c1) in ((x - 0.58, x + 0.02, z - 0.52, z - 0.48), (x - 0.58, x - 0.54, z - 0.52, z + 0.06), (x - 0.58, x + 0.02, z + 0.02, z + 0.06)):
        box(a0, a1, 1.83, 1.9, c0, c1, plush, bevel=0.015, collide=False)
    box(x + 0.0, x + 0.5, 0.05, 0.42, z + 0.05, z + 0.09, plush, bevel=0.01); box(x + 0.0, x + 0.04, 0.05, 0.42, z + 0.09, z + 0.48, plush, bevel=0.01)
    box(x + 0.46, x + 0.5, 0.05, 0.42, z + 0.09, z + 0.48, plush, bevel=0.01); box(x + 0.0, x + 0.5, 0.42, 0.46, z + 0.05, z + 0.48, plush, bevel=0.01)
    S['items'].append(dict(kind='dangle', p=[x + 0.42, 1.2, z - 0.42], len=0.72))
    S['zones'].append(dict(kind='nap', p=[x - 0.28, 1.83, z - 0.23], r=0.3, name='the cat tree'))

def scratch_post(x, z):
    rope = pbr('sisal', 'rough_linen', tile=0.25, tint=(0.95, 0.8, 0.55)); plush = pbr('plush', 'knitted_fleece', tile=0.5, tint=(0.95, 0.88, 0.76), nonormal=True)
    box(x - 0.24, x + 0.24, 0, 0.045, z - 0.24, z + 0.24, plush, bevel=0.015)
    cyl(x, z, 0.045, 0.74, 0.058, rope); cyl(x, z, 0.74, 0.78, 0.09, plush, collide=False)
    S['scratch'].append(dict(type='post', p=[x, z], r=0.058, y=[0, 0.74], name='scratching post', surface='rope'))

def floor_lamp(x, z, h=1.55, on=True):
    metal = flat('lamp_metal', hexc(0x3A3530), rough=0.4, metal=0.8)
    shade = flat('lamp_shade', hexc(0xF3E3C0), rough=0.8, emit=hexc(0xFFD9A0), emit_strength=2.2)
    cyl(x, z, 0, 0.025, 0.15, metal, collide=False); cyl(x, z, 0.02, h - 0.2, 0.014, metal, seg=10)
    lathe(x, z, h - 0.28, [(0.2, 0), (0.13, 0.28)], shade, name='shade')
    lamp_light(x, h - 0.2, z, 55)
    S['items'].append(dict(kind='lamp', p=[x, h - 0.15, z], r=0.5))

def table_lamp(x, y, z):
    base = flat('lamp_base', hexc(0x5C7F8A), rough=0.3)
    shade = flat('lamp_shade', hexc(0xF3E3C0), rough=0.8, emit=hexc(0xFFD9A0), emit_strength=2.2)
    lathe(x, z, y, [(0.06, 0), (0.07, 0.02), (0.035, 0.08), (0.05, 0.16), (0.015, 0.22), (0.012, 0.3)], base, name='lampbase')
    lathe(x, z, y + 0.26, [(0.13, 0), (0.085, 0.17)], shade, name='shade')
    lamp_light(x, y + 0.34, z, 28)

def wall_shelf(x0, x1, y, z0, z1, mat=None, spot=None):
    mat = mat or pbr('shelf_oak', 'oak_veneer_01', tile=1.0)
    return box(x0, x1, y - 0.035, y, z0, z1, mat, bevel=0.006, spot=spot)

def curtain(axis, at, a0, a1, y1, d, col, name='curtain'):
    """Two gathered fabric panels + rod on the room side of a window. d = +1/-1 toward the room."""
    fab = pbr('curt_' + name, 'cotton_jersey', tile=0.6, tint=col, nonormal=True)
    rodm = flat('lamp_metal', hexc(0x3A3530), rough=0.4, metal=0.8)
    import bmesh
    objs = []
    off = at + d * 0.12
    for (s0, s1) in ((a0 - 0.18, a0 + 0.32), (a1 - 0.32, a1 + 0.18)):
        bm = bmesh.new(); n = 26; rows = []
        for yy in (0.06, y1 + 0.12):
            row = []
            for i in range(n + 1):
                t = i / n; s = s0 + (s1 - s0) * t
                wob = math.sin(t * math.pi * 7) * 0.035 * d + d * 0.02
                p = (off + wob, yy, s) if axis == 'x' else (s, yy, off + wob)
                row.append(bm.verts.new(B(*p)))
            rows.append(row)
        for i in range(n): bm.faces.new((rows[0][i], rows[0][i + 1], rows[1][i + 1], rows[1][i]))
        bm.normal_update()
        o = L._finish(bm, 'curtain', fab, static=False, smooth=True)
        sm = o.modifiers.new('s', 'SOLIDIFY'); sm.thickness = 0.012
        bpy.context.view_layer.objects.active = o; bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.ops.object.modifier_apply(modifier='s')
        objs.append(o)
        S['scratch'].append(dict(type='wall', axis=axis, at=off + d * 0.05, n=d, a=[s0, s1], name='curtains', surface='fabric'))
    ob = join(objs, 'curtain'); L.STATIC.append(ob)
    if axis == 'x': rod = box(off - 0.012, off + 0.012, y1 + 0.13, y1 + 0.155, a0 - 0.3, a1 + 0.3, rodm, bevel=0.01, collide=False)
    else: rod = box(a0 - 0.3, a1 + 0.3, y1 + 0.13, y1 + 0.155, off - 0.012, off + 0.012, rodm, bevel=0.01, collide=False)
    key = L.wall_key(axis, at, a0, a1)          # curtains fade away with the wall they hang on
    if key: ob['fade'] = key; rod['fade'] = key
    return ob

def bowl(x, z, col, fill):
    cer = flat('bowl_%06x' % col, hexc(col), rough=0.25)
    lathe(x, z, 0.012, [(0.075, 0), (0.105, 0.012), (0.115, 0.06), (0.105, 0.062), (0.095, 0.02), (0.0, 0.018)], cer, name='bowl')
    f = flat('fill_%06x' % fill, hexc(fill), rough=0.35 if fill != 0x8A5A2B else 0.9)
    cyl(x, z, 0.03, 0.05, 0.096, f, collide=False, bevel=0)

def cat_bed(x, z, col=(0.75, 0.55, 0.5)):
    fab = pbr('catbed', 'knitted_fleece', tile=0.4, tint=col, nonormal=True)
    lathe(x, z, 0.0, [(0.3, 0), (0.36, 0.03), (0.38, 0.1), (0.34, 0.16), (0.28, 0.15), (0.25, 0.07), (0.0, 0.06)], fab, name='catbed', seg=32)
    collider(x - 0.3, x + 0.3, 0, 0.06, z - 0.3, z + 0.3, spot='the cat bed')
    S['zones'].append(dict(kind='nap', p=[x, 0.06, z], r=0.32, name='the cat bed'))

def treat(x, y, z): S['treats'].append([round(x, 2), round(y + 0.14, 2), round(z, 2)])

def living():
    put('sofa_03', -4.4, 0.9, rot=90, collide=('seat', 0.54, 0.2, (0.76, 0.3)))
    S['scratch'] += [dict(type='wall', axis='z', at=2.27, n=1, a=[-4.8, -4.0], name='sofa', surface='fabric', marks=True),
                     dict(type='wall', axis='z', at=-0.47, n=-1, a=[-4.8, -4.0], name='sofa', surface='fabric', marks=True),
                     dict(type='wall', axis='x', at=-4.87, n=-1, a=[-0.3, 2.1], name='sofa', surface='fabric', marks=True)]
    S['zones'].append(dict(kind='knead', b=[-4.8, -3.95, -0.3, 2.1], y=0.54, name='the sofa'))
    put('CoffeeTable_01', -2.85, 0.9, rot=90)
    put('ClassicConsole_01', -0.98, 0.7, rot=270, collide=('table', 0.1))
    put('Television_01', -0.98, 0.45, rot=270, y=0.949)
    S['items'].append(dict(kind='tv', p=[-1.22, 1.18, 0.45], n=[-1, 0], size=[0.34, 0.26]))
    put('ArmChair_01', -2.6, 3.95, rot=180, collide=('seat', 0.49, 0.22, (0.68, 0.14)))
    put('Ottoman_01', -2.6, 2.95, rot=0)
    put('wooden_bookshelf_worn', -6.9, -0.82, rot=0, collide=('shelves', [0.1, 0.4, 0.68, 0.96, 1.28, 1.66, 2.06]), cam=True, spot='the bookshelf')
    put('mid_century_lounge_chair', -6.85, 0.75, rot=90, collide=('seat', 0.42, 0.25))
    put('vintage_grandfather_clock_01', -0.92, 4.9, rot=270, cam=True, spot='the grandfather clock')
    put('side_table_tall_01', -5.55, 4.6, rot=0, collide=('table', 0.05))
    put('potted_plant_01', -1.05, -0.7, collide='none'); collider(-1.3, -0.8, 0, 0.45, -0.95, -0.45)
    put('Rockingchair_01', -4.6, 4.3, rot=180, collide=('seat', 0.42, 0.2))
    put('fancy_picture_frame_01', -0.69, 0.7, rot=270, y=1.62, collide='none')
    put('fancy_picture_frame_02', -8 + 0.075 + 0.045, 4.5, rot=90, y=1.2, collide='none')
    put('hanging_picture_frame_02', -6.9, 5.5 - 0.09, rot=180, y=10, collide='none', static=False)   # placeholder off-scene (keeps lib warm)
    put('wooden_display_shelves_01', -4.45, 5.22, rot=90, collide=('shelves', [0.06, 0.42, 0.78, 1.16, 1.54]), cam=True, spot='the cube shelves')
    put('boombox', -4.45, 5.22, rot=180, y=1.54, scale=0.8, collide='none')
    S['items'].append(dict(kind='boombox', p=[-4.45, 1.75, 5.2], r=0.45))
    put('cardboard_box_01', -6.0, 3.0, rot=0, spot='the cardboard box')
    S['zones'].append(dict(kind='box', p=[-6.0, 0.342, 3.0], r=0.3, name='the cardboard box'))
    cat_tree(-7.25, 4.7)
    scratch_post(-1.15, 1.95)
    floor_lamp(-7.55, 0.02)
    floor_lamp(-1.75, 5.15, on=True)
    wall_shelf(-0.9, -0.67, 1.42, 3.7, 4.35)
    rug('living', -5.3, -1.65, -0.55, 2.35, [0x7A2E2A, 0x1F3D4F, 0xE8D3A8, 0xC98A3A], seed=1)
    for a in ((-7.0, -5.0), (-3.9, -1.9)): curtain('z', 5.5 - 0.07, a[0], a[1], 2.15, -1, (0.82, 0.3, 0.26), 'living')
    curtain('x', -8 + 0.07, 1.2, 3.6, 2.15, 1, (0.82, 0.3, 0.26), 'living')
    wall_shelf(-2.1, -0.95, 1.35, -1.13, -0.88); wall_shelf(-1.75, -0.75, 1.9, -1.13, -0.88, spot='the high shelf')
    S['zones'].append(dict(kind='sun', b=[-7.2, -4.6, 2.6, 4.9], name='the sunbeam'))
    # things to knock about
    prop('throw_pillows_01#0', -4.45, 0.55, 0.1, rot=90); prop('throw_pillows_01#1', -4.45, 0.55, 1.75, rot=90)
    prop('ceramic_vase_01', -2.85, 0.53, 0.45); prop('tea_set_01#8', -2.9, 0.53, 1.1); prop('tea_set_01#0', -2.6, 0.53, 1.3); prop('tea_set_01#1', -3.1, 0.53, 1.4)
    prop('mantel_clock_01', -0.98, 0.95, 1.2, rot=270); prop('standing_picture_frame_01', -0.95, 0.95, -0.05, rot=270)
    prop('marble_bust_01', -5.55, 0.77, 4.6, rot=180)
    prop('antique_ceramic_vase_01', -6.5, 0.96, -0.8, scale=0.6); prop('garden_gnome', -7.3, 1.28, -0.82, scale=0.55); prop('ceramic_vase_03', -6.9, 1.66, -0.8, scale=0.8)
    prop('carved_wooden_elephant', -6.4, 1.28, -0.8, scale=1.6); prop('concrete_cat_statue', -7.35, 2.06, -0.8); prop('brass_vase_01', -6.5, 2.06, -0.82)
    prop('ceramic_vase_02', -4.75, 1.16, 5.22, scale=0.9); prop('standing_picture_frame_02', -4.15, 1.16, 5.22, rot=180); prop('ceramic_vase_04', -4.45, 0.78, 5.22, scale=0.9)
    prop('potted_plant_04', -6.4, 0.5, 5.36); prop('planter_pot_clay', -2.6, 0.5, 5.36); prop('potted_plant_04', -7.9 + 0.04, 0.5, 2.0)
    prop('jug_01', -1.5, 1.36, -1.0); prop('wine_bottles_01#1', -1.1, 1.91, -1.0)
    prop('baseball_01', -3.3, 0, 3.3); prop('american_football', -5.6, 0, 1.9, scale=0.6); prop('yarn', -2.0, 0, 1.9, col=0xD9534F); prop('yarn', -5.9, 0, 4.0, col=0x4F9BD9)
    prop('mouse', -3.6, 0, 4.6); prop('pingpong', -1.8, 0, 4.4)
    for t in ((-7.25, 1.83, 4.5), (-6.9, 2.06, -0.82), (-4.45, 1.54, 5.0), (-1.25, 1.9, -1.0), (-0.92, 2.19, 4.9), (-4.4, 0.54, 0.9), (-2.85, 0.523, 0.55), (-7.7, 0.5, 3.0), (-6.0, 0.342, 3.0), (-2.6, 0.62, 2.95), (-7.6, 0, -1.0), (-3.0, 0, 5.2)):
        treat(*t)

def kitchen():
    cab = flat('k_cab', hexc(0xA9C4B0), rough=0.5); top = pbr('k_top', 'marble_01', tile=1.5, rough=0.25)
    steel = flat('k_steel', hexc(0xB8BDC2), rough=0.3, metal=0.9); dark = flat('k_dark', hexc(0x2A2A2E), rough=0.5)
    zb, zf = -5.43, -4.85
    for (x0, x1) in ((-7.93, -2.92), (-2.4, -1.47)):
        box(x0, x1, 0.1, 0.86, zb, zf, cab, bevel=0.004, collide=False)
        box(x0 + 0.03, x1 - 0.03, 0, 0.1, zb, zf - 0.05, dark, bevel=0, collide=False)
        box(x0 - 0.015, x1 + 0.015, 0.86, 0.9, zb, zf + 0.03, top, bevel=0.008, collide=False)
        collider(x0, x1, 0, 0.9, zb, zf + 0.03, spot='the kitchen counter')
        n = max(1, round((x1 - x0) / 0.62)); w = (x1 - x0) / n
        doors = []
        for i in range(n):
            doors.append(box(x0 + i * w + 0.012, x0 + (i + 1) * w - 0.012, 0.13, 0.7, zf, zf + 0.018, cab, bevel=0.006, collide=False, static=False))
            doors.append(box(x0 + i * w + 0.012, x0 + (i + 1) * w - 0.012, 0.72, 0.84, zf, zf + 0.018, cab, bevel=0.006, collide=False, static=False))
            doors.append(box(x0 + (i + .5) * w - 0.06, x0 + (i + .5) * w + 0.06, 0.765, 0.78, zf + 0.018, zf + 0.04, steel, bevel=0.004, collide=False, static=False))
        L.STATIC.append(join(doors, 'kdoors'))
    put('electric_stove', -2.66, -5.11, rot=0, scale=1.03, spot='the stove')
    # sink under the window
    box(-4.85, -3.95, 0.905, 0.91, -5.3, -4.95, steel, bevel=0.003, collide=False); box(-4.8, -4.0, 0.80, 0.906, -5.26, -4.99, dark, bevel=0.01, collide=False)
    lathe(-4.4, -5.33, 0.9, [(0.022, 0), (0.018, 0.02), (0.012, 0.22), (0.012, 0.26)], steel, name='faucet', seg=12)
    box(-4.412, -4.388, 1.14, 1.165, -5.33, -5.12, steel, bevel=0.008, collide=False)
    S['items'].append(dict(kind='faucet', p=[-4.4, 1.12, -5.12], r=0.45, basin=[-4.4, 0.9, -5.12]))
    # backsplash + wall cabinets
    tiles = pbr('k_tiles', 'square_tiles', tile=0.6)
    box(-7.93, -1.47, 0.9, 1.45, zb - 0.005, zb + 0.012, tiles, bevel=0, collide=False)
    for (x0, x1) in ((-7.93, -5.5), (-3.3, -1.47)):
        box(x0, x1, 1.45, 2.2, zb, zb + 0.34, cab, bevel=0.005, cam=True, spot='the top of the kitchen cabinets')
        n = max(1, round((x1 - x0) / 0.6)); w = (x1 - x0) / n; doors = []
        for i in range(n):
            doors.append(box(x0 + i * w + 0.012, x0 + (i + 1) * w - 0.012, 1.48, 2.17, zb + 0.34, zb + 0.356, cab, bevel=0.006, collide=False, static=False))
            doors.append(box(x0 + (i + .5) * w - 0.008, x0 + (i + .5) * w + 0.008, 1.52, 1.64, zb + 0.356, zb + 0.376, steel, bevel=0.004, collide=False, static=False))
        L.STATIC.append(join(doors, 'kdoors2'))
    # fridge: rounded retro
    fr = flat('k_fridge', hexc(0xE9DCC3), rough=0.25)
    box(-1.42, -0.72, 0.03, 1.82, zb, -4.78, fr, bevel=0.05, segs=4, cam=True, spot='the top of the fridge')
    box(-1.4, -0.74, 1.22, 1.228, -4.782, -4.776, dark, bevel=0, collide=False)
    box(-1.36, -1.33, 1.3, 1.6, -4.78, -4.74, steel, bevel=0.008, collide=False); box(-1.36, -1.33, 0.75, 1.15, -4.78, -4.74, steel, bevel=0.008, collide=False)
    # dining
    put('painted_wooden_table', -4.1, -2.9, rot=0, collide=('table', 0.07), spot='the dining table')
    for (x, z, r) in ((-4.8, -3.72, 0), (-3.4, -3.72, 0), (-4.8, -2.08, 180), (-3.4, -2.08, 180)):
        put('painted_wooden_chair_01', x, z, rot=r, collide=('seat', 0.45, 0.12))
    put('painted_wooden_cabinet', -7.6, -1.9, rot=90, spot='the dresser')
    put('wooden_bowl_01', -4.1, -2.9, y=0.958, collide='none')
    put('wall_clock', -0.6 - 0.075 - 0.027, -2.0, rot=270, y=1.7, collide='none')
    put('vintage_microwave', -6.6, -5.12, rot=0, y=0.9, scale=0.5)
    put('wooden_cutting_board', -5.6, -5.1, rot=0, y=0.9, collide='none')
    # bowls on a mat
    mat_ = flat('k_mat', hexc(0x6E8F9C), rough=0.9)
    box(-1.3, -0.72, 0, 0.012, -2.25, -1.4, mat_, bevel=0.004, collide=False)
    bowl(-0.98, -2.0, 0xD9534F, 0x8A5A2B); bowl(-0.98, -1.62, 0x4F9BD9, 0x9FD4F0)
    S['items'].append(dict(kind='food', p=[-0.98, 0.06, -2.0], stand=[-1.33, -2.0], yaw=math.pi / 2))
    S['items'].append(dict(kind='water', p=[-0.98, 0.06, -1.62], stand=[-1.33, -1.62], yaw=math.pi / 2))
    binm = flat('k_bin', hexc(0x7C8A93), rough=0.35, metal=0.6)
    area_light(-4.3, 2.55, -3.3, 2.4, 1.4, 190)
    curtain('x', -8 + 0.07, -4.3, -2.7, 2.1, 1, (0.95, 0.85, 0.5), 'kitchen')
    rug('kitchen', -5.6, -2.6, -2.0, -1.45, [0xC9B38A, 0x6E8F9C, 0xF1E6D2], kind='stripes', scratch=False)
    prop('bin', -0.98, 0, -4.4)
    prop('vintage_electric_kettle', -1.95, 0.9, -5.1, scale=0.8); prop('pot_enamel_01', -2.78, 0.9, -5.22, scale=0.9); prop('brass_pot_01', -7.3, 0.9, -5.15, scale=0.8)
    prop('wooden_spoon', -5.25, 0.9, -5.0, rot=40); prop('croissant', -5.6, 0.945, -5.1); prop('wine_bottles_01#0', -7.7, 0.9, -5.2); prop('wine_bottles_01#2', -7.55, 0.9, -5.3)
    prop('food_apple_01', -4.1, 1.0, -2.9); prop('lemon', -4.0, 1.0, -2.82); prop('food_pomegranate_01', -4.2, 1.0, -2.8); prop('food_lime_01', -4.12, 1.0, -3.0); prop('yellow_onion', -6.9, 0.9, -4.95)
    prop('strawberry_chocolate_cake', -4.9, 0.958, -2.9); prop('carrot_cake', -3.2, 0.958, -2.75); prop('tea_set_01#6', -3.5, 0.958, -3.2); prop('tea_set_01#9', -4.6, 0.958, -2.6)
    prop('brass_goblets#0', -3.0, 0.958, -3.1); prop('brass_goblets#1', -5.1, 0.958, -3.2); prop('bananas#2', -3.7, 0.958, -2.6)
    prop('jug_01', -7.6, 1.18, -1.6, rot=90); prop('ceramic_vase_02', -7.6, 1.18, -2.2); prop('tea_set_01#2', -7.55, 1.18, -1.9)
    prop('mug', -6.0, 0.9, -5.0, col=0xE8785A); prop('mug', -3.6, 0.9, -5.2, col=0xF2C14E); prop('glass', -3.8, 0.9, -5.0); prop('cereal', -1.07, 1.82, -5.1); prop('flour', -2.0, 2.2, -5.25)
    prop('ball', -6.5, 0, -2.4, col=0xF2A03D)
    for t in ((-1.07, 1.82, -4.95), (-6.9, 2.2, -5.25), (-2.4, 2.2, -5.25), (-7.0, 0.9, -5.1), (-4.1, 0.0, -2.9), (-4.1, 0.958, -3.25), (-7.6, 1.18, -2.0), (-2.66, 0.89, -5.1), (-7.5, 0, -3.5), (-1.9, 0.9, -4.95)):
        treat(*t)

def hall():
    rug('hall', -0.05, 0.85, -4.6, 4.6, [0x2F4F5F, 0xD9C7A0, 0xB8483E, 0xE0913F], seed=4)
    put('painted_wooden_bench', 1.4 - 0.075 - 0.25, 1.6, rot=270, collide=('seat', 0.66, 0.15))
    put('ClassicNightstand_01', -0.6 + 0.075 + 0.22, -0.3, rot=90, spot=None)
    put('ornate_mirror_01', -0.6 + 0.075 + 0.014, -0.3, rot=90, y=1.15, collide='none')
    put('hanging_picture_frame_01', 1.4 - 0.075 - 0.01, 4.5, rot=270, y=1.05, collide='none')
    put('hanging_picture_frame_03', 1.4 - 0.075 - 0.016, -2.6, rot=270, y=1.2, collide='none')
    put('hanging_picture_frame_02', -0.6 + 0.075 + 0.017, 1.3, rot=90, y=1.25, collide='none')
    put('plastic_broom', 1.15, 5.2, rot=200, collide='none')
    wall_shelf(-0.52, -0.3, 1.25, -5.0, -4.2); wall_shelf(-0.52, -0.3, 1.8, -1.0, -0.2, spot='the hallway shelf')
    table_lamp(-0.32, 0.7, -0.42)
    area_light(0.4, 2.55, 2.2, 0.8, 1.6, 90); area_light(0.4, 2.55, -2.6, 0.8, 1.6, 90)
    prop('rubber_boots#0', 1.1, 0, 4.2, rot=90); prop('rubber_boots#1', 1.12, 0, 3.95, rot=80)
    prop('ceramic_vase_04', -0.3, 0.7, -0.1); prop('alarm_clock_01', -0.41, 1.25, -4.5, rot=90); prop('standing_picture_frame_01', -0.41, 1.25, -4.85, rot=90)
    prop('brass_goblets#2', -0.41, 1.8, -0.4); prop('ball', 0.4, 0, 0.3, col=0x9BDB5A); prop('mouse', 0.9, 0, -3.8)
    prop('binder_notebook#1', 1.05, 0.66, 1.5, rot=90)
    for t in ((0.4, 0, 4.9), (0.4, 0, -5.0), (-0.41, 1.8, -0.8), (-0.41, 1.25, -4.3), (1.05, 0.66, 1.95), (0.4, 0, 0.0), (0.4, 1.0, -5.38)):
        treat(*t)

def bedroom():
    put('GothicBed_01', 6.9, 4.5, rot=270, collide='none', name='bed')
    collider(5.98, 7.78, 0.3, 0.46, 3.76, 5.24, spot='the big bed'); collider(7.78, 7.93, 0, 1.53, 3.76, 5.24); collider(5.88, 5.98, 0, 0.9, 3.76, 5.24)
    for (x, z) in ((5.92, 3.8), (5.92, 5.2), (7.86, 3.8), (7.86, 5.2)): collider(x - 0.05, x + 0.05, 0, 0.3, z - 0.05, z + 0.05)
    S['zones'].append(dict(kind='knead', b=[6.0, 7.7, 3.8, 5.2], y=0.46, name='the bed'))
    S['zones'].append(dict(kind='nap', p=[6.6, 0.46, 4.5], r=0.7, name='the big bed'))
    S['zones'].append(dict(kind='under', b=[6.0, 7.75, 3.85, 5.15], name='the secret spot under the bed'))
    put('ClassicNightstand_01', 7.68, 3.4, rot=270)
    table_lamp(7.72, 0.7, 3.3)
    put('GothicCommode_01', 3.0, 0.9 + 0.075 + 0.3, rot=0, spot='the dresser')
    put('ornate_mirror_01', 3.0, 0.9 + 0.075 + 0.014, rot=0, y=1.45, collide='none')
    put('GreenChair_01', 2.05, 4.85, rot=135, collide='none'); collider(1.75, 2.35, 0, 0.45, 4.55, 5.15)
    put('vintage_suitcase#0', 7.6, 1.45, rot=90, collide='solid'); put('vintage_suitcase#3', 7.6, 1.45, rot=90, y=0.56, collide='solid')
    put('wicker_basket_01', 5.6, 1.35, scale=1.3, collide='none')
    cat_bed(4.3, 4.55)
    scratch_post(1.85, 1.45)
    rug('bedroom', 2.6, 5.6, 2.1, 4.1, [0xE9DCC3, 0x7D8FD1, 0xC98A9A, 0xF7F3EC], seed=7)
    curtain('z', 5.5 - 0.07, 3.3, 5.3, 2.15, -1, (0.55, 0.62, 0.86), 'bed'); curtain('x', 8 - 0.07, 2.2, 4.0, 2.1, -1, (0.55, 0.62, 0.86), 'bed')
    wall_shelf(1.48, 1.7, 1.3, 3.7, 4.6); wall_shelf(1.48, 1.7, 1.85, 4.3, 5.3, spot='the bedroom shelf')
    area_light(4.5, 2.55, 3.0, 1.6, 1.2, 60)
    S['zones'].append(dict(kind='sun', b=[3.0, 5.6, 3.6, 5.2], name='the bedroom sunbeam'))
    prop('throw_pillows_01#0', 6.6, 0.47, 4.1, rot=270); prop('throw_pillows_01#1', 6.6, 0.47, 4.95, rot=270)
    prop('alarm_clock_01', 7.62, 0.7, 3.55, rot=270); prop('glass', 7.55, 0.7, 3.25)
    prop('ceramic_vase_01', 2.6, 1.21, 1.25); prop('standing_picture_frame_02', 3.3, 1.21, 1.2); prop('perfume', 3.05, 1.21, 1.3); prop('round_spectacles', 2.85, 1.21, 1.35)
    prop('potted_plant_04', 4.3, 0.6, 5.36); prop('planter_pot_clay', 7.86, 0.75, 3.1); prop('carved_wooden_elephant', 1.59, 1.3, 4.2, rot=90); prop('ceramic_vase_03', 1.59, 1.85, 4.8)
    prop('yarn', 3.2, 0, 3.0, col=0xB07FD9); prop('bell', 5.2, 0, 2.6); prop('mouse', 2.4, 0, 2.2); prop('sock', 5.3, 0, 1.6); prop('sock', 6.4, 0, 3.2); prop('sock', 2.6, 0, 4.6)
    for t in ((6.9, 0, 4.5), (6.3, 0.46, 4.5), (3.0, 1.21, 1.3), (7.6, 1.11, 1.45), (1.59, 1.85, 5.1), (7.86, 0.75, 2.5), (4.3, 0.06, 4.55), (5.6, 0.1, 1.35), (2.05, 0.45, 4.85), (7.6, 0, 2.2)):
        treat(*t)

def study():
    put('metal_office_desk', 4.6, -4.95, rot=180, collide=('table', 0.06), spot='the desk')
    collider(3.62, 4.05, 0, 0.73, -5.4, -4.5); collider(5.15, 5.58, 0, 0.73, -5.4, -4.5)
    put('classic_laptop', 4.35, -4.95, rot=0, y=0.79, scale=0.8, collide='none')
    S['items'].append(dict(kind='laptop', p=[4.35, 0.82, -4.9], r=0.3, screen=[4.35, 1.03, -5.07], size=[0.3, 0.2]))
    put('desk_lamp_arm_01', 5.35, -5.15, rot=120, y=0.79, collide='none'); lamp_light(5.1, 1.35, -4.95, 30)
    put('dining_chair_02', 4.6, -4.05, rot=180, collide=('seat', 0.45, 0.12))
    put('drawer_cabinet', 2.35, -2.0 - 0.075 - 0.25, rot=180, collide='none')
    collider(1.78, 2.92, 0, 1.77, -2.57, -2.08, cam=True, spot='the tall cabinet')
    put('small_wooden_table_01', 7.3, -2.0 - 0.075 - 0.25, rot=180, collide=('table', 0.05))
    put('chess_set', 7.3, -2.33, rot=0, y=0.533, scale=0.7, collide='none')
    S['items'].append(dict(kind='chess', p=[7.3, 0.6, -2.33], r=0.35))
    put('wooden_stool_01', 6.55, -2.9, collide=('table', 0.04))
    put('modern_arm_chair_01', 7.35, -4.95, rot=270, collide=('seat', 0.42, 0.25))
    put('dartboard', 1.4 + 0.075 + 0.02, -2.75, rot=90, y=1.35, collide='none')
    put('book_encyclopedia_set_01', 2.35, -2.3, rot=180, y=10, collide='none', static=False)
    # upright piano against the south wall; the cat can walk the keys
    wood = pbr('piano_wood', 'walnut_veneer', tile=1.2, rough=0.25, tint=(0.55, 0.42, 0.38))
    ivory = flat('piano_white', hexc(0xF5F0E4), rough=0.3); ebony = flat('piano_black', hexc(0x151515), rough=0.3)
    px0, px1, zb = 3.75, 5.25, -2.075
    box(px0, px1, 0, 1.18, zb - 0.36, zb, wood, bevel=0.012, cam=False, spot='the piano')
    box(px0, px1, 0.6, 0.7, zb - 0.62, zb - 0.36, wood, bevel=0.01, collide=False)
    box(px0 + 0.04, px0 + 0.1, 0, 0.6, zb - 0.6, zb - 0.36, wood, bevel=0.008, collide=False); box(px1 - 0.1, px1 - 0.04, 0, 0.6, zb - 0.6, zb - 0.36, wood, bevel=0.008, collide=False)
    box(px0 + 0.06, px1 - 0.06, 0.7, 0.722, zb - 0.6, zb - 0.38, ivory, bevel=0.002, collide=False)
    keys = []
    nk = 24; kw = (px1 - px0 - 0.12) / nk
    for i in range(nk):
        if i % 12 in (1, 3, 6, 8, 10):
            keys.append(box(px0 + 0.06 + i * kw + kw * 0.15, px0 + 0.06 + (i + 1) * kw - kw * 0.15, 0.722, 0.735, zb - 0.5, zb - 0.38, ebony, bevel=0.002, collide=False, static=False))
        else:
            keys.append(box(px0 + 0.06 + i * kw + 0.002, px0 + 0.06 + (i + 1) * kw - 0.002, 0.7215, 0.7245, zb - 0.6, zb - 0.38, ivory, bevel=0.001, collide=False, static=False))
    L.STATIC.append(join(keys, 'pianokeys'))
    collider(px0, px1, 0.6, 0.722, zb - 0.62, zb - 0.36)
    S['items'].append(dict(kind='piano', b=[px0 + 0.06, px1 - 0.06, zb - 0.62, zb - 0.36], y=0.722, keys=nk))
    rug('study', 3.2, 6.4, -4.2, -2.9, [0x35523F, 0xD8C39A, 0x8A3B2E, 0xE5B45A], seed=11)
    curtain('z', -5.5 + 0.07, 3.6, 5.6, 2.1, 1, (0.4, 0.55, 0.42), 'study'); curtain('x', 8 - 0.07, -4.6, -3.0, 2.1, -1, (0.4, 0.55, 0.42), 'study')
    wall_shelf(1.48, 1.72, 1.5, -5.3, -4.5); wall_shelf(5.9, 7.0, 1.6, -2.3, -2.08, spot='the study shelf')
    area_light(4.6, 2.55, -3.7, 1.6, 1.0, 70)
    prop('Ukulele_01', 7.75, 0, -4.3, rot=20, lean=1); prop('binder_notebook#0', 5.1, 0.79, -4.75, rot=20); prop('mug', 3.85, 0.79, -4.8, col=0xFFFFFF)
    prop('ceramic_vase_02', 6.2, 1.6, -2.18); prop('garden_gnome', 6.8, 1.6, -2.18, rot=180); prop('gamepad', 4.6, 0, -3.3, scale=0.5)
    prop('marble_bust_01', 2.35, 1.77, -2.33, rot=180, scale=0.8); prop('standing_picture_frame_01', 1.6, 1.5, -4.9, rot=90); prop('ceramic_vase_04', 1.6, 1.5, -5.15)
    prop('baseball_01', 5.6, 0, -3.5); prop('paper', 4.9, 0.79, -5.05); prop('paper', 4.75, 0.79, -4.7); prop('paper', 4.0, 0.79, -5.1); prop('ink', 5.3, 0.79, -4.7)
    for t in ((4.6, 0, -4.95), (4.5, 1.18, -2.25), (4.5, 0.722, -2.57), (2.7, 1.77, -2.33), (6.45, 1.6, -2.18), (7.35, 0.42, -4.95), (1.6, 1.5, -4.7), (4.6, 0.79, -5.2), (7.6, 0, -2.6), (6.55, 0.44, -2.9)):
        treat(*t)

def bath():
    cer = flat('b_ceramic', hexc(0xF7F6F2), rough=0.12); steel = flat('k_steel', hexc(0xB8BDC2), rough=0.3, metal=0.9)
    wood = pbr('b_vanity', 'white_oak_veneer', tile=1.0)
    # bathtub (hollow: the cat can hop in)
    x0, x1, z0, z1, hh, th = 2.45, 4.5, -1.925, -1.15, 0.56, 0.075
    box(x0, x1, 0.08, 0.2, z0, z1, cer, bevel=0.03, segs=3, collide=False); collider(x0, x1, 0, 0.2, z0, z1, spot='the bathtub')
    box(x0, x1, 0.15, hh, z0, z0 + th, cer, bevel=0.03, segs=3); box(x0, x1, 0.15, hh, z1 - th, z1, cer, bevel=0.03, segs=3)
    box(x0, x0 + th, 0.15, hh, z0 + th, z1 - th, cer, bevel=0.03, segs=3); box(x1 - th, x1, 0.15, hh, z0 + th, z1 - th, cer, bevel=0.03, segs=3)
    lathe(4.42, -1.54, hh, [(0.02, 0), (0.014, 0.02), (0.012, 0.14)], steel, name='tap', seg=10); box(4.25, 4.43, hh + 0.12, hh + 0.145, -1.552, -1.528, steel, bevel=0.008, collide=False)
    S['items'].append(dict(kind='faucet', p=[4.25, hh + 0.1, -1.54], r=0.45, basin=[4.2, 0.2, -1.54]))
    # toilet
    box(3.95, 4.5, 0, 0.4, -0.05, 0.42, cer, bevel=0.08, segs=4, collide=False); box(3.93, 4.36, 0.4, 0.44, -0.07, 0.44, cer, bevel=0.02, segs=3, collide=False)
    box(4.3, 4.52, 0.4, 0.85, -0.1, 0.47, cer, bevel=0.03, segs=3, collide=False)
    collider(3.93, 4.52, 0, 0.44, -0.07, 0.44, spot='the toilet'); collider(4.3, 4.52, 0.44, 0.85, -0.1, 0.47)
    box(4.39, 4.43, 0.85, 0.87, 0.3, 0.38, steel, bevel=0.005, collide=False)
    S['items'].append(dict(kind='flush', p=[4.41, 0.87, 0.34], r=0.4))
    S['items'].append(dict(kind='tp', p=[4.6 - 0.075 - 0.07, 0.72, -0.5], n=[-1, 0]))
    # vanity + sink + mirror on the south wall
    zv = 0.9 - 0.075
    box(1.9, 2.95, 0.08, 0.8, zv - 0.5, zv, wood, bevel=0.006, collide=False); box(1.88, 2.97, 0.8, 0.84, zv - 0.52, zv, cer, bevel=0.01, collide=False)
    collider(1.88, 2.97, 0, 0.84, zv - 0.52, zv, spot='the bathroom sink')
    lathe(2.42, zv - 0.27, 0.84, [(0.19, 0.0), (0.2, 0.012), (0.16, 0.014), (0.1, -0.05), (0.0, -0.06)], cer, name='basin', seg=24)
    lathe(2.42, zv - 0.06, 0.84, [(0.018, 0), (0.012, 0.02), (0.01, 0.16)], steel, name='tap', seg=10); box(2.408, 2.432, 0.98, 1.0, zv - 0.2, zv - 0.06, steel, bevel=0.006, collide=False)
    S['items'].append(dict(kind='faucet', p=[2.42, 0.98, zv - 0.2], r=0.4, basin=[2.42, 0.84, zv - 0.27]))
    put('ornate_mirror_01', 2.42, zv - 0.014, rot=180, y=1.15, scale=1.1, collide='none')
    put('wicker_basket_02#0', 1.75, -1.6, scale=1.6, collide='none'); collider(1.58, 1.92, 0, 0.32, -1.78, -1.42)
    put('wooden_bucket_01', 3.5, 0.45, scale=0.7, collide='none')
    rug('bath', 2.6, 3.7, -0.95, -0.3, [0x9FD0D8, 0xF7F6F2, 0x5C9AA8], kind='plain', scratch=True)
    lamp_light(3.0, 2.3, -0.5, 95, color=(1.0, 0.92, 0.82), radius=0.15)
    shade = flat('lamp_shade', hexc(0xF3E3C0), rough=0.8, emit=hexc(0xFFD9A0), emit_strength=2.2)
    box(2.2, 2.64, 1.92, 2.0, zv - 0.07, zv, shade, bevel=0.02, collide=False)
    prop('rubber_duck_toy', 2.7, hh, -1.19, scale=0.45, rot=200); prop('plunger', 3.75, 0, 0.6); prop('perfume', 2.8, 0.84, zv - 0.15); prop('glass', 2.05, 0.84, zv - 0.15)
    prop('tproll', 4.41, 0.87, 0.1); prop('tproll', 1.75, 0.34, -1.6); prop('soap', 3.2, hh, -1.9 + 0.04)
    for t in ((3.4, 0.2, -1.54), (4.41, 0.85, 0.2), (2.42, 0.84, zv - 0.4), (1.75, 0.0, -0.3), (4.2, 0.0, -0.7)):
        treat(*t)

def utility():
    wh = flat('u_white', hexc(0xF2F2F0), rough=0.25); dark = flat('k_dark', hexc(0x2A2A2E), rough=0.5); steel = flat('k_steel', hexc(0xB8BDC2), rough=0.3, metal=0.9)
    glass = flat('u_glass', hexc(0x223040), rough=0.05, metal=0.3)
    for i, z in enumerate((-1.6, -0.95)):
        box(4.68, 5.3, 0.02, 0.87, z - 0.3, z + 0.3, wh, bevel=0.02, segs=3, collide=False)
        d = cyl(5.3, z, 0.45 - 0.015, 0.45 + 0.015, 0.2, steel, collide=False, name='door')
        from mathutils import Matrix
        piv = B(5.3, 0.45, z); d.data.transform(Matrix.Translation(piv) @ Matrix.Rotation(math.pi / 2, 4, 'Y') @ Matrix.Translation(-piv))
        g = cyl(5.31, z, 0.45 - 0.012, 0.45 + 0.012, 0.15, glass, collide=False, name='doorglass')
        g.data.transform(Matrix.Translation(B(5.31, 0.45, z)) @ Matrix.Rotation(math.pi / 2, 4, 'Y') @ Matrix.Translation(-B(5.31, 0.45, z)))
        box(5.3, 5.312, 0.74, 0.84, z - 0.27, z + 0.27, dark, bevel=0.002, collide=False)
    collider(4.68, 5.3, 0, 0.87, -1.9, -0.65, spot='the washing machine')
    S['items'].append(dict(kind='washer', p=[5.32, 0.45, -1.6], r=0.5))
    wall_shelf(4.68, 5.05, 1.45, -1.95, -0.5, spot='the laundry shelf')
    # litter box
    tray = flat('u_tray', hexc(0x6FA8C9), rough=0.5); sand = pbr('u_sand', 'terrazzo_tiles', tile=0.3, tint=(1.0, 0.92, 0.75), rough=1.0, nonormal=True)
    lx0, lx1, lz0, lz1 = 7.15, 7.85, 0.15, 0.7
    box(lx0, lx1, 0, 0.03, lz0, lz1, tray, bevel=0.01, collide=False); box(lx0 + 0.03, lx1 - 0.03, 0.03, 0.075, lz0 + 0.03, lz1 - 0.03, sand, bevel=0.004, collide=False)
    for (a0, a1, c0, c1) in ((lx0, lx1, lz0, lz0 + 0.03), (lx0, lx1, lz1 - 0.03, lz1), (lx0, lx0 + 0.03, lz0, lz1), (lx1 - 0.03, lx1, lz0, lz1)):
        box(a0, a1, 0.02, 0.14, c0, c1, tray, bevel=0.012, collide=False)
    collider(lx0, lx1, 0, 0.055, lz0, lz1)
    S['zones'].append(dict(kind='litter', b=[lx0, lx1, lz0, lz1], name='the litter box'))
    # robot vacuum dock
    box(7.72, 7.92, 0, 0.12, -1.9, -1.6, dark, bevel=0.02, collide=False)
    S['items'].append(dict(kind='vacuum', p=[7.45, 0, -1.75]))
    put('wicker_basket_01', 5.6, 0.45, scale=1.5, collide='none'); collider(5.32, 5.88, 0, 0.17, 0.23, 0.67)
    put('watering_can_metal_01', 7.6, -0.7, rot=60, collide='none', static=False)
    area_light(6.2, 2.55, -0.6, 1.4, 1.0, 85)
    rug('utility', 5.6, 7.0, -1.3, -0.4, [0xD9B36A, 0x7A5A3A, 0xF1E6D2], kind='stripes', scratch=False)
    prop('watering_can_metal_01', 7.6, 0, -0.7, rot=60); prop('catfood', 4.86, 1.45, -1.7); prop('cereal', 4.86, 1.45, -1.2); prop('sock', 5.6, 0.2, 0.45); prop('sock', 6.3, 0, -1.0)
    prop('bleach', 4.86, 1.45, -0.75); prop('ball', 6.8, 0, 0.3, col=0xE8556A)
    for t in ((4.95, 0.87, -1.25), (4.86, 1.45, -0.6), (7.5, 0.055, 0.42), (5.6, 0.17, 0.45), (7.86, 1.2, -0.55), (6.4, 0, -1.8)):
        treat(*t)


def garden():
    """What you see through the windows: lawn, hedge, trees, flower beds. Lit by the real-time sun only."""
    import random
    rng = random.Random(5)
    hedge = flat('ext_hedge', hexc(0x34512F), rough=0.95); leaf = flat('ext_leaf', hexc(0x4C6B3A), rough=0.95); leaf2 = flat('ext_leaf2', hexc(0x5E7F46), rough=0.95)
    bark = flat('ext_bark', hexc(0x5A4030), rough=0.95); fence = flat('ext_fence', hexc(0xF2EFE8), rough=0.7)
    path = pbr('ext_path', 'floor_pattern_02', tile=1.5, nonormal=True)
    # hedge all the way round
    for (x0, x1, z0, z1) in ((-15, 15, -12.6, -11.6), (-15, -0.9, 11.6, 12.6), (1.7, 15, 11.6, 12.6), (-15.6, -14.6, -12, 12), (14.6, 15.6, -12, 12)):
        o = box(x0, x1, 0, 1.5, z0, z1, hedge, bevel=0.12, segs=4, collide=False, static=False, name='hedge'); L.EXT.append(o)
        collider(x0, x1, 0, 1.6, z0, z1)
    # flower beds under the sunny windows
    cols = [0xF4F1EA, 0xE8DCA8, 0xFFFFFF, 0xB8A8CC, 0xF4F1EA]
    for (x0, x1, z0, z1) in ((-7.4, -1.6, 5.9, 6.6), (2.9, 5.7, 5.9, 6.6), (-8.9, -8.3, 0.8, 4.0)):
        for i in range(int((x1 - x0 + z1 - z0) * 4)):
            x = x0 + rng.random() * (x1 - x0); z = z0 + rng.random() * (z1 - z0)
            L.blob(x, 0.16 + rng.random() * 0.1, z, 0.2, leaf2 if i % 3 else leaf, squash=0.8, seed=i)
            if i % 4 == 0: L.blob(x + 0.05, 0.36 + rng.random() * 0.12, z, 0.075, flat('ext_fl%06x' % cols[i % 5], hexc(cols[i % 5]), rough=0.6), squash=0.8, jitter=0.05, seed=i)
    # garden path from the front door
    o = quad([(-0.3, -0.01, 13.25), (1.1, -0.01, 13.25), (1.1, -0.01, 5.6), (-0.3, -0.01, 5.6)], path, name='path', static=False); L.EXT.append(o)
    # white picket fence beyond the south lawn
    for i in range(46):
        x = -11 + i * 0.5
        if -0.6 < x < 1.4: continue          # the garden gate stands open
        o = box(x - 0.045, x + 0.045, 0, 0.75, 9.0, 9.04, fence, bevel=0.01, collide=False, static=False, name='picket'); L.EXT.append(o)
    for (xa, xb) in ((-11.2, -0.55), (1.35, 11.8)):
        for y in (0.2, 0.55):
            o = box(xa, xb, y, y + 0.07, 9.04, 9.07, fence, bevel=0.008, collide=False, static=False, name='rail'); L.EXT.append(o)
        collider(xa, xb, 0, 0.75, 8.99, 9.08)
    for x in (-0.55, 1.35):
        o = box(x - 0.07, x + 0.07, 0, 0.95, 8.95, 9.09, fence, bevel=0.015, collide=False, static=False, name='gatepost'); L.EXT.append(o)

def build():
    mats()
    architecture()
    living(); kitchen(); hall(); bedroom(); study(); bath(); utility()
    garden()
    # nav points the robot vacuum / fly roam between
    S['nav'] = [[0.4, -4.5], [0.4, -2.0], [0.4, 0.5], [0.4, 3.2], [0.4, 4.8], [-2.0, 3.2], [-3.0, 4.6], [-6.0, 2.0], [-3.2, -0.6], [-3.9, -1.7], [-6.4, -2.4], [-6.4, -4.3], [-2.0, -4.2], [-1.6, -3.4],
              [2.4, 2.9], [4.2, 2.6], [6.6, 2.6], [6.65, 1.4], [6.6, 0.2], [6.2, -1.0], [6.25, -2.6], [5.6, -3.6], [3.0, -3.9], [2.4, -0.55], [3.2, -0.6]]
