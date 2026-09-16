param([Parameter(Mandatory = $true)][string]$MakeNsis)
$ErrorActionPreference = 'Stop'
$work = Join-Path ([IO.Path]::GetTempPath()) ('dalpdf-installer-' + [guid]::NewGuid())
New-Item -ItemType Directory $work | Out-Null
$setup = Join-Path $work 'setup.exe'
$payload = Join-Path $work 'payload.txt'
$fixture = Join-Path $work 'fixture.exe'
[IO.File]::WriteAllText($payload, 'new-version')
$source = Join-Path $work 'fixture.cs'
[IO.File]::WriteAllText($source, 'class Fixture { static void Main() { System.Threading.Thread.Sleep(60000); } }')
& "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo "/out:$fixture" $source
if ($LASTEXITCODE) { throw '실행 중인 파일 테스트 빌드 실패' }
& $MakeNsis /V2 "/DOUTPUT=$setup" "/DPAYLOAD=$payload" (Join-Path $PSScriptRoot 'windows-installer.nsi')
if ($LASTEXITCODE) { throw 'NSIS 잠금 테스트 빌드 실패' }

function Start-Installer([string]$directory) {
  Start-Process $setup -ArgumentList @('/S', "/D=$directory") -PassThru
}
function Complete-Installer($process, [bool]$success) {
  if (!$process.WaitForExit(45000)) { $process.Kill(); throw '설치기 제한 시간 초과' }
  if (($process.ExitCode -eq 0) -ne $success) { throw "예상하지 않은 설치기 종료 코드: $($process.ExitCode)" }
}
function Assert-Content([string]$file, [string]$expected) {
  if ([IO.File]::ReadAllText($file) -ne $expected) { throw "기존 파일 손상 또는 설치 실패: $file" }
}

