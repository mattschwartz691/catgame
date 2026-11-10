"""The house. Run:  blender -b --python art/house.py -- preview|bake [lmres] [samples]"""
import bpy, sys, os, json, math
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import house_lib as L
from house_lib import box, cyl, lathe, quad, put, prop, pbr, flat, hexc, collider, join, B, S, log
import importlib
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else ['preview']
SITE = ([a[5:] for a in ARGS if a.startswith('site=')] or ['home'])[0]
ARGS = [a for a in ARGS if not a.startswith('site=')]
R = importlib.import_module({'home': 'house_rooms', 'colonial': 'house2_rooms'}[SITE])
SFX = '' if SITE == 'home' else '_' + SITE
MODE = ARGS[0]
LMRES = int(ARGS[1]) if MODE in ('bake', 'export') and len(ARGS) > 1 else 1024
SAMPLES = int(ARGS[2]) if MODE in ('bake', 'export') and len(ARGS) > 2 else 64
OUT = '/mnt/data/Games/tools/out'
ASSETS = os.path.join(HERE, '..', 'assets', 'house' if SITE == 'home' else 'house2')
os.makedirs(ASSETS, exist_ok=True)

L.reset()
sc = bpy.context.scene
SUN_DIR = np.array([-0.62, 0.52, 0.59]); SUN_DIR /= np.linalg.norm(SUN_DIR)
SUN_STRENGTH = 3.2
SUN_COLOR = (1.0, 0.93, 0.82)

# ---- world: soft sky (no sun disc) + a separate sun lamp
w = bpy.data.worlds.new('sky'); sc.world = w; w.use_nodes = True
nt = w.node_tree; bg = nt.nodes['Background']
sky = nt.nodes.new('ShaderNodeTexSky'); sky.sky_type = 'NISHITA'; sky.sun_disc = False
sky.sun_elevation = math.asin(SUN_DIR[1]); sky.sun_rotation = math.atan2(SUN_DIR[0], -SUN_DIR[2])
nt.links.new(sky.outputs['Color'], bg.inputs['Color']); bg.inputs['Strength'].default_value = R.SKY_STRENGTH
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
sun.data.energy = SUN_STRENGTH; sun.data.color = SUN_COLOR; sun.data.angle = math.radians(1.5)
from mathutils import Vector
sun.rotation_euler = (-Vector(B(*SUN_DIR))).to_track_quat('-Z', 'Y').to_euler()
sc.collection.objects.link(sun)

R.build()
log('built: %d static objects, %d colliders, %d props' % (len(L.STATIC), len(S['colliders']), len(S['props'])))

