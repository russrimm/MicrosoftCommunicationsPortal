# Creates the Entra ID app registration for Microsoft Communications Portal.
# Requires: az login (interactive) as an account that can grant admin consent
# (Global Administrator, Privileged Role Administrator, or Cloud Application Administrator).
#
# Usage:
#   az login --tenant <your-tenant-id>
#   pwsh ./scripts/create-entra-app.ps1
#
# Optional overrides:
#   $env:APP_NAME    = 'Microsoft Communications Portal'
#   $env:SECRET_YEARS = '2'   # client secret lifetime in years (default 2)

[CmdletBinding()]
param(
    [string]$AppName    = ($env:APP_NAME    ?? 'Microsoft Communications Portal'),
    [int]   $SecretYears = ([int]($env:SECRET_YEARS ?? '2'))
)

$ErrorActionPreference = 'Stop'

# Microsoft Graph resource + app-role IDs (Application permissions, well-known constants)
$GRAPH_APP_ID        = '00000003-0000-0000-c000-000000000000'
$ROLE_SERVICEMESSAGE = '1b620472-6534-4fe6-9df2-4680e8aa28ec'  # ServiceMessage.Read.All
$ROLE_SERVICEHEALTH  = '79c261e0-fe76-4144-aad5-bdc68fbe4037'  # ServiceHealth.Read.All

Write-Host ""
Write-Host "=== Microsoft Communications Portal - Entra ID setup ===" -ForegroundColor Cyan

# 1. Sanity-check az login
$acct = az account show --only-show-errors 2>$null | ConvertFrom-Json
if (-not $acct) {
    Write-Error "Not logged in. Run: az login --tenant <tenant-id>"
    exit 1
}
$tenantId = $acct.tenantId
Write-Host "Tenant : $tenantId ($($acct.name))"
Write-Host "User   : $($acct.user.name)"

# 2. Create or reuse the app registration
Write-Host ""
Write-Host "[1/6] App registration: $AppName" -ForegroundColor Yellow
$existing = az ad app list --display-name "$AppName" --only-show-errors --query "[0]" | ConvertFrom-Json
if ($existing) {
    Write-Host "  Reusing existing app appId=$($existing.appId)"
    $appId = $existing.appId
} else {
    $created = az ad app create `
        --display-name "$AppName" `
        --sign-in-audience AzureADMyOrg `
        --only-show-errors | ConvertFrom-Json
    $appId = $created.appId
    Write-Host "  Created appId=$appId"
}

# 3. Ensure service principal exists (required for consent + tokens)
Write-Host ""
Write-Host "[2/6] Service principal" -ForegroundColor Yellow
$sp = az ad sp list --filter "appId eq '$appId'" --only-show-errors --query "[0]" | ConvertFrom-Json
if (-not $sp) {
    $sp = az ad sp create --id $appId --only-show-errors | ConvertFrom-Json
    Write-Host "  Created SP objectId=$($sp.id)"
} else {
    Write-Host "  Reusing SP objectId=$($sp.id)"
}

# 4. Add required Graph app permissions (idempotent)
Write-Host ""
Write-Host "[3/6] API permissions (Microsoft Graph)" -ForegroundColor Yellow
foreach ($role in @(
    @{ id = $ROLE_SERVICEMESSAGE; name = 'ServiceMessage.Read.All' },
    @{ id = $ROLE_SERVICEHEALTH;  name = 'ServiceHealth.Read.All'  }
)) {
    az ad app permission add `
        --id $appId `
        --api $GRAPH_APP_ID `
        --api-permissions "$($role.id)=Role" `
        --only-show-errors 2>&1 | Out-Null
    Write-Host "  + $($role.name)"
}

# 5. Grant tenant-wide admin consent (requires admin role)
Write-Host ""
Write-Host "[4/6] Admin consent" -ForegroundColor Yellow
try {
    az ad app permission admin-consent --id $appId --only-show-errors 2>&1 | Out-Null
    Write-Host "  Consent granted." -ForegroundColor Green
} catch {
    Write-Warning "  Could not grant consent automatically. Grant it manually in the portal:"
    Write-Warning "  https://entra.microsoft.com -> Applications -> App registrations -> $AppName -> API permissions -> Grant admin consent"
}

# 6. Grant Graph app-role assignments to the App Service managed identity
#    (only when running as an azd post-provision hook — SERVICE_WEB_NAME is set by azd
#    from Bicep outputs, and the App Service has a system-assigned managed identity).
Write-Host ""
Write-Host "[5/6] Managed identity Graph permissions" -ForegroundColor Yellow
$webAppName = $env:SERVICE_WEB_NAME
$azdEnvName = $env:AZURE_ENV_NAME
if ($webAppName -and $azdEnvName) {
    $rgName = "rg-$azdEnvName"
    Write-Host "  App Service : $webAppName (RG: $rgName)"
    $miObjectId = az webapp identity show --name $webAppName -g $rgName --query principalId -o tsv --only-show-errors 2>$null
    if ($miObjectId) {
        Write-Host "  MI principal : $miObjectId"
        $graphSpId = az ad sp show --id $GRAPH_APP_ID --query id -o tsv --only-show-errors
        $granted = 0
        foreach ($role in @(
            @{ id = $ROLE_SERVICEMESSAGE; name = 'ServiceMessage.Read.All' },
            @{ id = $ROLE_SERVICEHEALTH;  name = 'ServiceHealth.Read.All'  }
        )) {
            $body = @{
                principalId = $miObjectId
                resourceId  = $graphSpId
                appRoleId   = $role.id
            } | ConvertTo-Json -Compress
            try {
                az rest --method POST `
                    --uri "https://graph.microsoft.com/v1.0/servicePrincipals/$graphSpId/appRoleAssignments" `
                    --body $body `
                    --only-show-errors 2>&1 | Out-Null
                Write-Host "  + $($role.name) -> managed identity" -ForegroundColor Green
                $granted++
            } catch {
                # 409 = already assigned — treat as success
                if ($_.Exception.Message -match '409') {
                    Write-Host "  = $($role.name) already assigned" -ForegroundColor Green
                    $granted++
                } else {
                    Write-Warning "  Could not assign $($role.name) to managed identity: $_"
                    Write-Warning "  Grant it manually: Azure portal -> Entra ID -> Enterprise applications -> $miObjectId -> Permissions"
                }
            }
        }
        if ($granted -eq 2) {
            Write-Host "  Managed identity is ready for Graph API calls." -ForegroundColor Green
        }
    } else {
        Write-Warning "  Could not read managed identity for $webAppName. Verify the App Service has a system-assigned identity enabled."
    }
} else {
    Write-Host "  Skipped (not an azd deployment — no SERVICE_WEB_NAME)." -ForegroundColor DarkGray
    Write-Host "  For Azure deployments, grant ServiceMessage.Read.All + ServiceHealth.Read.All" -ForegroundColor DarkGray
    Write-Host "  to the App Service managed identity. See README.md -> Setup -> Option A." -ForegroundColor DarkGray
}

