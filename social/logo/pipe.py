import json, os, base64, urllib.request, urllib.error, time, sys, concurrent.futures as cf
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
S = os.path.dirname(os.path.abspath(__file__)) + "/pipe"
KEY = os.environ["OPENROUTER_API_KEY"]
from gen import BRAND, CONCEPTS
GPT = "openai/gpt-5.4-image-2"; RECRAFT = "recraft/recraft-v4.1-pro-vector"

def call(body, tries=6):
    for i in range(tries):
        req = urllib.request.Request("https://openrouter.ai/api/v1/chat/completions", data=json.dumps(body).encode(),
            headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"})
        try:
            r = json.load(urllib.request.urlopen(req, timeout=300))
            if "error" in r: raise RuntimeError(r["error"])
            return r
        except urllib.error.HTTPError as e:
            if e.code == 429 and i < tries-1: time.sleep(4 * (i+1)); continue
            raise
def first_image(r): return r["choices"][0]["message"]["images"][0]["image_url"]["url"]

def raster(name):
    r = call({"model": GPT, "modalities": ["image","text"], "messages": [{"role":"user","content":
        BRAND + "\n\n" + CONCEPTS[name] + "\n\nOne logo mark, square, flat vector look."}]})
    url = first_image(r); b = base64.b64decode(url.split(",",1)[1])
    p = f"{S}/{name}-gpt.png"; open(p,"wb").write(b); return name, url

def vector(name, url, k):
    r = call({"model": RECRAFT, "modalities": ["image"], "messages": [{"role":"user","content":[
        {"type":"text","text": BRAND + "\n\n" + CONCEPTS[name] + "\n\nThe attached image is the reference design: reproduce it faithfully as a clean vector logo mark, simplifying the geometry, no text."},
        {"type":"image_url","image_url":{"url": url}}]}]})
    svg = base64.b64decode(first_image(r).split(",",1)[1]).decode()
    p = f"{S}/{name}-recraft-{k}.svg"; open(p,"w").write(svg); return name, k, len(svg)

with cf.ThreadPoolExecutor(6) as ex:
    rasters = {}
    for f in cf.as_completed([ex.submit(raster, n) for n in CONCEPTS]):
        try: n, u = f.result(); rasters[n] = u; print("gpt ok", n)
        except Exception as e: print("gpt ERR", repr(e)[:200])
with cf.ThreadPoolExecutor(2) as ex:
    for f in cf.as_completed([ex.submit(vector, n, u, k) for n, u in rasters.items() for k in (1,2)]):
        try: print("recraft", f.result())
        except Exception as e: print("recraft ERR", repr(e)[:200])
