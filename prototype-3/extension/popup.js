const $ = (s) => document.querySelector(s);
const paint = (on, n) => { const t = $("#toggle"); t.className = on ? "on" : "off"; t.textContent = on ? "수집 멈추기" : "수집 시작"; $("#stat").textContent = on ? `수집 중 · 이번에 보낸 원문 ${n || 0}개` : "꺼져 있어요"; };
chrome.storage.local.get(["server", "code", "on", "sent"], (s) => { $("#server").value = s.server || ""; $("#code").value = s.code || ""; paint(!!s.on, s.sent); });
$("#toggle").onclick = () => chrome.storage.local.get(["on"], (s) => {
  const server = $("#server").value.trim().replace(/\/$/, ""), code = $("#code").value.trim();
  if (!s.on && (!/^https?:\/\//.test(server) || code.length < 6)) { $("#stat").textContent = "서버 주소와 참여 코드를 확인해 주세요."; return; }
  chrome.storage.local.set({ server, code, on: !s.on, sent: 0 }, () => paint(!s.on, 0));
});
