# DalPDF 번역 글꼴

Google Fonts 저장소의 고정 리비전 `809e4d8b8d7e9364a914909bb777679606c178b8`에서 받은 Noto Sans KR와 Noto Serif KR의 가변 TTF를 FontTools 4.59.0의 `instantiateVariableFont(..., {'wght': 400})`로 정적 Regular 글꼴로 생성했습니다.

- 원본: https://github.com/google/fonts/tree/809e4d8b8d7e9364a914909bb777679606c178b8/ofl/notosanskr
- 원본: https://github.com/google/fonts/tree/809e4d8b8d7e9364a914909bb777679606c178b8/ofl/notoserifkr
- 라이선스: 각 OFL 파일에 SIL Open Font License 1.1 전문과 저작권 표시 포함.
- 앱 화면과 PDF 내보내기에 같은 글꼴을 사용합니다. 앱 실행 시 글꼴을 다운로드하지 않습니다.

일부 한자가 같은 글리프 ID를 공유할 때 PDFium의 유니코드 역매핑이 다른 문자로 바뀌는 문제를 막기 위해, 공유 글리프의 윤곽과 메트릭을 복제하여 문자별 ID를 분리했습니다. 재생성 스크립트: `scripts/prepare-translation-fonts.py`. 글리프 모양은 변경하지 않았습니다.
