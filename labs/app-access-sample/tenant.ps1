param(
    [Parameter(Mandatory)][ValidateSet('Setup','Inspect','Cleanup')][string]$Action,
    [Parameter(Mandatory)][guid]$TenantId,
    [Parameter(Mandatory)][guid]$ExpectedAdminId,
    [guid]$AllowedUserId,
    [guid]$DeniedUserId,
    [string]$StatePath = (Join-Path $PWD 'app-access-lab.json')
)
$ErrorActionPreference = 'Stop'
$Graph = 'https://graph.microsoft.com/v1.0'
$scopes = if ($Action -eq 'Inspect') { @('Application.Read.All','User.Read.All') } else {
    @('Application.ReadWrite.All','AppRoleAssignment.ReadWrite.All','DelegatedPermissionGrant.ReadWrite.All','User.Read.All')
}
Connect-MgGraph -TenantId $TenantId -Scopes $scopes -ContextScope Process -NoWelcome
if ((Get-MgContext).TenantId -ne $TenantId.ToString()) { throw 'Wrong tenant.' }
function Read-Graph([string]$Path) { Invoke-MgGraphRequest -Method GET -Uri "$Graph$Path" }
function Write-Graph([string]$Path,$Body) {
    Invoke-MgGraphRequest -Method POST -Uri "$Graph$Path" -Body ($Body | ConvertTo-Json -Depth 12) -ContentType 'application/json'
}
function Save-State($State) { $State | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $StatePath -Encoding utf8 }
function Read-All([string]$Path) {
    $next = "$Graph$Path"
    while ($next) {
        if (-not $next.StartsWith("$Graph/")) { throw 'Unexpected pagination host.' }
        $page = Invoke-MgGraphRequest -Method GET -Uri $next
        $page.value
        $next = $page.'@odata.nextLink'
    }
}
$me = Read-Graph '/me?$select=id'
if ($me.id -ne $ExpectedAdminId.ToString()) { throw 'Wrong signed-in administrator.' }
if ($Action -eq 'Setup') {
    if (Test-Path -LiteralPath $StatePath) { throw 'State file already exists. Inspect it; do not create duplicate resources.' }
    if ($AllowedUserId -eq [guid]::Empty -or $DeniedUserId -eq [guid]::Empty -or $AllowedUserId -eq $DeniedUserId -or $AllowedUserId -eq $ExpectedAdminId -or $DeniedUserId -eq $ExpectedAdminId) {
        throw 'Provide two distinct, non-admin test user IDs.'
    }
    foreach ($id in @($AllowedUserId,$DeniedUserId)) {
        $user = Read-Graph "/users/$id`?`$select=id,accountEnabled,userType"
        if (-not $user.accountEnabled -or $user.userType -ne 'Member') { throw 'Test users must be enabled tenant members.' }
    }
    $existing = Read-Graph "/applications?`$filter=displayName eq 'APP-ACCESS-LAB-Web'&`$select=id"
    if ($existing.value.Count) { throw 'An app with the lab name already exists. Inspect it first.' }
    if ((Read-Host 'Type APP-ACCESS-LAB to create lab-only resources') -cne 'APP-ACCESS-LAB') { throw 'Not confirmed.' }
    $reader = [guid]::NewGuid().ToString()
    $observer = [guid]::NewGuid().ToString()
    $graphSp = Read-Graph "/servicePrincipals?`$filter=appId eq '00000003-0000-0000-c000-000000000000'"
    if ($graphSp.value.Count -ne 1) { throw 'Expected exactly one Microsoft Graph service principal.' }
    $userRead = @($graphSp.value[0].oauth2PermissionScopes | Where-Object { $_.value -eq 'User.Read' -and $_.isEnabled })
    if ($userRead.Count -ne 1) { throw 'Cannot resolve delegated User.Read.' }
    $app = Write-Graph '/applications' @{
        displayName='APP-ACCESS-LAB-Web'; description='APP-ACCESS-LAB only. Delete after training.'
        signInAudience='AzureADMyOrg'
        web=@{redirectUris=@('http://localhost:4300/callback');homePageUrl='http://localhost:4300'}
        appRoles=@(
            @{id=$reader;allowedMemberTypes=@('User');displayName='Lab Reader';value='Lab.Reader';description='Read protected lab content';isEnabled=$true},
            @{id=$observer;allowedMemberTypes=@('User');displayName='Lab Observer';value='Lab.Observer';description='Sign in without protected access';isEnabled=$true}
        )
        requiredResourceAccess=@(@{resourceAppId=$graphSp.value[0].appId;resourceAccess=@(@{id=$userRead[0].id;type='Scope'})})
    }
    $state = @{tenantId=$TenantId.ToString();appObjectId=$app.id;clientId=$app.appId;readerRoleId=$reader;observerRoleId=$observer;allowedUserId=$AllowedUserId.ToString();deniedUserId=$DeniedUserId.ToString()}
    Save-State $state
    $sp = Write-Graph '/servicePrincipals' @{appId=$app.appId;appRoleAssignmentRequired=$true}
    $state.spId=$sp.id; Save-State $state
    $assignment = Write-Graph "/servicePrincipals/$($sp.id)/appRoleAssignedTo" @{principalId=$AllowedUserId.ToString();resourceId=$sp.id;appRoleId=$reader}
    $state.assignmentId=$assignment.id; Save-State $state
    $grant = Write-Graph '/oauth2PermissionGrants' @{clientId=$sp.id;resourceId=$graphSp.value[0].id;consentType='AllPrincipals';scope='User.Read'}
    $state.grantId=$grant.id; Save-State $state
    $credential = Write-Graph "/applications/$($app.id)/addPassword" @{passwordCredential=@{displayName='APP-ACCESS-LAB temporary';endDateTime=[datetime]::UtcNow.AddDays(1).ToString('o')}}
    $state.credentialKeyId=$credential.keyId; Save-State $state
    $env:TENANT_ID=$TenantId.ToString(); $env:CLIENT_ID=$app.appId; $env:CLIENT_SECRET=$credential.secretText
    Write-Host 'Lab created. Secret is in this process environment only; state file contains IDs, not the secret.'
    Write-Host 'In this same terminal, enter the sample folder and run npm ci, then npm start.'
} else {
    $state = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
    if ($state.tenantId -ne $TenantId.ToString()) { throw 'State file belongs to a different tenant.' }
    $app = Read-Graph "/applications/$($state.appObjectId)"
    if ($app.appId -ne $state.clientId -or $app.displayName -ne 'APP-ACCESS-LAB-Web' -or $app.description -ne 'APP-ACCESS-LAB only. Delete after training.') { throw 'Resource identity or lab marker does not match. Stop.' }
    if ($Action -eq 'Inspect') {
        $app | Select-Object id,appId,displayName,signInAudience,web,appRoles,requiredResourceAccess
        if ($state.spId) {
            Read-Graph "/servicePrincipals/$($state.spId)?`$select=id,appId,appRoleAssignmentRequired"
            Read-All "/servicePrincipals/$($state.spId)/appRoleAssignedTo" | Select-Object id,principalId,appRoleId
            Read-All "/oauth2PermissionGrants?`$filter=clientId eq '$($state.spId)'" | Select-Object id,resourceId,consentType,scope
        }
    } else {
        if ((Read-Host "Type exact app object ID $($state.appObjectId) to delete this lab app") -cne $state.appObjectId) { throw 'Not confirmed.' }
        if ($state.spId) {
            $sp = Read-Graph "/servicePrincipals/$($state.spId)"
            if ($sp.appId -ne $state.clientId) { throw 'Service principal does not belong to this app.' }
            Invoke-MgGraphRequest -Method DELETE -Uri "$Graph/servicePrincipals/$($state.spId)"
        }
        Invoke-MgGraphRequest -Method DELETE -Uri "$Graph/applications/$($state.appObjectId)"
        if (Test-Path Env:CLIENT_SECRET) { Remove-Item Env:CLIENT_SECRET }
        Write-Host 'App and service principal deleted. Test users and unrelated tenant policies were not changed.'
        Write-Host 'Verify absence in the portal; keep the state file as cleanup evidence.'
    }
}
