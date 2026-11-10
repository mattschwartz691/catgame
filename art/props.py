"""Export the dynamic (knockable) prop models used by the house into one small GLB.
Run after house.py bake:  blender -b --python art/props.py"""
import bpy, sys, os, json
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import house_lib as L
ASSETS = os.path.join(HERE, '..', 'assets', 'house')
data = json.load(open(os.path.join(ASSETS, 'house.json')))
bpy.ops.wm.read_factory_settings(use_empty=True)
ids = sorted(set(p['asset'] for p in data['props'] if p['asset'] in L.CATALOG))
objs = []
info = {}
for i, aid in enumerate(ids):
    src = L._lib(aid)
    bpy.context.scene.collection.objects.link(src)
    src.name = aid.replace('#', '__')
    size = L.CATALOG[aid]['size']
    big = max(size) > 0.45
    for m in src.data.materials:
        if not m or not m.use_nodes: continue
        bs = m.node_tree.nodes.get('Principled BSDF')
        for sock, res in (('Base Color', 512 if big else 256), ('Roughness', 128), ('Normal', 0)):
            for l in list(bs.inputs[sock].links):
                n = l.from_node
                while n and n.type != 'TEX_IMAGE':
                    ins = [k for k in n.inputs if k.is_linked]
                    n = ins[0].links[0].from_node if ins else None
                if res == 0: m.node_tree.links.remove(l); continue
                if n and n.image and n.image.size[0] > res: n.image.scale(res, res)
    objs.append(src); info[aid] = dict(size=size, alpha=L.CATALOG[aid]['alpha'])
bpy.ops.object.select_all(action='DESELECT')
for o in objs: o.select_set(True)
out = os.path.join(ASSETS, 'props.glb')
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_materials='EXPORT', export_image_format='AUTO',
                          export_yup=True, export_cameras=False, export_lights=False, export_animations=False)
json.dump(info, open(os.path.join(ASSETS, 'props.json'), 'w'))
print('[props] exported', len(ids), '%.1f MB' % (os.path.getsize(out) / 1e6))
