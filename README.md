# EPISTASSI — THE LISTENING / THE BACON DIRECTOR (3.2)

A first-person psychological horror investigation in a fictional stretch of the Po Valley. Start from a rural farmhouse: thirteen people are waiting to empty themselves so that an unheard recording can fill them. The album itself is never played. The game builds its threat from the bodies, the rooms, the industrial objects, the history of a closed choir room and the need to be heard.

## Run locally

- macOS: double-click `start-local.command`.
- Windows: double-click `start-local.bat`.
- Or run `python3 -m http.server 8765` in this folder and open `http://localhost:8765/`.

Use a current desktop browser with WebGL. Do not open `index.html` as a `file://` document. Three.js 0.160.0 is loaded from a pinned jsDelivr URL, so an Internet connection is required for the 3D engine and for credited archival portraits. Procedural characters remain as fallback if portrait images cannot load.

## Controls

- WASD / arrows: move.
- Mouse: look; if pointer lock is refused, hold left mouse and drag.
- E: interact, examine, speak or operate.
- Z: zoom into the currently targeted object or person; X: return to normal view.
- F: flashlight; Shift: run; Q: hold breath.
- Tab: journal; M: toggle sound.
- 1 / 2 or click: dialogue choices; Esc: close dialogue.

## Story and systems

- **Thirteen cult members** live in the farmhouse. Their fates are attached to discoveries and decisions; the final roll-call stages their visible departure before the endings.
- **The Fourteenth** is an elongated, cage-framed presence that approaches from behind the player. Looking directly at it makes it withdraw. Its distance drives the drone, pulse and distant footstep layers; the closer it gets, the more urgent the sound becomes.
- **Francis Bacon–influenced staging**: asymmetrical, elongated bodies; red wire cages; compressed stage-like rooms; hard pools of warm practical light against cold fill; distorted faces and suspended forms. This is an original interpretation of those broad visual qualities, not a recreation of a specific painting.
- **Practical lighting**: flickering candles and lamps in the farmhouse, church, ruin, slaughterhouse, cellar and cemetery; red and sickly side-light in enclosed scenes.
- **Windows as scenes**: inspect the farmhouse and ruin windows to witness short, impossible actions happening behind the glass. They add consequences to the preserve ending.
- **Grave mission**: retrieve the spade in the abandoned house, then dig Elena Bassi's grave in three stages. Her medical file links the 1977 choir deaths to carbon monoxide.
- **Canal-pump mission**: find the missing organ crank in the church and use it to stop the pump by the canal. The pump log adds another piece of the hydraulic connection.
- **Ventilation mission**: with both records recovered, open the blocked church duct. The grave report, Sergio's testimony and the open vent together make the factual ending more complete.
- **Dialogue matters**: Ines's trust, Sergio's confession, Ottavio's listening lesson and the choice to challenge or accept Dario/the Primo change later dialogue and ending text.
- **Four endings**: three primary choices remain; a fourth witness ending is unlocked only by finishing all three side missions and making the required dialogue choices (Ines trusted, Ottavio's audio lesson accepted, Sergio's truth heard, and the leader challenged).
- **Sound**: Web Audio generates wind, machine bearings, chains, valves, hinges, mechanical clicks, distorted low drones and proximity footsteps. NPC speech uses browser Italian speech synthesis with slow pitch/rate, radio-like interference, low mechanical layers and a short whispered tail. The exact voice quality depends on installed browser voices.
- **Inspection**: Z temporarily narrows the camera field of view while a target is active; X resets it. The effect is intended for looking at faces, mechanisms, windows and evidence before interacting.
- **Weather and time**: the base Po Valley landscape, crops, fog, rain, lightning and accelerated day/night cycle remain active; the cemetery also inherits exterior weather and night ambience.

## GitHub Pages

1. Keep `index.html` at the repository root.
2. In Settings → Pages, choose **GitHub Actions** as the source.
3. Push to `main` or run the Pages workflow from Actions.
4. Open the Pages URL after deployment succeeds.

The Pages workflow assembles `_site/` and deploys it. It does not require a local `node_modules` directory.

## Quality checks

The CI workflow runs `node --check js/game.js`, prepares the Pages folder, and checks that the HTML entrypoint, styles and game module are included. The game uses no analytics or fingerprinting code. A browser's generic anti-fingerprinting notice may still be associated with ordinary Canvas/WebGL rendering.

## Assets and rights

Archival photo fragments are credited in `ASSET_CREDITS.md` and loaded from Wikimedia Commons at runtime. They are used as altered, non-documentary fragments in a fictional game. Source-host availability and image rights labels can change; see the credits file for source pages and caveats.
