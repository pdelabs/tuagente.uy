# Auxiliary models per client (OpenRouter + dedicated keys)

Luis's decision (2026-08-06): **each client has their own OpenRouter API key**,
and the agent knows that capability exists — it can use models other than its
own for one-off tasks: transcribing audio, generating or describing an image,
an isolated heavy-reasoning call.

## The real model (refined 8/6/2026, first rollout: East)

**"tuagente" organization on OpenRouter** (inside Luis's login) + **one key per
client** created via the Management API, with its own spend limit:

- The client NEVER touches OpenRouter (same principle as Google: zero
  consoles). tuagente pays for everything included; the credit pool belongs to
  the org.
- Each client's key has a name, a USD limit, and its own spend chart in
  Activity → free per-client auditing, and a leaked key only compromises ONE
  client and gets rotated with a `PATCH`.
- Automatable rollout: `POST https://openrouter.ai/api/v1/keys` with
  `{"name": "<client>", "limit": N}` and auth from the management key
  (`tuagente.uy/.secrets/openrouter_provisioning.key`). The management key is
  admin-only: it can't be used to call models.

## Division of responsibilities (the usual principle)

**The skill decides the provider and the model; the agent only says what it
needs.** If the agent picked its own model, each run would use a different one
and cost would be unpredictable. Each capability is a kit skill with the
provider fixed in code:

| Capability | Provider v1 | Env | Note |
|---|---|---|---|
| Agent's LLM | OpenRouter (Luna) | `OPENROUTER_API_KEY` | already exists |
| Transcription (STT) | **OpenRouter — VERIFIED 8/6/2026** | `OPENROUTER_API_KEY` | see below |
| Image generation | OpenRouter (image models) | `OPENROUTER_API_KEY` | check available models when building the skill |
| Image/video analysis | vision-capable model via OpenRouter | `OPENROUTER_API_KEY` | |

Don't promise a capability in a client's SOUL until its skill exists and has
been tested with real material from that client.

## Transcription via OpenRouter (verified live, 8/6/2026)

Luis was right: OpenRouter added `transcription` as an output modality (14
models: `openai/whisper-large-v3`, `deepgram/nova-3`, Voxtral, Qwen ASR…).
OpenAI-compatible endpoint, multipart:

```bash
curl -X POST https://openrouter.ai/api/v1/audio/transcriptions \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -F "file=@audio.wav" -F "model=openai/whisper-large-v3" -F "language=es"
```

- Returns `{"text": ..., "usage": {"seconds", "cost"}}`.
- Measured cost with large-v3: USD 0.000115 for 4.6 s (~USD 0.09/hour). The
  skill's default is **`openai/whisper-large-v3-turbo`: USD 0.04 per HOUR**
  (12% WER vs 10.3% for the large model — irrelevant for note-taking), accepts
  mp3/mp4/wav/webm/flac/ogg. `whisper-1` caps files at 25 MB; for long
  interviews the skill extracts and compresses the audio with ffmpeg before
  uploading.
- **`language=es` is MANDATORY**: without it, Whisper returned the Spanish
  audio TRANSLATED into English (reproduced on the first attempt). The skill
  fixes it in code — the agent never decides it.
- OpenRouter's public docs don't document this endpoint yet (the audio pages
  only mention `input_audio` via chat-completions) — the models API's
  `?output_modalities=transcription` filter does list it.
- Note: these 14 models do NOT show up in `/api/v1/models` without the filter;
  you have to ask for it explicitly.

Conclusion: **a single key per client covers LLM + STT + images.** No need for
dedicated keys (Groq/OpenAI) unless a concrete case calls for one.

## The engine hides `OPENROUTER_API_KEY` from the agent — measured 30/8/2026

**`transcribe.py` could not run inside an agent. Not once, on any agent we ever
shipped.** The engine strips `OPENROUTER_API_KEY` by name from every `terminal`
and `execute_code` subprocess it spawns: a hard blocklist in
`tools/environments/local.py` (`_build_provider_env_blocklist`), which
`env_passthrough.py` explicitly refuses to re-allow (GHSA-rhgp-j443-p4rf, "would
be unrecoverable"). So the script — run the only way an agent can run it —
answered `falta OPENROUTER_API_KEY: la conexion de modelos no esta configurada`
on an agent whose key was in its own container environment, funding the very
turn that called it.

Reproduced from zero on `east-v2`: a real YouTube interview, `fetch_video.py`
downloaded the audio, `transcribe.py` returned that error, and the agent
correctly refused to continue. **`transcription` is a `level: base` capability,
sold to every client as "ya viene puesta", and it was dead on delivery.**

It also settles an accusation. `docs/east-requirements.md` §1.6 records the East
agent claiming that same missing connection and calls the claim invented — "the
one place it did invent". It did not invent it. The script said it, because it
was true, and building the transcript from YouTube's automatic captions was the
agent working around a broken capability, not dodging a paid step. The five
`[VERIFICAR CONTRA EL VIDEO]` markers in that deliverable are ours.

**The fix, and what it costs.** `TUAGENTE_MODELS_KEY` carries the same value
under a name the engine does not strip, in `<agent>/secrets.env` next to the
others; `transcribe.py` reads it first and falls back to `OPENROUTER_API_KEY` for
anything running outside a tool-spawned subprocess. `agent-check.py` fails
without it, because the symptom is invisible until the first audio arrives.

Out loud: **any command the agent runs can now read a spendable model key**,
which is what the engine's blocklist exists to prevent. The trade is bounded by
the model this whole note describes — one key per client, a limit we set, rotated
with a single `PATCH` — and the spend it enables is the capability the client
bought. It is still the agent holding a credential, and the narrower answer is
for the ADAPTER to transcribe and never hand the key over: `docs/PENDING.md`, as
a decision to take rather than a patch to sneak in.

(Note also that the name matters twice: `execute_code` strips by SUBSTRING on
`KEY`/`SECRET`/`TOKEN`, so `TUAGENTE_MODELS_KEY` reaches `terminal` — where our
scripts run — and stays stripped from `execute_code`, which is the narrower
surface and a good place to leave it stripped.)

## Detection

`auxiliary-models` entry in `connections/catalog.json`: presence of
`OPENROUTER_API_KEY`. Dedicated keys (Groq/OpenAI) get detected once the skill
that uses them is in the kit.

**That detection is right for the CONNECTION and wrong for the CAPABILITY**, and
the section above is why: the key being in the environment is what the adapter
can see, and it is not what decides whether the agent can transcribe. The card
says active either way. Whoever revisits this should have it check
`TUAGENTE_MODELS_KEY` too.

## First real case

East Comunicación pilot (interview transcription + note-taking + image
proposals). The flow design lives in `tuagente.uy/docs/east-pilot.md`;
whatever turns out generic (the `transcribe` skill, an image skill) comes back
here.
