# Pocket Hologram v0.2

Galaxy S21 Ultra의 전면 RGB 카메라로 관찰자의 눈 위치를 metric 좌표로 추정하고, 스마트폰 화면을 실제 창으로 취급해 head-coupled off-axis perspective를 렌더링하는 실험입니다.

## v0.2
- MediaPipe iris landmarks
- 홍채의 실제 크기(기본 11.7 mm) + camera HFOV를 이용한 metric Z 추정
- eye image position + focal length로 metric X/Y 추정
- S21 Ultra 기본 screen/camera preset
- camera-to-screen offset calibration
- One Euro Filter 기반 저지연 smoothing
- physical screen dimensions 기반 asymmetric off-axis frustum
- depth 판단이 쉬운 test chamber
- runtime calibration/debug panel
- GLB/GLTF/FBX/PMX/PMD 로컬 파일 로드 (파일 선택 또는 드래그&드롭, 텍스처·.bin 을 같이 놓으면 파일명으로 매핑)
- 빌드 없음: CDN importmap 이라 GitHub Pages 에서 바로 실행

## 캐릭터 (v0.4)
- 기본 모델: 하츠네 미쿠 v2 (あにまさ) PMD. 물리(ammo.js)로 머리카락/치마가 흔들림.
- idle = 4번 포즈 + 절차적 호흡·몸 흔들림·눈 깜빡임 + 사용자 눈 쪽으로 고개 돌리기.
- 모션 드롭다운: wavefile 댄스, 포즈 1~8, 11. VMD/VPD 파일을 드롭하면 모션이 추가됨.
- `window.character.play(name)` / `.morph(name, w)` 로 콘솔에서 제어 (LLM 연결 지점).

### 에셋 라이선스
MMD 에셋은 이 레포에 포함하지 않고 three.js r170 원본 위치에서 런타임에 불러온다.
- 모델/곡: Crypton 캐릭터 가이드라인 (piapro) 준수, 비상업.
- 포즈 (KEITEL): 상업 NG, 개조·재배포 OK.
- wavefile 모션: 원본 재배포 금지, 성인물 금지.
상업적 사용이나 다른 캐릭터로 바꾸려면 해당 에셋의 readme를 따로 확인할 것.

## 전신 모션
- `src/character/Motions.js`: 대화 상태별 모션캡처 클립 자동 재생. 대기 루프 위에 제스처를 크로스페이드한다.
- Mixamo FBX → `assets/motions/`에 넣고 `bash scripts/fbx2vmd.sh` (reze-rig, MIT).
- 반다이남코 리서치 모션 데이터셋 → `bash scripts/get-bandai.sh` (Blender 필요).
  BVH의 0-회전 자세가 사람 자세가 아니라서 `scripts/bvh2fbx.py`가 T자 기준 자세를 계산해 바인드로 쓴다.
- 텍스트로 모션 생성: `bash scripts/gen-motions.sh` — MoMask(MIT, HumanML3D 학습 → 비상업)로
  `scripts/motion_prompts.txt`의 문장마다 3개씩 만들어 `assets/motions/gen/vmd`로 변환. 첫 실행 때 설치까지 한다.
  (HY-Motion은 라이선스가 한국을 제외해서 쓰지 않는다.)
- 모션 파일은 `assets/`(gitignore)에만 둔다.

### 모션 출처
- Bandai Namco Research Motion Dataset — © Bandai Namco Research Inc., CC BY-NC 4.0 (비상업).
  https://github.com/BandaiNamcoResearchInc/Bandai-Namco-Research-Motiondataset
- Mixamo (Adobe) — 프로젝트 내 사용 가능, 원본 파일 단독 재배포 금지.

## 참고한 오픈소스 / prior art
설계 아이디어와 표준 수학을 비교하기 위해 다음 프로젝트를 조사했습니다.

- MindDock/off-axis-demo (MIT): MediaPipe iris tracking, simple asymmetric frustum, smoothing, GLTF workflow.
- splatsdotcom/WindowMode (MIT): iris apparent diameter + webcam HFOV를 이용한 metric eye-distance estimation, worker-based tracking architecture.
- V4C38/sensai-off-axis: physical screen calibration/debug UX와 head-coupled viewer 구조.

Pocket Hologram의 구현 코드는 위 프로젝트 코드를 복사하지 않고 별도 모듈 구조로 작성했습니다. Off-axis projection은 planar-screen asymmetric frustum의 표준 기하에서 직접 구현합니다.

## 실행

폰에서 바로: https://jm00517.github.io/pocket-hologram/
(repo Settings → Pages → Source: Deploy from a branch, `main` / `/ (root)` 한 번만 켜면 됨. Actions 불필요.)

로컬 개발은 정적 서버면 뭐든 됩니다. 카메라 API는 secure context(HTTPS 또는 localhost)가 필요하므로 USB 연결 시 ADB reverse 를 씁니다.

```bash
npx serve .            # http://localhost:3000
adb reverse tcp:3000 tcp:3000
```

그 다음 폰 Chrome에서 `http://localhost:3000` 로 접속합니다.

## Calibration
기본값은 Galaxy S21 Ultra 근사 preset입니다. Calibration 버튼에서 다음 값을 조절할 수 있습니다.

- visible screen width / height
- front camera X/Y offset from screen center
- camera horizontal FOV

특히 HFOV는 Z 거리 정확도에 직접 영향을 줍니다. 실제 기기/브라우저의 camera stream crop에 따라 보정이 필요합니다.

## 비용 원칙
GitHub Actions, 유료 CI/CD, 유료 호스팅, 외부 유료 API를 사용하지 않습니다.

## 다음 단계
- 실제 S21 Ultra에서 HFOV 및 camera offset calibration
- tracking을 Web Worker로 분리
- orientation-aware portrait/landscape transform
- VMD 모션 재생 (MMDAnimationHelper + ammo.js)
- 폴더 드롭 (webkitGetAsEntry)
- optional Gaussian Splat content backend
