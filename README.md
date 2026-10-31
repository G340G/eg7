# EPISTASSI — THE LISTENING / THE THIRTEEN CUT

A first-person psychological horror investigation in a fictional stretch of the Po Valley. The central idea is a group of thirteen people who want to empty themselves so that an unheard recording can fill them. The album is never played: the game builds dread from the room, the bodies, the objects and the sounds that remain around it.

## Run locally

- macOS: double-click `start-local.command`.
- Windows: double-click `start-local.bat`.
- Or run `python3 -m http.server 8765` in this folder and open `http://localhost:8765/`.

Use a current desktop browser with WebGL. Do not open `index.html` as a `file://` document. Three.js 0.160.0 is loaded from a pinned jsDelivr URL, so an Internet connection is required for the engine and for the credited archival portrait photographs. If those photographs fail, procedural 3D faces remain.

## Controls

- WASD / arrows: move (does not require pointer lock)
- Mouse: look; when pointer lock is refused, hold left mouse and drag
- E: interact, speak, examine
- F: flashlight; Shift: run; Q: hold breath
- Tab: journal; M: toggle sound
- 1 / 2 or click: dialogue choices; Esc: close dialogue

## Narrative systems

- **Thirteen cult members** live in the farmhouse. Their fates are driven by discoveries and decisions: some walk away into impossible thresholds, others collapse in front of the player and leave a stain. At the turntable, every remaining member is brought visibly into the cellar and receives a fate before the final choices unlock; no cultist is removed only by a hidden counter.
- **Il Primo**, the hidden leader, speaks from the slaughterhouse. His dialogue and Dario's earlier words leave his identity uncertain.
- **The slaughterhouse** is a new traversable location: four suspended, sculptural bovine forms, hoists, rusted rails, chains, damp brick, mould, manifestos and a threshold that returns the player to the same room from the wrong side. The imagery takes broad inspiration from Francis Bacon's distorted bodies and enclosed stage-like spaces, without recreating a specific painting.
- **The Po Valley** includes maize cultivation, winter wheat, waterlogged rice plots, canals, poplar-like trees, moving branches, wind, rain, lightning, fog and an accelerated day/night cycle.
- **Eight discoverable documents** lead to the cellar. The new ledger in the slaughterhouse is required; it lists thirteen names against the same time, 03:17.
- **Three final choices** lead to different endings: surrender your name to the empty place, open the windows and expose the carbon-monoxide explanation behind the 1977 deaths, or preserve the recording and the cult's ambiguity. Prior dialogue and the impossible passage change the wording and meaning of certain endings.
- **NPC animation** includes articulated arms and legs, slow walking, weight shifts, blinking eyelids and gaze. Faces retain the archival-photo treatment with procedural geometry underneath.
- **Sound** is entirely generated in Web Audio: wind, room tone, chain and hoist noise, hinges, drawers, clocks, machine bearings, tools, pipes, ratchets, distant knocks and a distinctive cut-air motif at each cultist's death. The forbidden record itself is never played.
- **Cinematic framing** occasionally pulls away from the player's eyes, hides the view behind foreground geometry and briefly stages the player as an observed figure.

## Publishing with GitHub Pages

1. Extract the ZIP and upload all its contents directly into the repository root (`index.html`, `style.css`, `js/`, `.github/`, launchers and scripts).
2. In Settings → Pages, choose **GitHub Actions** as the source.
3. Push to `main` or `master`, or run the workflow manually from Actions.
4. Open the Pages URL after the deployment job succeeds.

The included workflow prepares `_site/` and deploys it. The project does not require a local `node_modules` folder.

## Notes and limitations

- The photographic face fragments use external archival images credited in `ASSET_CREDITS.md`; they are not scraped indiscriminately from random personal profiles.
- NPC speech uses the browser's Italian speech synthesis when available; subtitles are always present.
- All geometric bodies, the carcass room, landscapes, plants, posters and environmental sounds are procedurally created. The bovine figures are surreal sculpture-like forms, not realistic anatomical models.
- The accelerated day/night cycle completes roughly every 4.5 minutes of active play.
- No analytics or browser fingerprint collection is included. The browser may show a generic anti-fingerprinting notice because the game uses WebGL and Canvas for ordinary 3D rendering and textures.
