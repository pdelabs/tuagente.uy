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

## Detection

`auxiliary-models` entry in `connections/catalog.json`: presence of
`OPENROUTER_API_KEY`. Dedicated keys (Groq/OpenAI) get detected once the skill
that uses them is in the kit.

## First real case

East Comunicación pilot (interview transcription + note-taking + image
proposals). The flow design lives in `tuagente.uy/docs/east-pilot.md`;
whatever turns out generic (the `transcribe` skill, an image skill) comes back
here.
