// 사이트 화면 구조를 읽어 완료된 메시지만 보낸다. 사이트가 바뀌면 SELECTORS만 고치면 된다.
const HOST = location.hostname.includes("chatgpt") ? "chatgpt" : "claude";
const SELECTORS = {
  chatgpt: {
    message: "[data-message-author-role]",
    role: (el) => el.getAttribute("data-message-author-role"),
    streaming: () => !!document.querySelector('[data-testid="stop-button"]'),
  },
  claude: {
    message: '[data-testid="user-message"], [data-is-streaming]',
    role: (el) => (el.matches('[data-testid="user-message"]') ? "user" : "assistant"),
    streaming: () => !!document.querySelector('[data-is-streaming="true"]'),
  },
}[HOST];
const sent = new Set();
let on = false, timer = null;
const badge = document.createElement("div");
badge.textContent = "판단 기록 수집 중";
Object.assign(badge.style, { position: "fixed", right: "12px", bottom: "12px", zIndex: 2147483647, background: "#111", color: "#fff",
  font: "600 12px -apple-system,sans-serif", padding: "6px 10px", borderRadius: "999px", display: "none", pointerEvents: "none" });
document.documentElement.appendChild(badge);

chrome.storage.local.get(["on"], (s) => { on = !!s.on; badge.style.display = on ? "block" : "none"; schedule(); });
chrome.storage.onChanged.addListener((c) => {
  if (!c.on) return;
  const was = on; on = !!c.on.newValue; badge.style.display = on ? "block" : "none";
  if (on && !was) baseline(); // 켜기 전 대화는 보내지 않는다(동의 이후만 수집)
  schedule();
});
function baseline() {
  if (!SELECTORS) return;
  for (const el of document.querySelectorAll(SELECTORS.message)) {
    const role = SELECTORS.role(el), text = (el.innerText || "").trim();
    sent.add(`${location.pathname}|${role}|${text}|${imagesIn(el).length}`);
  }
}

function imagesIn(el) {
  return [...el.querySelectorAll("img")]
    .filter((i) => (i.naturalWidth || i.width) >= 128 && !i.closest("button,[role=button]"))
    .map((i) => {
      if (i.src.startsWith("blob:") && i.complete) { // blob 주소는 페이지 안에서만 읽힌다
        try { const c = document.createElement("canvas"); c.width = i.naturalWidth; c.height = i.naturalHeight; c.getContext("2d").drawImage(i, 0, 0); return c.toDataURL("image/png"); } catch { return null; }
      }
      return i.src;
    }).filter(Boolean).slice(0, 8);
}
function scan() {
  if (!on || !SELECTORS || SELECTORS.streaming()) return schedule();
  for (const el of document.querySelectorAll(SELECTORS.message)) {
    const role = SELECTORS.role(el);
    if (role !== "user" && role !== "assistant") continue;
    const text = (el.innerText || "").trim();
    const images = imagesIn(el);
    if (!text && !images.length) continue;
    const key = `${location.pathname}|${role}|${text}|${images.length}`;
    if (sent.has(key)) continue;
    sent.add(key);
    chrome.runtime.sendMessage({ type: "send", host: HOST, url: location.href, role, text, images });
  }
}
function schedule() { clearTimeout(timer); timer = setTimeout(scan, 2500); } // 응답이 멈춘 뒤 2.5초 후에 읽는다
new MutationObserver(schedule).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
