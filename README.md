# 皇帝企鵝寶寶散步 · Emperor Chick Walk

A browser walking simulator: you are an emperor penguin chick (*Aptenodytes forsteri*) in the crèche on the sea ice of Atka Bay, Antarctica. Built with three.js, with no build step. The chick and the adults are rigged 3D models; the landscape, textures and sounds are generated in code.

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

- **Chick model**: the rigged "Baby Emperor Penguin (Chick)" model (`assets/chick.glb`), with fur cards over a textured body. The source export had lost the UVs that map the strand texture onto the fur cards, so viewers showed the coat as white slabs; `tools/chick-model` rebuilds per-card strand UVs (root to tip), bakes each card's colour from the body texture, keeps cards off the eyes and bill (in the source they were only hidden by accident through the broken UVs), keeps the five clips the game uses and quantizes the file (20 MB → 6.1 MB, no WebAssembly decoder needed). Keyframes are deliberately not resampled: the rig's joints pivot far from the skin, so even tiny keyframe errors warp the face. Each chick in the game gets a random down colour between mid grey and silvery white; only the grey down shifts, so the black cap and white face stay as they are.
- **Adult model**: the adult from the "Emperor Penguin Family" model (`assets/adult.glb`), about 1.1 m tall. Its feather cards had the same lost UVs as the chick's fur and get the same repair, each card mapped onto one of the long contour feathers of the strand texture; the chick that shares the source file is dropped (24 MB → 4.7 MB). The source has no clips and its rest pose bows the head toward a chick, so adults are posed procedurally: the head lifts to a relaxed angle, looks around and dips to the chest and up again to call, the flippers sway and the body rocks. Joints are picked by the vertices they move, as for the chick.
- **Animation**: the model's own clips for idling (looking around, flapping), walking (playback speed follows ground speed) and calling (the 叫 button). Lying down, tobogganing and tumbling are procedural: the body pitches onto its belly, the head and neck lift to look ahead, the flippers spread, and the feet paddle while pushing. The skeleton is partly flattened, so these poses rotate joints chosen by the vertices they move rather than by hierarchy. Footfalls come from the toe joints touching the ground.
- **Physics**: fixed 120 Hz step. Surface-dependent traction: snow grips, glaze ice lets you slide and fall over if you turn hard. Slope gravity, static friction on gentle snow slopes, Coulomb friction and drag when tobogganing, belly acting as a keel, hops, circle colliders for ice blocks, adults and other chicks.
- **Environment**: heightfield sea ice with wind-aligned drifts, snow hills, blue ice patches, pressure-ridge ice blocks, tabular icebergs on the horizon. Snow uses a sastrugi and wind-crust relief texture rendered on the GPU (512–2048 px by quality preset), sampled at three scales to hide tiling, with cavity shading, wind-packed versus powder patches and sun glitter. Ice blocks and icebergs get the same relief in world space, which reads as frost and firn strata.
- **Light**: Preetham sky, image-based lighting baked from the same sky, a low polar sun with soft shadows that follow the player, fog matched to the horizon colour, HDR rendering with ACES tone mapping and bloom on high quality. The sun height is adjustable in settings.
- **Weather and wind**: clear, falling snow and blizzard, or 自動 to drift between them every few minutes. Weather sets the mean wind and gusts, snowfall, fog, cloud cover (dimmer sun, softer shadows, hazed sky) and blowing snow. Flakes streak along their motion; above about 4 m/s snow streams over the ground in sheets. Wind pushes the chick: snow grip holds it, but in a blizzard it gets blown across glaze ice and along on its belly.
- **Footprints and slide troughs**: decals with normal maps derived from a depth field, so the low sun shades the dents.
- **Sound** (Web Audio, synthesized): wind, footsteps on snow and ice, the chick's two-voice whistle, the adults' trumpeting calls.
- **Mobile**: floating joystick, thumb-sized action buttons, safe-area insets, portrait and landscape, three quality presets (default is 平衡 on touch devices).

## Rebuilding the models

`assets/chick.glb` and `assets/adult.glb` are generated from the source models (each `.glb` plus its `textures/` folder):

```sh
cd tools/chick-model
npm i
node prepare.mjs "/path/to/Baby Emperor Penguin ( Chick ).glb" ../../assets/chick.glb
node prepare-adult.mjs "/path/to/Emperor Penguin Family.glb" ../../assets/adult.glb
```

## Files

```
index.html          UI, styles, import map
src/main.js         setup, game loop, NPC behaviour, HUD
src/world.js        terrain, ice, icebergs, snow material
src/atmosphere.js   sky, sun, environment lighting, fog
src/model.js        GLB download with progress and base64 fallback
src/chick.js        chick loading, clip blending, procedural belly pose
assets/chick.glb    processed chick model
assets/adult.glb    processed adult model
tools/chick-model/  conversion scripts for both models (shared fur repair in fur.mjs)
src/adult.js        adult loading, procedural head, flipper and body pose
src/physics.js      character physics
src/prints.js       footprints and belly trails
src/snow.js         falling and blowing snow particles
src/weather.js      weather states, wind and gusts
src/controls.js     camera and input
src/audio.js        synthesized sound
```
