Dim WshShell, strPath, fso, nodePath, command
Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
strPath = fso.GetParentFolderName(WScript.ScriptFullName)
nodePath = strPath & "\runtime\node.exe"

If Not fso.FileExists(nodePath) Then
    WScript.Quit 2
End If

command = "cmd /c cd /d """ & strPath & """ && """ & nodePath & """ """ & strPath & "\index.js"" >> """ & strPath & "\olycity.log"" 2>&1"
WshShell.Run command, 0, False
