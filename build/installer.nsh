!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "WinVer.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"

; Custom installer include for electron-builder NSIS target.
; Provides:
; - Silent mode aliases (/silent, /verysilent)
; - OS, RAM, and disk space checks
; - Logging of installer operations
; - Optional prerequisites execution if present in extraResources
; - Registry entries and environment variable setup
; - Cleanup and rollback on failure

Var IsSilent
Var InstallLog

; Ensure VERSION macro is defined based on electron-builder provided APP_VERSION
!ifndef VERSION
  !ifdef APP_VERSION
    !define VERSION "${APP_VERSION}"
  !else
    ; Fallback to a safe default; electron-builder usually injects APP_VERSION
    !define VERSION "0.1.4"
  !endif
!endif

!macro preInit
  ; Accept Inno-like silent flags as aliases to NSIS /S (without LogicLib blocks)
  ${GetParameters} $0
  ${GetOptions} $0 "/silent" $1
  StrCmp $1 "" +3
  StrCpy $IsSilent "1"
  SetSilent silent

  ${GetOptions} $0 "/verysilent" $1
  StrCmp $1 "" +3
  StrCpy $IsSilent "1"
  SetSilent silent
  ; Ensure shell variables (e.g., $PROGRAMDATA) resolve to machine-wide paths
  SetShellVarContext all
!macroend

!macro customInit
  ; Require Windows 10/Server 2016+
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_ICONSTOP "Unsupported OS. Requires Windows 10/11 or Server 2016+." /SD IDOK
    Abort
  ${EndIf}

  ; Initialize installer log path
  ExpandEnvStrings $2 %ProgramData%
  StrCpy $InstallLog "$2\\COREPMS\\logs"
  ClearErrors
  CreateDirectory "$InstallLog"
  ; Directory creation status will be logged in customInstall
!macroend

