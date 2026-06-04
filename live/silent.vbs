Dim WshShell, strPath, fso
Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
strPath = fso.GetParentFolderName(WScript.ScriptFullName)

' Install modules if needed
If Not fso.FolderExists(strPath & "\node_modules\ws") Then
    WshShell.Run "cmd /c cd /d """ & strPath & """ && npm install", 0, True
End If

' Launch node silently
WshShell.Run "cmd /c cd /d """ & strPath & """ && node index.js >> """ & strPath & "\olycity.log"" 2>&1", 0, False
