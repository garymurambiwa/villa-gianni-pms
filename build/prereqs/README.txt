COREPMS Prerequisites
=====================

This folder is for prerequisite installers that will be bundled with the application.

Expected Files:
- VC_redist.x64.exe - Visual C++ Redistributable 2019+ (x64)
  Download from: https://aka.ms/vs/17/release/vc_redist.x64.exe
  Required for bundled PostgreSQL to run.

Note: The main VC_redist.x64.exe should be placed in the resources/ folder.
The installer.nsh will check both locations:
1. resources/prereqs/VC_redist.x64.exe (primary - copied from resources/VC_redist.x64.exe)
2. build/prereqs/vc_redist.x64.exe (fallback)

The installer will automatically:
1. Check if VC++ 2015-2022 x64 is already installed via registry
2. Skip installation if already present
3. Run silent installation (/quiet /norestart) if needed
