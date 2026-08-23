# Improvements — what's missing, ordered by what matters to the client

Written 8/13/2026, after a long session hardening the kit, fixing the
portal, and **two blind tests with clients**: subagents who played the role
of an SMB owner with no access to the code or the docs, with only what a
real client has —a link and an expectation—.

The list is ordered by **damage to trust**, not by difficulty. What's at the
top is what makes someone not recommend the product.

---

## Status at the close of 8/13

What follows is the full diagnosis, exactly as it came out of the tests.
This is what was **closed and measured** that day, so it doesn't get
re-litigated.

| | Status |
|---|---|
| 1 · Flows you can see and touch | **closed** — next run, pause, resume, try it now |
| 1.b · The screen lies green | **closed**, and audited twice: the lie survived in the summary up top |
| 5 · Onboarding with a toll booth | **closed** — four options, none of them a blocker |
| Activity hidden under "More" | **closed** — it's in the main bar now |
| Notification outside the portal | **open** — still the most requested thing |
| 1.c · One approval for four actions | **open** |
| 2 · Five names for the same thing | **open** |
| 3 · Clients/Leads, calendar, brand kit | **open** — the big piece |

Three things learned while closing this, worth more than the fixes
themselves:

- **Almost every serious bug failed silently.** The SOUL that didn't
  install, the flows the agent said it had created, the rejection that woke
  nobody up, the check that came back green. The countermeasure isn't
  looking more carefully: it's making things **scream** — checks that fail
  instead of degrading.
- **The good fixes take the thing out of scope, not watch over it.** The
  kit's skills out of the indexed tree, secrets out of `data/`, the
  rejection that doesn't touch the ticket's status, the clock out of the
  screens and inside the one and only network entry point.
- **A blind test finds more than any code review**, and it costs pennies.
  The rule that makes it worth it is in section 8.

---

## 1. Flows: built well, but you can't see or touch them

The best thing the product has today: the client describes a problem in two
lines, the agent asks three concrete questions and leaves the work built.
The accountant put it this way: *"Ahí lo entendí"* — she understood the
product through the result, not the screen.

And that's where it stops.

- **It doesn't say when it runs next.** The Flows screen shows that it
  exists, not when it's going to happen.
- **It can't be edited or paused.** If the client changes their mind about
  the time, or wants to stop it for a week, there's nowhere to do that.
- **Activity said "Todavía no hay actividad"** right after three flows had
  just been built. The screen that exists to show something happened,
  didn't show it.
- **The notification lands in the portal, which is exactly where the
  client isn't.** Literal quote: *"el mail es lo único que miro todo el
  día"*. Today the flow runs and leaves the notice inside, so you have to
  remember to go check for the notice that exists because you forget.

**What I'd do:** "Next run: Monday 8/17 at 9:00" on every flow, Change and
Pause buttons, have Activity show what just happened, and a notification
outside the portal (mail first; WhatsApp later).

---

### 1.b The screen lies green

The most serious finding from both tests. The vet had two flows with the
**"Activo"** badge; going into Activity —hidden in the "More" menu— she
found out **both had already run and failed**. She asked the agent about it
in chat and it told her the truth: *"Respuesta corta: todavía no te podés
olvidar del tema. La última revisión automática falló."*

The agent knows it's broken and the screen covers for it. Her conclusion:
*"Sí lo pagaría, pero todavía no: mientras el lunes dependa de que alguien
suba un archivo y la pantalla mienta en verde, sigo con la misma carga
mental."*

On top of that: she asked to **try the flow right now** and there's no way
to, and to **check off "ya lo llamé"** on the list it hands back, which is
what turns a report into a working tool.

---

## 1.c One single approval for four different actions

She asked the agent for the full spring campaign. It came back with all
eight posts actually written —copy, photo brief, alt text—, a calendar and
drafts, and **executed nothing**, warning beforehand that it needed
approval. Very good.

But it left **a single approval request bundling posting to Instagram +
sending WhatsApps + booking appointments + spending money on 60 doses.** One
button for all four. She rejected it, rightly so.

**Approval has to be per action, not per batch.** Today the client chooses
between authorizing everything or nothing, which in practice means not
authorizing.

---

## 2. Five names for the same thing

Entregas · Entregables · Archivos · Artefactos · Visualizaciones. No client
could explain the difference, and it's not their fault: they're five words
of ours for "things the agent produced."

**What I'd do:** one single name visible to the client, and keep the
internal distinctions inside. If something needs splitting, split it by
what the client does with it (read / download / view), not by how we store
it.

---

## 3. New tabs that real use is asking for

From what came out of the tests and what we'd already been noticing:

- **Clients / Leads.** The accountant asked for this literally: she has 120
  clients and there's nowhere for them to live. Everything the agent
  produces is *for* someone, and today that someone doesn't exist as an
  entity in the portal. It's probably the single piece that most changes the
  product: it turns "an assistant that does tasks" into "an assistant that
  handles your book of clients."
- **Calendar.** Both businesses tested run on dates: DGI and BPS deadlines,
  Tuesday and Thursday surgeries, yearly vaccines. Today the dates live
  inside a flow's text or a deliverable. A calendar is the natural view of
  what the agent knows.
- **Brand kit.** This came out of the Instagram case: the agent needed
  colors, typography and tone to produce something presentable, and it
  inferred them by reading the website. It should be something the client
  sets up once (logo, colors, tone, what not to say) and the agent uses
  every time. It's also what separates a post that looks like it's from the
  company from one that looks like it's from a robot.

