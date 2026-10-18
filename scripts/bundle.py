"""서버 함수 세 파일을 하나로 합쳐 dist/record-model.ts를 만든다.
Supabase 대시보드의 함수 편집기에 붙여 넣어 배포할 때 쓴다. (CLI로 배포하면 필요 없음)
사용: python3 scripts/bundle.py
"""
import re, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
src = root / "supabase/functions/record-model"
def body(name):
    t = (src / name).read_text(encoding="utf-8")
    t = re.sub(r'^import \{[^}]*\} from "\./[a-z_]+\.ts";\n', "", t, flags=re.M)
    return t
out = ["// 자동 생성 파일: scripts/bundle.py 로 만든다. 직접 고치지 말고 supabase/functions/record-model/ 를 고칠 것.\n"]
idx = body("index.ts")
imports = [l for l in idx.splitlines(True) if l.startswith("import ")]
idx = "".join(l for l in idx.splitlines(True) if not l.startswith("import "))
out += imports + ["\n// ---- prompt.ts ----\n", body("prompt.ts"), "\n// ---- checks.ts ----\n", body("checks.ts"), "\n// ---- index.ts ----\n", idx]
(root / "dist").mkdir(exist_ok=True)
(root / "dist/record-model.ts").write_text("".join(out), encoding="utf-8")
print("dist/record-model.ts", sum(len(s) for s in out), "chars")
