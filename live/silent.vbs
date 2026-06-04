Dim WshShell, strPath
Set WshShell = CreateObject("WScript.Shell")
strPath = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
WshShell.Run "cmd /c cd /d """ & strPath & """ && node index.js >> """ & strPath & "\olycity.log"" 2>&1", 0, False
