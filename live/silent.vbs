Dim WshShell, strPath, fso, nodePath, logPath, command
Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
strPath = fso.GetParentFolderName(WScript.ScriptFullName)
nodePath = strPath & "\runtime\node.exe"
logPath = strPath & "\olycity.log"

If Not fso.FileExists(nodePath) Then
    WScript.Quit 2
End If

' A previous updater process can keep the append handle alive for a fraction
' of a second. Rotate before cmd opens the next handle, never while Node runs.
WScript.Sleep 750
On Error Resume Next
If fso.FileExists(logPath) Then
    If fso.GetFile(logPath).Size > 5242880 Then fso.DeleteFile logPath, True
End If
On Error GoTo 0

command = "cmd /c cd /d """ & strPath & """ && """ & nodePath & """ """ & strPath & "\index.js"" >> """ & logPath & """ 2>&1"
WshShell.Run command, 0, False
