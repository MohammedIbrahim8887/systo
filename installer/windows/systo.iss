; One-file Windows installer. Electrobun's Systo-Setup.exe needs its .installer folder beside it,
; so this unpacks both to a temp folder and runs it; Electrobun's setup does the real install.
; Built in CI: ISCC /DPayload=<unzipped setup> /DAppVersion=<version> /DIcon=<app.ico> systo.iss

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

[Setup]
AppId={{6B0E4F1C-8A2D-4E57-9C3B-5D17A2F0C9E4}
AppName=Systo
AppVersion={#AppVersion}
AppPublisher=Systo
AppPublisherURL=https://github.com/MohammedIbrahim8887/systo
CreateAppDir=no
Uninstallable=no
PrivilegesRequired=lowest
DisableWelcomePage=yes
DisableReadyPage=yes
DisableFinishedPage=yes
DisableProgramGroupPage=yes
ShowLanguageDialog=no
WizardStyle=modern
SetupIconFile={#Icon}
OutputDir=..\..\release
OutputBaseFilename=Systo-Setup-x64
Compression=lzma2/ultra64
SolidCompression=yes
ArchitecturesAllowed=x64compatible
MinVersion=10.0.17763

[Files]
Source: "{#Payload}\*"; DestDir: "{tmp}\systo-setup"; Flags: recursesubdirs createallsubdirs ignoreversion

[Run]
Filename: "{tmp}\systo-setup\Systo-Setup.exe"; WorkingDir: "{tmp}\systo-setup"; Flags: waituntilterminated
