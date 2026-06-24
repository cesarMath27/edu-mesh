# =============================================================================
#  INSTALADOR VISUAL de edu-mesh (Windows)
# -----------------------------------------------------------------------------
#  Deja TODO listo desde cero, con una ventana de progreso y SIN permisos de
#  administrador:
#    1) Si no hay Node.js, descarga Node LTS PORTÁTIL y lo guarda en runtime\node
#       (no toca el sistema, no pide UAC).
#    2) Instala las dependencias del proyecto (npm install).
#    3) Prepara el catálogo y las llaves (npm run setup).
#    4) Ofrece "Iniciar ahora" y crear un acceso directo en el Escritorio.
#
#  Lo lanza Instalar-edu-mesh.bat (doble clic). No se ejecuta a mano normalmente.
# =============================================================================

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Raíz del proyecto = dos niveles arriba de este .ps1 (scripts\install\ -> raíz).
$root    = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$runtime = Join-Path $root 'runtime'
$nodeDir = Join-Path $runtime 'node'
$nodeExe = Join-Path $nodeDir 'node.exe'

# Versión LTS de respaldo si no se puede consultar el índice oficial.
$FallbackVersion = 'v22.12.0'

# ---------------------------------------------------------------- UI ----------
$form = New-Object System.Windows.Forms.Form
$form.Text = 'Instalar edu-mesh'
$form.Size = New-Object System.Drawing.Size(640, 540)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.BackColor = [System.Drawing.Color]::FromArgb(245, 247, 252)

$title = New-Object System.Windows.Forms.Label
$title.Text = 'edu-mesh · Instalación'
$title.Font = New-Object System.Drawing.Font('Segoe UI', 18, [System.Drawing.FontStyle]::Bold)
$title.ForeColor = [System.Drawing.Color]::FromArgb(30, 41, 84)
$title.Location = New-Object System.Drawing.Point(24, 18)
$title.AutoSize = $true
$form.Controls.Add($title)

$subtitle = New-Object System.Windows.Forms.Label
$subtitle.Text = 'Preparando todo desde cero. No necesitas permisos de administrador.'
$subtitle.Font = New-Object System.Drawing.Font('Segoe UI', 9.5)
$subtitle.ForeColor = [System.Drawing.Color]::FromArgb(80, 90, 120)
$subtitle.Location = New-Object System.Drawing.Point(26, 56)
$subtitle.AutoSize = $true
$form.Controls.Add($subtitle)

$status = New-Object System.Windows.Forms.Label
$status.Text = 'Iniciando…'
$status.Font = New-Object System.Drawing.Font('Segoe UI', 10, [System.Drawing.FontStyle]::Bold)
$status.ForeColor = [System.Drawing.Color]::FromArgb(40, 50, 90)
$status.Location = New-Object System.Drawing.Point(26, 90)
$status.Size = New-Object System.Drawing.Size(580, 22)
$form.Controls.Add($status)

$bar = New-Object System.Windows.Forms.ProgressBar
$bar.Location = New-Object System.Drawing.Point(26, 116)
$bar.Size = New-Object System.Drawing.Size(584, 22)
$bar.Style = 'Marquee'
$bar.MarqueeAnimationSpeed = 30
$form.Controls.Add($bar)

$log = New-Object System.Windows.Forms.TextBox
$log.Multiline = $true
$log.ReadOnly = $true
$log.ScrollBars = 'Vertical'
$log.Font = New-Object System.Drawing.Font('Consolas', 9)
$log.BackColor = [System.Drawing.Color]::FromArgb(17, 24, 39)
$log.ForeColor = [System.Drawing.Color]::FromArgb(220, 230, 245)
$log.Location = New-Object System.Drawing.Point(26, 150)
$log.Size = New-Object System.Drawing.Size(584, 280)
$form.Controls.Add($log)

