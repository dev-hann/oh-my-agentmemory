<div align="center">

# oh-my-agentmemory

**opencode 에이전트가 [agentmemory](https://github.com/rohitg00/agentmemory)를 실제로 쓰게 만드세요.**

`agentmemory-capture.ts`의 동반 플러그인. 캡처는 이미 잘 됩니다 —
이 플러그인은 에이전트가 **능동적으로 메모리에 쓰게** 강제합니다.

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![opencode](https://img.shields.io/badge/opencode-%E2%89%A51.14-6E56CF.svg)](https://opencode.ai)
[![agentmemory](https://img.shields.io/badge/agentmemory-%E2%89%A50.9.28-FF6B35.svg)](https://github.com/rohitg00/agentmemory)
[![tests](https://img.shields.io/badge/tests-35%20passing-22C55E.svg)](./tests)
[![phases](https://img.shields.io/badge/hooks-5-9333EA.svg)](#어떻게-동작하나)

[English](./README.md) · 한국어

</div>

---

## 왜 필요한가

agentmemory는 **54개의 MCP 도구**와 튼튼한 자동 캡처 플러그인
(`agentmemory-capture.ts`)을 제공합니다. 세션이 기록되고, 시맨틱 메모리가
생성되고, 인사이트가 추출됩니다. **읽기 쪽은 잘 작동합니다.**

하지만 **쓰기 쪽이 멈춰 있습니다**:

- 에이전트가 스스로 `memory_save`를 거의 부르지 않습니다
- pinned slots(`persona`, `project_context`, `user_preferences`, `tool_guidelines`)이
  몇 주 동안 비어 있습니다
- `memory_lesson_save`는 거의 호출되지 않습니다
- `memory_crystallize`는 한 번도 발동하지 않습니다
- 사용자가 "이거 기억해"라고 말해도 에이전트는 "네"라고만 하고 저장하지 않습니다

`rules/memory.md` 정책 파일을 작성할 수 있지만 LLM이 무시할 수 있습니다.
이 플러그인은 그 정책을 모델이 절대 놓칠 수 없는 **매 턴 directive**로
바꿉니다 — caveman 모드 강화와 동일한 패턴을 메모리 위생에 적용합니다.

### 사용 전 / 후

| 지표 (세션당) | oh-my-agentmemory 없음 | oh-my-agentmemory 있음 |
|---|---|---|
| 채워진 pinned slots | 4개 중 0개 | **4개 중 4개** (session.created에서 자동 부트스트램) |
| `memory_save` 호출 | 0 | **1–3** (매 턴 directive 강화) |
| `memory_lesson_save` 호출 | 0 | **2–5** (파일 히스토리에서 자동 캡처) |
| `memory_crystallize` 호출 | 0 | **가끔** (done 액션 ≥3일 때 제안) |
| "이거 기억해" 실제 저장 | ~30% | **~90%** (키워드 감지 → directive) |

수치는 예시입니다 — 실제 향상은 세션 형태에 따라 다릅니다. `learning` hook
(자동 lesson)이 가장 큰 기여자이며, `enforcement` directive가 명시적
`memory_save` 호출의 가장 큰 매개자입니다.

---

## 어떻게 동작하나

다섯 개의 훅이 쓰기 쪽의 한 조각씩을 담당합니다. 각각 짧은 **목적 이름**을
가지며 `OH_AM_DISABLE`에서 사용됩니다. 모두 `agentmemory-capture.ts`와
공존합니다 (capture.ts는 passive 관측을 계속 수행).

```mermaid
flowchart LR
    subgraph OC[opencode 이벤트]
        SC[session.created]
        CM[chat.message]
        ST[system.transform<br/>매 LLM 턴]
        SI[session.status idle]
        FE[file.edited]
    end

    subgraph OH[oh-my-agentmemory]
        INIT[init<br/>빈 slots 부트스트랩]
        INTENT[intent<br/>키워드 감지]
        ENF[enforcement<br/>매 턴 directive]
        ARCH[archive<br/>crystal 제안]
        LEARN[learning<br/>히스토리 기반 자동 lesson]
    end

    subgraph AM[agentmemory HTTP API]
        SLOTS[/slot/replace]
        OBSERVE[/observe]
        LESSON[/lesson/save]
    end

    SC --> INIT --> SLOTS
    CM --> INTENT --> OBSERVE
    ST --> ENF
    SI --> ARCH --> OBSERVE
    FE --> LEARN --> LESSON
    INTENT -.대기 중인 의도.-> ENF
    ARCH -.플래그.-> ENF
    INIT -.캐시 무효화.-> ENF
```

| 훅 (opencode 이벤트) | 목적 | 하는 일 |
|---|---|---|
| `experimental.chat.system.transform` | **enforcement** | 매 턴 `output.system[]`에 정책 directive push. 헤더 + recall 규칙 + write 규칙 + crystal 규칙 + 상태 플래그(빈 slot, 대기 키워드, done 액션 수). 핫 패스는 HTTP-free를 위해 세션 단위로 캐싱. |
| `event: session.created` | **init** | slot 목록을 조회해 네 개 핵심 pinned slot 중 빈 것을 찾고, cwd 기반 프로젝트 매핑으로 템플릿을 채웁니다. `oh_am_bootstrap` observation 기록. |
| `chat.message` | **intent** | 사용자 텍스트를 이중 언어 패턴으로 매칭: "remember", "save this", "don't forget", "기억해", "저장해", "잊어". 매칭을 다음 directive에 큐잉. |
| `event: session.status` (idle) | **archive** | done 액션이 ≥3개면 `oh_am_crystal_candidate` observation 기록. 다음 directive가 후보 ID를 LLM에 노출. |
| `event: file.edited` | **learning** | 파일 히스토리를 가져와 에러 신호(`error`, `fail`, `bug`, `에러`, `실패`, …)를 찾습니다. 편집이 너무 작거나 에러 패턴이 없으면 스킵, `lesson_recall`로 중복 확인 후 `lesson/save` 호출. 파일당 5분 히스토리 캐시 + 60초 디바운스. |

### directive 예시 (LLM이 매 턴 보는 것)

```text
AGENTMEMORY POLICY ACTIVE. Use agentmemory MCP tools proactively.
Rules below override default behavior.
---
## Recall
• 과거 맥락이 필요하면 (최근 작업, 결정, 이전 버그)? memory_recall이나
  memory_smart_search를 파일 탐색보다 먼저 호출.
• Pinned slots(persona, project_context, user_preferences, tool_guidelines,
  pending_items, guidance)은 매 턴 자동 주입됨 — 다시 recall하지 말 것.
• 단순 작업(단일 파일 읽기, 산술, grep)은 memory 호출 스킵.
## Write
• 아키텍처 또는 자명하지 않은 기술 결정 후 memory_save 호출 (결정과 concepts 포함).
• 효과적/비효과적 접근 방식을 발견하면 memory_lesson_save 호출.
• 프로젝트 구조 / 빌드 파이프라인 / 새 모듈 추가? project_context에 memory_slot_replace.
• 미완료 작업이나 후속 작업을 약속? pending_items에 memory_slot_replace.
• 세션이 끝나는데 미련이 남음? guidance slot에 다음 세션 조언 작성.
• 이번 턴에 실제 memory_* 도구 호출 없이 "메모리 갱신했다"고 보고하지 말 것.
## Crystal
• done 상태 액션이 3개 이상? memory_recall로 기존 crystal 확인 후 memory_crystallize.
• done이 3개 미만이거나 순수 탐색 세션이면 crystalize 스킵.

[STATE] Pinned slots empty: project_context, user_preferences. session.created
부트스트랩이 놓쳤다면, 세션 종료 전에 memory_slot_replace로 채울 것.

[USER INTENT] User said: save:"remember this". 이번 턴에 매칭되는 memory_* 도구로
실행할 것.
---
Pinned slots은 이미 컨텍스트에 있음 — 다시 recall 금지. 이번 턴에 실제 도구 호출 없이
memory_*를 불렀다고 보고하면 거짓 보고 (금지).
```

규칙을 조정하려면 `src/core/policy.ts`를 편집하세요. directive는 데이터에서
자동으로 재구성됩니다 — 문자열 수작업 불필요.

---

## 설치

### 1. 사전 요구사항

- [opencode](https://opencode.ai) `≥1.14` (`experimental.chat.system.transform` 훅 제공)
- `http://localhost:3111`에서 실행 중인 [agentmemory](https://github.com/rohitg00/agentmemory) 서버:
  ```bash
  npx @agentmemory/agentmemory
  ```
- [Bun](https://bun.sh) (플러그인 런타임 + 개발 도구)

### 2. 클론 + 설치

```bash
git clone https://github.com/dev-hann/oh-my-agentmemory.git ~/Documents/oh-my-agentmemory
cd ~/Documents/oh-my-agentmemory
bun install
```

### 3. opencode 플러그인 디렉토리에 심볼릭 링크

```bash
ln -sfn ~/Documents/oh-my-agentmemory/src/adapters/opencode \
        ~/.config/opencode/plugins/oh-my-agentmemory
```

### 4. 플러그인 등록 (capture.ts와 병존)

`~/.config/opencode/opencode.json` 편집:

```json
{
  "plugin": [
    "./plugins/agentmemory-capture.ts",
    "./plugins/oh-my-agentmemory/plugin.ts"
  ]
}
```

`agentmemory-capture.ts`는 제거하지 마세요 — 이 플러그인은 **쓰기 전용**이며
capture.ts의 관측이 계속되어야 합니다.

### 5. (선택) 슬래시 명령 심볼릭 링크

```bash
for f in am-recall am-save am-bootstrap am-status; do
  ln -sfn ~/Documents/oh-my-agentmemory/src/adapters/opencode/commands/${f}.md \
          ~/.config/opencode/commands/${f}.md
done
```

### 6. opencode 재시작

`/am-status`로 확인 — pinned slots이 채워져 있어야 합니다.

---

## 슬래시 명령

| 명령 | 동작 |
|---|---|
| `/am-recall <쿼리>` | `memory_recall`로 과거 관측 + lessons 검색 |
| `/am-save <텍스트>` | `memory_save`로 통찰을 장기 메모리에 저장 |
| `/am-bootstrap` | 지금 당장 빈 slots 재부트스트랩 (cwd 프로젝트 감지가 틀렸을 때 사용) |
| `/am-status` | slot 채움 상태 + 최근 세션 + 최신 lessons + crystal 후보 표시 |

---

## 설정

모두 선택 사항. opencode 어댑터가 환경 변수에서 읽습니다.

| 변수 | 기본값 | 효과 |
|---|---|---|
| `AGENTMEMORY_URL` | `http://localhost:3111` | agentmemory 서버 기본 URL |
| `AGENTMEMORY_SECRET` | `""` | 서버에서 인증 활성화 시 Bearer 토큰 |
| `OH_AM_DEBUG` | `0` | `1`로 설정하면 stderr에 상세 로깅 |
| `OH_AM_DISABLE` | `""` | 비활성화할 목적 이름들의 콤마 목록: `enforcement`, `init`, `intent`, `archive`, `learning` (예: `intent,learning`) |

예: `OH_AM_DEBUG=1 OH_AM_DISABLE=learning opencode`

---

## 아키텍처

헥사고날 (ports & adapters). `core/` 계층은 I/O가 전혀 없는 순수 TypeScript로,
단위 테스트가 쉽고 다른 에이전트로의 포팅도 쉽습니다.

```
oh-my-agentmemory/
├── src/
│   ├── core/                       # agent 무관, 순수 TS, I/O 없음
│   │   ├── directives.ts           # buildDirective(ctx) → string
│   │   ├── bootstrap.ts            # SLOT_TEMPLATES + detectProject(cwd)
│   │   ├── keywords.ts             # 한영 키워드 패턴
│   │   ├── lessons.ts              # buildLessonFromFileHistory() → LessonCandidate
│   │   ├── policy.ts               # rules/memory.md를 데이터로 인코딩
│   │   └── types.ts                # 공유 타입
│   │
│   └── adapters/
│       └── opencode/               # 현재; claude-code/codex는 추후
│           ├── plugin.ts           # 단일 진입점, 모든 훅 등록
│           ├── client.ts           # agentmemory HTTP 래퍼
│           ├── hooks/
│           │   ├── system-transform.ts   # enforcement
│           │   ├── session-created.ts    # init
│           │   ├── chat-message.ts       # intent
│           │   ├── session-idle.ts       # archive
│           │   └── file-edited.ts        # learning
│           └── commands/
│               ├── am-recall.md
│               ├── am-save.md
│               ├── am-bootstrap.md
│               └── am-status.md
│
└── tests/
    └── core/                       # 35 단위 테스트 (네트워크 없음)
        ├── directives.test.ts
        ├── keywords.test.ts
        └── bootstrap.test.ts
```

### 향후 다른 에이전트

`adapters/claude-code/`와 `adapters/codex/`는 `core/`를 수정 없이 재사용합니다 —
훅 glue만 다릅니다. 헥사고널 분리가 포팅 비용을 "에이전트당 어댑터 파일 하나"로
줄여줍니다.

---

## 테스트

```bash
bun install
bun run test            # vitest, 35 테스트, ~600ms
bun run typecheck       # tsc --noEmit, strict 모드
```

모든 테스트는 `core/`를 대상으로 합니다 — 순수 함수, 결정론적, 네트워크 없음.
어댑터 동작은 실행 중인 agentmemory 서버 대상으로 수동 검증합니다.

---

## 비교

| | 내장 (CLAUDE.md / rules/) | `agentmemory-capture.ts` | **oh-my-agentmemory** |
|---|---|---|---|
| 계층 | 정적 정책 파일 | 플러그인 (읽기 쪽) | **플러그인 (쓰기 쪽)** |
| 관측 캡처 | 아니오 | 예 (22+ 훅) | 아니오 (capture.ts가 수행) |
| LLM이 `memory_save` 부르게 강제 | 명예 시스템 | 아니오 | **예 (매 턴 directive)** |
| 빈 slots 채움 | 아니오 | 아니오 | **예 (cwd 기반 부트스트랩)** |
| "이거 기억해" / "remember"에 반응 | 아니오 | 아니오 | **예 (키워드 감지)** |
| 버그 히스토리에서 자동 lesson 저장 | 아니오 | 아니오 | **예 (file.edited 훅)** |
| `memory_crystallize` 제안 | 아니오 | 아니오 | **예 (idle + done ≥3)** |
| 클라우드 의존성 | 없음 | 없음 | 없음 |
| 비용 | $0 | $0 | $0 |

이 플러그인은 capture.ts와 **보완적**이지 경쟁적이지 않습니다. 둘 중 하나를
끄면 루프의 절반을 잃습니다.

### vs opencode-supermemory

[opencode-supermemory](https://github.com/supermemoryai/opencode-supermemory)는
클라우드 호스팅 메모리, Notion/Drive 연동, 자동 사용자 프로필, 원라인 설치를
원할 때 올바른 선택입니다.

oh-my-agentmemory는 다음 경우에 올바른 선택입니다:

- 이미 agentmemory를 로컬에서 실행 중이고 50+ 세션의 데이터에 투자했음
- 모두 자체 호스팅으로 유지하고 싶음 (클라우드 없음, API 키 없음)
- supermemory의 3개 대신 agentmemory의 54-MCP-도구 표면(slots, lessons, crystals,
  actions, insights, 통합 파이프라인)이 필요함
- "자동 API 추출"보다 "directive 강화"를 선호

두 플러그인은 다른 메모리 시스템에 push하므로 공존할 수 있습니다.

---

## 문제 해결

<details>
<summary><b>directive가 시스템 프롬프트에 나타나지 않음</b></summary>

1. 플러그인 로드 확인: `OH_AM_DEBUG=1`로 opencode 로그에서 `[oh-am] plugin loaded` 확인
2. `opencode.json`에 두 항목(capture.ts AND oh-my-am/plugin.ts)이 모두 있는지 확인
3. 심볼릭 링크 대상 존재 확인: `ls -la ~/.config/opencode/plugins/oh-my-agentmemory/plugin.ts`
4. agentmemory 서버 동작 확인: `curl http://localhost:3111/agentmemory/health`

</details>

<details>
<summary><b>session.created 이후에도 slots이 비어 있음</b></summary>

1. `/am-bootstrap`을 실행해 강제 재부트스트랩 및 제안 내용 확인
2. `OH_AM_DEBUG=1`로 `[oh-am] bootstrap filled N/N slots` 로그 확인
3. 감지가 잘못된 프로젝트를 고르면 `src/core/bootstrap.ts`의 `PROJECT_MAP`에 cwd 추가
4. `init` hook이 `OH_AM_DISABLE=init`으로 비활성화되어 있을 수 있음

</details>

<details>
<summary><b>lesson이 너무 많이 저장됨 (learning 잡음)</b></summary>

`learning` hook은 기본적으로 보수적입니다 — 파일 히스토리의 에러 신호 AND 의미 있는
편집 크기가 모두 필요합니다. 그래도 시끄러우면:

1. 일시 비활성화: `OH_AM_DISABLE=learning`
2. `src/core/lessons.ts`에서 필터 조정:
   - `MIN_EDIT_LINES` 올리기 (기본 5)
   - 테스트 파일이나 생성 코드를 스킵하는 제외 패턴 추가
   - `ERROR_KEYWORDS`를 더 구체적으로 확장

</details>

<details>
<summary><b>directive가 너무 장황 / 토큰 예산에 악영향</b></summary>

directive 본문은 약 600 토큰입니다. 줄이려면:

1. `src/core/policy.ts` 편집 — 규칙 텍스트 단축
2. 또는 `system-transform.ts`에서 `buildDirective(ctx, { compact: true })` 호출 — 규칙 본문을 드롭하고 상태/키워드 라인만 유지

</details>

<details>
<summary><b>caveman 또는 다른 플러그인과 충돌</b></summary>

opencode는 모든 플러그인의 훅을 순차적으로 실행합니다. 여러 플러그인이
`output.system[]`에 push할 수 있으며 충돌 없음 — caveman은 자신의 강화 라인을,
oh-my-am은 자신의 directive를 push하며 둘 다 LLM에 도달합니다.

</details>

---

## 개발

```bash
git clone https://github.com/dev-hann/oh-my-agentmemory.git
cd oh-my-agentmemory
bun install
bun run test         # 35 단위 테스트
bun run typecheck    # strict TS
```

`core/` 계층은 I/O가 없어 모든 함수를 격리해서 테스트할 수 있습니다.
어댑터 테스트는 agentmemory 서버가 실행 중이어야 합니다.

### 로드맵

- **Skill 계층** — `using-agentmemory` opencode Skill (관련 있을 때 opencode가 자동
  로드, directive보다 강제성 큼)
- **Claude Code 어댑터** — `adapters/claude-code/` (`.claude/settings.json` 훅 스크립트가
  `core/`를 호출)
- **Codex 어댑터** — `adapters/codex/` (Codex 훅 포맷)
- **npm 게시** — `bunx oh-my-agentmemory install --agent X` CLI 설치자

기여 환영. 범위 논의를 위해 먼저 이슈를 여세요.

---

## 제거

```bash
# opencode.json의 plugin[]에서 제거
# 심볼릭 링크 제거
rm ~/.config/opencode/plugins/oh-my-agentmemory
rm ~/.config/opencode/commands/am-{recall,save,bootstrap,status}.md
# (선택) 소스 트리 제거
rm -rf ~/Documents/oh-my-agentmemory
```

agentmemory 데이터는 그대로 유지 — directive 플러그인만 제거됩니다.

---

## 라이선스

[MIT](./LICENSE) © dev-hann

## 감사

- [agentmemory](https://github.com/rohitg00/agentmemory) — 이 플러그인이 구동하는 메모리 엔진
- [agentmemory-capture.ts](https://github.com/rohitg00/agentmemory/blob/main/plugin/opencode/agentmemory-capture.ts) — 이 플러그인이 보완하는 정규 관측 플러그인
- [opencode-supermemory](https://github.com/supermemoryai/opencode-supermemory) — 키워드 감지 및 reasoned-recall directive 패턴의 참고 구현
- [caveman](https://github.com/JuliusBrussee/caveman) — 매 턴 system.transform 강화의 참고 구현
