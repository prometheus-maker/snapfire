const $ = (id) => document.getElementById(id);
let shot = null;

function fileName() {
  const d = new Date(), pad = (n) => String(n).padStart(2, "0");
  let host = "page";
  try { host = new URL(shot.page).hostname.replace(/^www\./, "") || "page"; } catch (e) { /* about: pages */ }
  const title = (shot.title || "").replace(/[\\/:*?"<>|#%]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}`;
  return `${title || host} ${stamp}.${shot.fmt === "jpeg" ? "jpg" : "png"}`;
}

const size = (b) => (b < 1048576 ? Math.max(1, Math.round(b / 1024)) + " KB" : (b / 1048576).toFixed(1) + " MB");

async function load() {
  shot = await browser.runtime.sendMessage({ type: "get", id: location.hash.slice(1) });
  if (!shot) { $("info").textContent = "This screenshot is gone (it is kept for 10 minutes). Take a new one."; return; }
  shot.blobs = [];
  for (const url of shot.urls) {
    const img = Object.assign(document.createElement("img"), { src: url, alt: "Screenshot" });
    $("main").append(img);
    await img.decode().catch(() => {});
    shot.blobs.push(await (await fetch(url)).blob());
  }
  const imgs = [...document.querySelectorAll("main img")];
  const W = imgs[0].naturalWidth, H = imgs.reduce((s, i) => s + i.naturalHeight, 0);
  const total = shot.blobs.reduce((s, b) => s + b.size, 0);
  const many = imgs.length > 1 ? ` in ${imgs.length} images (too tall for one)` : "";
  $("info").textContent = `${W} × ${H} px${many} · ${size(total)}${shot.cut ? " · very long page: cut at the size limit" : ""} · ${shot.title || shot.page || ""}`;
  document.title = "Screenshot: " + (shot.title || "page");
  for (const b of ["save", "copy", "zoom"]) $(b).disabled = false;
  if (imgs.length > 1) { $("copy").disabled = true; $("copy").title = "Copy works with one image; use Save"; $("save").textContent = `⬇ Save ${imgs.length} images`; }
}

$("save").addEventListener("click", () => {
  shot.blobs.forEach((blob, i) => {
    const name = shot.blobs.length > 1 ? fileName().replace(/(\.\w+)$/, ` (${i + 1} of ${shot.blobs.length})$1`) : fileName();
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
  });
});
$("copy").addEventListener("click", async () => {
  try {
    const png = shot.blobs[0].type === "image/png" ? shot.blobs[0] : await (async () => {
      const bmp = await createImageBitmap(shot.blobs[0]);
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      c.getContext("2d").drawImage(bmp, 0, 0);
      return c.convertToBlob({ type: "image/png" });
    })();
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    $("copy").textContent = "✅ Copied";
  } catch (e) {
    $("copy").textContent = "Copy failed: use Save";
  }
  setTimeout(() => { $("copy").textContent = "📋 Copy"; }, 2500);
});
$("zoom").addEventListener("click", () => {
  let on = false;
  document.querySelectorAll("main img").forEach((i) => { on = i.classList.toggle("actual"); });
  $("zoom").textContent = on ? "🔍 Fit width" : "🔍 Actual size";
});
load();