try {
  # 신규 설치는 실행 파일이 없어도 정상 설치됩니다.
  $fresh = Join-Path $work 'fresh'
  Complete-Installer (Start-Installer $fresh) $true
  Assert-Content (Join-Path $fresh 'dalpdf.exe') 'new-version'

  # 실제 실행 중인 dalpdf.exe가 종료되기 전에는 덮어쓰지 않습니다.
  $running = Join-Path $work 'running'
  New-Item -ItemType Directory $running | Out-Null
  $exe = Join-Path $running 'dalpdf.exe'
  Copy-Item $fixture $exe
  $before = (Get-FileHash $exe).Hash
  $app = Start-Process $exe -PassThru
  $installer = Start-Installer $running
  try {
    Start-Sleep -Seconds 2
    if ($installer.HasExited) { throw '실행 파일 종료를 기다리지 않았습니다.' }
    if ((Get-FileHash $exe).Hash -ne $before) { throw '실행 중인 파일이 변경됐습니다.' }
  } finally { if (!$app.HasExited) { $app.Kill(); $app.WaitForExit() } }
  Complete-Installer $installer $true
  Assert-Content $exe 'new-version'

  # 잠금이 30초 뒤에도 유지되면 실패하며 원본을 보존합니다.
  [IO.File]::WriteAllText($exe, 'old-version')
  $lock = [IO.File]::Open($exe, 'Open', 'Read', 'Read')
  try {
    Complete-Installer (Start-Installer $running) $false
    Assert-Content $exe 'old-version'
  } finally { $lock.Dispose() }

  # 잠금이 아닌 읽기 전용 오류도 기존 파일을 보존하고 실패합니다.
  [IO.File]::SetAttributes($exe, [IO.FileAttributes]::ReadOnly)
  try {
    Complete-Installer (Start-Installer $running) $false
    Assert-Content $exe 'old-version'
  } finally { [IO.File]::SetAttributes($exe, [IO.FileAttributes]::Normal) }

  # 기본 연결을 바꾸지 않고 설정 화면의 앱 후보 등록/해제만 수행하는지 확인합니다.
  $progId = 'HKCU:\Software\Classes\DalPDF.PDF'
  $capabilities = 'HKCU:\Software\DalBear\DalPDF\Capabilities'
  $registered = 'HKCU:\Software\RegisteredApplications'
  $openWith = 'HKCU:\Software\Classes\.pdf\OpenWithProgids'
  $existingOpenWith = Get-Item $openWith -ErrorAction SilentlyContinue
  $existingRegistered = Get-Item $registered -ErrorAction SilentlyContinue
  if ((Test-Path $progId) -or (Test-Path $capabilities) -or
      ($existingRegistered -and ($existingRegistered.GetValueNames() -contains 'DalPDF')) -or
      ($existingOpenWith -and ($existingOpenWith.GetValueNames() -contains 'DalPDF.PDF'))) {
    throw '기존 DalPDF 등록을 보호하기 위해 이 테스트는 DalPDF가 설치되지 않은 Windows에서만 실행합니다.'
  }
  function Read-PdfDefault {
    $extension = Get-Item 'HKCU:\Software\Classes\.pdf' -ErrorAction SilentlyContinue
    $choice = Get-Item 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.pdf\UserChoice' -ErrorAction SilentlyContinue
    $extensionDefault = if ($extension) { $extension.GetValue('') } else { $null }
    $choiceId = if ($choice) { $choice.GetValue('ProgId') } else { $null }
    $choiceHash = if ($choice) { $choice.GetValue('Hash') } else { $null }
    @($extensionDefault, $choiceId, $choiceHash) | ConvertTo-Json -Compress
  }
  $defaultBefore = Read-PdfDefault
  $setup = Join-Path $work 'registration-setup.exe'
  & $MakeNsis /V2 /DREGISTRATION "/DOUTPUT=$setup" "/DPAYLOAD=$payload" (Join-Path $PSScriptRoot 'windows-installer.nsi')
  if ($LASTEXITCODE) { throw '기본 앱 후보 등록 테스트 빌드 실패' }
  $registeredInstall = Join-Path $work 'registered'
  try {
    Complete-Installer (Start-Installer $registeredInstall) $true
    if ((Get-ItemPropertyValue "$capabilities\FileAssociations" '.pdf') -ne 'DalPDF.PDF') { throw 'PDF 앱 기능 등록 실패' }
    if ((Get-ItemPropertyValue $registered DalPDF) -ne 'Software\DalBear\DalPDF\Capabilities') { throw 'Windows 설정 앱 등록 실패' }
    if (!((Get-Item $openWith).GetValueNames() -contains 'DalPDF.PDF')) { throw '연결 프로그램 후보 등록 실패' }
    $command = (Get-Item "$progId\shell\open\command").GetValue('')
    if ($command -ne "`"$registeredInstall\dalpdf.exe`" `"%1`"") { throw 'PDF 실행 명령 등록 실패' }
    if ((Read-PdfDefault) -ne $defaultBefore) { throw '사용자 동의 없이 기본 PDF 앱을 변경했습니다.' }
    $uninstaller = Start-Process (Join-Path $registeredInstall 'uninstall.exe') -ArgumentList @('/S', "_?=$registeredInstall") -PassThru
    Complete-Installer $uninstaller $true
    if ((Test-Path $progId) -or (Test-Path $capabilities) -or (Get-ItemPropertyValue $registered DalPDF -ErrorAction SilentlyContinue)) { throw '앱 제거 후 기본 앱 후보 등록이 남았습니다.' }
    if ((Get-Item $openWith).GetValueNames() -contains 'DalPDF.PDF') { throw '앱 제거 후 연결 프로그램 후보가 남았습니다.' }
    if ((Read-PdfDefault) -ne $defaultBefore) { throw '앱 제거가 기본 PDF 앱을 변경했습니다.' }
  } finally {
    # 시작 시 없었던 테스트 등록만 정리하며 사용자의 기본값/다른 앱 등록은 건드리지 않습니다.
    Remove-ItemProperty $registered DalPDF -ErrorAction SilentlyContinue
    Remove-ItemProperty $openWith 'DalPDF.PDF' -ErrorAction SilentlyContinue
    Remove-Item $progId, $capabilities -Recurse -Force -ErrorAction SilentlyContinue
  }
  Write-Output 'Windows 기본 앱: 선택 후보 등록/해제 및 기존 기본 앱 보존 검증 통과'

  # 경량 설치 훅은 공통 해시를 읽고 모델 없는 최초 설치를 거부합니다.
  $modelHash = (Get-Content (Join-Path $PSScriptRoot '../src-tauri/model.sha256') -Raw).Trim()
  $setup = Join-Path $work 'light-setup.exe'
  & $MakeNsis /V2 /DLIGHT "/DEXPECTED_MODEL_SHA256=$modelHash" "/DOUTPUT=$setup" "/DPAYLOAD=$payload" (Join-Path $PSScriptRoot 'windows-installer.nsi')
  if ($LASTEXITCODE) { throw '경량 설치 훅의 모델 해시 검증 실패' }
  $cache = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) "com.dalbear.dalpdf/models/$modelHash.gguf"
  if (!(Test-Path $cache)) {
    $freshLight = Join-Path $work 'fresh-light'
    Complete-Installer (Start-Installer $freshLight) $false
    if (Test-Path (Join-Path $freshLight 'dalpdf.exe')) { throw '모델 없는 경량 설치가 허용됐습니다.' }
    Write-Output 'Windows 경량 설치기: 모델 없는 신규 설치 차단 검증 통과'
  }
  Write-Output 'Windows 설치기: 신규 설치, 실행 중 잠금 해제, 잠금 시간 초과, 읽기 전용 오류 검증 통과'
} finally {
  Remove-Item -Recurse -Force $work
}
