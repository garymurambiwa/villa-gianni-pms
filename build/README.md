# Build Resources

Place branding and signing assets here.

## Icons
- `icon.ico`: Application icon used for the executable and installer.
- Optional NSIS assets:
  - `installerIcon.ico`
  - `installerHeaderIcon.ico`
  - `uninstallerIcon.ico`

Configure in `package.json` → `build`:
```json
{
  "build": {
    "win": {
      "icon": "build/icon.ico"
    },
    "nsis": {
      "installerIcon": "build/installerIcon.ico",
      "installerHeaderIcon": "build/installerHeaderIcon.ico",
      "uninstallerIcon": "build/uninstallerIcon.ico"
    }
  }
}
```

## Code Signing
- Provide PFX/PKCS12 certificate via environment variables:
  - `CSC_LINK` or `WIN_CSC_LINK`
  - `CSC_KEY_PASSWORD` or `WIN_CSC_KEY_PASSWORD`
- Rebuild the installer after setting env vars.

## Generate Icons from a PNG
1. Save your logo as `build/logo.png` (square, transparent background recommended).
2. Run `npm run icons:generate`.
3. The script creates:
   - `build/icon.ico`
   - `build/installerIcon.ico`
   - `build/installerHeaderIcon.ico`
   - `build/uninstallerIcon.ico`
4. Optionally wire these paths in `package.json` → `build` and `nsis`.