# 7. Create client secret
Write-Host ""
Write-Host "[6/6] Client secret (valid $SecretYears years)" -ForegroundColor Yellow
$cred = az ad app credential reset `
    --id $appId `
    --display-name "portal-$(Get-Date -Format 'yyyyMMdd')" `
    --years $SecretYears `
    --append `
    --only-show-errors | ConvertFrom-Json
$clientSecret = $cred.password

# 8. Report + write .env
Write-Host ""
Write-Host "=== DONE ===" -ForegroundColor Green
Write-Host "M365_TENANT_ID    = $tenantId"
Write-Host "M365_CLIENT_ID    = $appId"
Write-Host "M365_CLIENT_SECRET = <written to .env>"

$envPath = Join-Path (Split-Path $PSScriptRoot -Parent) '.env'
$envLines = @(
    "# Written by scripts/create-entra-app.ps1 on $(Get-Date -Format 'yyyy-MM-dd HH:mm')",
    "M365_TENANT_ID=$tenantId",
    "M365_CLIENT_ID=$appId",
    "M365_CLIENT_SECRET=$clientSecret"
)

if (Test-Path $envPath) {
    $backup = "$envPath.bak-$(Get-Date -Format 'yyyyMMddHHmmss')"
    Copy-Item $envPath $backup
    Write-Host ""
    Write-Host "Existing .env backed up to: $backup" -ForegroundColor Yellow
    # Read raw text split on common line endings to handle corrupted single-line files
    $raw = [System.IO.File]::ReadAllText($envPath)
    $lines = $raw -split '\r?\n'
    $existing = $lines | Where-Object { $_ -notmatch '^(M365_TENANT_ID|M365_CLIENT_ID|M365_CLIENT_SECRET)=' -and $_ -notmatch '# Written by scripts/create-entra-app\.ps1' }
    # Drop trailing blank lines to avoid stacking empties
    while ($existing.Count -gt 0 -and [string]::IsNullOrWhiteSpace($existing[-1])) {
        $existing = $existing[0..($existing.Count - 2)]
    }
    ($existing + '' + $envLines) | Set-Content $envPath -Encoding UTF8
} else {
    $envLines | Set-Content $envPath -Encoding UTF8
}
Write-Host ""
Write-Host ".env updated (for local dev). Restart the server:  npm start" -ForegroundColor Cyan
if ($webAppName) {
    Write-Host ""
    Write-Host "Azure deployment uses managed identity — the .env client secret is for local dev only." -ForegroundColor Cyan
}
Write-Host ""
Write-Host "NOTE: Message Center + Service Health data can take up to ~1 hour to appear" -ForegroundColor DarkGray
Write-Host "      after first consent while Graph provisions access." -ForegroundColor DarkGray
