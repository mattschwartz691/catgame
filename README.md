# Cat About the House

A 3D cat sandbox for the phone browser. The humans are out; you are the cat.

Pick one of three cats, then roam a seven-room house: knock things off shelves, shred the sofa, hunt the fly,
ride the robot vacuum, play the piano, nap in a sunbeam, and work through the Cat To-Do List.

## Playing

- **Touch:** drag the left side of the screen to move, drag the right side to look.
  `JUMP`, `PAW` (hold it, then let go, to pounce), `MEOW`, and an orange context button that changes with where
  you are (scratch, nap, eat, knead, grab…).
- **Keyboard:** WASD / arrows, Space jump, E paw (hold to pounce), F or Q action, M meow, T to-do list, Shift to walk,
  drag the mouse to look.

Progress (to-do list, treats, score) is saved in the browser.

## Running

Static files, no build step for the game itself:

```
python3 -m http.server 8000
# open http://localhost:8000
```

Add `?q=low` (or `potato`, `medium`, `high`) to force a graphics tier; otherwise it is chosen per device and
adapts to frame rate.

## How it is made

- `js/` — the game (three.js, plain ES modules). The cat is animated entirely procedurally: inverse-kinematic legs,
  gait cycles, a spring-lagged tail, shell fur.
- `art/` — the offline asset pipeline (Blender + Python). `cat_build.py` sculpts the cat from signed-distance
  shapes and paints its coats; `house.py` / `house_rooms.py` build the house, bake its global illumination with
  Cycles and export it; `build_house.sh` runs the bake and compresses textures and meshes.
- `assets/` — the built cat, house and props.
- `vendor/` — three.js and the loaders it needs.

## Credits

Furniture, props and material textures come from [Poly Haven](https://polyhaven.com) (CC0).
three.js is MIT licensed. Sound and music are synthesised in the browser.
