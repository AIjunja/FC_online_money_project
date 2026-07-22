# FC 패배저금소

친구 둘이 FC 온라인 경기 결과를 기록하고, 월별 적립액 차이를 정산하는 모바일 우선 웹앱입니다.

## 지금 들어간 기능

- 방 생성/참여 및 선택형 4~6자리 PIN 인증
- 패배자·금액·경기 날짜·메모 기록과 D1 영구 저장
- 월별 참가자별 적립액, 패배 횟수, 순정산액 표시
- 다음 달 2일 00:00 (Asia/Seoul)부터 미정산 금액 한 번만 2배 적용
- 정산 완료 시 금액 스냅샷 고정, 방장 재오픈, 감사 로그
- 카카오톡 JavaScript SDK가 없어도 Web Share API → 클립보드 복사 fallback
- 브라질/독일/네덜란드/벨기에/스페인/프랑스/아르헨티나/포르투갈/잉글랜드를 제외한 39개 팀 랜덤 배정
- API가 없는 `npm run dev` 화면에서도 데모 localStorage fallback 제공

## 로컬 실행

```bash
npm install
npm run dev
```

프런트엔드만 확인할 때는 위 명령으로 충분합니다. API와 D1까지 확인하려면 Cloudflare 계정 없이도 로컬 D1을 사용할 수 있습니다.

```bash
npx wrangler d1 migrations apply fc-paejae-jeogeumso --local
npm run build
npm run dev:worker
```

그 다음 `http://localhost:8787`을 엽니다. `wrangler dev`는 `dist`를 정적 자산으로 제공하므로, UI를 바꾼 뒤에는 다시 `npm run build`를 실행하세요.

## Cloudflare 배포

1. Cloudflare D1을 만들고 `wrangler.jsonc`의 `database_id`를 입력합니다.
2. `wrangler d1 migrations apply fc-paejae-jeogeumso --remote`를 실행합니다.
3. `wrangler secret put AUTH_PEPPER`로 긴 랜덤 문자열을 등록합니다.
4. `npm run build && npx wrangler deploy`를 실행합니다.

`wrangler.jsonc`의 `database_id`는 의도적으로 placeholder로 남겨 두었습니다. 실제 계정 값은 소스에 커밋하지 마세요.

## 정산 규칙

예를 들어 A가 7,000원, B가 4,000원을 적립하면 A가 B에게 3,000원을 보냅니다. 7월 장부는 8월 1일 23:59:59 KST까지 기본 금액이고, 8월 2일 00:00 KST부터 6,000원입니다. 정산을 완료하면 그 시점의 최종 금액을 저장하므로 이후 시간이 지나도 변하지 않습니다.

## 검증

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## 다음 작업 후보

카카오 개발자 앱의 JavaScript 키를 연결하면 전용 카카오톡 공유 UI를 붙일 수 있습니다. 현재 공유 버튼은 표준 Web Share와 클립보드 fallback으로 바로 사용할 수 있게 되어 있습니다.
