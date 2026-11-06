$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '..\labs\app-access-sample\automation.ps1')

function Assert-Lab($Condition, [string]$Message) {
    if (-not $Condition) { throw "Contract failed: $Message" }
}
function Assert-LabThrows([scriptblock]$Action, [string]$Pattern) {
    $thrown=$false
    try { & $Action | Out-Null } catch {
        if ($_.Exception.Message -notmatch $Pattern) { throw }
        $thrown=$true
    }
    Assert-Lab $thrown "Expected error: $Pattern"
}
function Merge-LabMock([hashtable]$Target, [hashtable]$Patch) {
    foreach ($key in $Patch.Keys) {
        if ($Target.ContainsKey($key) -and $Target[$key] -is [hashtable] -and $Patch[$key] -is [hashtable]) {
            Merge-LabMock $Target[$key] $Patch[$key]
        } else { $Target[$key]=$Patch[$key] }
    }
}
function Get-LabMockCollection([string]$Path) {
    foreach ($key in $script:Db.Keys) {
        if ($key.StartsWith("$Path/") -and $key.Substring($Path.Length+1) -notmatch '/') { $script:Db[$key] }
    }
}
function Read-Host {
    param([string]$Prompt, [switch]$AsSecureString)
    if ($AsSecureString) { return ConvertTo-SecureString 'offline-password-only' -AsPlainText -Force }
    if ($Prompt -like '*authorize writes*') { return 'APP-ACCESS-LAB' }
    if ($Prompt -like '*resource group*') { return 'rg-app-access-lab' }
    $script:LabTenantId
}
function Connect-MgGraph {
    param($TenantId,$Scopes,$ContextScope,[switch]$NoWelcome)
    $script:LastScopes=@($Scopes)
}
function Get-MgContext { @{TenantId=$script:MockTenant} }

function Invoke-MgGraphRequest {
    param([string]$Method,[string]$Uri,[string]$Body,[string]$OutputType,[string]$ContentType)
    $address=[uri]$Uri
    Assert-Lab ($address.Host -eq 'graph.microsoft.com') 'Graph host'
    $path=$address.AbsolutePath -replace '^/(v1\.0|beta)',''
    $query=[uri]::UnescapeDataString($address.Query)
    $data=if ($Body) { $Body | ConvertFrom-Json -AsHashtable } else { @{} }
    $script:Calls+=@{method=$Method;uri=$Uri;path=$path;body=$data}
    if ($Method -eq 'GET') {
        if ($path -eq '/me') { return @{id=$script:Admin} }
        if ($script:Db.ContainsKey($path)) { return ($script:Db[$path] | ConvertTo-Json -Depth 30 | ConvertFrom-Json -AsHashtable) }
        if ($path -eq '/applicationTemplates') {
            return @{value=@(@{id='offline-template'})}
        }
        if ($path -eq '/roleManagement/directory/roleDefinitions') {
            return @{value=@(@{id='offline-app-admin';displayName='Application Administrator'})}
        }
        if ($path -match '/claimsMappingPolicies$') { return @{value=@()} }
        $items=@(Get-LabMockCollection $path)
        if ($query -match "(displayName|userPrincipalName|appId|clientId|principalId) eq '([^']+)'") {
            $property=$Matches[1];$value=$Matches[2]
            $items=@($items | Where-Object { $_[$property] -eq $value })
        }
        return @{value=$items}
    }
    if ($Method -eq 'PATCH' -or $Method -eq 'PUT') {
        if ($path -match '/connectorGroup/\$ref$') { return }
        Assert-Lab ($script:Db.ContainsKey($path)) "Mock update target exists: $path"
        Merge-LabMock $script:Db[$path] $data
        if ($path -match '^/applications/[^/]+$') {
            $app=$script:Db[$path]
            foreach ($sp in @(Get-LabMockCollection '/servicePrincipals' | Where-Object { $_.appId -eq $app.appId })) {
                $sp.appRoles=$app.appRoles
                if ($app.ContainsKey('api')) { $sp.oauth2PermissionScopes=$app.api.oauth2PermissionScopes }
            }
        }
        return
    }
    if ($Method -eq 'DELETE') {
        if ($path -match '^/groups/([^/]+)/members/([^/]+)/\$ref$') {
            $group=$script:Db["/groups/$($Matches[1])"];$userId=$Matches[2]
            $group['members@odata.bind']=@($group['members@odata.bind'] | Where-Object { -not $_.EndsWith("/$userId") })
            return
        }
        Assert-Lab ($script:Db.ContainsKey($path)) "Mock delete target exists: $path"
        $script:Db.Remove($path)
        return
    }
    if ($Method -eq 'POST') {
        if ($path -match '/addPassword$') {
            return @{keyId=[guid]::NewGuid().ToString();secretText='offline-secret-only'}
        }
        if ($path -match '/addTokenSigningCertificate$') {
            $spPath=$path -replace '/addTokenSigningCertificate$',''
            $certificate=@{key='AQID';customKeyIdentifier='AQI=';usage='Verify';thumbprint='0102'}
            $script:Db[$spPath].keyCredentials=@($certificate,@{key='BAUG';customKeyIdentifier='AQI=';usage='Sign'})
            return $certificate
        }
        if ($path.EndsWith('/$ref')) { return }
        if ($path.EndsWith('/instantiate')) {
            $app=Invoke-MgGraphRequest POST 'https://graph.microsoft.com/v1.0/applications' ($data | ConvertTo-Json)
            $sp=Invoke-MgGraphRequest POST 'https://graph.microsoft.com/v1.0/servicePrincipals' (@{appId=$app.appId} | ConvertTo-Json)
            return @{application=$app;servicePrincipal=$sp}
        }
        $id=[guid]::NewGuid().ToString()
        $data.id=$id
        if ($path -eq '/applications') {
            $data.appId=[guid]::NewGuid().ToString();$data.appRoles=@()
        }
        if ($path -eq '/servicePrincipals') {
            $apps=@(Get-LabMockCollection '/applications' | Where-Object { $_.appId -eq $data.appId })
            Assert-Lab ($apps.Count -eq 1) 'SP resolves its registration'
            $data.displayName=$apps[0].displayName;$data.appRoles=$apps[0].appRoles
            $data.keyCredentials=@()
        }
        $script:Db["$path/$id"]=$data
        return $data
    }
    throw "Unexpected mock operation: $Method $path"
}

