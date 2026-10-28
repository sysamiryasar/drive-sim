# 3D model credits

| Folder | Source | License |
|---|---|---|
| `vehicles/*.glb` (all except `ferrari.glb`), `vehicles/Textures/`, `props/` | [Car Kit](https://kenney.nl/assets/car-kit) by Kenney | CC0 1.0 — see `vehicles/Kenney-Car-Kit-License.txt` |
| `characters/` | [Blocky Characters](https://kenney.nl/assets/blocky-characters) by Kenney | CC0 1.0 — see `characters/Kenney-Blocky-Characters-License.txt` |
| `vehicles/ferrari.glb`, `vehicles/ferrari_ao.png` | "Ferrari 458 Italia" by **vicent091036**, as bundled with the [three.js car example](https://threejs.org/examples/#webgl_materials_car) | Attribution required. three.js credits the author and links the original Sketchfab listing, which is no longer online, so the exact license could not be re-checked. Fine for this free, non-commercial prototype with credit; confirm the license before any commercial use, or swap the file for another model. |

The game loads these at runtime (`entities.js` → `MODEL_FILES`). Any missing file
falls back to the procedural primitive models, so the folder is optional.