$btnStart = New-Object System.Windows.Forms.Button
$btnStart.Text = '▶  Iniciar ahora'
$btnStart.Font = New-Object System.Drawing.Font('Segoe UI', 10, [System.Drawing.FontStyle]::Bold)
$btnStart.Size = New-Object System.Drawing.Size(150, 38)
$btnStart.Location = New-Object System.Drawing.Point(26, 446)
$btnStart.BackColor = [System.Drawing.Color]::FromArgb(91, 140, 255)
$btnStart.ForeColor = [System.Drawing.Color]::White
$btnStart.FlatStyle = 'Flat'
$btnStart.Enabled = $false
$form.Controls.Add($btnStart)

$chkShortcut = New-Object System.Windows.Forms.CheckBox
$chkShortcut.Text = 'Crear acceso directo en el Escritorio'
$chkShortcut.Font = New-Object System.Drawing.Font('Segoe UI', 9.5)
$chkShortcut.Location = New-Object System.Drawing.Point(190, 454)
$chkShortcut.Size = New-Object System.Drawing.Size(270, 24)
$chkShortcut.Checked = $true
$chkShortcut.Enabled = $false
$form.Controls.Add($chkShortcut)

$btnClose = New-Object System.Windows.Forms.Button
$btnClose.Text = 'Cerrar'
$btnClose.Font = New-Object System.Drawing.Font('Segoe UI', 10)
$btnClose.Size = New-Object System.Drawing.Size(100, 38)
$btnClose.Location = New-Object System.Drawing.Point(510, 446)
$btnClose.FlatStyle = 'Flat'
$form.Controls.Add($btnClose)
$btnClose.Add_Click({ $form.Close() })

# ---------------------------------------------------------- helpers -----------
function Write-Log($msg) {
  $log.AppendText($msg + "`r`n")
  [System.Windows.Forms.Application]::DoEvents()
}
function Set-Status($msg) {
  $status.Text = $msg
  [System.Windows.Forms.Application]::DoEvents()
}

# Descarga con barra de progreso real (lee el stream por trozos + DoEvents).
function Download-File($url, $dest) {
  $bar.Style = 'Continuous'; $bar.Value = 0
  $req = [System.Net.HttpWebRequest]::Create($url)
  $req.UserAgent = 'edu-mesh-installer'
  $resp = $req.GetResponse()
  $total = $resp.ContentLength
  $in = $resp.GetResponseStream()
  $out = [System.IO.File]::Create($dest)
  try {
    $buffer = New-Object byte[] 65536
    $sum = 0; $i = 0
    while (($n = $in.Read($buffer, 0, $buffer.Length)) -gt 0) {
      $out.Write($buffer, 0, $n); $sum += $n; $i++
      if (($i % 8) -eq 0) {
        if ($total -gt 0) {
          $bar.Value = [Math]::Min(100, [int](($sum / $total) * 100))
          Set-Status ("Descargando Node.js…  {0:N1} / {1:N1} MB" -f ($sum / 1MB), ($total / 1MB))
        }
        [System.Windows.Forms.Application]::DoEvents()
      }
    }
    $bar.Value = 100
  } finally {
    $out.Close(); $in.Close(); $resp.Close()
  }
}

function Get-Text($url) {
  $req = [System.Net.HttpWebRequest]::Create($url)
  $req.UserAgent = 'edu-mesh-installer'
  $resp = $req.GetResponse()
  $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
  try { return $reader.ReadToEnd() } finally { $reader.Close(); $resp.Close() }
}