function Connect-AzAccount {
    param($Tenant,$Subscription)
    $script:Subscription=$Subscription.ToString()
}
function Get-AzContext { @{Tenant=@{Id=$script:LabTenantId};Subscription=@{Id=$script:Subscription}} }
function Get-AzResourceGroup { if ($script:AzureGroup) { $script:AzureGroup } }
function New-AzResourceGroup {
    param($Name,$Location)
    $script:AzureGroup=@{ResourceGroupName=$Name;Location=$Location}
}
function New-AzOperationalInsightsWorkspace {
    param($ResourceGroupName,$Name,$Location,$RetentionInDays)
    Assert-Lab ($RetentionInDays -eq 30) 'Workspace retention matches manual 30 days'
    $script:Workspace=@{ResourceId="/subscriptions/$script:Subscription/resourceGroups/$ResourceGroupName/providers/Microsoft.OperationalInsights/workspaces/$Name"}
    $script:Workspace
}
function Get-AzResource {
    param($ResourceGroupName)
    if ($script:OtherResource) { @{ResourceId='unrelated-resource'} }
    if ($script:Workspace) { $script:Workspace }
}
function Invoke-AzRestMethod {
    param($Method,$Path,$Payload)
    Assert-Lab ($Path -like '/providers/microsoft.aadiam/diagnosticSettings*api-version=2017-04-01') 'Verified tenant diagnostic API'
    if ($Method -eq 'GET') { return @{StatusCode=200;Content=(@{value=@($script:Diagnostic | Where-Object { $null -ne $_ })} | ConvertTo-Json -Depth 20)} }
    if ($Method -eq 'PUT') { $script:Diagnostic=@{name='APP-ACCESS-LAB-Logs';properties=($Payload | ConvertFrom-Json -AsHashtable).properties};return @{StatusCode=200} }
    if ($Method -eq 'DELETE') { $script:Diagnostic=$null;return @{StatusCode=204} }
    throw 'Unexpected Azure REST method'
}
function Remove-AzResourceGroup {
    param($Name,[switch]$Force)
    Assert-Lab ($Name -eq 'rg-app-access-lab') 'Never delete a different group'
    $script:AzureGroup=$null;$script:Workspace=$null
}

