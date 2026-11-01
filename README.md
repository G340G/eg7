# EPISTASSI — THE LISTENING / THE NEW ARRIVAL (3.3)

A first-person psychological horror game set in the fog of the Po Valley. You are Tobia, a piano tuner called to a farmhouse to tune a harpsichord. The fog closes the road. Thirteen people are waiting for an album called **Il Bianco**. You are the newest arrival — and, without knowing it, the fourteenth place in their order.

The people in the house are not presented as a generic Satanist group. They are lapsed Catholics, people who have lost the object of their belief but kept the forms: the Mass, the confessional, the bell, the altar, the Via Crucis. Their doctrine says that Il Bianco will fill a person so completely that the body cannot survive it. Before the album arrives, each person must be emptied of memory, voice, blood and finally life. The record is never heard. The room around the needle is the listening.

## Run locally

- macOS: double-click `start-local.command`.
- Windows: double-click `start-local.bat`.
- Or run `python3 -m http.server 8765` in this folder and open `http://localhost:8765/`.

Use a current desktop browser with WebGL. Do not open `index.html` as a `file://` document. Three.js 0.160.0 is loaded from a pinned jsDelivr URL. An Internet connection is required for the 3D engine and the credited archival portrait fragments.

## Controls

- WASD / arrows: move.
- Mouse: look; if pointer lock is refused, hold left mouse and drag.
- E: interact, examine, speak through text choices, or operate.
- Z: zoom into the current target; X: restore the normal view.
- F: flashlight; Shift: run; Q: hold your breath.
- Tab: journal; M: toggle environmental sound.
- 1 / 2 or click: dialogue choices; Esc: close dialogue.

**There is no voiceover or speech synthesis.** All character dialogue and narrative text is shown as subtitles. The sound layer is environmental and musical only: industrial motors, wind, chains, valves, distant machinery, footsteps, candle and room ambience, and the approach-driven drone of the Fourteenth.

## Story progression

- **The arrival:** Tobia comes to tune the farmhouse harpsichord. Ines welcomes him without asking why he is there. Ottavio asks him to describe the beating between two strings. The other residents reveal their peculiarities in small domestic exchanges, not explanatory speeches.
- **Il Primo's instructions:** the apparently helpful Il Primo gives Tobia practical tasks. Find a spade and dig Elena's grave. Then light seven candles in the church. He speaks as if he is helping the newcomer understand the house. The tasks quietly prepare the newcomer for the same emptying as the others.
- **The car:** after the grave and candle rites, Il Primo waits by his car. The drive crosses a dim forest at dusk, with distant industrial offices, drilling rigs and smoke behind the trees. At a clearing he turns on Tobia. The player must run through the forest and reach the gate back to the original road. Getting caught ends the game.
- **The confessional:** a discovery in the church reveals that Ottavio has been deaf since 2004. He feels vibration through his palm and has been waiting for someone to tell him whether sound exists. After the confession, a hand rises behind the lattice, apparently detached from any visible body.
- **The album:** in the cellar, inspect the sleeve and the bare acetate marked 14-B / A=415. Its thirteen lines are crossed out; the fourteenth is left blank. The needle is lowered, but Il Bianco is never heard. The room itself — lamp, floorboards, breathing and silence — is the listening.
- **The thirteen:** Ines, Ottavio, Don Remo, Dario, Marta, Sergio, Gabri, Livia, Elia, Noemi, Franco, Pino and Anna each have a distinct relationship to the album and to the act of being emptied. Their fates are staged as ritualised events rather than explained through a lore dump.
- **The Fourteenth:** an elongated, cage-framed presence approaches from behind. Looking directly at it makes it retreat. Its distance drives the low drone, pulse and distant footstep layers; if it catches the player, the recording ends.

## Visual and environmental design

- **Francis Bacon-inspired staging:** elongated, asymmetrical bodies; red wire cages; compressed stage-like rooms; suspended forms; hard warm pools against cold, grey-green fill. The design takes broad visual inspiration without reproducing a specific painting.
- **No skull props:** the hanging bovine forms have abstract, elongated heads and hide-like folds rather than skull-shaped masks.
- **Practical fire:** seven individually lit church candles have layered flame meshes, flicker and smoke. A censer, altar cloth, chalice and worn prayer book build the ritual from recognisable Catholic objects.
- **Relics and evidence:** the newspaper clipping, church order, burned photograph, list, tuning fork, cassette, engraved beam, grave report and album sleeve have distinct physical detailing and markings relevant to what they represent.
- **Windows:** the farmhouse and abandoned-house apertures look out onto trees, drainage ground and a distant industrial complex, rather than an empty black panel.
- **Industry:** offices, lit windows, elevated pipes, drilling structures, chimneys and smoke puncture the Po Valley horizon. A generated mechanical soundscape gives the works a distant, persistent presence.
- **The forest:** a playable route through trees and industrial silhouettes at dusk, with the return road as the escape objective.

## Publishing with GitHub Pages

1. Keep `index.html` at the repository root.
2. In Settings → Pages, choose **GitHub Actions** as the source.
3. Push to `main` or run the Pages workflow from Actions.
4. Open the Pages URL after deployment succeeds.

The Pages workflow runs `npm run check`, which checks JavaScript syntax and prepares the `_site/` deployment folder. The game requires no local `node_modules` directory.

## Notes

- The original album audio is deliberately absent. The game must never play or simulate a track from Il Bianco.
- The title remains **Il Bianco** even though the rest of the interface is in English.
- The screenplay's central ambiguity remains: the cult treats an unheard record as certain salvation, but the audience is not told what is on it. The 1977 choir's possible carbon-monoxide deaths are planted through evidence rather than an explanatory monologue.
- Archival photo fragments are credited in `ASSET_CREDITS.md`. Their availability depends on Wikimedia Commons and an Internet connection.
- The game uses no analytics or fingerprinting code. A browser may still associate ordinary Canvas/WebGL rendering with a generic anti-fingerprinting notice.
