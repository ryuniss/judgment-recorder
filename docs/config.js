// 배포 설정. README의 순서대로 Supabase를 만든 뒤 아래 두 값을 채웁니다.
// 여기 들어가는 값은 공개되어도 되는 값입니다. Claude API 키는 절대 여기에 넣지 않습니다.
window.APP_CONFIG = {
  // 예: "https://abcdefgh.supabase.co/functions/v1/record-model"
  FUNCTION_URL: "",
  // Supabase 프로젝트의 anon(public) 키
  SUPABASE_ANON_KEY: "",
  // true면 서버 없이 가짜 응답으로 화면 흐름만 확인합니다. 주소 끝에 ?mock=1 을 붙여도 됩니다.
  MOCK: false,
};
