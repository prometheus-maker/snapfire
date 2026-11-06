/* Snapfire: render the whole page in ONE capture (captureVisibleTab with a page-sized rect, Firefox only), so there are no scroll
   seams or repeated sticky headers. Very tall pages are captured in parts and joined on a canvas. */
const shots = new Map(); // id -> {url, w, h, title, page}; kept until the preview tab has taken it
const MAX_SIDE = 16384;   // keep each capture well inside Firefox's canvas limits
const MAX_AREA = 120e6;   // pixels in all images together (about 480 MB of RAM while they are built)
const MAX_JOIN = 32000;   // Firefox canvases stop at 32,767 px: taller pages are saved as several images

// Runs in the page: scroll through once so lazy images load, go to the top (sticky headers end up where they
// belong), and report the size of the page.
async function prepare(scrollFirst) {
  const de = document.documentElement, b = document.body || de;
  const y0 = window.scrollY, x0 = window.scrollX;
  const height = () => Math.max(de.scrollHeight, b.scrollHeight, de.clientHeight);
  if (scrollFirst) {
    const vh = window.innerHeight || 800;
    for (let y = 0, n = 0; y < height() && n < 40; y += vh, n++) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  window.scrollTo(0, 0);
  await new Promise((r) => setTimeout(r, 400));
  return { w: Math.max(de.scrollWidth, b.scrollWidth, de.clientWidth), h: height(), vw: de.clientWidth, vh: window.innerHeight,
    dpr: window.devicePixelRatio || 1, title: document.title, x0, y0 };
}

function restore(x, y) { window.scrollTo(x, y); }

async function capture(tab, mode, format) {
  const fmt = format === "jpeg" ? "jpeg" : "png";
  if (mode === "visible") {
    const url = await browser.tabs.captureVisibleTab(tab.windowId, { format: fmt, quality: 92 });
    return show({ urls: [url], title: tab.title, page: tab.url, fmt });
  }
  const [{ result: d }] = await browser.scripting.executeScript({ target: { tabId: tab.id }, func: prepare, args: [true] });
  try {
    const w = Math.min(d.w, 8000);
    let scale = d.dpr;
    if (w * scale > MAX_SIDE) scale = MAX_SIDE / w;
    if (w * d.h * scale * scale > MAX_AREA) scale = Math.max(0.5, Math.sqrt(MAX_AREA / (w * d.h)));
    const H = Math.min(Math.round(d.h * scale), Math.round(MAX_AREA / (w * scale))); // beyond the cap: the rest is cut
    const partCss = Math.floor(MAX_SIDE / scale); // CSS pixels of page height per capture
    const parts = [];
    for (let y = 0; y * scale < H; y += partCss) {
      const h = Math.min(partCss, d.h - y, Math.ceil((H - y * scale) / scale));
      parts.push({ y, h, url: await browser.tabs.captureVisibleTab(tab.windowId, { rect: { x: 0, y, width: w, height: h }, scale, format: "png" }) });
    }
    const W = Math.round(w * scale);
    let urls;
    if (H <= MAX_JOIN) {
      urls = [parts.length > 1 || fmt === "jpeg" ? await join(parts, W, H, scale, fmt) : parts[0].url];
    } else { // taller than one image can be: one file per part
      urls = [];
      for (const p of parts) urls.push(fmt === "jpeg" ? await join([{ ...p, y: 0 }], W, Math.round(p.h * scale), scale, fmt) : p.url);
    }
    return show({ urls, title: d.title || tab.title, page: tab.url, fmt, w: W, h: H, cut: H < Math.round(d.h * scale) });
  } finally {
    browser.scripting.executeScript({ target: { tabId: tab.id }, func: restore, args: [d.x0, d.y0] }).catch(() => {});
  }
}

async function join(parts, W, H, scale, fmt) {
  const c = new OffscreenCanvas(W, H), g = c.getContext("2d");
  if (fmt === "jpeg") { g.fillStyle = "#fff"; g.fillRect(0, 0, W, H); }
  for (const p of parts) {
    const img = await createImageBitmap(await (await fetch(p.url)).blob());
    g.drawImage(img, 0, Math.round(p.y * scale));
  }
  const blob = await c.convertToBlob({ type: "image/" + fmt, quality: 0.92 });
  return URL.createObjectURL(blob);
}

async function show(shot) {
  const id = String(Date.now()) + Math.random().toString(36).slice(2, 6);
  shots.set(id, shot);
  setTimeout(() => shots.delete(id), 10 * 60 * 1000);
  await browser.tabs.create({ url: browser.runtime.getURL("src/result.html") + "#" + id });
}

browser.runtime.onMessage.addListener(async (msg, sender) => {
  if (msg.type === "capture") {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    try {
      await capture(tab, msg.mode, msg.format);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  }
  if (msg.type === "get") {
    const s = shots.get(msg.id);
    shots.delete(msg.id);
    return s || null;
  }
});

browser.commands.onCommand.addListener(async (name) => {
  if (name !== "capture-full") return;
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  capture(tab, "full", "png").catch((e) => console.warn("Snapfire:", String(e), e && e.stack));
});

// Without a popup (the test build, or if a user removes it) a toolbar click takes the whole page.
browser.action.onClicked.addListener((tab) => capture(tab, "full", "png").catch((e) => console.warn("Snapfire:", String(e))));
