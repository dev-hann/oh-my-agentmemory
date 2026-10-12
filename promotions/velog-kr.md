# 코딩 에이전트가 기억을 안 쓰길래 강제로 쓰게 만들었다 (oh-my-agentmemory)

> opencode 플러그인 **oh-my-agentmemory**를 만든 이야기. 에이전트 메모리 도구는 잘 되어 있는데 정작 에이전트가 그걸 안 쓰는 문제를, 매 턴 정책을 주입하는 방식으로 풀었다.

## 문제: 읽기는 되는데 쓰기가 안 된다

[opencode](https://opencode.ai)에 [agentmemory](https://github.com/rohitg00/agentmemory)를 붙여 쓴 지 몇 달 됐다. 세션 자동 캡처, 시맨틱 검색, MCP 도구 54개 — 읽기 쪽은 진짜 잘 된다.

그런데 이상한 점 하나.

**에이전트가 스스로 메모리에 안 쓴다.**

- `memory_save`를 알아서 호출하는 일이 거의 없다
- pinned slot(persona, project_context 같은 것들)이 몇 주째 비어 있다
- "이거 기억해"라고 말하면 "네!" 하고선 아무것도 저장 안 한다
- `memory_lesson_save`? 존재 자체를 모르는 듯

`rules/memory.md`에 정책 파일을 써봤다. 결과? 첫 턴 좀 지키다가 금방 잊는다. 긴 프롬프트에 파묻힌 지시는 LLM이 슬그머니 무시한다. 익숙한 패턴이다.

## 해결: 매 턴 다시 주입한다

그래서 만든 게 [oh-my-agentmemory](https://github.com/dev-hann/oh-my-agentmemory).

핵심 아이디어는 단순하다. 정책을 시스템 프롬프트에 **매 턴 다시 주입**한다. opencode의 `experimental.chat.system.transform` 훅을 써서, 모델이 절대 놓치지 않는 위치에 기억 정책 배너를 박는다. 문체 강제 플러그인(caveman mode)에서 쓰는 반복 강제 패턴을 메모리 위생에 적용한 것.

단순 잔소리는 아니고, 훅 6개가 쓰기 쪽을 분담한다:

| 훅 | 하는 일 |
|---|---|
| **enforcement** | 매 턴 정책 directive 주입 |
| **init** | 세션 시작 시 빈 pinned slot 자동 부트스트랩 |
| **intent** | "기억해", "저장해", "remember this" 키워드 감지 → 다음 directive에 큐잉 |
| **learning** | 파일 편집에 에러 신호(`error`, `실패` 등) 있으면 자동으로 lesson 저장 |
| **archive** | 작업 완료 액션이 쌓이면 crystal(요약 압축) 제안 |
| **bridge** | 우선순위 높은 todo를 메모리 액션으로 브리지 |

키워드 감지는 한영 이중 언어. "기억해", "잊지 마", "저장해" 같은 한국어도 잡는다.

## 실사용 한 달 결과

매일 쓰면서 체감한 변화:

**이전** — 새 세션 열면 기억이 0에서 시작. 지난주에 정한 결정을 다시 설명하거나, 에이전트가 그냥 다시 grep한다.

**이후** — 새 세션에서 "로그인 폼 어디 있었지?" 같은 질문을 하면 메모리에서 회답이 온다. 지난 결정, 지난 버그, 지난 교훈이 세션을 넘어서 따라다닌다.

작성 시점 기준 CI 통과, 테스트 72개, MIT 라이선스. README는 영어/한국어 동시 지원.

## 설치

agentmemory 서버가 `localhost:3111`에 돌고 있다면 설치는 `opencode.json` 한 줄:

```json
{
  "plugin": [
    "./plugins/agentmemory-capture.ts",
    "oh-my-agentmemory"
  ]
}
```

agentmemory의 기본 캡처 플러그인(capture.ts)은 제거하지 말 것 — 이 플러그인은 **쓰기 전용**이고, 관측은 capture.ts가 계속 담당한다. 읽기와 쓰기를 각자 전문 플러그인이 맡는 구조다.

부팅하면 init 훅이 slot을 채우고, `/am-status`로 상태 확인 가능. `/am-recall`, `/am-save` 명령도 있다(선택 설치).

## 왜 이렇게 만들었나

처음엔 정책 파일로 해보려 했다. 실패. 다음으로 시스템 프롬프트에 한 번 넣어보려 했다. 이것도 흐려진다. 결론은 **반복 주입** — 매 턴, 캐시해서 네트워크 비용 없이.

"모델이 지시를 무시한다"는 문제는 메모리 말고도 곳곳에 있다. 이 패턴(매 턴 재주입 + 상태 플래그)은 다른 영역에도 적용 가능할 것 같다.

## 링크

- GitHub: https://github.com/dev-hann/oh-my-agentmemory
- npm: https://www.npmjs.com/package/oh-my-agentmemory

피드백 환영. 특히 "메모리 도구 깔았는데 에이전트가 안 써서 포기했다"는 분 — 그 벽이 이 플러그인의 존재 이유다.
