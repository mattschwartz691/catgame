#!/bin/bash
# Usage: art/build_house.sh bake|export [lmres] [samples] [site]     (bake = full light bake, export = reuse the last bake; site = home|colonial)
set -e
T=/mnt/data/Games/tools; SITE=${4:-home}
if [ $SITE = home ]; then A=/mnt/data/Games/Catgame/assets/house; SFX=; else A=/mnt/data/Games/Catgame/assets/house2; SFX=_$SITE; fi
AP=/mnt/data/Games/Catgame/assets/house
export TMPDIR=$T/tmp PATH=$T/node-v22.11.0-linux-x64/bin:$PATH
mkdir -p $TMPDIR $A
cd $T
./blender-4.2.9-linux-x64/blender -b --python /mnt/data/Games/Catgame/art/house.py -- ${1:-export} ${2:-2048} ${3:-200} site=$SITE 2>&1 | grep -E "^\[house|Traceback|Error|line [0-9]+" || true
./blender-4.2.9-linux-x64/blender -b --python /mnt/data/Games/Catgame/art/props.py 2>&1 | grep -E "^\[props|Traceback|Error|line [0-9]+" || true
export LD_LIBRARY_PATH=$T/KTX-Software-4.3.2-Linux-x86_64/lib PATH=$T/KTX-Software-4.3.2-Linux-x86_64/bin:$PATH
GT=$T/gt/node_modules/.bin/gltf-transform
PY=/tmp/claude-1003/-mnt-data-Games-Catgame/d6b6de78-a26d-4431-abfc-8faf17ff6cc6/scratchpad/venv/bin/python
for f in $A/house.glb $AP/props.glb; do
  W=$TMPDIR/pack_$SITE; rm -rf $W; mkdir -p $W
  $GT dedup $f $W/a.glb 2>&1 | grep -iE "^error" || true
  $GT prune $W/a.glb $W/b.glb --keep-attributes true 2>&1 | grep -iE "^error" || true
  $GT copy $W/b.glb $W/scene.gltf 2>&1 | grep -iE "^error" || true
  $PY /mnt/data/Games/Catgame/art/ktx_pack.py $W/scene.gltf
  $GT meshopt $W/scene.gltf $f --level medium 2>&1 | grep -iE "^error" || true
  rm -rf $W
done
/tmp/claude-1003/-mnt-data-Games-Catgame/d6b6de78-a26d-4431-abfc-8faf17ff6cc6/scratchpad/venv/bin/python - <<PY
from PIL import Image
Image.open('$T/out/lightmap$SFX.png').convert('RGB').save('$A/lightmap.webp', quality=92, method=6)
PY
ls -la $A