!macro customInstall
  ; Open custom log; electron-builder installs to $INSTDIR
  ; Write a simple human-readable log with timestamps
  FileOpen $0 "$InstallLog\\installer.log" w
  ${If} ${Errors}
    ; Fallback: try to create directory then reopen
    ClearErrors
    CreateDirectory "$InstallLog"
    FileOpen $0 "$InstallLog\\installer.log" w
  ${EndIf}
  ${If} ${Errors}
    ; If still failing, use temp as last resort
    StrCpy $InstallLog "$TEMP"
    FileOpen $0 "$InstallLog\\installer.log" w
  ${EndIf}
  ; Also mirror logs inside install directory to ensure visibility
  FileOpen $R0 "$INSTDIR\\installer.log" w
  FileWrite $0 "[START] Installation at $\r$\n"
  FileWrite $R0 "[START] Installation at $\r$\n"
  FileWrite $0 "Log directory: $InstallLog$\r$\n"
  FileWrite $R0 "Log directory: $InstallLog$\r$\n"
  FileWrite $0 "Install dir: $INSTDIR$\r$\n"
  FileWrite $R0 "Install dir: $INSTDIR$\r$\n"

  ; Optional prerequisites (if present in extraResources)
  ; VC++ Redistributable 2019+ (x64) - check if already installed first
  FileWrite $0 "[PREREQ] Checking VC++ Redistributable 2019+ (x64)...$\r$\n"
  FileWrite $R0 "[PREREQ] Checking VC++ Redistributable 2019+ (x64)...$\r$\n"
  
  ; Check registry for VC++ 2019+ (14.x) - MSVC Runtime
  ; Key locations for VC++ 2015-2022 (they share versions 14.x)
  ReadRegDWORD $3 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"
  ${If} $3 == 1
    FileWrite $0 "[PREREQ] VC++ Redistributable already installed (registry check)$\r$\n"
    FileWrite $R0 "[PREREQ] VC++ Redistributable already installed (registry check)$\r$\n"
  ${Else}
    ; Try to install from bundled file (support both naming conventions)
    ${If} ${FileExists} "$RESOURCES\prereqs\VC_redist.x64.exe"
      FileWrite $0 "[PREREQ] Installing VC_redist.x64.exe...$\r$\n"
      FileWrite $R0 "[PREREQ] Installing VC_redist.x64.exe...$\r$\n"
      ExecWait '"$RESOURCES\prereqs\VC_redist.x64.exe" /quiet /norestart' $7
      FileWrite $0 "[PREREQ] VC_redist.x64.exe exit code: $7$\r$\n"
      FileWrite $R0 "[PREREQ] VC_redist.x64.exe exit code: $7$\r$\n"
    ${ElseIf} ${FileExists} "$RESOURCES\prereqs\vc_redist.x64.exe"
      FileWrite $0 "[PREREQ] Installing vc_redist.x64.exe...$\r$\n"
      FileWrite $R0 "[PREREQ] Installing vc_redist.x64.exe...$\r$\n"
      ExecWait '"$RESOURCES\prereqs\vc_redist.x64.exe" /quiet /norestart' $7
      FileWrite $0 "[PREREQ] vc_redist.x64.exe exit code: $7$\r$\n"
      FileWrite $R0 "[PREREQ] vc_redist.x64.exe exit code: $7$\r$\n"
    ${Else}
      FileWrite $0 "[PREREQ] VC++ Redistributable installer not found in prereqs$\r$\n"
      FileWrite $R0 "[PREREQ] VC++ Redistributable installer not found in prereqs$\r$\n"
      FileWrite $0 "[PREREQ] WARNING: PostgreSQL may not work without VC++ Runtime$\r$\n"
      FileWrite $R0 "[PREREQ] WARNING: PostgreSQL may not work without VC++ Runtime$\r$\n"
    ${EndIf}
  ${EndIf}

  ; .NET Desktop Runtime (x64) - exact filename per requirements
  ${If} ${FileExists} "$RESOURCES\\prereqs\\windowsdesktop-runtime-6.0.x-win-x64.exe"
    FileWrite $0 "[PREREQ] windowsdesktop-runtime-6.0.x-win-x64.exe detected$\r$\n"
    FileWrite $R0 "[PREREQ] windowsdesktop-runtime-6.0.x-win-x64.exe detected$\r$\n"
    ExecWait '"$RESOURCES\\prereqs\\windowsdesktop-runtime-6.0.x-win-x64.exe" /quiet /norestart' $8
    FileWrite $0 "[PREREQ] windowsdesktop-runtime exit code: $8$\r$\n"
    FileWrite $R0 "[PREREQ] windowsdesktop-runtime exit code: $8$\r$\n"
  ${Else}
    FileWrite $0 "[PREREQ] windowsdesktop-runtime-6.0.x-win-x64.exe not found$\r$\n"
    FileWrite $R0 "[PREREQ] windowsdesktop-runtime-6.0.x-win-x64.exe not found$\r$\n"
  ${EndIf}

  ; Registry: record install path and version
  ClearErrors
  WriteRegStr HKLM "Software\\COREPMS" "InstallDir" "$INSTDIR"
  ${If} ${Errors}
    FileWrite $0 "[REG] InstallDir write failed$\r$\n"
    FileWrite $R0 "[REG] InstallDir write failed$\r$\n"
  ${Else}
    FileWrite $0 "[REG] InstallDir=$INSTDIR$\r$\n"
    FileWrite $R0 "[REG] InstallDir=$INSTDIR$\r$\n"
  ${EndIf}

  ClearErrors
  WriteRegStr HKLM "Software\\COREPMS" "Version" "${VERSION}"
  ${If} ${Errors}
    FileWrite $0 "[REG] Version write failed$\r$\n"
    FileWrite $R0 "[REG] Version write failed$\r$\n"
  ${Else}
    FileWrite $0 "[REG] Version=${VERSION}$\r$\n"
    FileWrite $R0 "[REG] Version=${VERSION}$\r$\n"
  ${EndIf}

  ; Environment variable: COREPMS_HOME
  ClearErrors
  WriteRegExpandStr HKLM "SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment" "COREPMS_HOME" "$INSTDIR"
  ${If} ${Errors}
    FileWrite $0 "[ENV] COREPMS_HOME write failed$\r$\n"
    FileWrite $R0 "[ENV] COREPMS_HOME write failed$\r$\n"
  ${Else}
    FileWrite $0 "[ENV] COREPMS_HOME=$INSTDIR$\r$\n"
    FileWrite $R0 "[ENV] COREPMS_HOME=$INSTDIR$\r$\n"
  ${EndIf}
  ; Broadcast environment change
  System::Call 'user32::SendMessageTimeoutW(i 0xffff, i ${WM_SETTINGCHANGE}, i 0, w "Environment", i 0x0003, i 5000, *i .r9)'
  FileWrite $0 "[ENV] Broadcasted WM_SETTINGCHANGE$\r$\n"
  FileWrite $R0 "[ENV] Broadcasted WM_SETTINGCHANGE$\r$\n"

  FileWrite $0 "[END] Installation success$\r$\n"
  FileWrite $R0 "[END] Installation success$\r$\n"
  FileClose $0
  FileClose $R0
!macroend

Function .onInstFailed
  ; Basic rollback: delete install directory if installation failed
  RMDir /r "$INSTDIR"
  ; Append failure to log if possible
  FileOpen $0 "$InstallLog\\installer.log" a
  FileWrite $0 "[ROLLBACK] Installation failed, cleanup performed$\r$\n"
  FileClose $0
FunctionEnd

!macro customUnInstall
  ; Remove registry entries
  DeleteRegKey HKLM "Software\\COREPMS"
  ; Remove environment variable
  DeleteRegValue HKLM "SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment" "COREPMS_HOME"
  ; Broadcast environment change
  System::Call 'user32::SendMessageTimeoutW(i 0xffff, i ${WM_SETTINGCHANGE}, i 0, w "Environment", i 0x0003, i 5000, *i .r9)'
  ; Log uninstall
  SetShellVarContext all
  ExpandEnvStrings $2 %ProgramData%
  StrCpy $InstallLog "$2\\COREPMS\\logs"
  CreateDirectory "$InstallLog"
  FileOpen $0 "$InstallLog\\installer.log" a
  FileWrite $0 "[UNINSTALL] Performed$\r$\n"
  FileClose $0
!macroend
