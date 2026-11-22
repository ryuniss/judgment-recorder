"""Optional real-provider pilot. No credentials printed; no production participant records."""
import json,os
from companion.q6 import protocol_reply
from companion.tests.test_q6 import context

def run():
 if not os.environ.get('OPENAI_API_KEY') or os.environ.get('AI_MODE','demo')=='demo':
  raise SystemExit('Requires a securely configured OPENAI_API_KEY and AI_MODE=live; no live evaluation performed.')
 cases=[('S3',context(),'Q6'),('aligned',context('입구에서 바로 내부가 보이지 않게 꺾이는 동선을 골랐어요. 처음 온 사람이 시선을 피할 수 있어서요.'),'NONE'),('missing_priority',context(priority=''),'NONE')]
 report=[]
 for name,data,expected in cases:
  out=protocol_reply(data)
  report.append({'scenario':name,'expected':expected,'observed':out['question_id'],'outcome':out['outcome'],'template_ok':out['template_ok'],'model':out['model'],'passed':out['question_id']==expected})
 print(json.dumps({'live_model_evaluation':True,'results':report},ensure_ascii=False,indent=2))
 if not all(r['passed'] for r in report):raise SystemExit(1)
if __name__=='__main__':run()