All three share one idea: **today the portal shows the agent's work, but
not the world it works on.**

---

## 4. What the client expected and isn't there

No interpretation, exactly as it came out:

- Mail notification.
- The official DGI/BPS calendar already loaded (not the agent inferring
  it).
- **Uploading files outside of chat.** The agent told her "subilo acá" and
  there's no upload button in Files.
- Editing and pausing flows.
- Examples from her own trade: the ten the portal offers are about social
  media, reviews and WhatsApp. For an accounting firm those are a different
  business.
- Knowing **where** sensitive information is stored ("la fiscal de mis 120
  clientes").
- **WhatsApp.** Onboarding offers Telegram or nothing. The vet uses WhatsApp
  for everything, like a good chunk of the country. Today the bridge exists
  but onboarding doesn't offer it, and when the agent tried it it threw a
  raw network error in the client's face.
- **Her own system.** The vet has a clinical-history system; it's not in
  Connections and there's no "other system / tell us which one you use".
  Today the only path is exporting by hand and uploading the file, which is
  exactly the mental load we came here to remove.
- **The price.** It says "no incluye tu abono mensual" and nowhere does it
  say how much. It's a business decision, but the silence communicates too.
- **A "ya lo llamé" checkbox** on the lists it produces. Without it, the
  weekly report is a piece of paper, not a tool.

---

## 5. What confuses or breeds distrust

- **Seven welcome banners**, and they come back every time you leave and
  return.
- **Technical paths in the chat**: `workspace/entregables/2026-08-13-…md`.
- **Usage** shows tokens and model quota. Means nothing to an SMB; either
  show it in pesos per month, or hide it.
- **Skills** has cards in English with dependencies inside them (`pymupdf,
  marker-pdf`) and mentions a tab that doesn't exist.
- **Onboarding**: requires Telegram or mail to let you through (decided:
  it'll become skippable), swallows a shared link's destination, doesn't
  listen to "I don't use Telegram", the chat doesn't scroll down on its own,
  and shows "thinking" for several minutes.

---

## 6. Technical debt already documented

Lives in `docs/PENDING.md` and in `hermes-kit/notes/`. What to keep in mind
when picking this back up:

- **The approval gate has three open, documented holes** (see the kit's
  commit `16a9460`): it turns itself off when the context names an
  already-resolved ticket —right on the final-rejection turn—; it detects by
  shape, not by effect, so `os.system("rm -f x")` gets through while text
  that merely *describes* a deletion gets blocked; and it still stops the
  agent when it drafts the approval request itself from `execute_code`.
  **It's the first thing to close**: the incident that triggered it was the
  agent running a rejected deletion.
- **The live proposal gets guessed from the shape of the text.** If the
  agent re-proposes in prose instead of a table, the portal has no way to
  know which version is the good one. The real fix belongs to the kit: the
  proposal needs to come marked, not inferred.
- **The consumer inventory** (who reads each file, with what privilege,
  **and with what grammar**). It's the countermeasure for the class of bug
  that cost us the most today.
- **The browser caches the agent's name and the manifest can't beat it.**
  We fixed the portal mixing up two clients (one saved config, many readers
  at different times), but six screens still read the name from the local
  cache. A re-naming done on another machine doesn't show up here until it
  gets cleared. The real fix is to **namespace the keys per agent**
  (`tuagente_<agent>_…`) instead of clearing them: it also solves the case
  of a company with two agents, which works today but shows the welcome
  banners again on every switch.
- The remote guard on the adapter migration fails open.
- A request escalated to `triage` can't be approved: the engine has no verb
  to get it out of there. Candidate to report upstream to Nous.
- `config.base.yaml` is so old the engine no longer auto-migrates it.

---

## 7. What ALREADY works and needs protecting

Comes out of the same two tests, worth having in writing so it doesn't get
broken without noticing:

- **Onboarding hooks people.** *"Tu empresa tiene un empleado nuevo"* landed
  on the first screen, and two minutes in the vet was already talking about
  overdue vaccines. It proposed three **vet-specific** jobs, not generic
  ones.
- **The agent doesn't lie or dress things up.** It flagged that its
  deadline reference was internal, not an official calendar; it said the
  image had been made by hand and wasn't a photo; and when asked about the
  broken flow, it answered the truth before the screen did.
- **It doesn't execute without permission, even under pressure.** They asked
  for the whole campaign with posts and spend: it wrote everything and
  executed nothing.
- **It works well with the client's own data.** A CSV uploaded through
  chat → a correct list of 6 overdue patients, with phone numbers, leaving
  out the two that were up to date, in under a minute and with no
  invention.
- **Flows really do get built**: file, cron and screen, with the "I don't
  message anyone" rule built in.

## 8. The blind test, as a method

The two sessions that produced almost this entire document cost pennies and
found more than any code review of the day. The rule that makes them worth
it: **the tester can't have access to the repo, the docs, or know what the
product is.** If they know how it's supposed to work, they stop discovering
things.

Worth repeating on every release, with a different business each time.

---

## 9. How to proceed

My suggested order, if a choice has to be made tomorrow:

1. **Flows you can see and touch** (next run, pause, edit) + **mail
   notification**. It's what turns the product into something trustworthy.
2. **Unify the five names** and drop the leftover jargon. Cheap, and it
   shows on every screen.
3. **Onboarding**, with the toll booth made skippable.
4. **Clients/Leads**, which is the big piece and the one that changes what
   the product is.
5. Calendar and brand kit, which build on the previous one.
