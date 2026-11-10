param(
    [switch]$NoBrowser,
    [int]$Port = 8765
)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

python -c "import reportlab, pypdf"
if ($LASTEXITCODE -ne 0) {
    Write-Host "Installing Python dependencies..." -ForegroundColor Yellow
    python -m pip install -r requirements.txt
    if ($LASTEXITCODE -ne 0) {
        throw "Dependency installation failed."
    }
}

$requiredPdfs = @(
    "output\pdf\2026110101-张晓雨.pdf",
    "output\pdf\2026110102-李明远.pdf",
    "output\pdf\2026110103-王思涵.pdf",
    "output\pdf\2026110104-陈子轩.pdf",
    "output\pdf\2026110105-刘若彤.pdf",
    "output\pdf\2026110106-赵文博.pdf",
    "output\pdf\2026110107-孙嘉怡.pdf",
    "output\pdf\2026110108-周景程.pdf",
    "output\pdf\2026110109-吴欣然.pdf",
    "output\pdf\2026110110-郑凯文.pdf",
    "output\pdf\网络与智能系统安全-评分标准.pdf"
)

$missingPdf = $requiredPdfs | Where-Object { -not (Test-Path -LiteralPath $_) }
if ($missingPdf) {
    Write-Host "Generating demo PDFs..." -ForegroundColor Yellow
    python scripts\generate_demo_pdfs.py
    if ($LASTEXITCODE -ne 0) {
        throw "PDF generation failed."
    }
}

$demoUrl = "http://127.0.0.1:$Port"
Write-Host "Demo URL: $demoUrl" -ForegroundColor Cyan
Write-Host "Press Ctrl+C to stop the server." -ForegroundColor DarkGray

if (-not $NoBrowser) {
    Start-Process $demoUrl
}

python app.py --port $Port
if ($LASTEXITCODE -ne 0) {
    throw "Demo server exited with code $LASTEXITCODE."
}