# Ejecuta un proceso ocultando su ventana y vuelca su salida al log en vivo.
#  Redirige a un archivo temporal a nivel de cmd y lo "sigue" (tail) con DoEvents.
function Run-Logged($exe, $argline, $workdir) {
  $tmp = [System.IO.Path]::GetTempFileName()
  # Comando interno completo (con redirección) envuelto en UN solo par de comillas:
  #   cmd /c "  "exe" args > "tmp" 2>&1  "   → cmd quita solo las comillas externas.
  $inner = "`"$exe`" $argline > `"$tmp`" 2>&1"
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = 'cmd.exe'
  $psi.Arguments = "/c `"$inner`""
  $psi.WorkingDirectory = $workdir
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $p = [System.Diagnostics.Process]::Start($psi)

  $pos = 0
  while ($true) {
    $done = $p.HasExited
    if (-not $done) { Start-Sleep -Milliseconds 150 }
    if (Test-Path $tmp) {
      $fs = [System.IO.File]::Open($tmp, 'Open', 'Read', 'ReadWrite')
      try {
        $fs.Seek($pos, 'Begin') | Out-Null
        $sr = New-Object System.IO.StreamReader($fs)
        $chunk = $sr.ReadToEnd(); $pos = $fs.Position
        $sr.Close()
      } finally { $fs.Close() }
      if ($chunk) { foreach ($line in ($chunk -split "`r?`n")) { if ($line.Trim()) { Write-Log "   $line" } } }
    }
    [System.Windows.Forms.Application]::DoEvents()
    if ($done) { break }
  }
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  return $p.ExitCode
}

# Resuelve el node a usar: portátil local > Node del sistema.
function Resolve-NodeExe {
  if (Test-Path $nodeExe) { return $nodeExe }
  $sys = Get-Command node -ErrorAction SilentlyContinue
  if ($sys) { return $sys.Source }
  return $null
}

# Invoca npm SIEMPRE vía "node npm-cli.js" (evita problemas con npm.cmd).
function Npm-Cli($exe) {
  $dir = Split-Path $exe -Parent
  $cli = Join-Path $dir 'node_modules\npm\bin\npm-cli.js'
  if (Test-Path $cli) { return $cli }
  return $null
}

function Install-PortableNode {
  $arch = if ($env:PROCESSOR_ARCHITECTURE -match 'ARM64') { 'arm64' } else { 'x64' }
  Set-Status 'Buscando la versión LTS de Node.js…'
  Write-Log "→ Detectando la última versión LTS (arquitectura $arch)…"
  $version = $FallbackVersion
  try {
    $json = Get-Text 'https://nodejs.org/dist/index.json' | ConvertFrom-Json
    $lts = $json | Where-Object { $_.lts } | Select-Object -First 1
    if ($lts) { $version = $lts.version }
    Write-Log "→ Versión LTS: $version"
  } catch {
    Write-Log "⚠ No se pudo consultar el índice; uso $FallbackVersion."
  }

  $file = "node-$version-win-$arch.zip"
  $url  = "https://nodejs.org/dist/$version/$file"
  New-Item -ItemType Directory -Force -Path $runtime | Out-Null
  $zip = Join-Path $runtime $file

  Write-Log "→ Descargando $url"
  Download-File $url $zip

  # Verificación de integridad (SHA-256) contra el manifiesto oficial.
  try {
    Set-Status 'Verificando integridad…'
    $sha = Get-Text "https://nodejs.org/dist/$version/SHASUMS256.txt"
    $expected = ($sha -split "`n" | Where-Object { $_ -match [Regex]::Escape($file) } | Select-Object -First 1).Split(' ')[0]
    $actual = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
    if ($expected -and ($expected.ToLower() -ne $actual)) {
      throw "La huella SHA-256 no coincide. Descarga corrupta o manipulada."
    }
    Write-Log '✓ Integridad verificada (SHA-256).'
  } catch {
    Write-Log "⚠ No se pudo verificar la huella: $($_.Exception.Message)"
  }

  Set-Status 'Extrayendo Node.js…'
  $bar.Style = 'Marquee'
  Write-Log '→ Extrayendo…'
  $extractTmp = Join-Path $runtime '_extract'
  if (Test-Path $extractTmp) { Remove-Item $extractTmp -Recurse -Force }
  Expand-Archive -Path $zip -DestinationPath $extractTmp -Force
  $inner = Get-ChildItem $extractTmp -Directory | Select-Object -First 1
  if (Test-Path $nodeDir) { Remove-Item $nodeDir -Recurse -Force }
  Move-Item $inner.FullName $nodeDir
  Remove-Item $extractTmp -Recurse -Force
  Remove-Item $zip -Force -ErrorAction SilentlyContinue
  Write-Log "✓ Node.js portátil listo en runtime\node"
}

