# 皇帝企鵝寶寶散步 · Emperor Chick Walk

A browser walking simulator: you are an emperor penguin chick (*Aptenodytes forsteri*) in the crèche on the sea ice of Atka Bay, Antarctica. Built with three.js. No build step and no asset files: every model, texture and sound is generated in code.

## Run

Serve the folder over HTTP and open `index.html`:

```sh
npx http-server -p 8080 .
# or
python3 -m http.server 8080
```

three.js 0.170.0 is loaded from jsDelivr through an import map, so the page needs internet access the first time.

## Controls

| | Desktop | Phone / tablet |
|---|---|---|
| Walk | `WASD` / arrow keys, `Shift` to hurry | Drag on the left half of the screen (push to the edge to hurry) |
| Camera | Drag the mouse, wheel to zoom | Drag on the right half, pinch to zoom |
| Hop | `Space` | 跳 button |
| Belly slide (toboggan) | `E` toggles lying down; keep pushing forward to paddle | 滑行 button |
| Call | `C` | 叫 button; the nearest adult turns and answers |

## What is simulated

- **Chick model**: lathe and ellipsoid body parts with shell-textured down (one instanced mesh per part). The down grows in tufts that pinch to wispy tips, lean in random directions, are combed down and back, have paler silver tips and can carry a dusting of snow; backlit down glows at the silhouette. Head pattern follows field descriptions of crèche-age chicks: black crown from the bill over the back of the head and down the sides of the neck, white cheeks, eye "goggles", chin and throat. Small dark-brown eyes with a bare skin ring and eyelids, a slender ridged bill with a hooked tip, tapered downy flippers, and webbed three-toed feet with knuckles and long claws. The down sways with acceleration and wind.
- **Animation**: procedural waddle (body rolls over the stance foot), feet planted on the terrain under each foot, look-around, blinking, breathing, belly-slide and tumble poses, calling with an open beak.
- **Physics**: fixed 120 Hz step. Surface-dependent traction: snow grips, glaze ice lets you slide and fall over if you turn hard. Slope gravity, static friction on gentle snow slopes, Coulomb friction and drag when tobogganing, belly acting as a keel, hops, circle colliders for ice blocks, adults and other chicks.
- **Environment**: heightfield sea ice with wind-aligned drifts, snow hills, blue ice patches, pressure-ridge ice blocks, tabular icebergs on the horizon. Snow uses a generated sastrugi normal map and sun glitter.
- **Light**: Preetham sky, image-based lighting baked from the same sky, a low polar sun with soft shadows that follow the player, fog matched to the horizon colour, HDR rendering with ACES tone mapping and bloom on high quality. The sun height is adjustable in settings.
- **Footprints and slide troughs**: decals with normal maps derived from a depth field, so the low sun shades the dents.
- **Sound** (Web Audio, synthesized): wind, footsteps on snow and ice, the chick's two-voice whistle, the adults' trumpeting calls.
- **Mobile**: floating joystick, thumb-sized action buttons, safe-area insets, portrait and landscape, three quality presets (default is 平衡 on touch devices).

## Files

```
index.html          UI, styles, import map
src/main.js         setup, game loop, NPC behaviour, HUD
src/world.js        terrain, ice, icebergs, snow material
src/atmosphere.js   sky, sun, environment lighting, fog
src/fur.js          shell-fur material
src/chick.js        chick model and animation
src/adult.js        adult emperor model
src/physics.js      character physics
src/prints.js       footprints and belly trails
src/snow.js         blowing snow particles
src/controls.js     camera and input
src/audio.js        synthesized sound
```
