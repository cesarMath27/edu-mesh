# =============================================================================
#  win-hotspot.ps1  —  crea una WiFi en la PC (con o SIN internet) en Windows
# -----------------------------------------------------------------------------
#  Lo invoca src/net/hotspot.js. Objetivo: crear la red del salón AUNQUE NO HAYA
#  internet ni ninguna red conectada.
#
#  Dos mecanismos en Windows:
#    A) "Red hospedada" (SoftAP, `netsh`): crea una WiFi PROPIA sin necesitar
#       internet. Es lo que se quiere para un salón offline. Pide Administrador y
#       el adaptador WiFi DEBE soportar "red hospedada".
#    B) "Mobile hotspot" (WinRT): no pide admin, pero COMPARTE una conexión de
#       internet (si no hay internet, no sirve).
#
#  Estrategia: primero averigua si el adaptador soporta "red hospedada".
#    · No soporta / no hay WiFi → mensaje claro (no se puede por software: dongle/router).
#    · Soporta + admin          → A (netsh, offline).
#    · Soporta + sin admin      → B (por si hay internet); si no, pide elevación y usa A.
#
#  SIEMPRE imprime una línea JSON: { ok, method, message, hint }. Cuando corre
#  elevado, la escribe en -OutFile (el proceso padre la lee).
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

# ¿El adaptador WiFi soporta "red hospedada"?  'yes' | 'no' | 'unknown'
# Devuelve también si parece NO haber WiFi en el equipo (drivers vacío/erróneo).
function HostedSupport {
  try {
    $d = (netsh wlan show drivers 2>&1 | Out-String)
    if ([string]::IsNullOrWhiteSpace($d)) { return 'nowifi' }
    foreach ($line in ($d -split "\r?\n")) {
      if ($line -match '(?i)hosted network supported|red hospedada admitida|red hospedada compatible|compatible con red hospedada') {
        if ($line -match '(?i):\s*(yes|s[ií])') { return 'yes' }
        if ($line -match '(?i):\s*no')          { return 'no' }
      }
    }
    # Si nombró un controlador pero no la línea de "hosted", asumimos desconocido.
    if ($d -match '(?i)driver|controlador|interface|interfaz') { return 'unknown' }
    return 'nowifi'
  } catch { return 'unknown' }
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

# Relanza ESTE script como Administrador (aviso de Windows / UAC) para crear la red
# hospedada offline. Devuelve el JSON del proceso elevado, o $null si se canceló.
function ElevateForNetsh {
  $tmp = [IO.Path]::GetTempFileName()
  try {
    # ArgumentList como UNA cadena bien entrecomillada (robusto con rutas con espacios).
    $argLine = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -Action start -Ssid "{1}" -Password "{2}" -OutFile "{3}" -Elevated' -f $PSCommandPath, $Ssid, $Password, $tmp
    $p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden -ArgumentList $argLine -PassThru
    if ($null -eq $p) { return $null }
    $p.WaitForExit()
    return (Get-Content -Raw -Path $tmp -ErrorAction SilentlyContinue)
  } catch {
    return $null   # UAC cancelado o no se pudo elevar
  } finally {
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  }
}

$adminHint  = 'Para crear la WiFi SIN internet hace falta permiso de Administrador: acepta el aviso de Windows, o abre el lanzador con clic derecho -> Ejecutar como administrador.'
$dongleHint = 'Esta PC no puede crear una WiFi sin internet por software (su adaptador no soporta "red hospedada", o no tiene WiFi). Solucion: un adaptador USB WiFi con modo AP (baratos) o un pequeno router/travel-router.'

# ============================== STOP =========================================
if ($Action -eq 'stop') {
  try { $tm = GetTetheringManager; if ($tm.TetheringOperationalState -eq 1) { Await ($tm.StopTetheringAsync()) ([Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult]) | Out-Null } } catch { }
  try { netsh wlan stop hostednetwork *> $null } catch { }
  Emit $true 'stop' 'detenido' ''
  exit 0
}

# ============================== START ========================================
try {
  $hosted = HostedSupport

  if ($hosted -eq 'nowifi') {
    Emit $false 'manual' 'No detecto WiFi utilizable en esta PC (el servicio WLAN no respondio o no hay adaptador).' $dongleHint
    exit 0
  }
  if ($hosted -eq 'no') {
    # Sin "red hospedada" no hay AP offline; Mobile hotspot solo serviria con internet.
    $w = WinRtStart
    if ($w.ok) { Emit $true 'mobile-hotspot' $w.msg ''; exit 0 }
    Emit $false 'manual' 'Tu adaptador WiFi NO soporta "red hospedada", asi que no puede crear una WiFi sin internet.' $dongleHint
    exit 0
  }

  # hosted = 'yes' o 'unknown' -> intentamos crear la red hospedada (offline)
  if (Test-Admin) {
    $r = NetshStart
    if ($r.ok) { Emit $true 'netsh' $r.msg ''; exit 0 }
    $w = WinRtStart
    if ($w.ok) { Emit $true 'mobile-hotspot' $w.msg ''; exit 0 }
    $extra = if ($hosted -eq 'unknown') { ' ' + $dongleHint } else { '' }
    Emit $false 'manual' (("No se pudo iniciar la red hospedada: " + $r.msg).Trim()) ($adminHint + $extra)
    exit 0
  }

  # Sin admin: primero Mobile hotspot (por si hay internet; no molesta con permisos).
  $w = WinRtStart
  if ($w.ok) { Emit $true 'mobile-hotspot' $w.msg ''; exit 0 }

  # Sin internet -> pedir elevacion y crear la red OFFLINE con netsh.
  if (-not $Elevated) {
    $res = ElevateForNetsh
    if ($res -and $res.Trim()) { Write-Output $res.Trim(); exit 0 }
    Emit $false 'manual' 'Se necesita permiso de Administrador para crear la WiFi sin internet (el aviso de Windows fue cancelado o bloqueado).' $adminHint
    exit 0
  }

  Emit $false 'manual' 'No se pudo crear la red hospedada aun con permisos.' $dongleHint
  exit 0
} catch {
  Emit $false 'manual' ("Error inesperado: " + $_.Exception.Message) $adminHint
  exit 0
}
