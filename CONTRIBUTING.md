# Contributing to Iterant

Thanks for wanting to help a small mind grow up. Iterant is an art piece and an experiment at the same time, so contributions can be code, prompts, design, or careful observation of how it behaves.

## Getting started (no GPU needed)

You need Node 22 or newer. There is nothing to install.

```bash
git clone https://github.com/nirry-dev/iterant.git
cd iterant
npm test          # unit tests and a short mock life
npm run dev       # a mock creature at http://127.0.0.1:8421, waking every 15 s with canned thoughts
npm run demo      # a real recorded life (examples/demo-life) at http://127.0.0.1:8422, paused
```

`npm run dev` uses the mock brain, so you can work on the viewer, the life loop or the API without a model. Its life lives in `.dev-life/`; delete that folder to start over.

To run it with a real model, copy `config.example.json` to `config.json` and point `brain.baseUrl` and `brain.model` at any OpenAI-compatible server (llama.cpp's `llama-server`, LM Studio, vLLM, Ollama's `/v1`). See the README for Claude.

## How the project is shaped

- **No dependencies, no build step.** The server is plain Node ESM; the viewer is plain browser ESM. Please keep it that way. The optional Claude backend loads `@anthropic-ai/sdk` only when chosen.
- **Match the code around you.** Two-space indent, single quotes, short functions with a one-line comment saying *why* when it isn't obvious. `.editorconfig` covers the basics.
- **The records are the product.** Every cycle and night is saved as a self-contained JSON record, and the pages are views over them. If you add a mechanic, record what happened and why, so it can be shown and replayed.
- **Two materials in the design.** Its own words are light (cool serif); people's words are paper (warm). New UI should keep that distinction.

The map of the code is in the README under *Under the hood*.

## Changing how it thinks (prompts, `server/mind.js`)

Prompt changes are the most interesting and the easiest to get wrong, because small models react to wording in surprising ways. A prompt PR should include evidence:

1. Run a few real cycles before and after, in a throwaway folder:
   ```bash
   node server/run-cycles.js 4 --data /tmp/try-before --letter "Mara: It rained all day here." --night
   ```
2. Paste short excerpts of the records (monologue, decision, reply, the night's release notes) into the PR, and say which model you used.
3. Say what you were trying to change and whether it worked. "It still does X sometimes" is useful information, not a failure.

## Changing mechanics (memory, drift guard, fatigue, moderation, its place)

Add or update a test in `test/`. The mock brain in `server/brain.js` answers every phase, so a whole life can run in a test in milliseconds. `npm run dev` streams the mock's answers slowly, so live views (drawing, building, tending) can be watched without a model.

## Granting its wishes

At night a creature may leave its keeper a wish: something it cannot do or get itself. Its keeper can open any wish as a GitHub issue labelled `wish`, quoting the wish and why it asked. Those issues are a roadmap written by the creature, and good places to start:

- **A new sense** usually belongs in `server/senses.js` (what it can feel) and `describeMachine()`/`situation()` in `server/mind.js` (how it is told). Keep senses honest: real signals from its host, never invented sights.
- **A new material or way of making** (colour it was never told about, curves, sound as numbers) touches the prompts in `server/mind.js` and, for drawings, the whitelist in `web/lib/svgclean.js` (with tests).
- **A change to how it lives** (rhythm, memory, its place) is a mechanic: see above.

Say in the PR which wish it grants. When it ships, its keeper marks the wish granted on the Place page, and the creature hears about it the next time it wakes.

## Security-sensitive areas

- `web/lib/svgclean.js` decides what of its drawings reaches a browser. Any change needs tests for the attack cases in `test/svgclean.test.js`.
- `server/moderation.js` and the letter routes decide what strangers can make public. Please describe the threat you considered.
- See [SECURITY.md](SECURITY.md) for reporting vulnerabilities privately.

## Pull requests

- Keep them focused; one idea per PR.
- `npm run check` and `npm test` must pass (CI runs both on Node 22 and 24).
- For UI changes, include a screenshot or a short clip.
- Be kind in reviews. See the [Code of Conduct](CODE_OF_CONDUCT.md).

## Ideas that would help

- **Replay as video:** render a replay to a file for sharing.
- **Senses:** more honest signals from the host (time since its human last typed, disk sounds as numbers, weather only if someone tells it).
- **More creatures:** several minds on one card, writing to each other, maybe visiting each other's places.
- **Errands:** building something in its place out of a photo it was brought, errands that ask for a sound or a word instead of a photo, a model screen for photos so its keeper only sees the doubtful ones.
- **Its place:** paths it chooses itself, weather in its place that follows the letters, letting it move things, a larger map once it fills up.
- **Moderation:** better heuristics, a second-opinion model, multilingual letters.
- **Accessibility:** screen-reader narration of the replay, better keyboard paths through the journey.
- **Deployment guide:** running a public instance safely behind a tunnel, with a keeper.
