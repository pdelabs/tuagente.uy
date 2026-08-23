# Research 3 — Maturity and real cost of agent capabilities (8/19/2026)

Research agent covering benchmarks, postmortems, and 2025-2026 pricing,
measured against our ~US$25/month-per-role budget.

## 1. Maturity

- **Browser/computer-use is far from human level**: WebArena ~60-62%
  success (IBM CUGA 61.7%) vs 78% human; OSWorld ~62% vs 72%. STRONG.
- **And the numbers were inflated**: WebArena Verified found misaligned
  evaluations and string-matching that inflated results. STRONG.
- **In production: "70-95% depending on task type", only when narrow and
  supervised**; it fails on anti-bot measures, 2FA, drag-and-drop, unusual
  UIs. "Agents that do anything in your browser" is still demo-ware
  (Zylos, Scrapfly 2026). STRONG.
- **Measured causes**: floating ads break 73% of reads; CAPTCHAs fail 36%
  of the time. MEDIUM.
- **Operator (OpenAI): <50% success on real sites; deprecated Aug-2025.**
  STRONG.
- **Voice agents: mature only in a narrow niche**; real-world P50 latency
  1.4-1.7s (5-8x human turn-taking). Hamming AI, based on 4M+ calls.
  STRONG.
- **The demo→prod gap kills ~60% of voice deployments**: STT loses 10-25%
  accuracy with noise; hallucinations run 3-5x higher on unseen inputs.
  MEDIUM.
- **LLM-based OCR/extraction: the most mature item on this list** — Gemini
  2.5 Pro 94% on scanned invoices, 96-98% on text PDFs; degrades with bad
  scans. STRONG.
- **Spreadsheets via code: creating simple spreadsheets is mature (~82%
  SpreadsheetBench v1); professional end-to-end tasks <35% (v2), even for
  Claude/ChatGPT for Excel.** STRONG.
- **Office documents (xlsx/docx/pptx) via skills: mature**, styles
  preserved, CSV→deck in a single prompt. MEDIUM.
- **Brand imagery: text rendering got solved in 2025** (Nano Banana);
  product editing for e-commerce is a common use case. STRONG.
- **RAG/knowledge bases: the technique matured, the upkeep didn't** — 73%
  of deployments fail in year one because the knowledge base goes stale,
  not because of the model; the failure is silent (it answers confidently
  off old docs). MEDIUM.

## 2. Costs against US$25/month per role

- **Image: US$0.005-0.06/image** (GPT Image Mini $0.005, Imagen 4 Fast
  $0.02, Flux 2 Pro $0.055); 200 images/month ≈ US$1-8. FITS. STRONG.
- **Transcription: US$0.0035-0.008/min**; 40 hrs/month ≈ US$9-18. Fits;
  heavy usage brushes up against the limit. STRONG.
- **TTS: OpenAI at US$15/M characters fits; ElevenLabs (US$48-180/M)
  BREAKS the budget under sustained use.** STRONG.
- **Video: US$1.50-12 per 30s clip** (US$0.03-0.70/sec; with 3-5 retries a
  usable clip costs US$5-30); 2/week ≈ US$40-240/month. ALWAYS BREAKS THE
  BUDGET. STRONG.
- **Search APIs: US$5-9/1,000 requests** (Brave $5, Exa $7, Tavily ~$8, x2
  for advanced). An HOURLY watcher ≈ US$36-58/month (breaks it); a DAILY
  watcher ≈ US$1-2 (fits). STRONG.
- **The dominant cost is agentic-loop tokens, not the capabilities
  themselves**: 5-50x the tokens of a chat; a single unbounded task can
  cost US$5-8 on its own. The #1 risk against US$25/month: a browser agent
  or deep research stuck in a retry loop. Mitigation: caps, a cheap
  router, prompt caching (−50%). STRONG.
- **Trend 2023→2026: input tokens −85%; image and STT got cheaper; video
  is still expensive.** This favors the US$25/role model, except for video
  and premium voice. MEDIUM.

## 3. Winning combos with a real product

- **Transcription+summary (meeting notes) = THE proven combo**: Fireflies
  is in 75% of the Fortune 500; Granola is SOC-2; 4-5 profitable players.
  STRONG.
- **OCR+reconciliation (expense capture)**: real-world accuracy 90-95%
  (vendors claim 99); cost per receipt drops from $0.70 to $0.23; the
  value = OCR + matching + flagging exceptions, with a human for anything
  critical. STRONG.
- **Scheduled scraping+alerts (price watching)**: a US$1.2B (2024)→US$2.5B
  (2033) market; the stable path = structured scraping/search API + LLM
  matching, NOT a free-roaming browser agent. STRONG.
- **Voice+scheduling (receptionist)**: documented ROI (778 leads in 4
  months, 76% conversion) but the figures come from vendors. MEDIUM.
- **Search+synthesis (deep research)**: real measured adoption
  (Harvard/Perplexity); 93.9% SimpleQA; reports in <3 min drawing on ~50
  sources. STRONG.
- **Data→document (CSV→spreadsheet→deck)**: Anthropic's skills + Excel's
  Agent Mode validate "the agent delivers the file, not a wall of text".
  MEDIUM.

## 4. What NOT to promise

- **Extraction hallucinating plausible values into empty fields: 1-3% in
  financial extractions** — invisible without per-field validation. Don't
  promise extraction without review on anything headed to accounting.
  STRONG.
- **Whisper invents phrases ~1-1.4% of the time (triggered by silences);
  38% of those invented phrases contain harmful content.** Mitigate with
  VAD; don't promise a literal transcript for legal/medical use. STRONG.
- **Browser automation breaks at the worst moment** (checkout, login,
  CAPTCHA) and every retry costs money; cross-tab sync is "fragile in
  2026". STRONG.
- **The web closed its doors to agents: Cloudflare (~20% of the internet)
  has blocked AI crawlers by default since Jul-2025**; since Sep-2026 it
  blocks "agent use" on pages with ads. Paid search APIs = the stable
  path. STRONG.
- **Image: the problem is consistency and backlash, not quality** — 50
  images look like 50 different artists without a style system; "AI slop"
  was 2025's word of the year; consumer distrust went 20%→40%
  (2025→2026). Promise "assets with a style guide", never "your whole
  campaign". STRONG.
- **Voice in open environments fails in public**: Taco Bell halted its
  500+ location rollout (loops + viral sabotage). Voice works for
  structured 1-on-1 calls. STRONG.
- **The typical agentic failure is silent and compounding**; Gartner:
  >40% of agentic initiatives will be canceled before 2027 — for lack of
  a resilience layer, not the model's fault. MEDIUM.
- **The success pattern = small scope + a specific domain** (MIT NANDA:
  95% of pilots show no P&L impact; the winning 5% is tightly scoped and
  uses an external partner — 67% success with outside expertise vs 22%
  in-house). We are that external partner. MEDIUM.

## Operational synthesis

Safe today: OCR/extraction with validation, transcription+meeting notes,
office documents, image generation with a style guide, scoped
search/deep-research. Keep narrow or don't promise: free-roaming browser,
real-time voice, video. Against US$25/role: video always breaks it;
premium TTS and hourly monitoring break it under normal use; the silent
risk is uncapped loops ⇒ a budget cap per role and per capability.
