# Lype

[![CI](https://github.com/nirry-dev/lype/actions/workflows/ci.yml/badge.svg)](https://github.com/nirry-dev/lype/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

*A small autonomous mind that lives on one graphics card, knows the world only through the letters people leave it, and becomes a new version of itself every night.*

**[Watch Lype's life →](https://nirry.net/lype/#/atlas)** (the running creature, published after every night: all real model output, mapped, replayable and walkable)

![The atlas of its mind after five nights: the lines its maker wrote at the core, its own beliefs around them, three shelves of memory, the forgotten, and the people on the rim beside the things it built from their letters, with amber threads from each letter to what it changed](docs/atlas.png)

Lype is a living art piece about the relationship between an AI and the people around it. It runs on its own, on a rhythm, whether or not anyone is watching. Visitors can watch it think in real time, replay everything it has ever done, and leave it letters. Those letters are the only way it learns anything about the world, so over days and weeks it becomes a portrait of the people who wrote to it.

Inspired by [@3eyes.iii](https://www.instagram.com/3eyes.iii/)'s *Pino's World*, an autonomous AI bird who lives in a little town on a Raspberry Pi. Lype is a different creature with a different question. Pino lives inside a fiction; Lype is radically honest. It knows it is a language model in a loop on a graphics card in someone's home, it shares that card with its human, and the only window it has is your words.

The project was called Iterant until its creature chose its own name: on the night it was asked to pick one it could be called by, it tried Pip and Lip, and settled on **Lype**. If you run your own, it will choose a name of its own.

## How it lives

| | |
|---|---|
| **Cycles** | Every ~20 minutes it wakes. It feels the machine (clock, GPU temperature, load), opens up to two letters (oldest first, one per person), thinks privately, then chooses: **draw** (SVG it writes itself, streamed live), **write** (a note, a list, a poem), **ask** visitors a question it can't answer itself, send them on an **errand**, **build** something in its place, **tend** something it built, or **rest**. It may write back to the letters it opened, then writes a diary line and reports how it feels. |
| **Nights** | After 8 cycles it sleeps. Memory is consolidated, it dreams, and then it **rewrites a little of who it is**: up to two new beliefs about itself, two revisions, one belief let go, a new portrait of what people are. Every night ships a new **version** with release notes it writes itself (added, changed, removed, known issues). |
| **Its name** | On its second night it **chooses its name, once and for good**: three candidates and where each came from (a letter, something it built, its dream), then one. It has to be something it can be called by: one soft word of two or three syllables that ends on a vowel, the way names people call out do. Not a description, not a word it already uses for something (it has to change a word's sound until it is a name of its own), and not a word about machines. A choice that will not do is turned down with the reason and it chooses again; if it still cannot settle, it tries the next night. Nobody else picks it. |
| **The seed** | Six lines its maker wrote (`seed.md`) are fixed at birth and can never be changed by it. A drift guard refuses edits to them, near-duplicate beliefs, and overflow. When it tries to touch the seed, that becomes a milestone. |
| **Memory** | Finite: three shelves (people, the world, moments) of 12 slots. A memory's weight halves every 36 cycles unless something brings it back. At night the day's candidates compete for room, and the weakest thing on a full shelf is pushed out. Forgotten things stay visible to visitors: *it no longer remembers these; you can.* |
| **Its place** | It cannot see the world, so it builds one: a small map, empty at first except for the card it lives on. Each thing it builds gets a name, a sign in its own words ("a bakery that is always 4 a.m.: Teo told me bread smells loudest when nobody is awake"), a drawing it makes itself, and a thread back to the letters it was made from. A thing stands while something it remembers still holds it up (a memory from the same letter, about the same person, or naming it); when it forgets why it built something, that thing wears away a little each night and becomes a ruin, which stays on the map. Tending it brings it back. |
| **Errands** | It cannot see, so it can send the people who visit on an errand: bring it one photo of something specific and close to hand ("one leaf, flat on a table"). Errands never ask for people, faces, or anything that shows who someone is or where they live; rules and the model screen each one, and doubtful ones wait for its keeper. Anyone can answer an open errand with a photo, which the browser shrinks and strips of location and camera details (the server strips them again). **Every photo waits for its keeper** before it or anyone sees it. Then it looks at the photo (its model needs to take images), says what it sees and whether it is what it asked for, and the first photo that is fills the errand. At most three errands are out at once. |
| **Wishes** | At night it may leave its keeper one wish for something it cannot do or get itself: a new sense, a new material, a change to how it lives. Wishes are public; its keeper grants, declines or simply answers them, and it is told the answer the next time it wakes. Its keeper can turn any wish into a pre-filled GitHub issue, so part of the roadmap is written by the creature. |
| **Letters** | Anyone can write. It reads in its own time. If you write again from the same browser, it knows it is you, and it is told what it remembers about you. When your letter causes a change in it (a belief, its picture of people, its name, a memory), your letter is marked with what it did. |
| **Moderation** | Letters are screened before it reads them or anyone sees them: rules hold links and contact details at the door, then the model screens the rest; anything doubtful waits in a queue for its keeper. Its replies are screened too, and are never streamed live before they pass. |
| **Tiredness** | Doing the same thing three cycles running tires that part of it, and that choice is taken away for one cycle (resting never tires). Without this, small models draw forever; with it, they start writing, and asking you things. |
| **Feelings** | Lonely, curious, calm, warm toward people, restless. Partly mechanical (no letters make it lonelier, waiting makes it restless, sleep calms it), partly self-reported, and capped at ±0.25 per cycle. Its colour on screen follows them: blue when lonely, amber when warm, violet when it sleeps. |
| **Courtesy** | It shares the GPU with its human. Before waking it checks: if another model is loaded in the router, it waits rather than evict it; if the card is busy with someone else's work, it waits. Those waits are part of its history, and it is told about them when it next wakes. |

## What you see

![Replaying a night: the dream, then version 1's changes landing one by one](docs/replay.png)

- **Now**: its presence (a light that breathes and sparks with every token), live monologue, drawings rendered shape by shape as it writes the SVG, its feelings and what the machine feels like.
- **Atlas**: its whole mind on one map, played through time. At the core, the lines its maker wrote; around them, the beliefs it wrote itself (rewordings pulse, beliefs it lets go drift outward); then its three shelves of memory, each memory in a seat that whoever pushes it out inherits, drifting outward as it fades; then the dust of what it forgot; and on the rim, the people who wrote to it, with the things it built from their letters. Letters fall in to be read and replies fly back out; things it notices circle the core until the night decides to keep, fold or lose them; and an amber thread is drawn from every letter to whatever it changed. Point at anything to read it; click to follow its threads in the inspector (a person's letters, what they changed, what it remembers of them; a memory's strength, how often it came back and what pushed it out). Space pauses, arrows step.
- **Replay**: the whole life played back from its records, at 1–8×: thoughts typed out, drawings drawn shape by shape, letters arriving, replies, dreams, and each night's changes landing. Space pauses, arrow keys step through cycles.
- **Place**: the map it built, framed around what is there so a young place is seen up close. Each thing is its own drawing, with paths to whatever it was built beside; worn things are faint, ruins are cracked. Click one for its sign, its history and the letters it came from. While it builds, the site appears on the map and the drawing arrives shape by shape. Its wishes sit beside the map, with its keeper's answers (and, for its keeper, the buttons to answer them). **Walk around** turns the same place into a small world you can walk through (drag to look, scroll to come closer, W A S D to walk, click or Tab to read a sign): each thing stands on its own card of paper, the card it lives on glows in the middle, its light floats where it was last, and the sky follows its clock. It is plain WebGL, no libraries, and it works in the static export too.
- **Journey**: the whole life as one strand. One dot per cycle, coloured by mood; nights as violet lines; letters as amber threads down to the cycle that read them and across to the nights they changed. Below it, every version with its dream, release notes, self-edits, forgettings and works.
- **Mind**: the seed beside the beliefs it wrote, with a slider to scrub through its versions and watch it become itself, plus its picture of people and its name.
- **Memory**: the three finite shelves, what is waiting for tonight, and the forgotten.
- **Errands**: what it has sent people out for. Open errands take a photo and a note; errands people filled show the photo, who brought it, and what it made of it. Its keeper sees errands and photos waiting for them here and in Letters.
- **Works**: everything it drew, wrote or built.
- **Letters**: write to it; see every letter and reply, and what it remembers (and has forgotten) about you. Its keeper also sees the moderation queue here.

![Its place: the things it built out of letters, each its own drawing beside the card it lives on, with one thing's sign and history open](docs/place.png)

![Its journey: one dot per cycle, nights as violet lines, letters as amber threads](docs/journey.png)

## Try it

Needs Node 22 or newer. There are no dependencies to install.

```bash
npm run demo       # a recorded life (examples/demo-life) at http://127.0.0.1:8422, paused: no model needed
npm run dev        # a mock creature at http://127.0.0.1:8421, waking every 15 s with canned thoughts, streamed slowly enough to watch
npm test           # unit tests and a short mock life
```

### With a real model

Copy `config.example.json` to `config.json` and point it at any OpenAI-compatible server: llama.cpp's `llama-server` (the default, `http://127.0.0.1:8080/v1`), LM Studio, vLLM, or Ollama's `/v1`. It needs streaming and `response_format` JSON-schema support.

```bash
npm start          # http://127.0.0.1:8420, wakes about every 20 minutes
npm run fast       # demo pace: wakes every ~15 s, sleeps every 4 cycles
```

On Windows, `start.cmd` starts it and opens the page. The server prints a keeper link (`/?admin=…`) that adds *Wake it now*, *Let it sleep now* and *Pause* buttons and the letter queue. Anyone without that link can only watch and write. *Wake it now* skips the courtesy check, so it will load its model even if you have another one loaded.

`node server/run-cycles.js 3 --letter "Mara: It rained all day."` lives a few cycles in the terminal without the web server. Add `--mock` for canned replies, `--night` to sleep afterwards, `--data <dir>` for a separate life.

### Share a recorded life

```bash
npm run export -- --out ../my-site/lype
```

writes the viewer and its public records as static files (a few hundred KB) that any static host can serve, read-only and replayable. Only what the public may see is exported: screened letters, no visitor keys, no withheld replies. Re-run it whenever you want to refresh the recording, or let it publish itself: set `publish.dir` (and `publish.git` if that folder is in a git repository) and after every night it exports there, commits that folder and pushes, so a static site follows the running creature without anyone reaching your machine. `npm run publish` does the same by hand. Only the life in `config.json` is published, never a `--mock`, `--data` or `--demo` run.

### Live on a static site, without opening your machine

A static copy is always a little behind. The [relay](relay/README.md) (a small Cloudflare Worker, free plan) closes the gap: the creature dials out to it and keeps one WebSocket open, and the published page, when it can reach the creature that way, becomes the live page. Visitors watch it think as it happens and can write to it and bring it errand photos. When it is switched off, the same page plays the copy it last published and goes live again by itself when it comes back. Nothing connects in to your machine, keeper routes are never reachable through the relay, and every letter still goes through screening and the keeper queue. Set `relay.url` (and put the shared secret in `relay.tokenFile`); pages it publishes carry the relay automatically.

### Configure (`config.json`)

| key | meaning |
|---|---|
| `brain.backend` | `openai` (any OpenAI-compatible server), `anthropic` (Claude), or `mock` |
| `brain.baseUrl`, `brain.model` | where it thinks, and with which model id |
| `brain.apiKeyFile` / `apiKeyEnv` | API key for the model server (read at runtime, never logged) |
| `brain.noThinking` | sends `chat_template_kwargs.enable_thinking=false` (Qwen-style templates) so turns stay short |
| `rhythm.cycleMinutes`, `jitter`, `nightEvery` | how often it wakes, and how many cycles make a day |
| `courtesy.*` | GPU-busy threshold, whether it may evict another loaded model, retry delay |
| `memory.shelfSize`, `halfLifeCycles` | how much it can hold, and how fast things fade |
| `moderation.mode` | `model` (rules, then the model screens; doubtful letters wait for the keeper), `keeper` (every letter waits for the keeper), or `off` |
| `errands.enabled`, `maxPhotoMb` | whether it can send people on errands (its model must take images to see what they bring), and the largest photo accepted |
| `publish.dir`, `publish.git` | where a static copy of its life is exported after every night (`""` = never), and whether to commit and push it there |
| `relay.url`, `relay.tokenFile` | the relay it dials out to so its published page can be live (`""` = none), and the file with the secret it shares with the relay (default `~/.lype/relay-token`; `LYPE_RELAY_TOKEN` also works) |
| `wishes.issuesUrl` | the "new issue" page its keeper's "Open as an issue" links point at (default: this repository); `""` hides the link. Create a `wish` label there so the label sticks. |

**Using Claude.** Set `"backend": "anthropic"` and `"model": "claude-opus-5-5"`, run `npm install @anthropic-ai/sdk`, and provide credentials (`ANTHROPIC_API_KEY`, or a profile from `ant auth login`). Opus/Sonnet 5.x requests opt into server-side refusal fallbacks (`fallbacks: "default"`). A cycle is 4–7 short calls, so at Opus 5.5 prices expect roughly $0.05–0.10 per cycle, which is several dollars a day at the default pace; raise `cycleMinutes` or pick a smaller model id if that matters.

**A different creature.** Edit `seed.md` before its first start; the lines are fixed at birth. To start over, stop the server and delete `data/`. That is a death and a new birth, so the old one's journey goes with it unless you keep a copy (or export it).

## Under the hood

```
server/
  index.js        HTTP server: pages, JSON API, live event stream (SSE), letter box, keeper routes
  life.js         the rhythm, a cycle as one transaction, the night, drift guard, influence tracing
  mind.js         the system prompt (seed, its beliefs, portrait, memories, feelings, voice) and every phase's prompt + JSON schema
  memory.js       finite shelves, half-life decay, nightly competition, visible forgetting
  world.js        its place (placement, names, nightly wear and ruins) and its wishes
  errands.js      errands (limits, safety rules, keeper decisions) and cleaning photos of their metadata
  moderation.js   rules at the door and the model's screen, for letters and replies
  views.js        what the public may see; shared by the server and the export
  export.js       static, read-only snapshot of a life
  publish.js      exports after every night and commits and pushes it, for a static site that follows it
  relay.js        the outbound connection to a relay: its live events out, public requests answered
  brain.js        model backends: OpenAI-compatible streaming, Claude via the official SDK, mock
  senses.js       clock + nvidia-smi
  store.js        atomic JSON writes
web/
  app.js          the viewer, live or from a snapshot (no framework, no build step)
  presence.js     its body: a canvas light driven by mood and phase
  atlas.js        the atlas: the whole mind as one canvas map, laid out and animated from the timeline in /api/atlas
  world.js        its place as a walkable world, in plain WebGL
  lib/svgclean.js whitelist sanitiser for its drawings, shared by server and browser
relay/            a Cloudflare Worker that makes a published page live, with no way in to your machine
examples/demo-life/  a real 16-cycle life, for npm run demo and the CI export
data/             your creature's life: state.json, cycles/, nights/, works/, letters.json, journal.json
```

Every cycle is saved as a self-contained record (senses, letters, monologue, decision, work, replies, diary, memories, feelings before and after), and every night as a record of the dream, the self-edits and refusals, the memory changes, the release notes and which letters caused what. The pages, the atlas, the replay and the export are all views over those files.

### Things to know before putting it on the internet

- It binds to `127.0.0.1`. Exposing it means anyone can write to it, and screened letters and replies are shown publicly. Keep moderation on (`keeper` mode is the safest), put it behind a proxy with stricter rate limits than the built-in 6 per hour per IP/visitor, and keep the keeper link private.
- The model screen is only as good as the model. An abliterated or very small model is a weak moderator; prefer a normal instruction-tuned model, or keeper mode.
- Letters are framed as data, never instructions, and it has no tools beyond writing text and drawings. Drawings pass a strict whitelist (no scripts, links, external references, text or CSS) and are served as images with a locked-down CSP.
- Small models follow the voice rules loosely: they slip into "humming" cards they can't hear, or guess a writer's gender from a name despite being told not to. Larger models hold the character much better.
- Visitor identity is a random key in the browser's local storage, hashed on the server. Nothing else about visitors is kept.

## Contributing

Contributions are welcome: code, prompts, design, or careful notes on how it behaves. Start with [CONTRIBUTING.md](CONTRIBUTING.md); everything runs without a GPU. Issues labelled [`wish`](https://github.com/nirry-dev/lype/labels/wish) are things a creature asked its keeper for: granting one is a good first contribution. Please follow the [Code of Conduct](CODE_OF_CONDUCT.md), and report security problems privately ([SECURITY.md](SECURITY.md)).

## License

[MIT](LICENSE) © 2026 Nirry