$previous=$PWD
$temporary=Join-Path ([IO.Path]::GetTempPath()) ("app-automation-contract-"+[guid]::NewGuid())
[IO.Directory]::CreateDirectory($temporary) | Out-Null
try {
    Set-Location -LiteralPath $temporary
    $script:Admin=[guid]::NewGuid().ToString();$script:MockTenant=[guid]::NewGuid().ToString()
    $script:Db=@{};$script:Calls=@();$script:LastScopes=@()
    $script:AzureGroup=$null;$script:Workspace=$null;$script:Diagnostic=$null;$script:OtherResource=$false
    Initialize-LabAutomation -TenantId $script:MockTenant -AdminId $script:Admin
    $graphId='00000003-0000-0000-c000-000000000000'
    $script:Db['/servicePrincipals/offline-graph']=@{id='offline-graph';appId=$graphId
        oauth2PermissionScopes=@(@{id='e1fe6dd8-ba31-4d61-89e7-88639da4683d';value='User.Read';isEnabled=$true})}
    New-LabUsers -Domain 'offline.onmicrosoft.com'
    $allowed=Get-LabObject 'lab-app-allowed';$denied=Get-LabObject 'lab-app-denied'
    foreach ($user in @($allowed,$denied)) {
        $actual=$script:Db["/users/$($user.id)"]
        Assert-Lab ($actual.accountEnabled -and $actual.userType -eq 'Member' -and $actual.passwordProfile.forceChangePasswordNextSignIn) 'Enabled ordinary users/password-change state'
    }
    $web=New-LabRegistration -Name 'APP-ACCESS-LAB-Web' -Secret
    $app=$script:Db["/applications/$($web.appObjectId)"]
    Assert-Lab ($app.signInAudience -eq 'AzureADMyOrg' -and $app.web.redirectUris[0] -eq 'http://localhost:4300/callback') 'Core registration audience/callback'
    Assert-Lab (-not $app.isFallbackPublicClient -and -not $app.web.implicitGrantSettings.enableIdTokenIssuance -and -not $app.web.implicitGrantSettings.enableAccessTokenIssuance) 'No public/implicit flow'
    Assert-Lab ($app.appRoles.Count -eq 0 -and @(Get-LabMockCollection '/oauth2PermissionGrants').Count -eq 0) '07 does not execute 08/09'
    Assert-Lab (@($script:Calls | Where-Object { $_.path -match 'appRoleAssignedTo' }).Count -eq 0) '07 creates no assignment'
    $expiry=(@($script:Calls | Where-Object { $_.path.EndsWith('/addPassword') })[0].body.passwordCredential.endDateTime)
    Assert-Lab ([math]::Abs((([datetime]$expiry)-[datetime]::UtcNow).TotalHours-24) -lt 0.01) 'One-day credential'
    Use-LabClient
    Assert-Lab ($env:CLIENT_ID -eq $web.clientId -and $env:CLIENT_SECRET -eq 'offline-secret-only') 'Same sample process environment'
    Assert-LabThrows { New-LabRegistration -Name 'APP-ACCESS-LAB-Web' } 'already recorded'
    Set-LabDelegatedPermission -Consent
    $grant=@(Get-LabMockCollection '/oauth2PermissionGrants')[0]
    Assert-Lab ($grant.clientId -eq $web.spId -and $grant.resourceId -eq 'offline-graph' -and $grant.scope -eq 'User.Read' -and $grant.consentType -eq 'AllPrincipals') '08 actual delegated admin grant'
    Set-LabUserRoles
    Assert-Lab (($app.appRoles.value | Sort-Object) -join ',' -eq 'Lab.Observer,Lab.Reader') '09 exact two role values'
    foreach ($role in $app.appRoles) { Assert-Lab ($role.isEnabled -and $role.allowedMemberTypes[0] -eq 'User') 'Enabled Users/Groups roles' }
    Add-LabAppAssignment -PrincipalId $allowed.id | Out-Null
    $assignments=@(Get-LabMockCollection "/servicePrincipals/$($web.spId)/appRoleAssignedTo")
    Assert-Lab ($assignments.Count -eq 1 -and $assignments[0].principalId -eq $allowed.id -and $assignments[0].appRoleId -eq @($app.appRoles | Where-Object value -eq 'Lab.Reader')[0].id) 'Only allowed gets the Reader GUID'
    New-LabReaderGroup
    $group=Get-LabObject 'APP-ACCESS-LAB-Readers'
    $actualGroup=$script:Db["/groups/$($group.id)"]
    Assert-Lab ($actualGroup.securityEnabled -and -not $actualGroup.mailEnabled -and $actualGroup.groupTypes.Count -eq 0) 'Assigned security group'
    Assert-Lab ($actualGroup['members@odata.bind'].Count -eq 1 -and $actualGroup['members@odata.bind'][0].EndsWith("/$($allowed.id)")) 'Only allowed is a member'
    Assert-Lab (@(Get-LabMockCollection "/servicePrincipals/$($web.spId)/appRoleAssignedTo")[0].principalId -eq $group.id) 'Direct Reader removed; only group route'
    Add-LabAppAssignment -PrincipalId $denied.id -Role 'Lab.Observer' | Out-Null
    Remove-LabAssignment -PrincipalId $denied.id
    Remove-LabReaderMembership
    Assert-Lab ($actualGroup['members@odata.bind'].Count -eq 0 -and $script:Db.ContainsKey("/users/$($allowed.id)")) 'Revocation deletes membership reference, never user'
    Set-LabEmailClaim
    $app.optionalClaims.accessToken=@(@{name='existing'})
    Set-LabEmailClaim
    Assert-Lab ($app.optionalClaims.idToken.Count -eq 1 -and $app.optionalClaims.idToken[0].name -eq 'email' -and $app.optionalClaims.accessToken[0].name -eq 'existing') 'Email claim idempotence/other-token preservation'
    $script:Db['/policies/authorizationPolicy']=@{permissionGrantPolicyIdsAssignedToDefaultUserRole=@('managePermissionGrantsForSelf.low','managePermissionGrantsForOwnedResource.keep')}
    $script:Db['/policies/adminConsentRequestPolicy']=@{isEnabled=$false;notifyReviewers=$false;remindersEnabled=$false;requestDurationInDays=30;reviewers=@()}
    Set-LabConsentWorkflow -ReviewerId $script:Admin
    $workflow=$script:Db['/policies/adminConsentRequestPolicy']
    Assert-Lab ($workflow.isEnabled -and $workflow.notifyReviewers -and $workflow.remindersEnabled -and $workflow.requestDurationInDays -eq 7 -and $workflow.reviewers[0].query -eq "/users/$script:Admin") 'Exact workflow settings'
    Assert-Lab ($script:Db['/policies/authorizationPolicy'].permissionGrantPolicyIdsAssignedToDefaultUserRole[0] -eq 'managePermissionGrantsForOwnedResource.keep') 'Owned-resource consent preserved'
    Assert-Lab (@($script:Calls | Where-Object { $_.path -eq '/policies/adminConsentRequestPolicy' -and $_.method -eq 'PUT' }).Count -eq 1) 'Workflow uses supported PUT'
    New-LabRegistration -Name 'APP-ACCESS-LAB-Consent' -AssignmentRequired $false -Secret | Out-Null
    Set-LabDelegatedPermission -ClientName 'APP-ACCESS-LAB-Consent'
    Assert-Lab (@(Get-LabMockCollection '/oauth2PermissionGrants').Count -eq 1) 'Consent-request client has no direct grant'
    Restore-LabConsentWorkflow
    Assert-Lab (-not $workflow.isEnabled -and $workflow.requestDurationInDays -eq 30 -and $script:LabState.baselines.Count -eq 0) 'Restore baseline once'
    New-LabRegistration -Name 'APP-ACCESS-LAB-AdminScope' | Out-Null
    New-LabDirectoryRole -OperatorId $script:Admin -EditorId ([guid]::NewGuid())
    $roleDefinition=@(Get-LabMockCollection '/roleManagement/directory/roleDefinitions')[0]
    Assert-Lab ($roleDefinition.rolePermissions[0].allowedResourceActions[0] -eq 'microsoft.directory/applications/credentials/update') 'Exact custom role action'
    $roleAssignments=@(Get-LabMockCollection '/roleManagement/directory/roleAssignments')
    Assert-Lab (@($roleAssignments | Where-Object directoryScopeId -eq '/').Count -eq 1 -and @($roleAssignments | Where-Object directoryScopeId -eq "/$((Get-LabObject 'APP-ACCESS-LAB-AdminScope').appObjectId)").Count -eq 1) 'Both administrative scopes'
    New-LabTemplateApp -Name 'APP-ACCESS-LAB-SAML' -TemplateName 'Microsoft Entra SAML Toolkit' | Out-Null
    Set-LabSaml -Name 'APP-ACCESS-LAB-SAML' -ReplyUrl 'https://vendor.example/acs' -SignOnUrl 'https://vendor.example/login' | Out-Null
    Set-LabSaml -Name 'APP-ACCESS-LAB-SAML' -ReplyUrl 'https://vendor.example/final-acs' -SignOnUrl 'https://vendor.example/final-login' | Out-Null
    $saml=Get-LabObject 'APP-ACCESS-LAB-SAML';$samlSp=$script:Db["/servicePrincipals/$($saml.spId)"]
    Assert-Lab ($samlSp.preferredSingleSignOnMode -eq 'saml' -and $samlSp.loginUrl.EndsWith('/final-login') -and $samlSp.replyUrls[0].EndsWith('/final-acs')) 'Final SAML URLs/mode'
    Assert-Lab ([Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $temporary '.app-access-lab-APP-ACCESS-LAB-SAML.cer'))) -eq 'AQID') 'Exports Verify certificate, not duplicate Sign key'
    Set-LabSamlDisplayClaim
    $claimPolicy=@(Get-LabMockCollection '/policies/claimsMappingPolicies')[0]
    Assert-Lab ($claimPolicy.definition[0] -match '"SamlClaimType":\s*"lab_display_name"') 'SAML display-name claim policy'
    New-LabProxy -InternalUrl 'https://internal.example/' -ExternalUrl 'https://app-access-lab-proxy-offline.msappproxy.net/' -ConnectorId ([guid]::NewGuid()) | Out-Null
    Assert-Lab (@($script:Calls | Where-Object { $_.method -eq 'POST' -and $_.uri -match '/beta/.*/connectors/.*/memberOf/\$ref$' }).Count -eq 1) 'Correct connector memberOf relationship'
    Assert-Lab (@($script:Calls | Where-Object { $_.method -eq 'PUT' -and $_.uri -match '/beta/applications/.*/connectorGroup/\$ref$' }).Count -eq 1) 'Correct app connector-group relationship'
    Set-LabProxyKcd -Spn 'HTTP/internal.example'
    $proxy=Get-LabObject 'APP-ACCESS-LAB-Proxy';$publishing=$script:Db["/applications/$($proxy.appObjectId)"].onPremisesPublishing
    Assert-Lab ($publishing.externalAuthenticationType -eq 'aadPreAuthentication' -and $publishing.isOnPremPublishingEnabled -and $publishing.singleSignOnSettings.kerberosSignOnSettings.kerberosSignOnMappingAttributeType -eq 'onPremisesUserPrincipalName') 'Proxy preauthentication/KCD identity parity'
    $api=New-LabApi
    Assert-Lab ($script:Db["/applications/$($api.appObjectId)"].appRoles.Count -eq 0) 'Delegated API scope does not create app-only branch early'
    New-LabRegistration -Name 'APP-ACCESS-LAB-Caller' -AssignmentRequired $false | Out-Null
    Set-LabDelegatedPermission -ClientName 'APP-ACCESS-LAB-Caller' -ResourceClientId $api.clientId -Scope 'access_as_user' -Consent
    Set-LabApiApplicationRole
    New-LabRegistration -Name 'APP-ACCESS-LAB-Daemon' -Platform None -AssignmentRequired $false -Secret | Out-Null
    Set-LabApplicationPermission
    $daemon=Get-LabObject 'APP-ACCESS-LAB-Daemon';$daemonApp=$script:Db["/applications/$($daemon.appObjectId)"]
    Assert-Lab ($daemonApp.requiredResourceAccess.Count -eq 2) 'App-only permission preserves default delegated request'
    Assert-Lab (@(Get-LabMockCollection "/servicePrincipals/$($daemon.spId)/appRoleAssignments")[0].resourceId -eq $api.spId) 'Actual daemon-to-API grant'
    Set-LabDelegatedPermission -ClientName 'APP-ACCESS-LAB-API' -Consent
    New-LabCredential -Name 'APP-ACCESS-LAB-API'
    $spa=New-LabRegistration -Name 'APP-ACCESS-LAB-SPA' -Platform Spa -RedirectUri 'http://localhost:5173'
    Assert-Lab ($script:Db["/applications/$($spa.appObjectId)"].spa.redirectUris[0] -eq 'http://localhost:5173' -and -not $spa.ContainsKey('credentialKeyId')) 'SPA redirect/no browser secret'
    $multi=New-LabRegistration -Name 'APP-ACCESS-LAB-Multi' -Audience AzureADMultipleOrgs
    Assert-Lab ($script:Db["/applications/$($multi.appObjectId)"].signInAudience -eq 'AzureADMultipleOrgs') 'Multitenant workforce audience'
    $policyId=New-LabMfaPolicy -EmergencyAdminIds @($script:Admin)
    $policy=$script:Db["/identity/conditionalAccess/policies/$policyId"]
    Assert-Lab ($policy.state -eq 'enabledForReportingButNotEnforced' -and $policy.conditions.users.includeUsers.Count -eq 2 -and $policy.conditions.users.excludeUsers[0] -eq $script:Admin -and $policy.conditions.applications.includeApplications[0] -eq $web.clientId -and $policy.grantControls.builtInControls[0] -eq 'mfa') 'Exact report-only MFA scope/exclusions'
    New-LabLogExport -SubscriptionId ([guid]::NewGuid()) -Location 'westeurope' -WorkspaceName 'law-app-access-offline'
    Assert-Lab ($script:Diagnostic.properties.workspaceId -eq $script:Workspace.ResourceId -and ($script:Diagnostic.properties.logs.category | Sort-Object) -join ',' -eq 'AuditLogs,SignInLogs') 'Actual workspace diagnostic destination/categories'
    $script:OtherResource=$true
    Assert-LabThrows { Remove-LabLogExport } 'Other resources'
    $script:OtherResource=$false
    Remove-LabLogExport
    Assert-Lab ($null -eq $script:Workspace -and $null -eq $script:Diagnostic) 'Owned Azure cleanup'
    $saved=Get-Content -LiteralPath $script:LabStatePath -Raw
    Assert-Lab ($saved -notmatch 'offline-secret-only|offline-password-only') 'No credentials in persisted state'
    $originalTenant=$script:MockTenant;$script:MockTenant=[guid]::NewGuid().ToString()
    Assert-LabThrows { Set-LabUserRoles } 'Wrong Graph tenant'
    $script:MockTenant=$originalTenant
    Assert-LabThrows { Remove-LabRecordedObject '/servicePrincipals/offline-graph' } 'active, recorded'
    $app.displayName='not-the-recorded-app'
    Assert-LabThrows { Remove-LabRecordedObject "/applications/$($web.appObjectId)" } 'identity changed'
    $app.displayName='APP-ACCESS-LAB-Web'
    Remove-LabAutomation
    Assert-Lab (@($script:LabState.records | Where-Object active).Count -eq 0 -and $script:Db.ContainsKey('/servicePrincipals/offline-graph')) 'Only recorded Graph objects deleted'
    Assert-Lab (-not (Test-Path Env:CLIENT_SECRET)) 'Process secret cleared'
    Write-Output 'Offline automation contracts passed (mocked Graph/Azure; no tenant requests).'
} finally {
    Set-Location -LiteralPath $previous
    Get-ChildItem -LiteralPath $temporary -File -Force | ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }
    Remove-Item -LiteralPath $temporary
}