function Create-Shortcut {
  try {
    $desktop = [Environment]::GetFolderPath('Desktop')
    $lnk = Join-Path $desktop 'edu-mesh (Maestro).lnk'
    $target = Join-Path $root 'Iniciar-Maestro.bat'
    $ws = New-Object -ComObject WScript.Shell
    $sc = $ws.CreateShortcut($lnk)
    $sc.TargetPath = $target
    $sc.WorkingDirectory = $root
    $sc.IconLocation = "$nodeExe, 0"
    $sc.Description = 'Inicia edu-mesh: QR para alumnos + panel del maestro'
    $sc.Save()
    Write-Log "✓ Acceso directo creado en el Escritorio."
  } catch {
    Write-Log "⚠ No se pudo crear el acceso directo: $($_.Exception.Message)"
  }
}

# ------------------------------------------------------------ flujo -----------
function Run-Install {
  try {
    Write-Log "Carpeta del proyecto: $root"

    # 1) Node.js
    $exe = Resolve-NodeExe
    if ($exe) {
      Write-Log "✓ Node.js ya disponible: $exe"
    } else {
      Write-Log 'No se encontró Node.js. Se instalará una copia PORTÁTIL (sin admin).'
      Install-PortableNode
      $exe = Resolve-NodeExe
    }
    if (-not $exe) { throw 'No fue posible preparar Node.js.' }
    $ver = (& $exe --version) 2>$null
    Write-Log "Node.js: $ver"

    $npmCli = Npm-Cli $exe
    if (-not $npmCli) { throw "No se encontró npm junto a Node ($exe)." }

    # 2) Dependencias
    $bar.Style = 'Marquee'
    Set-Status 'Instalando dependencias (npm install)… puede tardar un poco.'
    Write-Log '→ npm install'
    $code = Run-Logged $exe "`"$npmCli`" install --no-audit --no-fund" $root
    if ($code -ne 0) { throw "npm install terminó con código $code." }
    Write-Log '✓ Dependencias instaladas.'

    # 3) Catálogo + llaves (solo la primera vez)
    if (-not (Test-Path (Join-Path $root 'keys\trust-store.json'))) {
      Set-Status 'Preparando el catálogo y las llaves (npm run setup)…'
      Write-Log '→ npm run setup'
      $code = Run-Logged $exe "`"$npmCli`" run setup" $root
      if ($code -ne 0) { throw "El setup terminó con código $code." }
      Write-Log '✓ Catálogo y llaves listos.'
    } else {
      Write-Log '✓ El catálogo ya estaba preparado.'
    }

    $bar.Style = 'Continuous'; $bar.Value = 100
    Set-Status '✓ ¡Todo listo! Ya puedes iniciar edu-mesh.'
    Write-Log ''
    Write-Log '======================================================'
    Write-Log '  INSTALACIÓN COMPLETA'
    Write-Log '  Pulsa "Iniciar ahora" para abrir el QR y el panel.'
    Write-Log '======================================================'
    $btnStart.Enabled = $true
    $chkShortcut.Enabled = $true
    $btnClose.Text = 'Cerrar'
  } catch {
    $bar.Style = 'Continuous'; $bar.Value = 0
    Set-Status '✗ La instalación falló.'
    Write-Log ''
    Write-Log "ERROR: $($_.Exception.Message)"
    Write-Log 'Revisa tu conexión a internet e inténtalo de nuevo.'
    Write-Log 'Si el problema persiste, instala Node 22 LTS desde https://nodejs.org y vuelve a abrir este instalador.'
  }
}

$btnStart.Add_Click({
  if ($chkShortcut.Checked) { Create-Shortcut }
  $bat = Join-Path $root 'Iniciar-Maestro.bat'
  Start-Process -FilePath $bat -WorkingDirectory $root
  $form.Close()
})

# Arranca la instalación en cuanto se muestra la ventana (sin clics).
$form.Add_Shown({ Run-Install })
[void]$form.ShowDialog()
