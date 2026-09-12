# social/ — the Instagram kit

How tuagente.uy content for Instagram gets made. Ask Claude for a post (the
`ig-post` skill, see `.claude/skills/ig-post/SKILL.md`) and it comes back
rendered: PNGs at Instagram size, a caption, alt text, all on brand.

| File | What it is |
|---|---|
| `brand.md` | the identity: audience, voice, allowed claims, pillars, visual rules, caption formula. **Read it before writing a single line of copy.** |
| `templates/` | five HTML templates (`statement`, `job`, `chat`, `list`, `stat`) plus the shared `base.css` with the themes |
| `render.mjs` | `post.json` in, PNGs out. Headless Chrome, no dependencies |
| `fonts/` | Plus Jakarta Sans, the same face as the landing and the portal |
| `posts/<date>-<slug>/` | one folder per post: `post.json`, `caption.md`, `NN.png`, and `.build/NN.html` for tuning by eye |

## Render

```bash
node social/render.mjs social/posts/2026-09-12-que-le-pedis          # every slide
node social/render.mjs social/posts/2026-09-12-que-le-pedis --only 3 # one slide
```

Requires Google Chrome at its default macOS path, or `CHROME=/path/to/chrome`.
The mascot is drawn by `app/app/lib/agentito-svg.mjs`, the same module the
product uses, so it cannot drift.

## post.json

```json
{
  "format": "feed",             // feed 1080x1350 (default) | square | story
  "theme": "violet",            // violet | ink | light | tonal-violet | tonal-green | tonal-coral | tonal-amber
  "look": { "tone": 3 },        // optional agentito axes; default is the brand look
  "slides": [
    { "template": "statement", "theme": "ink", "eyebrow": "...", "title": "... <em>accent</em>",
      "body": "...", "cta": "...", "hint": "...", "agentitoSize": "lg", "alt": "..." }
  ]
}
```

Per-slide fields by template:

- `statement`: `eyebrow`, `title`, `titleSize` (`md`/`sm`), `body`, `cta`, `hint`, `agentitoSize` (`lg`/`xl`/`none`)
- `job`: `eyebrow`, `title`, `body`, `never` (the text after the bold "Nunca")
- `chat`: `eyebrow`, `title`, `body`, `agentName`, `agentStatus`, `messages: [{from: owner|agent, text}]`, `cta`, `hint`
- `list`: `num`, `eyebrow`, `title`, `body`, `bullets: [..]`, `cta`, `hint`, `agentitoSize`
- `stat`: `eyebrow`, `value`, `valueSize` (`md`), `label`, `body`, `cta`, `agentitoSize`

Every slide carries `alt`. A slide's `theme` overrides the post's. The counter
`n/N` appears on its own when there is more than one slide (`"counter": false`
hides it).

## Adding a template

Copy the closest one in `templates/`, keep `{{head}}` and `{{foot}}`, use the
classes in `base.css` before inventing new ones, render a post with it and
look at the PNG. Document its fields here and in the skill.
