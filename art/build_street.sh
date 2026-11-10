#!/bin/bash
# Usage: art/build_street.sh      (exports assets/street/street.glb + street.json, then compresses it)
set -e
T=/mnt/data/Games/tools; A=/mnt/data/Games/Catgame/assets/street
export TMPDIR=$T/tmp PATH=$T/node-v22.11.0-linux-x64/bin:$PATH
mkdir -p $TMPDIR $A
cd $T
./blender-4.2.9-linux-x64/blender -b --python /mnt/data/Games/Catgame/art/street.py 2>&1 | grep -E "^\[house|Traceback|Error|line [0-9]+" || true
export LD_LIBRARY_PATH=$T/KTX-Software-4.3.2-Linux-x86_64/lib PATH=$T/KTX-Software-4.3.2-Linux-x86_64/bin:$PATH
GT=$T/gt/node_modules/.bin/gltf-transform
PY=/tmp/claude-1003/-mnt-data-Games-Catgame/d6b6de78-a26d-4431-abfc-8faf17ff6cc6/scratchpad/venv/bin/python
W=$TMPDIR/pack_street; rm -rf $W; mkdir -p $W
$GT dedup $A/street.glb $W/a.glb 2>&1 | grep -iE "^error" || true
$GT prune $W/a.glb $W/b.glb --keep-attributes true 2>&1 | grep -iE "^error" || true
$GT copy $W/b.glb $W/scene.gltf 2>&1 | grep -iE "^error" || true
$PY /mnt/data/Games/Catgame/art/ktx_pack.py $W/scene.gltf
$GT meshopt $W/scene.gltf $A/street.glb --level medium 2>&1 | grep -iE "^error" || true
rm -rf $W
ls -la $A
