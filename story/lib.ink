// pocket-hologram 스토리 표준 라이브러리. main.ink 맨 위에서 INCLUDE lib.ink 로 넣는다.
// 게임이 붙여 주는 외부 함수(EXTERNAL)와, 함수마다 대신 쓰는 기본 구현이 들어 있다. 기본 구현 덕분에 Inky나
// 개발자 도구의 퍼즈 테스트에서도 그대로 돌아간다. 게임 안에서는 실제 값(시계, 맵, VR 여부 등)이 들어간다.

// 트리거 노트(# on: ...)를 깨운 이벤트 이름과 값. 러너가 노트로 넘어가기 직전에 써 넣는다.
VAR event = ""
VAR event_value = 0

// 지금 시각 (브라우저 시계)
EXTERNAL hour()
=== function hour() ===
~ return 12
EXTERNAL minute()
=== function minute() ===
~ return 0
// 0 = 일요일 .. 6 = 토요일
EXTERNAL weekday()
=== function weekday() ===
~ return 1
// "MM-DD" (생일, 기념일)
EXTERNAL date()
=== function date() ===
~ return "01-01"
// "morning" 5-11시, "day" 11-17시, "evening" 17-20시, "night" 20-5시
EXTERNAL period()
=== function period() ===
~ return "day"

// 지금 맵 id ("crossing", "classroom", "pool", "sky", "citadel", "noneuclid"; 맵 없음 = "")
EXTERNAL map()
=== function map() ===
~ return "classroom"
// VR 헤드셋을 쓰고 있으면 true
EXTERNAL vr()
=== function vr() ===
~ return false
// 바로 코앞(얼굴 앞)에 있으면 true
EXTERNAL near()
=== function near() ===
~ return false

// 지난번 방문에서 몇 시간 지났나 (처음이면 -1)
EXTERNAL away()
=== function away() ===
~ return -1
// 몇 번째 방문인가 (1부터)
EXTERNAL visits()
=== function visits() ===
~ return 1

// 이 모션 클립이 있나 (에셋은 각자 내려받는 것이라 없을 수도 있다)
EXTERNAL has_motion(motion_name)
=== function has_motion(motion_name) ===
~ return true
// 이 추억이 열려 있나 (세이브와 상관없이, 한 번이라도 본 적 있으면)
EXTERNAL memory(memory_id)
=== function memory(memory_id) ===
~ return false
