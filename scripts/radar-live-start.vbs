' Inicia el radar en tiempo real sin ventana (para la carpeta Inicio de Windows).
' Para detenerlo: Administrador de tareas -> "Node.js" y "Procesador de comandos de Windows", o reinicia el PC
' despues de quitar el acceso directo de la carpeta Inicio (Win+R -> shell:startup).
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run "cmd /c """ & dir & "\radar-live.cmd""", 0, False
