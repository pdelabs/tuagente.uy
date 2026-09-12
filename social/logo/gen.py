import json, os, base64, sys, urllib.request, concurrent.futures as cf
S = os.path.dirname(os.path.abspath(__file__))
KEY = os.environ["OPENROUTER_API_KEY"]
ref = base64.b64encode(open(f"{S}/agentito-ref.png","rb").read()).decode()

BRAND = ("Brand: tuagente.uy, one autonomous AI agent installed inside a Uruguayan small company. "
 "Brand color violet #5B4BE8, ink #14131F. Style: modern, geometric, flat, minimal, single-weight shapes, "
 "no gradients, no 3D, no text, no letters, white background, centered, plenty of margin. "
 "Avoid the cliches: no generic robot head with a screen, no chat bubble, no circuit lines, no brain, no sparkles. "
 "The attached image is the brand mascot (the 'agentito'): a round violet blob with an antenna and big eyes. "
 "The logo may reference it but must be simpler, iconic, readable at 32px.")

CONCEPTS = {
 "sol-agente": "Concept: the Sol de Mayo from the Uruguayan flag reinterpreted as the agent. A circle with 8 short geometric rays, and the top ray is the mascot's antenna (a ray ending in a small dot). Two simple dot eyes inside the circle, nothing else. One color.",
 "franjas-senal": "Concept: the four sky-blue stripes of the Uruguayan flag become signal waves. A small violet circle (the agent) at the lower left, and four curved concentric stripes radiating up-right from it, like a signal or activity. Violet plus the flag's sky blue #75AADB.",
 "mate-antena": "Concept: a mate gourd seen in profile, simplified to a rounded shape, with the bombilla (straw) doubling as the agent's antenna and one round eye. Uruguayan and playful, but geometric and minimal. Single violet color.",
 "a-agentito": "Concept: a lowercase letter 'a' (as in tuagente) whose bowl is the mascot: a round blob with one antenna dot on top and two dot eyes inside the bowl. It must still read as an 'a'. Single violet color.",
 "horizonte-24-7": "Concept: half a sun rising over a flat horizon line, the sun made of a solid half circle with 5 rays, and the topmost ray ends in a dot like the mascot's antenna. Represents the agent working around the clock and the Sol de Mayo. Violet on white.",
 "sello": "Concept: a rounded square badge like an app icon, violet, with a white cutout of the mascot silhouette reduced to a circle plus antenna and two eyes, and a ring of 8 tiny sun-ray ticks around the circle referencing the Sol de Mayo. Clean and iconic.",
}

def call(model, messages, modalities=None):
    body = {"model": model, "messages": messages}
    if modalities: body["modalities"] = modalities
    req = urllib.request.Request("https://openrouter.ai/api/v1/chat/completions", data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=300))

def raster(name):
    prompt = BRAND + "\n\n" + CONCEPTS[name] + "\n\nProduce one logo mark, square composition."
    r = call("google/gemini-3-pro-image", [{"role":"user","content":[
        {"type":"text","text":prompt},
        {"type":"image_url","image_url":{"url":"data:image/png;base64,"+ref}}]}], ["image","text"])
    imgs = r["choices"][0]["message"].get("images") or []
    out = []
    for i, im in enumerate(imgs[:2]):
        url = im["image_url"]["url"]; b = base64.b64decode(url.split(",",1)[1])
        p = f"{S}/raster-{name}-{i+1}.png"; open(p,"wb").write(b); out.append(p)
    return name, out, r.get("error")

def svg(name):
    prompt = (BRAND + "\n\n" + CONCEPTS[name] +
      "\n\nWrite this logo as clean SVG code: viewBox 0 0 120 120, only <path>, <circle>, <rect>, <line> elements, "
      "fill/stroke with the brand colors, stroke-linecap round where strokes are used, no text, no filters, no gradients. "
      "Geometry must be precise and symmetric. Reply with ONLY the <svg>...</svg>, nothing else.")
    r = call("anthropic/claude-opus-5", [{"role":"user","content":prompt}])
    t = r["choices"][0]["message"]["content"]
    t = t[t.find("<svg"): t.rfind("</svg>")+6]
    p = f"{S}/svg-{name}.svg"; open(p,"w").write(t)
    return name, [p], r.get("error")

if __name__ == "__main__":
  with cf.ThreadPoolExecutor(12) as ex:
      futs = [ex.submit(raster, n) for n in CONCEPTS] + [ex.submit(svg, n) for n in CONCEPTS]
      for f in cf.as_completed(futs):
          try: print(f.result())
          except Exception as e: print("ERR", repr(e)[:300])
