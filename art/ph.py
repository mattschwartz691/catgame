"""Poly Haven (CC0) asset fetcher with an on-disk cache.  https://polyhaven.com/license"""
import json, os, urllib.request
from concurrent.futures import ThreadPoolExecutor

CACHE = '/mnt/data/Games/tools/cache/ph'
UA = {'User-Agent': 'asset-fetch/1.0'}

def _get(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    req = urllib.request.Request(url, headers=UA)
    data = urllib.request.urlopen(req, timeout=120).read()
    with open(path + '.tmp', 'wb') as f:
        f.write(data)
    os.replace(path + '.tmp', path)
    return path

def files(aid):
    p = os.path.join(CACHE, aid, 'files.json')
    _get('https://api.polyhaven.com/files/' + aid, p)
    return json.load(open(p))

def model(aid, res='1k'):
    """Download a model as glTF (+bin +textures). Returns the .gltf path."""
    f = files(aid)['gltf']
    res = res if res in f else sorted(f.keys())[0]
    g = f[res]['gltf']
    d = os.path.join(CACHE, aid, 'gltf_' + res)
    out = _get(g['url'], os.path.join(d, os.path.basename(g['url'])))
    for rel, inc in g.get('include', {}).items():
        _get(inc['url'], os.path.join(d, rel))
    return out

def texture(aid, res='1k', maps=('Diffuse', 'nor_gl', 'arm')):
    """Download texture maps as jpg. Returns {map: path}."""
    f = files(aid)
    out = {}
    for m in maps:
        if m not in f:
            continue
        e = f[m][res]['jpg']
        out[m] = _get(e['url'], os.path.join(CACHE, aid, 'tex_' + res, os.path.basename(e['url'])))
    return out

def hdri(aid, res='2k', fmt='hdr'):
    e = files(aid)['hdri'][res][fmt]
    return _get(e['url'], os.path.join(CACHE, aid, os.path.basename(e['url'])))

def fetch_all(models=(), textures=(), workers=12):
    with ThreadPoolExecutor(workers) as ex:
        a = list(ex.map(model, models)); b = list(ex.map(texture, textures))
    return a, b

if __name__ == '__main__':
    import sys
    for a in sys.argv[1:]:
        print(model(a))
