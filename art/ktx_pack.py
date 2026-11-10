"""Re-encode every texture of an unpacked .gltf as KTX2 (Basis ETC1S for colour/data, UASTC for normal maps)
so phones can keep them GPU-compressed.   usage: ktx_pack.py scene.gltf"""
import json, os, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
from PIL import Image

path = sys.argv[1]; d = os.path.dirname(path)
g = json.load(open(path))
srgb, normal = set(), set()
def tex_img(t): 
    T = g['textures'][t['index']]
    return T.get('source', T.get('extensions', {}).get('EXT_texture_webp', {}).get('source'))
for m in g.get('materials', []):
    pbr = m.get('pbrMetallicRoughness', {})
    if 'baseColorTexture' in pbr: srgb.add(tex_img(pbr['baseColorTexture']))
    if 'emissiveTexture' in m: srgb.add(tex_img(m['emissiveTexture']))
    if 'normalTexture' in m: normal.add(tex_img(m['normalTexture']))

def conv(i):
    im = g['images'][i]; src = os.path.join(d, im['uri'])
    base = os.path.splitext(src)[0]
    pil = Image.open(src)
    alpha = pil.mode in ('RGBA', 'LA', 'PA') and pil.convert('RGBA').getextrema()[3][0] < 250
    pil = pil.convert('RGBA' if alpha else 'RGB')
    w, h = pil.size                      # block compression wants multiples of 4
    w2, h2 = max(4, (w + 3) // 4 * 4), max(4, (h + 3) // 4 * 4)
    if (w2, h2) != (w, h): pil = pil.resize((w2, h2), Image.LANCZOS)
    png = base + '.__tmp.png'; pil.save(png)
    out = base + '.ktx2'
    if i in normal:
        cmd = ['ktx', 'create', '--format', 'R8G8B8_UNORM', '--assign-oetf', 'linear', '--encode', 'uastc', '--uastc-quality', '2', '--zstd', '18', '--generate-mipmap', png, out]
    elif i in srgb:
        cmd = ['ktx', 'create', '--format', 'R8G8B8A8_SRGB' if alpha else 'R8G8B8_SRGB', '--assign-oetf', 'srgb', '--encode', 'basis-lz', '--qlevel', '200', '--clevel', '4', '--generate-mipmap', png, out]
    else:
        cmd = ['ktx', 'create', '--format', 'R8G8B8_UNORM', '--assign-oetf', 'linear', '--encode', 'basis-lz', '--qlevel', '180', '--clevel', '4', '--generate-mipmap', png, out]
    r = subprocess.run(cmd, capture_output=True, text=True)
    os.remove(png)
    if r.returncode != 0 or not os.path.exists(out):
        return i, None, r.stderr[-200:]
    os.remove(src)
    return i, os.path.basename(out), ''

with ThreadPoolExecutor(48) as ex:
    res = list(ex.map(conv, range(len(g.get('images', [])))))
bad = [r for r in res if r[1] is None]
for i, name, err in res:
    if name:
        g['images'][i]['uri'] = os.path.join(os.path.dirname(g['images'][i]['uri']), name); g['images'][i]['mimeType'] = 'image/ktx2'
for t in g.get('textures', []):
    src = t.pop('source', None)
    ext = t.setdefault('extensions', {})
    if src is None: src = ext.pop('EXT_texture_webp', {}).get('source')
    if g['images'][src].get('mimeType') == 'image/ktx2': ext['KHR_texture_basisu'] = {'source': src}
    else: t['source'] = src
    if not ext: t.pop('extensions')
for k in ('extensionsUsed', 'extensionsRequired'):
    e = [x for x in g.get(k, []) if x != 'EXT_texture_webp']
    if 'KHR_texture_basisu' not in e: e.append('KHR_texture_basisu')
    g[k] = e
json.dump(g, open(path, 'w'))
print('[ktx] %d textures, %d failed' % (len(res), len(bad)), bad[:3])
