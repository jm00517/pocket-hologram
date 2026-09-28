# Pocket Hologram

Galaxy S21 Ultra 같은 스마트폰의 전면 카메라로 관찰자의 얼굴/눈 위치를 추정하고, 화면을 고정된 창으로 간주한 **head-coupled off-axis perspective**를 렌더링하는 실험 프로젝트입니다.

## 목표
- Android Chrome에서 실행
- MediaPipe Face Landmarker 기반 head/eye tracking
- Three.js off-axis projection
- GLB/GLTF/FBX 파일 로컬 로드
- 별도 서버/CI/CD/유료 서비스 없이 로컬 실행

## 실행
Node.js 20+ 권장.

```bash
npm install
npm run dev
```

PC와 폰이 같은 Wi-Fi라면 Vite가 표시하는 LAN 주소로 접속할 수 있습니다. 단, 모바일 브라우저의 카메라 API는 보안 컨텍스트(HTTPS 또는 localhost)를 요구할 수 있습니다. 가장 간단한 첫 검증은 Android에서 로컬 HTTPS 개발환경/USB 디버깅 포트를 쓰는 것입니다.

## 사용
1. Start camera
2. 카메라 권한 허용
3. 얼굴을 좌우/상하/앞뒤로 움직여 큐브의 motion parallax 확인
4. Model 버튼으로 .glb/.gltf/.fbx 선택

모델은 브라우저 로컬 파일에서만 읽으며 업로드하지 않습니다.

## 현재 한계
- RGB 전면카메라 기반 Z 추정이라 절대 거리 정확도는 낮음
- S21 Ultra 물리 화면 크기는 기본값으로 근사
- landscape/portrait 및 카메라 FOV별 calibration 필요
- FBX 외부 texture 경로는 단일 파일 drag-and-drop에서 깨질 수 있음
- MMD PMX/PMD/VMD는 다음 단계

## 비용 원칙
GitHub Actions, 유료 CI/CD, 유료 호스팅, 외부 유료 API를 사용하지 않습니다.
