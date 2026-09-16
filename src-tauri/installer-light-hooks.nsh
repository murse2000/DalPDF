!include "${__FILEDIR__}\installer-hooks.nsh"
!macroundef NSIS_HOOK_PREINSTALL
!define /file DALPDF_MODEL_SHA256 "${__FILEDIR__}\model.sha256"

!macro NSIS_HOOK_PREINSTALL
  ; 경량 파일은 앱이 모델을 보존한 뒤에만 사용하며 최초 설치를 대신하지 않습니다.
  IfFileExists "$LOCALAPPDATA\com.dalbear.dalpdf\models\${DALPDF_MODEL_SHA256}.gguf" dalpdf_model_present
  IfSilent dalpdf_model_missing
  MessageBox MB_OK|MB_ICONSTOP "이 파일은 앱 내부 업데이트 전용입니다. 모델을 포함한 전체 설치 파일을 사용해 주세요."
  dalpdf_model_missing:
  SetErrorLevel 2
  Abort
  dalpdf_model_present:
  Push "$INSTDIR\${MAINBINARYNAME}.exe"
  Call DalPDFWaitForExecutable
!macroend
