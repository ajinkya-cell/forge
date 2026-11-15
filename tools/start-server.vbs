' Starts the Forge server in the background without opening a browser.
Set sh = CreateObject("WScript.Shell")
Set fs = CreateObject("Scripting.FileSystemObject")
root = fs.GetParentFolderName(fs.GetParentFolderName(WScript.ScriptFullName))
sh.CurrentDirectory = root
sh.Run "node """ & root & "\server.js""", 0, False
