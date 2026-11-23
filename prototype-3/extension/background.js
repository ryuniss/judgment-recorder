// 원문 전송과, 페이지에서 직접 못 읽는 이미지 주소를 data URL로 바꾸는 일을 맡는다.
async function toDataUrl(src) {
  const r = await fetch(src, { credentials: "include" });
  if (!r.ok) throw new Error(r.status);
  const b = await r.blob();
  if (b.size > 4_000_000) throw new Error("too big");
  const buf = new Uint8Array(await b.arrayBuffer());
  let s = ""; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return `data:${b.type || "image/png"};base64,${btoa(s)}`;
}
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type !== "send") return;
  (async () => {
    const { server, code, on } = await chrome.storage.local.get(["server", "code", "on"]);
    if (!on) return reply({ skipped: true });
    const images = [];
    for (const src of msg.images || []) { try { images.push(src.startsWith("data:") ? src : await toDataUrl(src)); } catch { /* 못 읽은 이미지는 건너뜀 */ } }
    const r = await fetch(`${server}/ingest`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, host: msg.host, url: msg.url, role: msg.role, text: msg.text, images }) });
    const j = await r.json().catch(() => ({}));
    if (r.ok && !j.duplicate) { const { sent = 0 } = await chrome.storage.local.get("sent"); chrome.storage.local.set({ sent: sent + 1 }); }
    reply({ ok: r.ok, ...j });
  })().catch((e) => reply({ ok: false, error: String(e) }));
  return true;
});
