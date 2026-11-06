"""Install Snapfire into a real Firefox (geckodriver), fire its Alt+Shift+S command on test pages, check the preview
tab and the saved file. Run: tests/real.sh"""
import http.server, pathlib, socketserver, sys, threading, time
from selenium import webdriver
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.firefox.service import Service

HOME = pathlib.Path.home()
XPI, DL, SHOTS = sys.argv[1], pathlib.Path("/tmp/sf-dl"), pathlib.Path("/tmp/sfshots")
HERE = pathlib.Path(__file__).resolve().parent
fails = []


def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail else ""))
    if not ok:
        fails.append(name)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(HERE / "pages"), **k)

    def log_message(self, *a):
        pass


srv = socketserver.TCPServer(("127.0.0.1", 0), Quiet)
threading.Thread(target=srv.serve_forever, daemon=True).start()
LOCAL = f"http://127.0.0.1:{srv.server_address[1]}"

for f in DL.glob("*"):
    f.unlink()
DL.mkdir(exist_ok=True)
SHOTS.mkdir(exist_ok=True)
o = Options()
o.binary_location = str(HOME / ".local/firefox-real/firefox/firefox")
o.add_argument("-headless")
for k, v in {"browser.download.dir": str(DL), "browser.download.folderList": 2, "browser.download.useDownloadDir": True,
             "browser.download.always_ask_before_handling_new_types": False}.items():
    o.set_preference(k, v)
d = webdriver.Firefox(options=o, service=Service(str(HOME / ".local/firefox-real/geckodriver"), service_args=["--allow-system-access"]))

STATS = """const all = [...document.querySelectorAll('main img')]; const img = all[all.length - 1];
  if (!img || !img.naturalHeight || !/px/.test(document.getElementById('info').textContent)) return null;
  const c = document.createElement('canvas'); const w = img.naturalWidth, h = img.naturalHeight;
  c.width = Math.min(w, 400); c.height = 200; const g = c.getContext('2d');
  // bottom fifth of the image, squeezed: is there anything drawn there (not one flat colour)?
  g.drawImage(img, 0, Math.floor(h * 0.8), w, Math.floor(h * 0.2), 0, 0, c.width, 200);
  const px = g.getImageData(0, 0, c.width, 200).data; const seen = new Set();
  for (let i = 0; i < px.length; i += 40) seen.add(px[i] >> 4 << 8 | px[i + 1] >> 4 << 4 | px[i + 2] >> 4);
  return {w, h: all.reduce((s, i) => s + i.naturalHeight, 0), images: all.length, colours: seen.size,
    info: document.getElementById('info').textContent};"""


def shoot(url, wait=2):
    print("..", url, flush=True)
    d.switch_to.window(d.window_handles[0])
    d.get(url)
    time.sleep(wait)
    page_h = d.execute_script("return Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)")
    before = set(d.window_handles)
    d.set_context(d.CONTEXT_CHROME)
    try:
        r = d.execute_script("""const id = 'snapfire_prometheus-maker_github_io-browser-action';
          window.CustomizableUI.addWidgetToArea(id, window.CustomizableUI.AREA_NAVBAR);
          const node = window.document.getElementById(id); if (!node) return 'no widget';
          (node.querySelector('toolbarbutton') || node).click(); return 'ok';""")
    finally:
        d.set_context(d.CONTEXT_CONTENT)
    for _ in range(60):
        time.sleep(0.5)
        new = set(d.window_handles) - before
        if new:
            break
    print("..  command:", r, "new tab:", bool(new), flush=True)
    if not new:
        print("..  title:", d.title)
        d.set_context(d.CONTEXT_CHROME)
        print("..  tabs:", d.execute_script("return [...window.gBrowser.tabs].map(t => t.linkedBrowser.currentURI.spec)"))
        print(d.execute_script("""return Services.console.getMessageArray().map(m => m.message || String(m))
          .filter(t => /snapfire|moz-extension|capture|Error/i.test(t)).slice(-8).join('\\n')"""))
        d.set_context(d.CONTEXT_CONTENT)
        return r, page_h, None
    d.switch_to.window(new.pop())
    st = None
    for _ in range(40):
        time.sleep(0.5)
        st = d.execute_script(STATS)
        if st:
            break
    return r, page_h, st


try:
    d.set_window_size(1280, 900)
    d.install_addon(XPI, temporary=True)
    print(".. installed", flush=True)

    r, ph, st = shoot(LOCAL + "/sticky-lazy.html")
    check("shortcut fires", str(r).startswith("ok"), r)
    check("local page: preview tab opened", st is not None, st)
    if st:
        check("local page: image as tall as the page", abs(st["h"] - ph) <= 2, f"{st['w']}x{st['h']} page_h={ph}")
        check("local page: lazy image at the bottom was loaded (bottom not flat)", st["colours"] > 3, st)
        d.save_screenshot(str(SHOTS / "result-local.png"))
        d.find_element("id", "save").click()
        time.sleep(2)
        files = list(DL.glob("*.png"))
        check("save writes a PNG file", bool(files) and files[0].read_bytes()[:4] == b"\x89PNG", [f.name for f in DL.iterdir()])

    r, ph, st = shoot("https://en.wikipedia.org/wiki/Firefox", wait=3)
    check("wikipedia long page captured", st is not None and st["h"] >= ph - 2 and st["colours"] > 3, f"{st} page_h={ph}")
    if st:
        d.save_screenshot(str(SHOTS / "result-wiki.png"))

    r, ph, st = shoot(LOCAL + "/very-tall.html")
    check("very tall page (40,000 px) saved as several full-width images", st is not None and st["h"] >= 30000 and st["colours"] > 3,
          f"{st} page_h={ph}")
finally:
    d.quit()
    srv.shutdown()
print(f"\n{len(fails)} failed" if fails else "\nall passed")
sys.exit(1 if fails else 0)
