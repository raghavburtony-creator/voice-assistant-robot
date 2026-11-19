# Echo's robot

Echo is drawn by the 3D robot companion from the myt Learning Hub (https://learninghub.myt.mu, where it is called Ixia).

> **Permission: read before you ship a project with it.** myt (Mauritius Telecom) gave the NASA Earth Jukebox team permission
> to use the robot in November 2026. That permission was for that app. `robot-companion.js` carries no open-source licence, so
> it is **not** yours to reuse freely. Before you use it in another project, or make this repository public, get myt's
> permission in writing for that use, and save it next to this file. Until then, keep this repository private.
> Credit in any app that uses it: "Robot companion by the myt Learning Hub."

The app drives it from `src/echo/robot/EchoRobot.tsx`. The robot's own chat, tips and greetings are off; Echo's words, voice and
buttons are the app's.

## Files

Copied byte for byte from https://learninghub.myt.mu/robot/ on 13 Nov 2026 (via the Earth Jukebox repository). Do not edit them: drive the robot through its API instead (`say`, `face`, `gesture`, `hush`, `configure`; see the comment at the top of `robot-companion.js`).

| File | What | sha256 |
|---|---|---|
| `robot-companion.js` | The `<robot-companion>` element. **Changed since it was copied:** the Earth Jukebox recorded `d747e125…0624710`, but the file it shipped (and this one) hashes to the value here, so someone edited it there. Ask the team what changed before you rely on it being myt's original. | `4c63eed66328ecbd0d4cf9a6c24fc289dfb8bc4fcfa8fc87f742acc10ba6a9fe` |
| `robot-fx.js` | Its effects, loaded by it on demand | `cea6a09a0d207fbd32eeb11ad113442afe70518da0337e7db929b6a13ec01c01` |
| `vendor/three.module.min.js` | three.js r184 (MIT, © three.js authors) | `d58eb29e87e57583b6cdcfdd6b1823b82ad1024256c6dde07d4947f02e9cd465` |
| `vendor/three.core.min.js` | three.js r184, imported by the module above | `36c9439657066258e6ec370343ef97d2a723f2958ca50a4f23240a4108e1d5a1` |

Made for this app:

| File | What |
|---|---|
| `echo-logo.png` | "echo" on the robot's chest, in place of the myt logo (Atkinson Hyperlegible Bold, OFL; 512 by 256, transparent). |
| `echo-head.png` | A still of the robot's head (256 by 256, transparent), for small badges and favicons. |
| `echo-model.js` | `buildRobot()` copied unchanged from `robot-companion.js` (lines 424-573) as an ES module, for drawing the same robot inside your own three.js scene (not used by the kit). Copy it again if `robot-companion.js` changes. sha256 `1440c055abf10838d3092754de0283c0f3ab2deea1366157f2dbfe882d987ba3` |

The app loads three.js from here (the element's `three` attribute), never from a CDN, and the script only after the first render. Do not lint or edit this folder.
