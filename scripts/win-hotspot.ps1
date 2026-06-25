# =============================================================================
#  win-hotspot.ps1  —  crea una WiFi en la PC (con o SIN internet) en Windows
# -----------------------------------------------------------------------------
#  Lo invoca src/net/hotspot.js. Objetivo: crear la red del salón AUNQUE NO HAYA
#  internet. Para eso hay dos mecanismos en Windows:
#    A) "Red hospedada" (SoftAP, `netsh`): crea una WiFi PROPIA sin necesitar
#       ninguna conexión a internet. Es justo lo que se quiere para un salón
#       offline, PERO pide permiso de Administrador y el adaptador WiFi debe
#       soportar "red hospedada".
#    B) "Mobile hotspot" (WinRT): NO pide admin, pero COMPARTE una conexión de
#       internet existente (si no hay internet, no sirve).
#
#  Estrategia (offline primero):
#    · Con admin            → A (netsh, offline). Si falla, B.
#    · Sin admin            → B (por si hay internet, sin molestar). Si falla,
#                             se PIDE elevación (aviso de Windows) y se usa A.
#  Si nada funciona, se devuelve un mensaje claro (no "necesita WiFi").
#
#  Imprime SIEMPRE una línea JSON: { ok, method, message, hint }. Cuando corre
#  elevado, la escribe en -OutFile (el proceso padre la lee).
#
#  Uso:  powershell -NoProfile -ExecutionPolicy Bypass -File win-hotspot.ps1 `
#          -Action start -Ssid "edu-mesh" -Password "edumesh1234"
# =============================================================================
param(
  [string]$Action = 'start',
  [string]$Ssid = 'edu-mesh',
  [string]$Password = '',
  [string]$OutFile = '',
  [switch]$Elevated
)

function Emit($ok, $method, $message, $hint) {
  $json = ([ordered]@{ ok = [bool]$ok; method = "$method"; message = "$message"; hint = "$hint" } | ConvertTo-Json -Compress)
  # Sin BOM (UTF8 plano) para que el proceso padre lea el JSON limpio.
  if ($OutFile) { [IO.File]::WriteAllText($OutFile, $json, (New-Object Text.UTF8Encoding($false))) } else { Write-Output $json }
}

function Test-Admin {
  try {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    return (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
  } catch { return $false }
}

# ---- A) SoftAP offline con netsh (necesita admin) ----
function NetshStart {
  try {
    netsh wlan set hostednetwork mode=allow ssid="$Ssid" key="$Password" *> $null
    $out = (netsh wlan start hostednetwork 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -eq 0) { return @{ ok = $true; msg = 'Red hospedada (SoftAP) activa — funciona SIN internet.' } }
    return @{ ok = $false; msg = $out }
  } catch { return @{ ok = $false; msg = $_.Exception.Message } }
}

# ---- Ayudantes para esperar tareas asíncronas de WinRT ----
function Await($op, $resultType) {
  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  })[0]
  $task = $asTask.MakeGenericMethod($resultType).Invoke($null, @($op))
  $task.Wait(-1) | Out-Null
  $task.Result
}
function AwaitAction($action) {
  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction'
  })[0]
  $task = $asTask.Invoke($null, @($action))
  $task.Wait(-1) | Out-Null
}
function GetTetheringManager {
  [void][Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager, Windows.Networking.NetworkOperators, ContentType = WindowsRuntime]
  [void][Windows.Networking.Connectivity.NetworkInformation, Windows.Networking.Connectivity, ContentType = WindowsRuntime]
  $profile = [Windows.Networking.Connectivity.NetworkInformation]::GetInternetConnectionProfile()
  if ($null -eq $profile) { throw 'sin-internet' }
  return [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager]::CreateFromConnectionProfile($profile)
}

