# East Comunicación pilot (Cata) — first real client

Decided 2026-08-06. tuagente's first real client, under the new structure:
**free install + free pilot month 1**. Cata is a freelance communicator with
several end clients; her typical interview ends up on live TV.

## Today's flow (manual, per interview)

1. The interview (mp4) gets uploaded to Google Drive.
2. She downloads the video and runs it through Whisper → transcript.
3. She runs the transcript through ChatGPT **with her own prompt** →
   key bullet points.
4. She looks for images of the current news context (Google, Instagram,
   press) — on TV those images go up with the bullet points below as
   headlines/lower-thirds.

## The flow with an agent — v1 (an honest line on what gets automated)

| Step | Who | How |
|---|---|---|
| Detect a new mp4 in Drive | agent (cron) | Google service account with the shared folder — no OAuth, no token expiry |
| Download the video, extract audio | agent | ffmpeg in the container (verify the image ships it) |
| Transcribe | agent | the kit's `transcribe` skill (Groq Whisper or OpenAI — decide at build time) |
| **Lower-thirds for TV (the pilot's flow)** | agent | `frases-zocalo` skill: 10 phrases/quotes/headlines IN ALL CAPS for the program's edit — Cata's prompt verbatim (received 8/6). Her real brief lives in a long conversation in her previous tool; the accumulated tweaks get recovered from her examples and feedback |
| News item for social (2nd flow: Radio Viva) | agent | `redactar-noticia` skill (headline + copy, Cata's prompt verbatim). Already drafted; it kicks in when the material belongs to that flow |
| Context images | **mixed** | v1: the agent proposes concrete searches and links per bullet point; Cata picks. Scraping Instagram/Google Images is fragile and has rights issues — don't promise it |
| Delivery | agent | a deliverable in the portal (transcript + bullet points + headlines + links) + a Telegram notice |

**Cata's multi-client setup:** one Drive folder per end client; the
deliverable comes out tagged with that client. The SOUL lists her clients
and each one's tone.

**Pilot rule:** anything generic this flow needs (the transcribe skill, the
images skill, Drive detection) goes into the KIT, not into Cata's agent.
Her agent only holds her SOUL, her prompt, and her folders.

## Technical decisions already made

- **Drive via a service account, not OAuth** (v1): Cata shares the folder
  with the service account's mail address and that's it. Avoids the
  published OAuth app, the 7-day token expiry, and the whole procedure (see
  `hermes-kit/connections/google-workspace.md` — still valid for when a
  client needs to *write* to their own spreadsheets under their own
  identity).
- **OpenRouter per client** as a global kit capability — documented in
  `hermes-kit/notes/auxiliary-models.md`. STT probably needs a dedicated key
  (Groq/OpenAI); the skill decides, not the agent.
- **Hosting: Railway from day 1 of real use.** The morning of 8/6 the Mac
  had two network outages and a Docker crash. Build and test locally; deploy
  to Railway before Cata depends on this (~USD 7/month).

## What we need from Cata / Luis (manual)

1. **The bullet-points prompt** (the one she uses in ChatGPT), as-is.
2. **One real sample interview** (mp4) **and the final aired result** (how
   the headlines and images actually looked on air) — calibrates the
   deliverable.
3. Drive folder(s) shared with the service account (we create the GCP
   project and hand over the address to share with).
4. An OpenRouter key in her name + an STT key (we create them, billed to
   her account).
5. A list of her end clients and where she wants the notices (Telegram).

## Pilot success criteria (agree with her before starting)

From an uploaded mp4 to a ready deliverable with no manual touch, in under X
minutes, with bullet points she can use without rewriting them. If it hasn't
saved her real hours in 30 days, it shuts off and she pays nothing.
