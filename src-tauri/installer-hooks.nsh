!include LogicLib.nsh

; 업데이트를 시작한 앱이 실제로 실행 파일의 쓰기 잠금을 해제한 뒤 복사합니다.
; OPEN_EXISTING으로 검사하므로 기다리거나 취소할 때 기존 파일을 변경하지 않습니다.
Function DalPDFWaitForExecutable
  Exch $0
  Push $1
  Push $2
  Push $3
  retry:
    StrCpy $3 120
  check:
    System::Call 'kernel32::CreateFileW(w r0, i 0x40000000, i 7, p 0, i 3, i 0, p 0) p.r1 ?e'
    Pop $2
    ${If} $1 P<> -1
      System::Call 'kernel32::CloseHandle(p r1)'
      Goto done
    ${EndIf}
    ${If} $2 = 2
    ${OrIf} $2 = 3
      Goto done
    ${EndIf}
    ${If} $2 = 32
    ${OrIf} $2 = 33
      IntOp $3 $3 - 1
      ${If} $3 > 0
        Sleep 250
        Goto check
      ${EndIf}
      IfSilent failed
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "DalPDF가 아직 실행 중이거나 다른 프로그램이 파일을 사용 중입니다.$\nDalPDF를 완전히 종료한 뒤 재시도해 주세요.$\n$\nDalPDF is still running or its file is in use. Close DalPDF, then retry." IDRETRY retry
      Goto failed
    ${EndIf}
    ; 권한/읽기 전용 오류를 실행 중 오류로 숨기지 않습니다.
    IfSilent failed
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "DalPDF 실행 파일에 쓸 수 없습니다. 파일 권한과 읽기 전용 속성을 확인해 주세요. (Windows 오류 $2)$\n$\nCannot write DalPDF executable. Check permissions and read-only attributes. (Windows error $2)" IDRETRY retry
  failed:
    SetErrorLevel $2
    Abort
  done:
    Pop $3
    Pop $2
    Pop $1
    Pop $0
FunctionEnd

!macro NSIS_HOOK_PREINSTALL
  Push "$INSTDIR\${MAINBINARYNAME}.exe"
  Call DalPDFWaitForExecutable
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; 설정 화면에 선택 가능한 앱으로 등록합니다. UserChoice는 변경하지 않습니다.
  WriteRegStr SHCTX "Software\Classes\DalPDF.PDF" "" "PDF 문서"
  WriteRegStr SHCTX "Software\Classes\DalPDF.PDF\DefaultIcon" "" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr SHCTX "Software\Classes\DalPDF.PDF\shell\open\command" "" '$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\"'
  WriteRegStr SHCTX "Software\Classes\.pdf\OpenWithProgids" "DalPDF.PDF" ""
  WriteRegStr SHCTX "Software\DalBear\DalPDF\Capabilities" "ApplicationName" "DalPDF"
  WriteRegStr SHCTX "Software\DalBear\DalPDF\Capabilities" "ApplicationDescription" "PDF 뷰어 및 편집기"
  WriteRegStr SHCTX "Software\DalBear\DalPDF\Capabilities" "ApplicationIcon" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr SHCTX "Software\DalBear\DalPDF\Capabilities\FileAssociations" ".pdf" "DalPDF.PDF"
  WriteRegStr SHCTX "Software\RegisteredApplications" "DalPDF" "Software\DalBear\DalPDF\Capabilities"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegValue SHCTX "Software\Classes\.pdf\OpenWithProgids" "DalPDF.PDF"
  DeleteRegKey SHCTX "Software\Classes\DalPDF.PDF"
  DeleteRegValue SHCTX "Software\RegisteredApplications" "DalPDF"
  DeleteRegKey SHCTX "Software\DalBear\DalPDF\Capabilities"
!macroend
