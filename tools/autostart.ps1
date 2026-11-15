# Turns "start Forge when I log in" on or off by adding or removing a shortcut in your Startup folder.
# Usage: autostart.ps1 on | off | status
param([ValidateSet('on', 'off', 'status')][string]$Mode = 'status')

$lnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'Forge.lnk'
$root = Split-Path -Parent $PSScriptRoot
$vbs = Join-Path $root 'Forge.vbs'

switch ($Mode) {
  'on' {
    $s = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
    $s.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
    $s.Arguments = '"' + $vbs + '"'
    $s.WorkingDirectory = $root
    $s.Description = 'Start Forge'
    $ico = Join-Path $root 'public\icon.ico'
    if (Test-Path $ico) { $s.IconLocation = $ico }
    $s.Save()
    'on'
  }
  'off' { if (Test-Path $lnk) { Remove-Item $lnk -Force }; 'off' }
  default { if (Test-Path $lnk) { 'on' } else { 'off' } }
}
