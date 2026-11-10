"""Import the downloaded Poly Haven models, normalise them (one mesh, base-centred, decimated to budget)
and save them into a library .blend + catalog.json.  Run: blender -b --python art/assets.py -- [render]"""
import bpy, sys, os, json, math
from mathutils import Matrix, Vector
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import ph
LIB = '/mnt/data/Games/tools/cache/assets.blend'
CAT = '/mnt/data/Games/tools/cache/catalog.json'
OUT = '/mnt/data/Games/tools/out/catalog'
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []

BUDGET = {'potted_plant_01': 9000, 'potted_plant_02': 9000, 'sofa_03': 8000, 'GothicBed_01': 9000, 'wooden_bookshelf_worn': 5000}
DEFAULT_BUDGET = 4500
SMALL = 1800      # props under 40 cm

def all_ids():
    return sorted(d for d in os.listdir(ph.CACHE) if any(x.startswith('gltf_') for x in os.listdir(os.path.join(ph.CACHE, d))))

SPLIT = {'tea_set_01', 'wine_bottles_01', 'brass_goblets', 'throw_pillows_01', 'vintage_suitcase', 'rubber_boots', 'binder_notebook', 'wicker_basket_02', 'bananas'}

def finish(ob, name, aid):
    ob.name = name; ob.data.name = name
    vs = [v.co for v in ob.data.vertices]
    mn = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    mx = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    ob.data.transform(Matrix.Translation((-(mn.x + mx.x) / 2, -(mn.y + mx.y) / 2, -mn.z)))
    size = mx - mn
    ob.data.calc_loop_triangles(); tris = len(ob.data.loop_triangles)
    budget = BUDGET.get(aid, SMALL if max(size) < 0.4 else DEFAULT_BUDGET)
    if tris > budget:
        bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active = ob
        m = ob.modifiers.new('dec', 'DECIMATE'); m.ratio = budget / tris
        bpy.ops.object.modifier_apply(modifier='dec')
        ob.data.calc_loop_triangles()
    for p in ob.data.polygons: p.use_smooth = True
    alpha = False
    for mat in ob.data.materials:
        if mat and mat.use_nodes:
            b = mat.node_tree.nodes.get('Principled BSDF')
            if b and b.inputs['Alpha'].is_linked: alpha = True
    return dict(size=[round(size.x, 4), round(size.z, 4), round(size.y, 4)], tris0=tris, tris=len(ob.data.loop_triangles),
                mats=[m.name for m in ob.data.materials if m], alpha=alpha)

def import_asset(aid):
    before = set(o.name for o in bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=ph.model(aid))
    new = [o.name for o in bpy.data.objects if o.name not in before]
    meshes = [bpy.data.objects[n] for n in new if bpy.data.objects[n].type == 'MESH']
    for o in meshes:
        mw = o.matrix_world.copy()
        o.parent = None
        o.data = o.data.copy()
        o.data.transform(mw); o.matrix_world = Matrix.Identity(4)
    keep = []
    if aid in SPLIT and len(meshes) > 1:
        keep = [(o, '%s#%d' % (aid, i)) for i, o in enumerate(sorted(meshes, key=lambda o: o.name))]
    else:
        bpy.ops.object.select_all(action='DESELECT')
        for o in meshes: o.select_set(True)
        bpy.context.view_layer.objects.active = meshes[0]
        if len(meshes) > 1: bpy.ops.object.join()
        keep = [(bpy.context.view_layer.objects.active, aid)]
    keepn = set(o.name for o, _ in keep)
    for n in new:
        if n in bpy.data.objects and n not in keepn: bpy.data.objects.remove(bpy.data.objects[n])
    out = {}
    for o, name in keep:
        out[name] = finish(o, name, aid)
    return out

bpy.ops.wm.read_factory_settings(use_empty=True)
catalog = {}
for aid in all_ids():
    try:
        if aid == 'steel_frame_shelves_01': continue
        for name, info in import_asset(aid).items():
            catalog[name] = info
            print('[asset]', name, info['size'], info['tris0'], '->', info['tris'], 'alpha' if info['alpha'] else '', len(info['mats']), flush=True)
    except Exception as e:
        print('[asset] FAIL', aid, e, flush=True)
json.dump(catalog, open(CAT, 'w'), indent=1)
for im in bpy.data.images:
    if im.filepath: im.filepath = bpy.path.abspath(im.filepath)
bpy.ops.wm.save_as_mainfile(filepath=LIB)

if 'render' in ARGS:
    os.makedirs(OUT, exist_ok=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'; sc.cycles.samples = 24; sc.cycles.use_denoising = True
    sc.render.resolution_x = sc.render.resolution_y = 240
    w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (.8, .8, .85, 1)
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 3; sun.rotation_euler = (math.radians(45), 0, math.radians(30)); sc.collection.objects.link(sun)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
    # axis marker: red bar toward game +X, blue toward game +Z (= blender -Y)
    def bar(col, loc, scl):
        bpy.ops.mesh.primitive_cube_add(size=1); o = bpy.context.object; o.scale = scl; o.location = loc
        m = bpy.data.materials.new('ax'); m.use_nodes = True; m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = col
        m.node_tree.nodes['Principled BSDF'].inputs['Emission Color'].default_value = col; m.node_tree.nodes['Principled BSDF'].inputs['Emission Strength'].default_value = 1
        o.data.materials.append(m); return o
    bx = bar((1, 0, 0, 1), (0, 0, 0), (1, .02, .02)); bz = bar((0, .2, 1, 1), (0, 0, 0), (.02, 1, .02))
    objs = [o for o in bpy.data.objects if o.name in catalog]
    for o in objs: o.hide_render = True
    for o in objs:
        o.hide_render = False
        s = catalog[o.name]['size']; r = max(s) * 1.0
        bx.scale = (r * .5, .01 * r, .01 * r); bx.location = (r * .75, 0, 0.005)
        bz.scale = (.01 * r, r * .5, .01 * r); bz.location = (0, -r * .75, 0.005)
        tgt = Vector((0, 0, s[1] * .45))
        for name, pos in (('a', Vector((r * 1.3, -r * 1.9, s[1] * .5 + r * 1.0))), ('t', Vector((0.001, 0, s[1] + r * 3.2)))):
            cam.location = tgt + pos if name == 'a' else pos
            cam.rotation_euler = (tgt - cam.location).to_track_quat('-Z', 'Y').to_euler()
            sc.render.filepath = os.path.join(OUT, f'{o.name}_{name}.png'); bpy.ops.render.render(write_still=True)
        o.hide_render = True
print('[asset] done', len(catalog))
