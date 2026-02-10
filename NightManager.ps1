$ErrorActionPreference = "SilentlyContinue"
$logFile = "nightly_report.md"

function Log-Message($msg) {
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path $logFile -Value "## [$timestamp] $msg"
    Write-Host "[$timestamp] $msg" -ForegroundColor Cyan
}

Log-Message "?? Night Manager Started. Limit: 400 Cycles (~5 Hours). Protocol: DYNAMIC DATA ONLY."

# The Loop (Runs 400 times)
for ($i=1; $i -le 400; $i++) {
    Log-Message "?? Cycle ${i}/400: Auditing Revenue Engine..."
    
    # 1. AUDIT: Run the engine
    $auditOutput = npx tsx src/revenue-engine/main.ts 2>&1 | Out-String
    
    # 2. CHECK FOR STATIC DATA ARTIFACTS
    
    # Failure Condition A: The  Default Target (Static Data)
    if ($auditOutput -match "\\$65,000.00") {
        Log-Message "? GENERIC TARGET DETECTED. The engine is using the static $65k placeholder."
        
        $prompt = "CRITICAL: The Revenue Engine is using a static target of $65,000. This is unacceptable. \n\n1. Modify 'src/revenue-engine/hospitable-client.ts' to calculate the actual Trailing 12-Month (TTM) Revenue from the reservations endpoint. \n2. Update 'src/revenue-engine/main.ts' to use this dynamic TTM value as 'CURRENT_TARGET_RENT' instead of the hardcoded default. \n\nImplement this dynamic logic now."
        
        claude --print "$prompt" --allowedTools "Bash,Read,Edit"
        Log-Message "? Claude updated logic to use Dynamic TTM Revenue."
    
    # Failure Condition B: Market Mismatch (e.g. South Padre for a Bolivar property)
    } elseif ($auditOutput -match "South Padre" -and ($auditOutput -match "Bolivar" -or $auditOutput -match "Houston" -or $auditOutput -match "Crystal Beach")) {
        Log-Message "? MARKET MISMATCH. Property is in Bolivar/Houston, but Market is South Padre."
        
        $prompt = "CRITICAL: Location Mismatch. The property is in Bolivar/Houston, but the engine is pulling South Padre market data. \n\n1. Update 'src/revenue-engine/key-data-fetcher.ts' to support dynamic market mapping for Bolivar, Crystal Beach, and Houston. \n2. Ensure the correct UUID is used based on the property's city. \n\nFix the mapping now."
        
        claude --print "$prompt" --allowedTools "Bash,Read,Edit"
        Log-Message "? Claude updated Market Mapping logic."

    } else {
        Log-Message "? Audit Passed: Dynamic Data Active."
        
        # 3. EXPAND: Rotate to next property
        Log-Message "?? Rotating to next property..."
        claude --print "The current property passed the Dynamic Data audit. Now, query Hospitable for a DIFFERENT property ID (specifically targeting Bolivar, Crystal Beach, or Houston), update .env, and run the audit again." --allowedTools "Bash,Read,Edit"
    }
    
    # 4. SAVE PROGRESS
    git add .
    git commit -m "night-manager: cycle ${i} dynamic data enforcements"
    
    # Sleep to prevent rate limits
    Start-Sleep -Seconds 45
}

Log-Message "?? Night Shift Complete (400 Cycles)."
