; Advertise browser capabilities without changing the user's HTTP/HTTPS default.
!macro customInstall
  WriteRegStr SHCTX "Software\Classes\${APP_ID}.BrowserURL" "" "${PRODUCT_NAME} URL"
  WriteRegStr SHCTX "Software\Classes\${APP_ID}.BrowserURL" "URL Protocol" ""
  WriteRegStr SHCTX "Software\Classes\${APP_ID}.BrowserURL\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "Software\Classes\${APP_ID}.BrowserURL\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\${APP_ID}" "" "${PRODUCT_NAME}"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\${APP_ID}\Capabilities" "ApplicationName" "${PRODUCT_NAME}"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\${APP_ID}\Capabilities" "ApplicationDescription" "Browse with separate Dovo Studio profiles"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\${APP_ID}\Capabilities\URLAssociations" "http" "${APP_ID}.BrowserURL"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\${APP_ID}\Capabilities\URLAssociations" "https" "${APP_ID}.BrowserURL"
  WriteRegStr SHCTX "Software\RegisteredApplications" "${APP_ID}.Browser" "Software\Clients\StartMenuInternet\${APP_ID}\Capabilities"
!macroend

!macro customUnInstall
  DeleteRegValue SHCTX "Software\RegisteredApplications" "${APP_ID}.Browser"
  DeleteRegKey SHCTX "Software\Clients\StartMenuInternet\${APP_ID}"
  DeleteRegKey SHCTX "Software\Classes\${APP_ID}.BrowserURL"
!macroend
