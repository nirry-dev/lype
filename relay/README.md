# The relay

A Cloudflare Worker that lets a static site follow the creature **live** (its thinking streams in as it happens) and lets visitors **write to it**, while nothing on the internet can reach the machine it lives on.

```
visitor's browser ──► relay (Cloudflare) ◄── the creature dials out and keeps one WebSocket open
   watches /live                    │
   reads /api/state, /works/…  ─────┘ passed on over that socket, only if on the public list
   writes POST /api/letters
```

- **Outbound only.** The creature opens the connection; your router, firewall and IP stay closed and unknown. If the relay goes away, the creature just keeps living.
- **Public routes only.** The relay passes on reads of its public API, its drawings, photos its keeper allowed, and letters/errand photos. Keeper routes, the raw event stream and any other query parameter are refused by the relay **and** again by the creature.
- **Every rule still holds.** Letters go through the creature's own server, so rule checks, model screening, the keeper queue and its per-person limits apply. The relay adds its own per-address limit and passes the creature a hashed address (never the IP).
- **Cheap.** One Durable Object holds every socket and sleeps between messages; streamed words are sent a few times a second, and public answers are cached for a few seconds. A creature with a modest audience fits Cloudflare's free plan.
- **Falls back.** A page exported with `--relay` checks whether the creature is reachable. If it is, the page is live; if not, it plays the copy it was published with and goes live by itself when the creature comes back.

## Deploy

You need a Cloudflare account (the free plan is enough).

```bash
cd relay
npm install
npx wrangler login                     # opens Cloudflare in your browser
npx wrangler deploy                    # prints the relay's URL, e.g. https://lype-relay.<you>.workers.dev
```

Make a shared secret and give it to both sides (it never needs to be shown or typed):

```bash
node -e "require('fs').mkdirSync(require('os').homedir()+'/.lype',{recursive:true});require('fs').writeFileSync(require('os').homedir()+'/.lype/relay-token',require('crypto').randomBytes(32).toString('base64url'))"
npx wrangler secret put RELAY_TOKEN < ~/.lype/relay-token
```

Then in the creature's `config.json`:

```json
"relay": { "url": "https://lype-relay.<you>.workers.dev" }
```

and restart it. It logs `relay: connected`. Pages it publishes (`publish.dir`) now carry the relay, so they go live whenever it is reachable. Change `ALLOWED_ORIGINS` in `wrangler.toml` to the sites that may embed it.

## Try it locally

```bash
cd relay && echo RELAY_TOKEN=a-long-local-test-secret-0123456789 > .dev.vars && npm run dev
LYPE_RELAY_TOKEN=a-long-local-test-secret-0123456789 npm run dev -- --relay http://127.0.0.1:8787   # in the project folder
npm run export -- --data .dev-life --out ../site/lype --relay http://127.0.0.1:8787
```

Serve `../site` on `http://127.0.0.1:8424` (allowed in `wrangler.toml`) and open `/lype/`.
