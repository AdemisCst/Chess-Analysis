# ==========================================================================
# ARQUIVO: servidor.ps1
# DESCRIÇÃO: Servidor HTTP local mínimo (sem dependências) para o Acervo 64.
# Por que existe: o Stockfish roda em Web Worker e carrega um arquivo .wasm.
# Navegadores bloqueiam esses recursos quando a página é aberta como arquivo
# local (file://). Servir a pasta em http://localhost resolve isso.
#
# USO: dê duplo clique em iniciar.bat (ou execute este script).
# Para encerrar: feche esta janela ou pressione Ctrl+C.
# ==========================================================================

param(
    [int]$Port = 8765
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

$mime = @{
    '.html' = 'text/html; charset=utf-8'
    '.htm'  = 'text/html; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.js'   = 'text/javascript; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.svg'  = 'image/svg+xml'
    '.wasm' = 'application/wasm'
    '.pgn'  = 'application/x-chess-pgn; charset=utf-8'
    '.txt'  = 'text/plain; charset=utf-8'
    '.md'   = 'text/plain; charset=utf-8'
    '.png'  = 'image/png'
    '.ico'  = 'image/x-icon'
}

function Send-Response {
    param(
        [System.Net.Sockets.NetworkStream]$Stream,
        [int]$StatusCode,
        [string]$StatusText,
        [byte[]]$Body,
        [string]$ContentType
    )
    if ($null -eq $Body) { $Body = [byte[]]@() }
    $header = "HTTP/1.1 $StatusCode $StatusText`r`n" +
              "Content-Type: $ContentType`r`n" +
              "Content-Length: $($Body.Length)`r`n" +
              "Cache-Control: no-store`r`n" +
              "Access-Control-Allow-Origin: *`r`n" +
              "Connection: close`r`n`r`n"
    $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
    $Stream.Write($headerBytes, 0, $headerBytes.Length)
    if ($Body.Length -gt 0) { $Stream.Write($Body, 0, $Body.Length) }
}

$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
try {
    $listener.Start()
} catch {
    Write-Host "Nao foi possivel abrir a porta $Port. Feche outra janela do servidor e tente novamente." -ForegroundColor Red
    Read-Host "Pressione Enter para sair"
    exit 1
}

$url = "http://localhost:$Port/"
Write-Host ""
Write-Host "  Acervo 64 - servidor local" -ForegroundColor Cyan
Write-Host "  Abra: $url" -ForegroundColor Green
Write-Host "  Para encerrar: Ctrl+C ou feche esta janela." -ForegroundColor DarkGray
Write-Host ""

Start-Sleep -Milliseconds 400
Start-Process $url

while ($true) {
    $client = $listener.AcceptTcpClient()
    $stream = $null
    try {
        $client.ReceiveTimeout = 5000
        $stream = $client.GetStream()
        $stream.ReadTimeout = 5000

        $buffer = New-Object byte[] 16384
        $read = $stream.Read($buffer, 0, $buffer.Length)
        if ($read -le 0) { continue }

        $requestText = [System.Text.Encoding]::ASCII.GetString($buffer, 0, $read)
        $firstLine = ($requestText -split "`r`n")[0]
        $requestParts = $firstLine -split ' '
        if ($requestParts.Length -lt 2) {
            Send-Response -Stream $stream -StatusCode 400 -StatusText 'Bad Request' -Body ([System.Text.Encoding]::UTF8.GetBytes('Bad request')) -ContentType 'text/plain'
            continue
        }

        $method = $requestParts[0]
        $target = $requestParts[1]
        if ($method -ne 'GET' -and $method -ne 'HEAD') {
            Send-Response -Stream $stream -StatusCode 405 -StatusText 'Method Not Allowed' -Body ([System.Text.Encoding]::UTF8.GetBytes('Method not allowed')) -ContentType 'text/plain'
            continue
        }

        $target = ($target -split '\?')[0]
        $target = [System.Uri]::UnescapeDataString($target)
        if ([string]::IsNullOrWhiteSpace($target) -or $target -eq '/') { $target = '/index.html' }

        $relative = $target.TrimStart('/') -replace '/', '\'
        $fullPath = [System.IO.Path]::GetFullPath((Join-Path $root $relative))
        $rootPath = [System.IO.Path]::GetFullPath($root) + [System.IO.Path]::DirectorySeparatorChar
        if (-not $fullPath.StartsWith($rootPath, [System.StringComparison]::OrdinalIgnoreCase)) {
            Send-Response -Stream $stream -StatusCode 403 -StatusText 'Forbidden' -Body ([System.Text.Encoding]::UTF8.GetBytes('Acesso negado')) -ContentType 'text/plain; charset=utf-8'
            continue
        }

        if (Test-Path -LiteralPath $fullPath -PathType Leaf) {
            $bytes = [System.IO.File]::ReadAllBytes($fullPath)
            $extension = [System.IO.Path]::GetExtension($fullPath).ToLowerInvariant()
            $contentType = $mime[$extension]
            if (-not $contentType) { $contentType = 'application/octet-stream' }
            if ($method -eq 'HEAD') { $bytes = [byte[]]@() }
            Send-Response -Stream $stream -StatusCode 200 -StatusText 'OK' -Body $bytes -ContentType $contentType
        } else {
            $body = [System.Text.Encoding]::UTF8.GetBytes('Arquivo nao encontrado: ' + $relative)
            Send-Response -Stream $stream -StatusCode 404 -StatusText 'Not Found' -Body $body -ContentType 'text/plain; charset=utf-8'
        }
    } catch {
        # Conexões interrompidas pelo navegador são normais; siga em frente.
    } finally {
        if ($stream) { try { $stream.Close() } catch {} }
        try { $client.Close() } catch {}
    }
}
