# Shared toolkit for client agents

What we build once and reuse in every agent we deploy.

## Principle: don't rebuild what Hermes already brings

Confirmed on the real install (`hermes skills list`, `hermes plugins list`):
it already ships **xlsx, docx, powerpoint, pdf, nano-pdf, ocr-and-documents,
google-workspace, notion, himalaya (email), computer-use** and browser
plugins (browser-use, browserbase), out of the box. Writing our own version
of that is burning money.

Our value sits in two layers Hermes can't have:

1. **The skills for the portal contract** — they make any agent look good on
   tuagente without depending on the model remembering conventions.
2. **The LATAM-reality integrations** — what a Uruguayan client asks for that
   no runtime brings.

---

## Layer 1 — Contract skills (generic, go into every agent)

### `artifact` ✅ done
Creates a self-contained HTML visualization that the portal shows on the
Artifacts tab and that can be cited in chat. The script owns the format
(shell, brand CSS, id, path, metadata); the agent only supplies the content.
Hard rule: self-contained, no CDNs, charts with SVG/CSS.

### `deliverable` ✅ done
The agent passes a title, kind and content; the script handles the path, the
dated file name, the front matter, and returns the reference to cite. Internal
files go to `workspace/interno/` and the portal hides them behind a toggle,
so Files only shows what's useful to the client.

### `approval` ✅ done
Always formats the request the same way (what I want to do / what happens if
you approve / what happens if you reject / content to review) and documents
the **sticky-block** rule: you have to block with the block action, never
create the ticket already blocked, because otherwise the permission request
self-unblocks and the task keeps going as if it were authorized. The portal
closes the loop: it can approve with corrections, and that version gets
logged as the client's comment before unblocking.

### `status` — to evaluate
Have the agent report progress on a long task (0-100% + one line), so the
portal shows progress instead of silence.

---

## Layer 2 — Integrations (turned on per client)

- **WhatsApp Cloud API** — Hermes brings it natively (`hermes
  whatsapp-cloud`). It's the channel we'll get asked for the most here.
  What's missing is the onboarding procedure (number, Meta verification),
  not the code.
- **Google Workspace / Sheets** — built in. Many SMBs live in a
  spreadsheet: reading and writing it is usually 80% of the value.
- **Calendly / scheduling** — a webhook so the agent knows when a meeting
  got booked and can build the context beforehand.
- **Billing and collections** — depends on the client. This one actually
  needs code written.
- **ERPs and local systems** — case by case; the reusable pattern is "a
  skill that wraps an API with credentials in `.env` and a script that owns
  the format".

---

## How it's distributed

A `hermes-kit` repo with layer 1's skills + `portal_adapter.py`, and an
onboarding script that copies it into the new agent's `data/`.

The **conformance check already exists**: `tools/portal-check.py`. It hits a
deployed agent and verifies the manifest, auth, CORS (adapter and gateway),
that every declared module actually responds, that files get served as
`text/plain`, that the chat proxy is up, and the workspace conventions. It
writes nothing. Against the fixture agent: 13 ok, 0 failures.

```bash
python3 tools/portal-check.py --key <API_SERVER_KEY>
```

## Installing a skill: how it actually works

**Correcting a previous, wrong conclusion.** We'd noted that local skills
"don't get auto-discovered". That's false: Hermes discovers them on its own.

The mechanism (verified 2026-08-04): `data/.skills_prompt_snapshot.json`
stores, alongside the index injected into the prompt, a `manifest` with
`{path of each SKILL.md: [mtime_ns, size]}`. It's a **change detector**: when
a file doesn't match, Hermes rebuilds the index **on its own** — no
commands, no restarts. Our three skills showed up on their own ~20 minutes
after we created them. The test that returned "that skill doesn't exist" fell
inside that window, and that's where the wrong conclusion came from.

**The real bug was something else, and it WAS ours: `SKILL.md` with no
frontmatter.** Without it, the skill gets indexed with `description: ""` —
the agent sees the name and nothing telling it what it does or when to use
it. Every skill of ours has to start like this:

```yaml
---
name: <slug>
description: "What it does + WHEN to use it. It's the only thing the agent
              reads to decide whether to open it."
version: 1.0.0
---
```

**What's left in the SOUL, then:** not the skill catalog (the index handles
that), but the **business rules** — what needs approval, where each thing
goes, when an artifact is worth it. Documenting the exact command in the
SOUL still helps reinforce the critical skills, but it isn't the mechanism.

## The lesson that runs through all of this

The model supplies the words; the code supplies the format. Every time we
relied on a convention written in prose in the SOUL (where to save things,
how to title them, what "blocked" means), it broke. Every time we put it in
a script, it held.