# ---- B) Mobile hotspot con WinRT (sin admin, comparte internet) ----
function WinRtStart {
  try {
    $tm = GetTetheringManager
    $cfg = $tm.GetCurrentAccessPointConfiguration()
    $cfg.Ssid = $Ssid
    if ($Password) { $cfg.Passphrase = $Password }
    AwaitAction ($tm.ConfigureAccessPointAsync($cfg))
    if ($tm.TetheringOperationalState -ne 1) {
      $res = Await ($tm.StartTetheringAsync()) ([Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult])
      if ($res.Status -ne 0) { throw "estado $($res.Status): $($res.AdditionalErrorMessage)" }
    }
    return @{ ok = $true; msg = 'Mobile hotspot activo (comparte la conexión de esta PC).' }
  } catch {
    if ("$($_.Exception.Message)" -eq 'sin-internet') { return @{ ok = $false; msg = 'sin-internet' } }
    return @{ ok = $false; msg = $_.Exception.Message }
  }
}

# Relanza ESTE script con permisos de Administrador (aviso de Windows / UAC) para
# crear la red hospedada offline. Devuelve el JSON del proceso elevado, o $null.
function ElevateForNetsh {
  $tmp = [IO.Path]::GetTempFileName()
  try {
    $a = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"",
      '-Action', 'start', '-Ssid', "`"$Ssid`"", '-Password', "`"$Password`"",
      '-OutFile', "`"$tmp`"", '-Elevated')
    $p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden -ArgumentList $a -PassThru
    $p.WaitForExit()
    $res = (Get-Content -Raw -Path $tmp -ErrorAction SilentlyContinue)
    return $res
  } catch {
    return $null   # UAC cancelado o no se pudo elevar
  } finally {
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  }
}

$adminHint = 'Para crear la WiFi SIN internet hace falta: (1) permiso de Administrador (acepta el aviso de Windows, o inicia el lanzador como administrador) y (2) un adaptador WiFi que soporte "red hospedada". Si tu PC no tiene WiFi (solo cable) o el adaptador no la soporta, usa un adaptador USB WiFi con modo AP, o un router/travel-router.'

# ============================== STOP =========================================
if ($Action -eq 'stop') {
  try { if ((GetTetheringManager).TetheringOperationalState -eq 1) { Await ((GetTetheringManager).StopTetheringAsync()) ([Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult]) | Out-Null } } catch { }
  try { netsh wlan stop hostednetwork *> $null } catch { }
  Emit $true 'stop' 'detenido' ''
  exit 0
}

# ============================== START ========================================
$netshErr = ''

if (Test-Admin) {
  # Con admin: primero la red offline (netsh).
  $r = NetshStart
  if ($r.ok) { Emit $true 'netsh' $r.msg ''; exit 0 }
  $netshErr = $r.msg
  $w = WinRtStart
  if ($w.ok) { Emit $true 'mobile-hotspot' $w.msg ''; exit 0 }
  $wmsg = if ($w.msg -eq 'sin-internet') { 'no hay internet que compartir' } else { $w.msg }
  Emit $false 'manual' (("La red hospedada no inició: $netshErr. Mobile hotspot: $wmsg.").Trim()) $adminHint
  exit 0
}

# Sin admin: prueba Mobile hotspot (por si hay internet; no molesta con permisos).
$w = WinRtStart
if ($w.ok) { Emit $true 'mobile-hotspot' $w.msg ''; exit 0 }

# Sin internet (o WinRT falló): pide elevación y crea la red OFFLINE con netsh.
if (-not $Elevated) {
  $res = ElevateForNetsh
  if ($res) { Write-Output $res.Trim(); exit 0 }
  Emit $false 'manual' 'Se necesita permiso de Administrador para crear la WiFi sin internet (el aviso fue cancelado o bloqueado).' $adminHint
  exit 0
}

# Llegamos aquí elevados pero netsh ya falló arriba (no debería) → mensaje claro.
Emit $false 'manual' (("No se pudo crear la red hospedada. $netshErr").Trim()) $adminHint
exit 0
