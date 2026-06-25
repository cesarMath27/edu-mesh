# =============================================================================
#  win-hotspot.ps1  —  enciende/apaga el punto de acceso WiFi en Windows
# -----------------------------------------------------------------------------
#  Lo invoca src/net/hotspot.js. Estrategia (mejor esfuerzo):
#    1) "Mobile hotspot" nativo (WinRT NetworkOperatorTetheringManager) — SIN admin,
#       pero comparte una conexión existente (si no hay red de internet, falla).
#    2) Si falla, `netsh wlan` (SoftAP) — funciona offline pero PIDE administrador y
#       no lo soportan todos los adaptadores.
#  Imprime SIEMPRE una sola línea JSON: { "ok": bool, "method": str, "message": str }
#  para que Node sepa si quedó activo o si hay que pasar a modo asistido.
#
#  Uso:  powershell -NoProfile -ExecutionPolicy Bypass -File win-hotspot.ps1 `
#          -Action start -Ssid "edu-mesh" -Password "edumesh1234"
# =============================================================================
param(
  [string]$Action = 'start',
  [string]$Ssid = 'edu-mesh',
  [string]$Password = ''
)

function Emit($ok, $method, $message) {
  ([ordered]@{ ok = [bool]$ok; method = "$method"; message = "$message" } | ConvertTo-Json -Compress)
}

# --- Ayudantes para "esperar" tareas asíncronas de WinRT desde PowerShell ---
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

function Get-TetheringManager {
  [void][Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager, Windows.Networking.NetworkOperators, ContentType = WindowsRuntime]
  [void][Windows.Networking.Connectivity.NetworkInformation, Windows.Networking.Connectivity, ContentType = WindowsRuntime]
  $profile = [Windows.Networking.Connectivity.NetworkInformation]::GetInternetConnectionProfile()
  if ($null -eq $profile) { throw 'No hay una conexión de internet que compartir (Mobile hotspot la necesita).' }
  return [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager]::CreateFromConnectionProfile($profile)
}

# -------------------------------- STOP ---------------------------------------
if ($Action -eq 'stop') {
  $stopped = $false
  try {
    $tm = Get-TetheringManager
    if ($tm.TetheringOperationalState -eq 1) {
      Await ($tm.StopTetheringAsync()) ([Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult]) | Out-Null
      $stopped = $true
    }
  } catch { }
  try { netsh wlan stop hostednetwork *> $null; if ($LASTEXITCODE -eq 0) { $stopped = $true } } catch { }
  Emit $stopped 'stop' 'detenido'
  exit 0
}

# -------------------------------- START --------------------------------------
$winrtErr = ''
# 1) Mobile hotspot nativo (sin admin)
try {
  $tm = Get-TetheringManager
  $cfg = $tm.GetCurrentAccessPointConfiguration()
  $cfg.Ssid = $Ssid
  if ($Password) { $cfg.Passphrase = $Password }
  AwaitAction ($tm.ConfigureAccessPointAsync($cfg))
  if ($tm.TetheringOperationalState -ne 1) {
    $res = Await ($tm.StartTetheringAsync()) ([Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult])
    if ($res.Status -ne 0) { throw "estado $($res.Status): $($res.AdditionalErrorMessage)" }
  }
  Emit $true 'mobile-hotspot' 'Mobile hotspot activo'
  exit 0
} catch {
  $winrtErr = $_.Exception.Message
}

# 2) netsh (SoftAP) — offline, pero pide administrador
try {
  netsh wlan set hostednetwork mode=allow ssid="$Ssid" key="$Password" *> $null
  $out = (netsh wlan start hostednetwork 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -eq 0) {
    Emit $true 'netsh' 'Red hospedada (SoftAP) activa'
  } else {
    Emit $false 'netsh' (("$out $winrtErr").Trim())
  }
} catch {
  Emit $false 'netsh' (("$($_.Exception.Message) $winrtErr").Trim())
}
exit 0
