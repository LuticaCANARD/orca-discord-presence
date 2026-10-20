# Orca Discord Presence

[English](README.md) · **한국어** · [日本語](README.ja.md) · [简体中文](README.zh-CN.md)

[Orca](https://github.com/stablyai/orca) 에이전트 플릿이 하는 일을 Orca 로고와 함께 Discord 상태에 게시한다.

```text
┌──────┐  Orca                                                    ← minimal (default)
│ logo │  2 agents working · 1 blocked · across 2 worktrees   (3 of 5)
└──────┘  12:40 elapsed

┌──────┐  Orca · checkout-service · feat/ipc                      ← full
│ logo │  2 agents working · 1 wrapping up · in checkout-service, web   (3 of 5)
└──────┘  12:40 elapsed
```

첫 줄은 **헤더**이며 직접 정할 수 있다. 둘째 줄은 [플릿 줄](#플릿-줄)로, 끝에 Discord 자체의 파티 게이지(Orca가 알려 준 에이전트 중 바쁜 에이전트 수)가 붙는다. 타이머는 Orca를 켜 둔 시간이 아니라 [현재 작업 구간](#경과-타이머)을 잰다.

TypeScript로 작성되었고 런타임 의존성이 없다. Discord Rich Presence IPC 프로토콜을 `node:net` 위에서 직접 주고받는다.

## 요구 사항

- 플러그인 시스템이 켜진 Orca `>= 1.4.0` (Settings → Plugins). 마지막으로 Orca `1.4.230`에서 확인했다. [호환성](#호환성) 참고
- 같은 컴퓨터에서 실행 중인 Discord **데스크톱** 앱 (웹 클라이언트는 로컬 IPC 소켓을 열지 않는다)

그 밖에는 필요 없다. 플러그인에 Discord 애플리케이션 id가 포함되어 있어서, 에이전트가 무언가를 하는 순간부터 게시를 시작한다.

## 설치

Settings → Plugins → *Add marketplace*에서 아래 URL을 붙여 넣고 동의 대화상자를 수락한다.

```text
https://github.com/LuticaCANARD/orca-discord-presence.git#v0.3.1
```

`#v0.3.1`이 중요하다. 이것이 없으면 Orca는 계속 바뀌는 `main`에서 인덱스를 읽는다. 대화상자에는 아래의 [권한](#요청하는-권한)이 나열된다. 플러그인을 직접 고쳐 보려면 [개발](#개발)을 참고한다.

## 게시되는 내용

이 절의 내용은 설정할 수 없다. 카드에 무엇이 표시되는지와 그 이유를 설명한다.

### 플릿 줄

에이전트는 `working`, `blocked`, `waiting` 중 하나일 때 바쁜 것으로 센다. Orca는 뒤의 두 상태를 똑같이 "에이전트가 사용자의 주의를 필요로 함"으로 표시한다. 그래서 권한 확인 프롬프트에 멈춰 있는 플릿도 유휴로 읽히지 않고 타이머가 계속 돈다. 그리고 막힌 것과 질문받은 것은 서로 다른 소식이므로 각각 별도 구간으로 표시한다.

`working`은 Orca의 **결합(combined)** 상태이며, 이 단어에는 숨은 의미가 있다. 패널은 메인 에이전트 *또는 살아 있는 서브에이전트* 중 하나라도 일하면 `working`으로 읽힌다. 따라서 메인 에이전트가 끝났어도 서브에이전트가 돌고 있으면 여전히 센다. 이제 호스트가 결합 상태 옆에 메인 에이전트 자체의 상태도 보고하므로, 그런 패널은 `1 wrapping up`으로 따로 떼어 working 수에서 뺀다. working 패널 세 개 중 하나가 서브에이전트의 마무리라면 `2 agents working · 1 wrapping up`으로 읽히고, 에이전트 네 개로 읽히는 일은 없다. 메인 에이전트 정보를 보내지 않는 호스트는 어느 쪽인지 말해 주지 않으므로, 그 패널은 그냥 working 에이전트로 남는다.

*잘못 끝난* 턴은 일부러 표시하지 않는다. 호스트는 메인 에이전트의 마지막으로 끝난 턴에 대한 판정(`failure`, 입증된 `interruption`, 누군가 요청한 `cancellation`)을 보고하지만, 공개 프로필의 실패 횟수는 소식으로서의 가치가 사라진 몇 분 뒤에는 소음일 뿐이다. 대신 **Show Connection Status**(연결 상태 보기)가 최근 실패를 조치할 수 있는 곳에서 보고한다.

### 경과 타이머

타이머는 플릿의 현재 작업 구간이 시작된 시점부터 센다. 이 시점에 대한 답은 두 가지가 있고, 호스트의 답이 더 낫다. `mainAgent.stateStartedAt`은 에이전트 자신의 상태가 시작될 때 찍히지만, 이 플러그인은 자신이 *알아챈* 시점만 알 수 있다. 그 차이가 바로 중요한 경우다. Orca는 유휴 플러그인 워커를 5분 뒤 회수하고 다음 이벤트가 오면 다시 띄우며, 에이전트가 이미 돌고 있을 때 플러그인을 켤 수도 있다. 호스트의 시각은 두 경우 모두 살아남지만, 로컬에서 관찰한 시각은 시계를 0부터 다시 시작한다.

그래서 아직 바쁜 에이전트 중 가장 이른 자체 시각을 쓰고, 로컬 관찰값은 대체값으로 쓴다. 마무리 중인 패널은 기준이 되지 않는다. 그 시각은 서브에이전트가 마무리하는 작업의 시작이 아니라 메인 에이전트가 `done`이 된 시점이기 때문이다. 시각은 에이전트가 실행되는 컴퓨터에서 찍히는데, SSH 호스트라면 이 컴퓨터가 아니다. 그래서 1분 넘게 미래이거나 하루보다 오래된 값은 미래에서 거꾸로 세는 타이머로 게시하지 않고 버린다. **Show Connection Status**가 타이머가 둘 중 어느 쪽을 쓰는지 알려 준다.

### 파티 게이지

Discord는 상태 줄 옆에 `(3 of 5)`를 표시한다. Orca가 상태를 보고한 패널 중 바쁜 에이전트 수다. 이름이 담기지 않으므로 `full`과 `minimal` 모두에서 게시되며, 바쁜 것이 없으면 사라진다. `(0 of 5)`는 유휴 플릿이 아니라 고장 난 파티처럼 읽히기 때문이다. 함께 보내는 파티 id는 워커마다 무작위이고 참가할 수 없다. Rich Presence는 프로필에 **Join** 버튼을 띄우려면 참가 비밀값(join secret)이 필요한데, 이 플러그인은 그것을 절대 보내지 않는다.

## 프라이버시

**기본값은 `minimal`이며, 의도한 것이다.** 브랜치 이름에는 티켓 id나 고객사 이름이 흔히 들어간다. 플러그인을 켜는 순간 그런 이름을 게시하는 상태는 나쁜 기본값이다.

| 단계 | 게시되는 것 |
| --- | --- |
| `full` | 헤더, 포커스된 워크스페이스, 브랜치, 에이전트 수, 에이전트가 일하고 있는 워크스페이스 |
| `minimal` *(기본값)* | 헤더와 에이전트 수. 바쁜 worktree는 개수만 세고 이름은 절대 쓰지 않는다. 헤더의 `{workspace}`와 `{branch}`는 빈 값이 된다 |
| `off` | 아무것도 없음. 상태를 지운다 |

**Cycle Privacy Level**(프라이버시 단계 순환) 명령으로 단계를 바꾼다. `minimal`의 가림은 관례가 아니다. 테스트가 그 단계에서 프로젝트, 브랜치, 워크스페이스 이름이 페이로드에 들어가지 않음을 검증한다.

워크스페이스 이름은 worktree의 디렉터리 이름에서 가져오고, 없으면 브랜치를 쓴다. 플러그인이 실행 중일 때 Orca가 알려 준 worktree만 이름을 붙일 수 있으므로, `full` 상태는 빈칸이 되는 대신 `across 2 worktrees`로 물러나며, 긴 목록은 `in api, cli, docs +2`처럼 줄어든다.

## 명령

| 명령 | 동작 |
| --- | --- |
| `Discord Presence: Toggle` | 게시를 켜거나 끈다 |
| `Discord Presence: Cycle Privacy Level` | 명령 인자로 단계를 정하고, 인자가 없으면 `full` → `minimal` → `off` → … 순으로 순환한다 |
| `Discord Presence: Set Header` | 명령 인자로 첫 줄을 정하고, 인자가 없으면 프리셋을 순환한다 |
| `Discord Presence: Reconnect` | Discord 연결을 끊고 즉시 다시 게시한다 |
| `Discord Presence: Show Connection Status` | 게시 중인 내용, 로고와 배지 키, 최근 잘못 끝난 턴, 연결 상태, 소켓 경로, 마지막 오류 |

모든 명령의 결과는 저장된다. 뭔가 이상해 보이면 가장 먼저 **Show Connection Status**를 실행한다. 마지막 게시가 왜 실패했는지 알려 준다.

**Reconnect**(재연결)는 백오프가 해결하지 못하는 경우를 위한 것이다. Discord가 Orca보다 늦게 시작되었거나, 플릿이 조용할 때 재시작된 경우다. 플러그인은 스스로 재시도하지만 워커가 살아 있을 때만 그렇고, Orca는 유휴 워커를 5분 뒤 회수한다([알려진 제약](#알려진-제약) 참고). 이 명령을 실행하면 워커가 다시 띄워지고, *동시에* 그 워커가 곧바로 연결한다.

### 단축키

모든 명령은 **Settings → Shortcuts → Plugins**에 나타나며, 자주 쓰는 명령에 키 조합을 기록할 수 있다. `Toggle`과 `Cycle Privacy Level`이 가장 유력한 후보다.

**플러그인은 기본 키 조합을 일부러 제공하지 않는다.** Orca에게 매니페스트의 키 바인딩은 *지시성 콘텐츠(instructional content)*다. 이를 선언하면 사용자의 동의가 플러그인의 파일 트리에 묶이므로, 모든 릴리스가 Settings → Plugins에서 *Needs review* 상태로 도착하게 된다. 또한 다른 플러그인의 키 조합과 겹치면 **두** 플러그인의 명령이 모두 비활성화된다. 직접 기록한 단축키는 재정의(override)이므로 업데이트 후에도 남고, 이런 비용이 없다.

## 설정

모든 설정에는 동작하는 기본값이 있다. 이 절은 그것을 바꾸려는 경우를 위한 것이다.

### 헤더

**Set Header**(헤더 설정) 명령을 쓰면 텍스트 편집기 없이 바꿀 수 있다.

- **인자가 있을 때** — 인자가 그대로 헤더가 되므로, 키 바인딩이나 자동화로 직접 지정할 수 있다: `"My Fleet"` 또는 `{ "header": "My Fleet" }`. 빈 문자열은 헤더를 숨긴다.
- **인자가 없을 때** — 프리셋을 순환한다. 명령 팔레트만으로 할 수 있는 것은 이것뿐이다.

  `Orca` → `{workspace}` → `{workspace} · {branch}` → *숨김* → `Orca` → …

`{workspace}`와 `{branch}`는 설정에 고정되는 것이 아니라 게시할 때 해석되며, 그 차이가 핵심이다. 헤더를 `checkout-service`로 적어 두면 `minimal`로 내려도 그 이름을 계속 게시한다. `{workspace}`는 빈 값이 되고 `Orca`로 대체된다. 아무 값도 나오지 않은 토큰은 구분자도 함께 지우므로, 줄 끝에 가운뎃점이 남는 일은 없다.

### 로고와 배지

`largeImage`는 파일 경로가 아니라 **아트 에셋 키(art asset key)**다. Discord는 상태를 게시하는 애플리케이션에 업로드된 아트워크를 표시한다. 기본 제공 애플리케이션은 `orca` 키 아래 Orca 로고를 호스팅하고 있으므로 로고는 따로 설정할 필요가 없다.

`clientId`를 직접 만든 애플리케이션으로 바꾸면 이것이 더는 성립하지 않는다. 그 이름으로 아트워크를 업로드하기 전까지 `orca` 키는 아무 의미가 없다. 로고를 `orca`로 업로드하거나, `largeImage`를 사용한 키로 설정한다.

`smallImage`는 로고 모서리의 배지이며 **기본으로 꺼져 있다**. 기본 제공 애플리케이션에는 `orca` 외의 키로 된 아트워크가 없으므로, 기본값을 두면 빈 사각형이 게시된다. 직접 만든 애플리케이션에 배지를 업로드하고 그 키를 지정하면 켜진다. 얹힐 로고가 없는 배지는 혼자 게시되지 않고 버려진다.

### 내 Discord 애플리케이션으로 게시하기

헤더 *위* 줄은 *"Playing \<application name\>"*으로 표시되는데, 이 이름은 이 플러그인이 아니라 Discord 애플리케이션의 것이다. Rich Presence IPC에는 이를 위한 필드가 없다. `header`가 존재하는 이유가 바로 이것이다. 플러그인이 제어할 수 있는 가장 위의 줄이다. *"Playing …"* 줄 자체를 바꾸려면 직접 만든 애플리케이션으로 게시한다.

1. [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**
2. 상태에 표시되기를 원하는 이름을 붙인다
3. *General Information*의 **Application ID**를 `clientId`에 복사한다
4. *Rich Presence → Art Assets*에 아트워크를 업로드하고, `largeImage`를 그 키로 설정한다

Rich Presence 애플리케이션 id는 공개 식별자다. 모든 클라이언트의 IPC 통신에 실려 다니며, 그 자체로는 아무 권한도 주지 않는다. 민감한 쪽은 OAuth 클라이언트 시크릿인데, Rich Presence는 이를 전혀 필요로 하지 않고 이 플러그인도 요구하지 않는다. 그래서 id를 소스에 포함해 배포한다.

### 설정 파일

Orca에는 아직 플러그인별 설정 UI가 없으므로, 명령으로 다룰 수 없는 것은 직접 파일에 적는다.

| 플랫폼 | 경로 |
| --- | --- |
| Linux | `~/.config/Orca/plugins-data/lutica-canard.discord-presence/settings.json` |
| macOS | `~/Library/Application Support/Orca/plugins-data/lutica-canard.discord-presence/settings.json` |
| Windows | `%APPDATA%\Orca\plugins-data\lutica-canard.discord-presence\settings.json` |

```json
{
  "enabled": true,
  "privacy": "minimal",
  "clientId": "1234567890123456789",
  "header": "Orca",
  "largeImage": "orca",
  "largeText": "Orca",
  "smallImage": "",
  "smallText": ""
}
```

| 키 | 기본값 | 효과 |
| --- | --- | --- |
| `enabled` | `true` | 게시 여부 |
| `privacy` | `"minimal"` | [프라이버시](#프라이버시) 참고 |
| `clientId` | 기본 제공 id | 게시에 사용할 Discord 애플리케이션 |
| `header` | `"Orca"` | 첫 줄. `{workspace}`와 `{branch}`를 쓸 수 있고, `""`이면 숨긴다 |
| `largeImage` | `"orca"` | 로고의 아트 에셋 키. `""`이면 이미지를 게시하지 않는다 |
| `largeText` | `"Orca"` | 로고에 마우스를 올렸을 때의 툴팁 |
| `smallImage` | `""` *(꺼짐)* | 로고 모서리 배지의 아트 에셋 키 |
| `smallText` | `""` | 배지에 마우스를 올렸을 때의 툴팁 |

모든 키는 선택 사항이며, `""`은 *기본값*이 아니라 *끔*을 뜻한다. 파일을 반영하려면 Orca를 재시작하거나 플러그인을 껐다가 다시 켠다.

## 요청하는 권한

| 권한 | 이유 |
| --- | --- |
| `workspace:read` | `full` 프라이버시에서 쓰는 포커스된 워크스페이스 이름과 브랜치 |
| `events:subscribe` | worktree 생명주기와 에이전트 상태 변화 — 게시되는 데이터 자체 |
| `storage` | 플릿 상태가 워커 회수 후에도 살아남도록 (아래 참고) |
| `settings:own` | 플러그인 자신의 `enabled` / `privacy` / `clientId` / `header` / 아트워크 키 |
| `notifications:show` | 명령 결과 알림 |

`secrets`와 `terminal:send`는 일부러 **요청하지 않는다**.

## 호환성

2026-10-20에 최신 안정 데스크톱 릴리스 [`v1.4.230`](https://github.com/stablyai/orca/releases/tag/v1.4.230)과 `912c130` 시점의 Orca `main`을 기준으로 확인했다(`main` 자체의 패키지 버전은 `1.4.214`로 되어 있다. 릴리스 계열과 `main`은 번호를 따로 매기므로, 의미 있는 비교 기준은 그 번호가 아니라 소스의 동일성이다).

`v1.4.192` 확인 시점 이후 플러그인에 영향을 주는 변경 하나가 릴리스에 들어갔고, 이 버전은 그 위에 만들어졌다.

- **`plugin-events.ts` — `agent.status.changed`에 `mainAgent`가 추가되었다.** 이벤트의 `state`는 원래부터 Orca의 *결합* 상태였다. `working`은 메인 에이전트가 이미 끝났어도 살아 있는 서브에이전트가 있으면 해당된다. 새로 생긴 선택적 필드 `mainAgent`는 메인 에이전트 자체의 `state`, 마지막으로 끝난 턴의 `outcome`, 그리고 호스트가 찍은 `stateStartedAt`을 담는다. 이 플러그인은 이제 세 가지를 모두 사용한다. [플릿 줄](#플릿-줄)과 [경과 타이머](#경과-타이머) 참고.

그 밖에 바뀐 것은 모두 리팩터링이며, 읽어 보고 무해하다고 판단했다.

- **`plugin-manifest.ts`** — `isQualifiedPluginKey`, `pluginPanelTabKey`, `isPluginPanelTabKey`가 새 파일 `plugin-tab-key.ts`로 옮겨지고 다시 export된다(릴리스됨). `main`에서는 추가로 스키마 객체에 `pluginManifestV1Object`라는 이름이 붙었고, `contributes`의 기본값이 직접 쓴 리터럴 대신 `prefault({})`로 채워진다. 빈 배열 일곱 개로 동일하며, 이 플러그인처럼 `contributes`를 직접 선언하는 매니페스트에는 아무 영향이 없다.
- **`plugin-marketplace.ts`** (`main`에만 있음) — 필드 맵이 추출되었고, 카테고리 중복과 id 중복 검사에 이름이 붙었다. 규칙은 같다.

둘 다 필드 이름을 바꾸거나 검증 대상을 바꾸지는 않지만, 사전 작업처럼 보인다. 명시적으로 *V1*이라 이름 붙은 스키마 객체, 그리고 이제 파일 이름을 매개변수로 받는 마켓플레이스 리더가 그렇다.

Orca는 패널별로 아는 정보를 계속 늘리고 있다. `main`은 상태 행에 `programStatus` 항목(프로그램 자체의 OSC 7501 진행률, 메시지, 블록)을 추가했다. 하지만 플러그인에 전달되는 투영은 바뀌지 않았으므로 그중 어느 것도 `agent.status.changed`에 도달하지 않는다. 네 필드와 `mainAgent`가 여전히 이벤트의 전부다.

엔진 하한은 `>=1.4.0`으로 유지한다. 모든 계약 변경이 추가적이고 `mainAgent`는 선택 사항이므로, 이를 보내지 않는 호스트에서 플러그인은 이전과 똑같이 동작한다.

업스트림을 다시 읽고 변경이 없음을 확인했다. 아래는 `src/lib/orca-api.mts`가 옮겨 적은 계약들이다.

| 업스트림 계약 | 상태 |
| --- | --- |
| Host API v0 메서드 표 (`plugin-host-api.ts`) | 메서드 13개, 모두 여전히 `experimental`. `workspace.readContext`는 여전히 `{ branch, displayName, terminals }`를 반환한다 |
| 이벤트 집합 (`plugin-events.ts`) | 여전히 worktree/에이전트 이벤트 세 개뿐이며 포커스 변경 이벤트는 없다. `agent.status.changed`는 이제 선택적 `mainAgent`도 담는다 |
| 권한 종류 (`plugin-capabilities.ts`) | 여전히 범위 없는 종류 일곱 개. 여전히 `net:*` 없음 |
| 에이전트 상태 (`agent-status-types.ts`) | 여전히 `working` / `blocked` / `waiting` / `done`. 행의 풍부한 내부 정보 중 플러그인 이벤트 페이로드에 도달하는 것은 `mainAgent`뿐이다 |
| 워커 환경 (`plugin-worker-env.ts`) | 여전히 `XDG_RUNTIME_DIR`이 빠진 허용 목록 |
| 유휴 회수 (`plugin-host-protocol.ts`) | 여전히 5분 |
| 설정과 저장소 위치 | 여전히 `<userData>/plugins-data/<publisher>.<id>/` |
| 매니페스트와 마켓플레이스 스키마 | 스키마 변경 없음 (`plugin-manifest.ts`의 변화는 헬퍼 이동). `commands[].context`는 여기서 선언한다 |

`orca-compatibility.json`은 검토한 Git blob id를 기록한다. 읽기 전용인 **Orca compatibility** 워크플로가 매주 월요일 최신 안정 릴리스와 `main`을 확인한다. 파일이 바뀌지 않았더라도 새 안정 버전이 나오거나, 어느 쪽 ref에서든 계약이 바뀌면 실패하여 이 절과 직접 작성한 API 타입을 다시 검토하게 만든다. 같은 검사를 로컬에서 `npm run check:orca-compatibility`로 실행할 수 있다(공개 GitHub API에 대한 네트워크 접근이 필요하다).

`main`은 릴리스보다 몇 주 앞서 가므로, 어떤 파일은 출시되기 한참 전부터 그곳에서 바뀐 채로 있을 수 있다. 그런 미출시 객체 id는 읽고 난 뒤 `verifiedMain`에 넣는다. 그러면 검사는 그 id에 대해 조용히 넘어가지만, `main`이 그 id를 지나 움직이는 순간 다시 실패하고, `main`이 릴리스된 id로 되돌아오면 그 재정의가 쓸모없어졌다고 알린다. 아무도 지우지 않는 재정의는 다음에 그 경로에 들어오는 무엇이든 계속 눈감아 줄 것이기 때문이다.

매니페스트에 넣을 수 있지만 일부러 넣지 않은 기여(contribution) 종류:

- **`keybindings`** — [단축키](#단축키) 참고.
- **`panels`** — 샌드박스된 패널은 `workspace.readContext`, `terminal.sendText`, `notifications.show`만 호출할 수 있다. 플러그인 저장소와 설정은 워커 전용이므로, 프레즌스 패널은 플러그인이 무엇을 게시하는지 읽을 수 없다. 아직 표시할 것이 없다.
- **`languagePacks`, `vmRecipes`, `agents`** — 다른 종류의 플러그인을 위한 콘텐츠 팩이다.
- **`icon`** — 호스트가 검증은 하지만, 아직 플러그인 목록 어디에도 표시되지 않는다.

## 알려진 제약

**상태는 설계상 일시적이다.** Orca는 진행 중인 작업이 없는 플러그인 워커를 5분 뒤 회수하고(`PLUGIN_WORKER_IDLE_REAP_MS`) 다음 이벤트가 오면 다시 띄운다. 워커는 스스로를 살려 둘 수 없다. 유휴 시계를 갱신하는 것은 호스트→워커 통신뿐이다. 그래서 프레즌스는 플릿이 활동하는 동안 나타나고, 몇 분간 조용하면 사라졌다가, 다음 에이전트 이벤트에 다시 나타난다. 플릿 상태는 플러그인 저장소에 저장되므로 그 사이에 잃는 것은 없으며, 6시간보다 오래된 상태는 아직 살아 있는 것처럼 복원하지 않고 버린다.

**포커스된 워크스페이스는 푸시가 아니라 폴링으로 얻는다.** Orca는 포커스 변경 이벤트를 보내지 않으므로, `full` 프라이버시에서는 30초마다 워크스페이스와 브랜치를 새로 읽고 다시 게시한다. **Show Connection Status**와 **Reconnect**는 즉시 새로 읽는다.

**명령 인자는 호스트에 달려 있다.** Orca가 인자를 전달해 주면 **Set Header**는 문자열이나 `{ header }`를, **Cycle Privacy Level**은 단계나 `{ privacy }`를 받는다. `1.4.192` 기준으로 이를 전달하는 호스트 경로는 없다. IPC는 인자를 실어 나르지만, 팔레트와 기록된 단축키 모두 인자 없이 명령을 호출한다. 이것이 바뀌기 전까지는 순환이 유일한 인터페이스이며, 자유로운 헤더는 설정 파일에 적어야 한다.

**작업 시작 시각은 에이전트 자신의 호스트에서 온다.** `mainAgent.stateStartedAt`은 에이전트가 실행되는 컴퓨터가 찍으므로, 시계가 어긋난 SSH 호스트는 Discord 타이머를 움직일 수 있다. 이 컴퓨터보다 1분 넘게 앞서거나 하루보다 오래된 시각은 버리고 로컬에서 관찰한 시점을 쓴다. 그보다 적게 어긋난 시계는 어긋난 만큼 경과 시간을 밀어낸다.

**Linux 소켓 탐색은 휴리스틱이다.** Orca의 워커 환경은 `XDG_RUNTIME_DIR`을 빼놓은 허용 목록이므로, `/run/user/<uid>`를 `process.getuid()`로 재구성한다. Flatpak과 Snap 배치도 함께 탐색한다.

**플러그인 API는 업스트림에서 EXPERIMENTAL이다.** Orca 자체 문서는 `pluginApi` v1이 고정되기 전까지 호환성을 약속하지 않는다. 지금 로컬 소켓을 열 수 있는 것은 권한 모델에 아직 `net:*` 종류가 없기 때문일 뿐이며, 소스에는 범위가 지정된 종류가 계획되어 있다고 적혀 있다. 앞으로의 Orca가 이를 제한할 수 있고, 그러면 플러그인이 계속 동작하려면 권한을 선언해야 한다.

**Discord는 `SET_ACTIVITY` 호출 횟수를 제한한다.** 업데이트는 디바운스(1.5초)되고 게시 사이에 최소 4초 간격을 두며, 동일한 페이로드는 아예 건너뛴다.

**워커 자체 로그는 Settings에 있다.** **Show Connection Status**로 부족하면 Settings → Plugins → *View logs*에서 워커가 남긴 로그를 볼 수 있다. 연결 실패, 권한 거부, 거부된 이벤트가 모두 여기에 남는다.

## 개발

```bash
git clone https://github.com/LuticaCANARD/orca-discord-presence.git
cd orca-discord-presence
npm install
npm run build      # tsc → dist/
npm test           # build + node --test (99 tests)
npm run typecheck  # no emit
```

Settings → Plugins → *Add development plugin*에서 체크아웃한 디렉터리를 고르면 Orca에 불러온다.

```text
orca-plugin.json            manifest (validated against the host schema by a test)
orca-marketplace.json       marketplace index — lets this repo be its own source
orca-compatibility.json     reviewed Orca release and plugin-contract object ids
scripts/check-orca-compatibility.mjs
                            latest-release and main contract drift check
src/main.mts                worker entry: activate/deactivate, commands, events
src/lib/orca-api.mts        hand-maintained types for Orca's plugin worker API
src/lib/presence-model.mts  pure state model — events in, activity payload out
src/lib/discord-ipc.mts     Rich Presence IPC client over node:net
src/lib/socket-path.mts     socket discovery across platforms and sandboxes
orca-compatibility.json     reviewed upstream blob ids — the baseline the weekly check compares against
scripts/check-orca-compatibility.mjs  the check itself (also runs as a workflow)
.github/actions/verify-build  the gates, shared by CI and both release paths
.github/workflows/          CI, tag-and-release, release, orca-compatibility
```

설치되는 트리는 해시되며 파일 2,000개, 50 MiB로 제한된다. 이 저장소는 그 한도에 닿을 걱정이 전혀 없다. 컴파일된 결과물이 그 안에 함께 들어간다는 점 때문에 알아 둘 만할 뿐이다.

`dist/`는 **의도적으로 커밋한다.** Orca는 호스트 쪽 빌드 단계 없이 플러그인 디렉터리를 그대로 설치하므로, 컴파일된 진입점이 저장소에 있어야 한다. `dist/`와 `src/`가 일치하지 않으면 CI가 빌드를 실패시킨다.

Orca는 플러그인 작성자용 타입 패키지를 제공하지 않으므로, `src/lib/orca-api.mts`가 호스트의 계약(`plugin-host-api.ts`, `plugin-events.ts`, `plugin-capabilities.ts`)을 옮겨 적는다. Orca 업그레이드 후 그곳에서 타입 오류가 나면 실제 신호다. 캐스팅으로 덮기 전에 읽어 본다.

### 릴리스 만들기

**버전을 올리는 것이 곧 릴리스다.** 버전은 네 곳에 있으며, 서로 다르면 테스트가 실패한다.

1. `package.json` → `version`
2. `orca-plugin.json` → `version`
3. `orca-marketplace.json` → `plugins[].source.ref` (`v<version>` 형식)
4. `README.md`와 번역본(`README.ko.md`, `README.ja.md`, `README.zh-CN.md`) → 설치 URL의 `#v<version>` 프래그먼트

`npm run build`를 실행하고, 변경된 파일을 모두 커밋한 뒤 `main`에 병합한다. 그러면 **Tag and release**가 매니페스트 버전을 읽고, 그 태그가 이미 있으면 멈추고, 게이트를 실행한 다음에야 태그를 만들고 릴리스를 게시한다. 그래서 태그는 자체 검사에 실패한 트리를 가리키는 일이 없고, 노트북에서 태그를 다는 일도 없다. `0.4.0-rc.1` 같은 버전은 프리릴리스로 게시된다.

예전 방식도 여전히 동작한다. `v*` 태그를 직접 푸시하면 **Release**가 그것을 매니페스트와 대조해 검증하고 게시한다. 이 방법은 일반 릴리스가 아니라 오래된 커밋에서 릴리스를 다시 만들 때 쓴다.

| 워크플로 | 트리거 | 하는 일 |
| --- | --- | --- |
| **CI** | `main`으로의 모든 푸시, 모든 PR | 게이트 |
| **Tag and release** | `main`으로의 푸시 | 아직 태그가 없는 버전에 태그를 달고 게시한다 |
| **Release** | 직접 푸시한 `v*` 태그 | 태그를 매니페스트와 대조해 검증하고 게시한다 |
| **Orca compatibility** | 매주 월요일, 또는 수동 실행 | 업스트림을 읽고 검토되지 않은 것이 있으면 실패한다 |

게이트 자체(타입 검사, 빌드, `src/`와 일치하는 `dist/`, 테스트)는 `.github/actions/verify-build` 한 곳에만 있으므로, 세 경로 중 어느 것도 다른 경로와 몰래 어긋날 수 없다.

마켓플레이스 목록은 `main`이 아니라 **릴리스 태그**를 고정한다. 브랜치 ref는 다음 마켓플레이스 갱신 때 그 시점의 HEAD로 다시 해석되어, 사용자를 미출시 커밋으로 조용히 옮겨 버린다. 테스트가 ref가 태그인지, 그리고 매니페스트 버전과 일치하는지를 강제한다.

## 라이선스

MIT
