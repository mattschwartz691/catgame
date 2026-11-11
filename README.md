# Cat About the House

A 3D cat sandbox for the phone browser. The humans are out; you are the cat.

Pick one of five cats, then roam a seven-room house: knock things off shelves, shred the sofa, hunt the fly,
ride the robot vacuum, play the piano, nap in a sunbeam, and work through the Cat To-Do List. The front door is
open: walk down the street to a second, bigger house: a red colonial with four storeys to explore, from the billiard
room in the basement to the attic. It loads in the background after the game starts.

Five mini-games are scattered about, each on a glowing ring: Laser Chase (living room of the first house), Stalk the
Sparrow (the lawn across the street), and in the red house The Floor Is Lava (basement), Vole Patrol (back garden)
and Attic Bells (attic). Stand on a ring and press the orange button.

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
  shapes and paints its coats; `house.py` builds a house from a room module (`house_rooms.py` for the first house, `house2_rooms.py` for the colonial), bakes its global illumination with Cycles and exports it (`build_house.sh bake|export 2048 200 home|colonial`); `street.py` / `build_street.sh` make the street, gardens and the houses' roofs. The build scripts also compress textures and meshes.
- `assets/` — the built cat, houses, street and props.
- `vendor/` — three.js and the loaders it needs.

## Credits

Furniture, props and material textures come from [Poly Haven](https://polyhaven.com) (CC0).
three.js is MIT licensed. Sound and music are synthesised in the browser.

## Playing together

"Play together" in the menu links up to four players so they see each other's cats. One starts a game and
gets a four-letter code; the others join with it. The browsers talk directly over WebRTC (`js/net.js`,
vendored PeerJS); the public PeerJS broker is used only to introduce them. Only the cats are shared: each
player keeps their own house, treats and to-do list.
