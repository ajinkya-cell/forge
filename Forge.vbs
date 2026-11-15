' Forge launcher: starts the local server with no console window, then opens Forge in your browser.
' Double-click this to start Forge. If it is already running, it just opens the page.
' It waits until Forge actually answers before opening the page, so a slow first start never shows
' "This site can't be reached". If Forge can't start, it says so and points to start.bat for the details.
Option Explicit
Dim sh, fs, root, url, i
Set sh = CreateObject("WScript.Shell")
Set fs = CreateObject("Scripting.FileSystemObject")
root = fs.GetParentFolderName(WScript.ScriptFullName)
url = "http://localhost:4747/"

Function ForgeIsUp()
  Dim http
  ForgeIsUp = False
  On Error Resume Next
  Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  http.setTimeouts 1000, 1000, 1000, 1000
  http.open "GET", "http://127.0.0.1:4747/api/ping", False ' the server listens on 127.0.0.1 only: asking "localhost" first tries IPv6 and stalls
  http.send
  If Err.Number = 0 Then
    If http.status = 200 Then ForgeIsUp = (Err.Number = 0)
  End If
  Err.Clear
  On Error GoTo 0
End Function

If Not ForgeIsUp() Then
  sh.CurrentDirectory = root
  On Error Resume Next
  sh.Run "node """ & root & "\server.js""", 0, False
  If Err.Number <> 0 Then
    MsgBox "Forge could not start because Node.js was not found." & vbCrLf & vbCrLf & _
      "Install Node.js from nodejs.org (or check that 'node' works in a terminal), then try again.", vbExclamation, "Forge"
    WScript.Quit 1
  End If
  On Error GoTo 0
  ' wait up to 30 seconds for the server to answer
  For i = 1 To 60
    WScript.Sleep 500
    If ForgeIsUp() Then Exit For
  Next
  If Not ForgeIsUp() Then
    MsgBox "Forge did not start within 30 seconds." & vbCrLf & vbCrLf & _
      "Double-click start.bat in the Forge folder to see what went wrong.", vbExclamation, "Forge"
    WScript.Quit 1
  End If
End If

sh.Run url, 1, False
