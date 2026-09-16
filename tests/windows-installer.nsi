Unicode true
RequestExecutionLevel user
SilentInstall silent
Name "DalPDF 설치 잠금 회귀 테스트"
OutFile "${OUTPUT}"
!ifdef LIGHT
  !include "../src-tauri/installer-light-hooks.nsh"
  !if "${DALPDF_MODEL_SHA256}" != "${EXPECTED_MODEL_SHA256}"
    !error "모델 해시가 설치 훅에서 다르게 읽혔습니다."
  !endif
!else
  !include "../src-tauri/installer-hooks.nsh"
!endif
!define MAINBINARYNAME "dalpdf"
Section
  SetShellVarContext current
  SetRegView 64
  SetOutPath $INSTDIR
  !insertmacro NSIS_HOOK_PREINSTALL
  File /oname=dalpdf.exe "${PAYLOAD}"
  !ifdef REGISTRATION
    !insertmacro NSIS_HOOK_POSTINSTALL
    WriteUninstaller "$INSTDIR\uninstall.exe"
  !endif
SectionEnd
!ifdef REGISTRATION
Section "Uninstall"
  SetShellVarContext current
  SetRegView 64
  !insertmacro NSIS_HOOK_POSTUNINSTALL
SectionEnd
!endif
