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
- GLB/GLTF/FBX 로컬 파일 로드

## 참고한 오픈소스 / prior art
설계 아이디어와 표준 수학을 비교하기 위해 다음 프로젝트를 조사했습니다.

- MindDock/off-axis-demo (MIT): MediaPipe iris tracking, simple asymmetric frustum, smoothing, GLTF workflow.
- splatsdotcom/WindowMode (MIT): iris apparent diameter + webcam HFOV를 이용한 metric eye-distance estimation, worker-based tracking architecture.
- V4C38/sensai-off-axis: physical screen calibration/debug UX와 head-coupled viewer 구조.

Pocket Hologram의 구현 코드는 위 프로젝트 코드를 복사하지 않고 별도 모듈 구조로 작성했습니다. Off-axis projection은 planar-screen asymmetric frustum의 표준 기하에서 직접 구현합니다.

## 실행
```bash
npm install
npm run dev
```

카메라 API는 secure context가 필요합니다. S21 Ultra를 USB로 연결한 경우 개발 PC에서 Vite를 실행한 뒤 ADB reverse를 쓰는 것이 무료이고 간단합니다.

```bash
adb reverse tcp:5173 tcp:5173
```

그 다음 폰 Chrome에서 `http://localhost:5173` 로 접속합니다.

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
- MMD PMX/PMD/VMD loader
- optional Gaussian Splat content backend
