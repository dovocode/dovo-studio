# electron-builder signs this file before compiling the final installer, then deletes it.
# Check the exact file that NSIS embeds, while it is still available.
!ifndef BUILD_UNINSTALLER
  !system 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${__FILEDIR__}\verify-windows-uninstaller.ps1" -Path "${UNINSTALLER_OUT_FILE}"' = 0
!endif