def render(name, pos, target, lens=24, res=(1280, 800), ortho=None, samples=48):
    cam = bpy.data.objects.get('cam')
    if not cam:
        cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.type = 'ORTHO' if ortho else 'PERSP'
    if ortho: cam.data.ortho_scale = ortho
    cam.data.lens = lens; cam.data.clip_start = 0.02
    cam.location = B(*pos)
    cam.rotation_euler = (B(*target) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.render.engine = 'CYCLES'; sc.cycles.samples = samples; sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.view_settings.view_transform = 'AgX'; sc.view_settings.exposure = R.PREVIEW_EXPOSURE
    sc.render.filepath = os.path.join(OUT, name + '.png')
    bpy.ops.render.render(write_still=True)

if MODE == 'preview':
    views = ARGS[1:] or ['top']
    for o in L.BAKE_ONLY: o.hide_render = 'top' in views or True
    # place the dynamic props too so the preview shows the dressed set
    for p in S['props']:
        try: put(p['asset'], p['p'][0], p['p'][2], rot=p.get('rot', 0), y=p['p'][1], scale=p.get('scale', 1), collide='none', static=False)
        except Exception as e: print('prop preview fail', p['asset'], e)
    for v in views:
        if v == 'top':
            b = R.BOUNDS; cx, cz = (b[0] + b[1]) / 2, (b[2] + b[3]) / 2
            render('house%s_top' % SFX, (cx, 40, cz + 0.01), (cx, 0, cz), ortho=max(b[1] - b[0], (b[3] - b[2]) * 1.45) + 1.5, res=(1600, 1120))
        elif v.startswith('top@'):
            y = float(v[4:]); b = R.BOUNDS; cx, cz = (b[0] + b[1]) / 2, (b[2] + b[3]) / 2
            render('house%s_top_%s' % (SFX, v[4:].replace('-', 'm')), (cx, y + 2.58, cz + 0.01), (cx, y, cz), ortho=max(b[1] - b[0], (b[3] - b[2]) * 1.45) + 1.5, res=(1500, 1050), samples=32)
        elif v in R.VIEWS: render('house%s_%s' % (SFX, v), *R.VIEWS[v])
    log('preview done'); sys.exit(0)

# ================================================================== bake + export
texels = L.pack_lightmaps(LMRES, weight=R.lm_weight)
# merge into the final export objects BEFORE baking (one scene sync per object makes many small bakes very slow)
fades = {}; rest = {}; fadeY = {}
for ob in L.STATIC:
    k = ob.get('fade'); lv = float(ob.get('lv', 0.0))
    if k: fades.setdefault(k, []).append(ob); fadeY[k] = lv
    else: rest.setdefault(lv, []).append(ob)
exp = [join(objs, 'fade_' + k) for k, objs in fades.items()]
exp += [join(objs, 'static_%d' % round(lv * 100)) for lv, objs in rest.items()]
L.STATIC[:] = exp
log('merged into %d objects' % len(exp))
lm = L.bake_lightmap(LMRES, SAMPLES, sun, os.path.join(OUT, 'lightmap%s.npy' % SFX)) if MODE == 'bake' else np.load(os.path.join(OUT, 'lightmap%s.npy' % SFX))
b = R.BOUNDS
LEVELS = getattr(R, 'LEVELS', [0.0])
probes_all = [L.bake_probes(b[0], b[1], b[2], b[3], y + 0.22, 0.25, max(64, SAMPLES), sun) for y in LEVELS]
probes = probes_all[0]
log('lightmap stats: mean %.3f  p50 %.3f  p99 %.3f  max %.3f' % (lm.mean(), np.percentile(lm, 50), np.percentile(lm, 99), lm.max()))
log('probe stats: mean %.3f max %.3f' % (probes.mean(), probes.max()))

# ---- lightmap + probes + scene description
LMAX = float(min(6.0, max(1.0, np.percentile(lm, 99.7))))
enc = np.clip(lm / LMAX, 0, 1) ** (1 / 2.2)
img = bpy.data.images.new('LMOUT', LMRES, LMRES, alpha=False)
img.pixels.foreach_set(np.concatenate([enc, np.ones((LMRES, LMRES, 1), dtype=np.float32)], -1).ravel())
img.filepath_raw = os.path.join(OUT, 'lightmap%s.png' % SFX); img.file_format = 'PNG'; img.save()
pr = probes[::-1].mean(-1)       # row 0 = north (z0)
levels = [dict(y=y, v=[round(float(v), 3) for v in p[::-1].mean(-1).ravel()]) for y, p in zip(LEVELS, probes_all)]
OX, OZ = getattr(R, 'ORIGIN', (0.0, 0.0))
L.offset_data(S, OX, OZ)
data = dict(S)
SPAWN = dict(R.SPAWN); SPAWN['x'] += OX; SPAWN['z'] += OZ
data.update(bounds=[R.BOUNDS[0] + OX, R.BOUNDS[1] + OX, R.BOUNDS[2] + OZ, R.BOUNDS[3] + OZ], site=SITE, roofs=[[r[0] + OX, r[1] + OX, r[2] + OZ, r[3] + OZ] for r in getattr(R, 'ROOFS', [R.BOUNDS])], sun=dict(dir=[float(v) for v in SUN_DIR], intensity=SUN_STRENGTH, color=list(SUN_COLOR)),
            lightmap=dict(max=LMAX, res=LMRES), probes=dict(cell=0.25, nx=int(pr.shape[1]), nz=int(pr.shape[0]), v=[round(float(v), 3) for v in pr.ravel()]),
            spawn=SPAWN, wallH=R.H, levels=levels, fadeY=fadeY, pits=[[r[0] + OX, r[1] + OX, r[2] + OZ, r[3] + OZ] for r in getattr(R, 'PITS', [])], pitY=getattr(R, 'PIT_Y', 0))
json.dump(data, open(os.path.join(ASSETS, 'house.json'), 'w'))
# ---- texture budgets (phones have little texture memory): colour maps only, detail maps where they earn their keep
def tex_node(m, bs, sock):
    for l in bs.inputs[sock].links:
        n = l.from_node
        while n and n.type != 'TEX_IMAGE':
            ins = [i for i in n.inputs if i.is_linked]
            n = ins[0].links[0].from_node if ins else None
        return l, n
    return None, None
def unlink(m, bs, sock, value=None):
    for l in list(bs.inputs[sock].links): m.node_tree.links.remove(l)
    if value is not None: bs.inputs[sock].default_value = value
HERO = R.HERO
seen = set()
for ob in L.STATIC + L.EXT:
    for m in ob.data.materials:
        if not m or not m.use_nodes or m.name in seen: continue
        seen.add(m.name)
        bs = m.node_tree.nodes.get('Principled BSDF')
        if not bs: continue
        n = m.name
        floor = n.startswith('fl_'); tiling = 'tile' in m.keys()
        hero = any(n.startswith(h) for h in HERO)
        l, t = tex_node(m, bs, 'Base Color')
        if t and t.image:
            size = 1024 if (floor or hero) else 512
            if t.image.size[0] > size: t.image.scale(size, size)
        if floor or hero:
            for sock in ('Roughness', 'Normal'):
                l, t = tex_node(m, bs, sock)
                if t and t.image and t.image.size[0] > 512: t.image.scale(512, 512)
            unlink(m, bs, 'Metallic', 0.0) if floor else None
        else:
            l, t = tex_node(m, bs, 'Roughness')
            if l is not None: unlink(m, bs, 'Roughness', 0.62)
            if tex_node(m, bs, 'Metallic')[0] is not None: unlink(m, bs, 'Metallic', 0.0)
            if tex_node(m, bs, 'Normal')[0] is not None: unlink(m, bs, 'Normal')
log('materials: %d' % len(seen))

# ---- export
exp = list(L.STATIC)
# outdoor pieces: outer wall faces ride along with their wall's fade group, the rest becomes one object
byname = {o.name: o for o in exp}
loose = []
for ob in list(L.EXT):
    k = ob.get('fade')
    if k and ('fade_' + k) in byname:
        tgt = byname['fade_' + k]
        if 'LM' not in ob.data.uv_layers: ob.data.uv_layers.new(name='LM')
        bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); tgt.select_set(True); bpy.context.view_layer.objects.active = tgt
        bpy.ops.object.join()
    else: loose.append(ob)
if loose:
    for ob in loose:
        if 'UVMap' not in ob.data.uv_layers and len(ob.data.uv_layers) == 0: ob.data.uv_layers.new(name='UVMap')
    bpy.ops.object.select_all(action='DESELECT')
    for ob in loose: ob.select_set(True)
    bpy.context.view_layer.objects.active = loose[0]
    if len(loose) > 1: bpy.ops.object.join()
    ext = bpy.context.view_layer.objects.active; ext.name = 'exterior'; exp.append(ext)
if OX or OZ:
    from mathutils import Matrix
    for o in exp: o.data.transform(Matrix.Translation(B(OX, 0, OZ)))
bpy.ops.object.select_all(action='DESELECT')
for o in exp: o.select_set(True)
bpy.ops.export_scene.gltf(filepath=os.path.join(ASSETS, 'house.glb'), export_format='GLB', use_selection=True,
                          export_materials='EXPORT', export_image_format='AUTO',
                          export_yup=True, export_cameras=False, export_lights=False, export_animations=False, export_extras=False)
log('exported house.glb %.1f MB' % (os.path.getsize(os.path.join(ASSETS, 'house.glb')) / 1e6))

log('done')
