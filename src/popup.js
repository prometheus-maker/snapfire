const fmtInputs = [...document.querySelectorAll("input[name=fmt]")];
const saved = localStorage.getItem("fmt");
if (saved) fmtInputs.forEach((i) => { i.checked = i.value === saved; });
fmtInputs.forEach((i) => i.addEventListener("change", () => localStorage.setItem("fmt", i.value)));

async function go(mode) {
  const msg = document.getElementById("msg");
  document.querySelectorAll("button").forEach((b) => { b.disabled = true; });
  msg.className = "msg";
  msg.textContent = mode === "full" ? "Loading the whole page… (long pages take a few seconds)" : "Capturing…";
  const format = fmtInputs.find((i) => i.checked).value;
  const r = await browser.runtime.sendMessage({ type: "capture", mode, format });
  if (r && r.ok) { window.close(); return; }
  msg.className = "msg err";
  msg.textContent = "Firefox doesn't let add-ons capture this page (built-in pages, the add-ons site, PDFs). " + ((r && r.error) || "");
  document.querySelectorAll("button").forEach((b) => { b.disabled = false; });
}
document.getElementById("full").addEventListener("click", () => go("full"));
document.getElementById("visible").addEventListener("click", () => go("visible"));
