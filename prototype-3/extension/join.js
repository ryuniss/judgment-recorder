// 개인 링크 페이지에서 서버 주소와 참여 코드를 읽어 저장한다. 수집은 켜지 않는다(학생이 직접 켠다).
const server = document.querySelector('meta[name="jr-server"]')?.content;
const code = document.querySelector('meta[name="jr-code"]')?.content;
const box = document.getElementById("ext");
if (server && code) chrome.storage.local.set({ server, code }, () => {
  if (box) { box.className = "st ok"; box.textContent = "확장 프로그램에 내 코드가 저장됐어요. 대화할 때 확장 프로그램 팝업에서 '수집 시작'만 누르면 돼요."; }
});
