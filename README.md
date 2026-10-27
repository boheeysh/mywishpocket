# 마이위시포켓

여러 쇼핑몰(인스타그램, 네이버, 쿠팡, 무신사, 29CM 등)의 위시 상품 링크를 한곳에 모아 한눈에 보는 웹앱입니다.
PC 브라우저에서 쓰고, 휴대폰에서는 홈 화면에 설치해 앱처럼 씁니다(PWA).

## 파일 구조
```
index.html            화면 (위시 / 우선순위 / 구매 기준 / 이용 방법 탭, 등록 화면, 폴더 관리)
style.css             디자인 (핀터레스트풍 벽돌 배치, PC/휴대폰 반응형, 다크모드)
app.js                기능 (상품·폴더·구매 기준 관리, 정렬, 세일 D-day, 자동 가격 확인, 별 추천, 엑셀 저장, 백업)
manifest.webmanifest  홈 화면 설치 정보, 휴대폰 공유 받기 설정
sw.js                 오프라인 지원
api/preview.js        링크에서 상품명·사진·가격·원래 가격 읽어오기 (Vercel 서버 함수)
icons/                앱 아이콘
dev-server.js         내 컴퓨터에서 실행용 (배포에는 사용 안 함)
```

## 내 컴퓨터에서 실행
Node.js가 설치되어 있어야 합니다. VS Code 터미널에서:
```
node dev-server.js
```
브라우저에서 http://localhost:3000 열기.
(index.html을 더블클릭해서 열면 '정보 불러오기'가 작동하지 않습니다.)

## 배포
GitHub 저장소에 올린 뒤 Vercel에서 Import → 설정 변경 없이 Deploy.
`api/` 폴더는 Vercel이 자동으로 서버 함수로 인식합니다.

## API 키 보관 (중요)
- 키는 `.env`에만 넣습니다. `.gitignore`에 등록되어 있어 GitHub에 올라가지 않습니다.
- 어떤 키가 필요한지는 `.env.example`에 적혀 있습니다. (현재 앱 코드는 키를 사용하지 않습니다)
- Vercel에서 키가 필요해지면 `.env` 파일을 올리지 말고, Vercel 프로젝트의 Settings → Environment Variables에 입력합니다.
