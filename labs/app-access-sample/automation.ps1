Set-StrictMode -Version 3
$ErrorActionPreference = 'Stop'

function Initialize-LabAutomation {
    param([Parameter(Mandatory)][guid]$TenantId, [Parameter(Mandatory)][guid]$AdminId)
    $script:LabStatePath = Join-Path $PWD '.app-access-lab-state.json'
    $script:LabTenantId = $TenantId.ToString()
    $script:LabAdminId = $AdminId.ToString()
    $script:LabSecrets = @{}
    if (Test-Path -LiteralPath $script:LabStatePath) {
        $script:LabState = Get-Content -LiteralPath $script:LabStatePath -Raw | ConvertFrom-Json -AsHashtable
        if ($script:LabState.tenantId -ne $script:LabTenantId -or $script:LabState.adminId -ne $script:LabAdminId) {
            throw 'The state file belongs to a different tenant or administrator.'
        }
    } else {
        $script:LabState = @{tenantId=$script:LabTenantId;adminId=$script:LabAdminId;objects=@{};records=@();baselines=@{}}
    }
    if ((Read-Host 'Type APP-ACCESS-LAB to authorize writes in this disposable tenant') -cne 'APP-ACCESS-LAB') {
        throw 'Lab writes were not confirmed.'
    }
}

function Connect-LabGraph {
    param([Parameter(Mandatory)][string[]]$Scopes)
    Connect-MgGraph -TenantId $script:LabTenantId -Scopes (@($Scopes) + 'User.Read' | Select-Object -Unique) -ContextScope Process -NoWelcome | Out-Null
    if ((Get-MgContext).TenantId -ne $script:LabTenantId) { throw 'Wrong Graph tenant.' }
    $me = Get-LabGraph '/me?$select=id'
    if ($me.id -ne $script:LabAdminId) { throw 'Wrong signed-in administrator.' }
}

function Get-LabGraph {
    param([Parameter(Mandatory)][string]$Path, [ValidateSet('v1.0','beta')][string]$Version='v1.0')
    if (-not $Path.StartsWith('/')) { throw 'Use a Graph-relative path.' }
    Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/$Version$Path" -OutputType Hashtable
}

function Send-LabGraph {
    param([Parameter(Mandatory)][ValidateSet('POST','PATCH','PUT','DELETE')][string]$Method,
        [Parameter(Mandatory)][string]$Path, [hashtable]$Body,
        [ValidateSet('v1.0','beta')][string]$Version='v1.0')
    if (-not $Path.StartsWith('/')) { throw 'Use a Graph-relative path.' }
    $parameters = @{Method=$Method;Uri="https://graph.microsoft.com/$Version$Path";OutputType='Hashtable'}
    if ($null -ne $Body) { $parameters.Body=$Body | ConvertTo-Json -Depth 30; $parameters.ContentType='application/json' }
    Invoke-MgGraphRequest @parameters
}

function Save-LabState {
    $script:LabState | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $script:LabStatePath -Encoding utf8
}

function Add-LabRecord {
    param([string]$Path, [hashtable]$Identity)
    $script:LabState.records += @{path=$Path;identity=$Identity;active=$true}
    Save-LabState
}

function Get-LabObject {
    param([string]$Name)
    if (-not $script:LabState.objects.ContainsKey($Name)) { throw "Create $Name first with the appropriate section." }
    $script:LabState.objects[$Name]
}

function Read-LabSecret {
    param([string]$Prompt)
    $secure = Read-Host $Prompt -AsSecureString
    [System.Net.NetworkCredential]::new('', $secure).Password
}

function New-LabUsers {
    param([Parameter(Mandatory)][string]$Domain)
    Connect-LabGraph @('User.ReadWrite.All')
    foreach ($name in @('lab-app-allowed','lab-app-denied')) {
        if ($script:LabState.objects.ContainsKey($name)) { throw "$name is already recorded. Do not recreate it." }
        $upn = "$name@$Domain"
        $filter = [uri]::EscapeDataString("userPrincipalName eq '$($upn.Replace("'","''"))'")
        $existing = Get-LabGraph "/users?`$filter=$filter"
        if (@($existing.value).Count) { throw "User $upn already exists; use the manual route instead of adopting it." }
        $password = Read-LabSecret "Temporary password for $upn"
        $user = Send-LabGraph POST '/users' @{
            accountEnabled=$true;displayName=$name;mailNickname=$name;userPrincipalName=$upn;userType='Member'
            passwordProfile=@{password=$password;forceChangePasswordNextSignIn=$true}
        }
        $script:LabState.objects[$name]=@{id=$user.id;upn=$upn}
        Add-LabRecord "/users/$($user.id)" @{userPrincipalName=$upn}
    }
}

function New-LabRegistration {
    param([Parameter(Mandatory)][ValidatePattern('^APP-ACCESS-LAB-')][string]$Name,
        [ValidateSet('Web','Spa','None')][string]$Platform='Web', [string]$RedirectUri='http://localhost:4300/callback',
        [ValidateSet('AzureADMyOrg','AzureADMultipleOrgs')][string]$Audience='AzureADMyOrg',
        [bool]$AssignmentRequired=$true, [switch]$Secret)
    Connect-LabGraph @('Application.ReadWrite.All')
    if ($script:LabState.objects.ContainsKey($Name)) { throw "$Name is already recorded." }
    $existing = Get-LabGraph "/applications?`$filter=displayName eq '$Name'"
    if (@($existing.value).Count) { throw "$Name already exists; do not create a duplicate or adopt an existing app." }
    $body = @{displayName=$Name;description='APP-ACCESS-LAB only. Delete after training.';signInAudience=$Audience;isFallbackPublicClient=$false
        requiredResourceAccess=@(@{resourceAppId='00000003-0000-0000-c000-000000000000'
            resourceAccess=@(@{id='e1fe6dd8-ba31-4d61-89e7-88639da4683d';type='Scope'})})}
    if ($Platform -eq 'Web') {
        $body.web=@{redirectUris=@($RedirectUri);implicitGrantSettings=@{enableAccessTokenIssuance=$false;enableIdTokenIssuance=$false}}
    } elseif ($Platform -eq 'Spa') { $body.spa=@{redirectUris=@($RedirectUri)} }
    $app = Send-LabGraph POST '/applications' $body
    $entry = @{appObjectId=$app.id;clientId=$app.appId}
    $script:LabState.objects[$Name]=$entry
    Add-LabRecord "/applications/$($app.id)" @{appId=$app.appId;displayName=$Name}
    $sp = Send-LabGraph POST '/servicePrincipals' @{
        appId=$app.appId;accountEnabled=$true;appRoleAssignmentRequired=$AssignmentRequired
        tags=@('WindowsAzureActiveDirectoryIntegratedApp')
    }
    $entry.spId=$sp.id
    Add-LabRecord "/servicePrincipals/$($sp.id)" @{appId=$app.appId;displayName=$Name}
    if ($Secret) { New-LabCredential -Name $Name }
    $entry
}

function New-LabCredential {
    param([Parameter(Mandatory)][string]$Name)
    Connect-LabGraph @('Application.ReadWrite.All')
    $entry=Get-LabObject $Name
    if ($entry.ContainsKey('credentialKeyId')) { throw 'A lab credential is already recorded; do not create another.' }
    $credential=Send-LabGraph POST "/applications/$($entry.appObjectId)/addPassword" @{
        passwordCredential=@{displayName='APP-ACCESS-LAB temporary';endDateTime=[datetime]::UtcNow.AddDays(1).ToString('o')}
    }
    $entry.credentialKeyId=$credential.keyId
    $script:LabSecrets[$Name]=$credential.secretText
    Save-LabState
}

function Use-LabClient {
    param([string]$Name='APP-ACCESS-LAB-Web')
    $app = Get-LabObject $Name
    if (-not $script:LabSecrets.ContainsKey($Name)) { $script:LabSecrets[$Name]=Read-LabSecret "Existing secret VALUE for $Name" }
    $env:TENANT_ID=$script:LabTenantId; $env:CLIENT_ID=$app.clientId; $env:CLIENT_SECRET=$script:LabSecrets[$Name]
}

function New-LabTemplateApp {
    param([Parameter(Mandatory)][ValidatePattern('^APP-ACCESS-LAB-')][string]$Name,
        [Parameter(Mandatory)][string]$TemplateName)
    Connect-LabGraph @('Application.ReadWrite.All')
    if ($script:LabState.objects.ContainsKey($Name)) { throw "$Name is already recorded." }
    $existing=Get-LabGraph "/applications?`$filter=displayName eq '$Name'"
    if (@($existing.value).Count) { throw "$Name already exists." }
    $escaped=$TemplateName.Replace("'","''")
    $templates=Get-LabGraph "/applicationTemplates?`$filter=displayName eq '$escaped'"
    if (@($templates.value).Count -ne 1) { throw 'Resolve exactly one application template.' }
    $result=Send-LabGraph POST "/applicationTemplates/$($templates.value[0].id)/instantiate" @{displayName=$Name}
    $entry=@{appObjectId=$result.application.id;clientId=$result.application.appId;spId=$result.servicePrincipal.id}
    $script:LabState.objects[$Name]=$entry
    Add-LabRecord "/applications/$($entry.appObjectId)" @{appId=$entry.clientId;displayName=$Name}
    Add-LabRecord "/servicePrincipals/$($entry.spId)" @{appId=$entry.clientId;displayName=$Name}
    $entry
}

function Add-LabDefaultAssignment {
    param([string]$Name, [string]$PrincipalId)
    Connect-LabGraph @('Application.Read.All','AppRoleAssignment.ReadWrite.All')
    $entry=Get-LabObject $Name;$sp=Get-LabGraph "/servicePrincipals/$($entry.spId)"
    $roles=@($sp['appRoles'] | Where-Object { $_.isEnabled -and $_.allowedMemberTypes -contains 'User' })
    if ($roles.Count -gt 1) { throw 'Multiple roles: select the exact role instead of assuming default access.' }
    $roleId=if ($roles.Count) { $roles[0].id } else { [guid]::Empty.ToString() }
    $assignment=Send-LabGraph POST "/servicePrincipals/$($entry.spId)/appRoleAssignedTo" @{principalId=$PrincipalId;resourceId=$entry.spId;appRoleId=$roleId}
    Add-LabRecord "/servicePrincipals/$($entry.spId)/appRoleAssignedTo/$($assignment.id)" @{principalId=$PrincipalId;appRoleId=$roleId}
}

function Set-LabSaml {
    param([Parameter(Mandatory)][string]$Name, [Parameter(Mandatory)][string]$ReplyUrl,
        [Parameter(Mandatory)][string]$SignOnUrl, [string]$EntityId)
    Connect-LabGraph @('Application.ReadWrite.All')
    $entry=Get-LabObject $Name
    $body=@{web=@{redirectUris=@($ReplyUrl)}}
    if ($EntityId) { $body.identifierUris=@($EntityId) }
    Send-LabGraph PATCH "/applications/$($entry.appObjectId)" $body | Out-Null
    Send-LabGraph PATCH "/servicePrincipals/$($entry.spId)" @{
        preferredSingleSignOnMode='saml';loginUrl=$SignOnUrl;replyUrls=@($ReplyUrl)
        appRoleAssignmentRequired=$true;accountEnabled=$true
    } | Out-Null
    $sp=Get-LabGraph "/servicePrincipals/$($entry.spId)?`$select=id,preferredTokenSigningKeyThumbprint,keyCredentials"
    if (-not $sp['preferredTokenSigningKeyThumbprint']) {
        $cert=Send-LabGraph POST "/servicePrincipals/$($entry.spId)/addTokenSigningCertificate" @{
            displayName="CN=$Name";endDateTime=[datetime]::UtcNow.AddYears(3).ToString('o')
        }
        Send-LabGraph PATCH "/servicePrincipals/$($entry.spId)" @{preferredTokenSigningKeyThumbprint=$cert.thumbprint} | Out-Null
        $encoded=$cert.key
    } else {
        $keys=@($sp.keyCredentials | Where-Object {
            $_.usage -eq 'Verify' -and $_.customKeyIdentifier -and ([Convert]::ToHexString([Convert]::FromBase64String($_.customKeyIdentifier))) -eq $sp.preferredTokenSigningKeyThumbprint
        })
        if ($keys.Count -ne 1 -or -not $keys[0].key) { throw 'Cannot export the active signing certificate.' }
        $encoded=$keys[0].key
    }
    $certificate=Join-Path $PWD ".app-access-lab-$Name.cer"
    [IO.File]::WriteAllBytes($certificate,[Convert]::FromBase64String($encoded))
    @{LoginUrl="https://login.microsoftonline.com/$script:LabTenantId/saml2"
      EntraIdentifier="https://sts.windows.net/$script:LabTenantId/"
      LogoutUrl="https://login.microsoftonline.com/$script:LabTenantId/saml2";CertificateFile=$certificate}
}

function Set-LabSamlDisplayClaim {
    param([string]$Name='APP-ACCESS-LAB-SAML')
    Connect-LabGraph @('Application.ReadWrite.All','Policy.ReadWrite.ApplicationConfiguration')
    $entry=Get-LabObject $Name
    $existing=Get-LabGraph "/servicePrincipals/$($entry.spId)/claimsMappingPolicies"
    if (@($existing.value).Count) { throw 'A mapping policy already exists; do not replace an unrelated claims contract.' }
    $definition=@{ClaimsMappingPolicy=@{Version=1;IncludeBasicClaimSet='true';ClaimsSchema=@(
        @{Source='user';ID='userprincipalname';SamlClaimType='http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier'},
        @{Source='user';ID='displayname';SamlClaimType='lab_display_name'}
    )}}
    $policy=Send-LabGraph POST '/policies/claimsMappingPolicies' @{
        displayName='APP-ACCESS-LAB-SAML-Claims';definition=@($definition | ConvertTo-Json -Depth 10);isOrganizationDefault=$false
    }
    Add-LabRecord "/policies/claimsMappingPolicies/$($policy.id)" @{displayName='APP-ACCESS-LAB-SAML-Claims'}
    Send-LabGraph POST "/servicePrincipals/$($entry.spId)/claimsMappingPolicies/`$ref" @{
        '@odata.id'="https://graph.microsoft.com/v1.0/policies/claimsMappingPolicies/$($policy.id)"
    } | Out-Null
}

function New-LabProxy {
    param([Parameter(Mandatory)][string]$InternalUrl, [Parameter(Mandatory)][string]$ExternalUrl,
        [Parameter(Mandatory)][guid]$ConnectorId)
    $entry=New-LabTemplateApp -Name 'APP-ACCESS-LAB-Proxy' -TemplateName 'Custom'
    Connect-LabGraph @('Directory.ReadWrite.All')
    $group=Send-LabGraph POST '/onPremisesPublishingProfiles/applicationProxy/connectorGroups' @{name='APP-ACCESS-LAB-Connectors'} -Version beta
    $entry.connectorGroupId=$group.id;Save-LabState
    # Connector installation/registration is shared; move only the lab connector.
    Send-LabGraph POST "/onPremisesPublishingProfiles/applicationProxy/connectors/$ConnectorId/memberOf/`$ref" @{
        '@odata.id'="https://graph.microsoft.com/beta/onPremisesPublishingProfiles/applicationProxy/connectorGroups/$($group.id)"
    } -Version beta | Out-Null
    Send-LabGraph PATCH "/applications/$($entry.appObjectId)" @{identifierUris=@($ExternalUrl);web=@{redirectUris=@($ExternalUrl)}} | Out-Null
    Send-LabGraph PATCH "/applications/$($entry.appObjectId)" @{
        onPremisesPublishing=@{internalUrl=$InternalUrl;externalUrl=$ExternalUrl;externalAuthenticationType='aadPreAuthentication';isOnPremPublishingEnabled=$true}
    } -Version beta | Out-Null
    Send-LabGraph PUT "/applications/$($entry.appObjectId)/connectorGroup/`$ref" @{
        '@odata.id'="https://graph.microsoft.com/beta/onPremisesPublishingProfiles/applicationProxy/connectorGroups/$($group.id)"
    } -Version beta | Out-Null
    Send-LabGraph PATCH "/servicePrincipals/$($entry.spId)" @{accountEnabled=$true;appRoleAssignmentRequired=$true} | Out-Null
    Set-LabDelegatedPermission -ClientName 'APP-ACCESS-LAB-Proxy' -Consent
    Add-LabDefaultAssignment -Name 'APP-ACCESS-LAB-Proxy' -PrincipalId (Get-LabObject 'lab-app-allowed').id
    $entry
}

function Set-LabProxyKcd {
    param([Parameter(Mandatory)][string]$Spn)
    Connect-LabGraph @('Directory.ReadWrite.All')
    $entry=Get-LabObject 'APP-ACCESS-LAB-Proxy'
    Send-LabGraph PATCH "/applications/$($entry.appObjectId)" @{
        onPremisesPublishing=@{singleSignOnSettings=@{
            singleSignOnMode='onPremisesKerberos'
            kerberosSignOnSettings=@{kerberosServicePrincipalName=$Spn;kerberosSignOnMappingAttributeType='onPremisesUserPrincipalName'}
        }}
    } -Version beta | Out-Null
}

function Set-LabDelegatedPermission {
    param([string]$ClientName='APP-ACCESS-LAB-Web', [string]$ResourceClientId='00000003-0000-0000-c000-000000000000',
        [string]$Scope='User.Read', [switch]$Consent)
    $scopes=@('Application.ReadWrite.All')
    if ($Consent) { $scopes+='DelegatedPermissionGrant.ReadWrite.All' }
    Connect-LabGraph $scopes
    $client = Get-LabObject $ClientName
    $resources = Get-LabGraph "/servicePrincipals?`$filter=appId eq '$ResourceClientId'"
    if (@($resources.value).Count -ne 1) { throw 'Expected one resource service principal.' }
    $resource = $resources.value[0]
    $permission = @($resource['oauth2PermissionScopes'] | Where-Object { $null -ne $_ -and $_.value -eq $Scope -and $_.isEnabled })
    if ($permission.Count -ne 1) { throw "Resource scope $Scope is missing or not propagated. Retry after inspection." }
    Set-LabRequestedPermission -ClientName $ClientName -ResourceClientId $ResourceClientId -PermissionId $permission[0].id -Type Scope
    if ($Consent) {
        $grants = Get-LabGraph "/oauth2PermissionGrants?`$filter=clientId eq '$($client.spId)'"
        $matches = @($grants.value | Where-Object { $_.resourceId -eq $resource.id -and $_.consentType -eq 'AllPrincipals' })
        if ($matches.Count -gt 1) { throw 'Ambiguous delegated grant.' }
        if ($matches.Count -eq 0) {
            $grant = Send-LabGraph POST '/oauth2PermissionGrants' @{clientId=$client.spId;resourceId=$resource.id;consentType='AllPrincipals';scope=$Scope}
            Add-LabRecord "/oauth2PermissionGrants/$($grant.id)" @{clientId=$client.spId;resourceId=$resource.id}
        } else {
            $scopeNames = @($matches[0].scope -split ' ' | Where-Object { $_ })
            if ($scopeNames -notcontains $Scope) { $scopeNames+=$Scope }
            Send-LabGraph PATCH "/oauth2PermissionGrants/$($matches[0].id)" @{scope=($scopeNames -join ' ')} | Out-Null
        }
    }
}

function Set-LabRequestedPermission {
    param([string]$ClientName, [string]$ResourceClientId, [string]$PermissionId, [ValidateSet('Scope','Role')][string]$Type)
    $client=Get-LabObject $ClientName
    $app=Get-LabGraph "/applications/$($client.appObjectId)"
    $access=@($app['requiredResourceAccess'] | Where-Object { $null -ne $_ -and $_.resourceAppId -ne $ResourceClientId })
    $current=@($app['requiredResourceAccess'] | Where-Object { $null -ne $_ -and $_.resourceAppId -eq $ResourceClientId })
    if ($current.Count -gt 1) { throw 'Ambiguous requested resource permissions.' }
    $permissions=if ($current.Count) { @($current[0].resourceAccess) } else { @() }
    if (@($permissions | Where-Object { $_.id -eq $PermissionId -and $_.type -eq $Type }).Count -eq 0) {
        $permissions+=@{id=$PermissionId;type=$Type}
    }
    $access+=@{resourceAppId=$ResourceClientId;resourceAccess=$permissions}
    Send-LabGraph PATCH "/applications/$($client.appObjectId)" @{requiredResourceAccess=$access} | Out-Null
}

function Set-LabUserRoles {
    param([string]$Name='APP-ACCESS-LAB-Web')
    Connect-LabGraph @('Application.ReadWrite.All')
    $entry = Get-LabObject $Name
    $app = Get-LabGraph "/applications/$($entry.appObjectId)"
    $roles = @($app['appRoles'] | Where-Object { $null -ne $_ -and $_.value -notin @('Lab.Reader','Lab.Observer') })
    foreach ($spec in @(@{value='Lab.Reader';name='Lab Reader';description='Read protected lab content'},
        @{value='Lab.Observer';name='Lab Observer';description='Sign in without protected access'})) {
        $previous=@($app['appRoles'] | Where-Object { $null -ne $_ -and $_.value -eq $spec.value })
        if ($previous.Count -gt 1) { throw 'Ambiguous app role value.' }
        $id=if ($previous.Count) { $previous[0].id } else { [guid]::NewGuid().ToString() }
        $roles+=@{id=$id;displayName=$spec.name;value=$spec.value;description=$spec.description;allowedMemberTypes=@('User');isEnabled=$true}
    }
    Send-LabGraph PATCH "/applications/$($entry.appObjectId)" @{appRoles=$roles} | Out-Null
    Send-LabGraph PATCH "/servicePrincipals/$($entry.spId)" @{appRoleAssignmentRequired=$true;accountEnabled=$true} | Out-Null
}

function Add-LabAppAssignment {
    param([string]$Name='APP-ACCESS-LAB-Web', [Parameter(Mandatory)][string]$PrincipalId, [string]$Role='Lab.Reader')
    Connect-LabGraph @('Application.Read.All','AppRoleAssignment.ReadWrite.All')
    $entry=Get-LabObject $Name
    $sp=Get-LabGraph "/servicePrincipals/$($entry.spId)"
    $roles=@($sp.appRoles | Where-Object { $_.value -eq $Role -and $_.isEnabled })
    if ($roles.Count -ne 1) { throw "Role $Role is missing or not yet propagated. Retry after inspection." }
    $body=@{principalId=$PrincipalId;resourceId=$entry.spId;appRoleId=$roles[0].id}
    $assignment=Send-LabGraph POST "/servicePrincipals/$($entry.spId)/appRoleAssignedTo" $body
    Add-LabRecord "/servicePrincipals/$($entry.spId)/appRoleAssignedTo/$($assignment.id)" @{principalId=$PrincipalId;appRoleId=$roles[0].id}
    $assignment
}

function Remove-LabAssignment {
    param([string]$Name='APP-ACCESS-LAB-Web', [Parameter(Mandatory)][string]$PrincipalId)
    Connect-LabGraph @('Application.Read.All','AppRoleAssignment.ReadWrite.All')
    $entry=Get-LabObject $Name
    $records=@($script:LabState.records | Where-Object { $_.active -and $_.path.StartsWith("/servicePrincipals/$($entry.spId)/appRoleAssignedTo/") -and $_.identity.principalId -eq $PrincipalId })
    foreach ($record in $records) {
        Remove-LabRecordedObject -Path $record.path
    }
    if (-not $records.Count) { throw 'No script-created assignment for that principal; do not delete unrelated access.' }
}

function New-LabReaderGroup {
    param([string]$Name='APP-ACCESS-LAB-Web')
    Connect-LabGraph @('Group.ReadWrite.All')
    if ($script:LabState.objects.ContainsKey('APP-ACCESS-LAB-Readers')) { throw 'The Reader group is already recorded.' }
    $existing=Get-LabGraph "/groups?`$filter=displayName eq 'APP-ACCESS-LAB-Readers'"
    if (@($existing.value).Count) { throw 'The Reader group already exists. Do not adopt it.' }
    $allowed=Get-LabObject 'lab-app-allowed'
    $group=Send-LabGraph POST '/groups' @{
        displayName='APP-ACCESS-LAB-Readers';mailNickname='APP-ACCESS-LAB-Readers'
        mailEnabled=$false;securityEnabled=$true;groupTypes=@()
        'members@odata.bind'=@("https://graph.microsoft.com/v1.0/users/$($allowed.id)")
    }
    $script:LabState.objects['APP-ACCESS-LAB-Readers']=@{id=$group.id}
    Add-LabRecord "/groups/$($group.id)" @{displayName='APP-ACCESS-LAB-Readers'}
    Add-LabAppAssignment -Name $Name -PrincipalId $group.id | Out-Null
    Remove-LabAssignment -Name $Name -PrincipalId $allowed.id
}

function Remove-LabReaderMembership {
    Connect-LabGraph @('Group.ReadWrite.All')
    $group=Get-LabObject 'APP-ACCESS-LAB-Readers';$allowed=Get-LabObject 'lab-app-allowed'
    $actual=Get-LabGraph "/groups/$($group.id)"
    if ($actual.displayName -ne 'APP-ACCESS-LAB-Readers') { throw 'The recorded group identity changed.' }
    Send-LabGraph DELETE "/groups/$($group.id)/members/$($allowed.id)/`$ref" | Out-Null
}

function Set-LabEmailClaim {
    Connect-LabGraph @('Application.ReadWrite.All')
    $entry=Get-LabObject 'APP-ACCESS-LAB-Web'
    $app=Get-LabGraph "/applications/$($entry.appObjectId)"
    $optional=if ($app['optionalClaims']) { $app['optionalClaims'] } else { @{} }
    $claims=@($optional['idToken'] | Where-Object { $null -ne $_ })
    if (@($claims | ForEach-Object { $_.name }) -notcontains 'email') { $optional.idToken=$claims+@(@{name='email';essential=$false}) }
    Send-LabGraph PATCH "/applications/$($entry.appObjectId)" @{optionalClaims=$optional} | Out-Null
}

function Set-LabConsentWorkflow {
    param([Parameter(Mandatory)][guid]$ReviewerId)
    Connect-LabGraph @('Policy.ReadWrite.Authorization','Policy.ReadWrite.ConsentRequest')
    $authorization=Get-LabGraph '/policies/authorizationPolicy'
    $workflow=Get-LabGraph '/policies/adminConsentRequestPolicy'
    if (-not $script:LabState.baselines.ContainsKey('consent')) {
        $script:LabState.baselines.consent=@{authorization=$authorization;workflow=$workflow}
        Save-LabState
    }
    $policies=@($authorization.permissionGrantPolicyIdsAssignedToDefaultUserRole | Where-Object { $_ -notlike 'managePermissionGrantsForSelf.*' })
    Send-LabGraph PATCH '/policies/authorizationPolicy' @{permissionGrantPolicyIdsAssignedToDefaultUserRole=$policies} | Out-Null
    Send-LabGraph PUT '/policies/adminConsentRequestPolicy' @{
        isEnabled=$true;notifyReviewers=$true;remindersEnabled=$true;requestDurationInDays=7
        reviewers=@(@{query="/users/$ReviewerId";queryType='MicrosoftGraph'})
    } | Out-Null
}

function Restore-LabConsentWorkflow {
    Connect-LabGraph @('Policy.ReadWrite.Authorization','Policy.ReadWrite.ConsentRequest')
    if (-not $script:LabState.baselines.ContainsKey('consent')) { throw 'No saved consent baseline.' }
    $baseline=$script:LabState.baselines.consent
    Send-LabGraph PATCH '/policies/authorizationPolicy' @{permissionGrantPolicyIdsAssignedToDefaultUserRole=$baseline.authorization.permissionGrantPolicyIdsAssignedToDefaultUserRole} | Out-Null
    $body=@{}
    foreach ($key in @('isEnabled','notifyReviewers','remindersEnabled','requestDurationInDays','reviewers')) { $body[$key]=$baseline.workflow[$key] }
    Send-LabGraph PUT '/policies/adminConsentRequestPolicy' $body | Out-Null
    $script:LabState.baselines.Remove('consent');Save-LabState
}

function New-LabDirectoryRole {
    param([Parameter(Mandatory)][guid]$OperatorId, [Parameter(Mandatory)][guid]$EditorId)
    Connect-LabGraph @('RoleManagement.ReadWrite.Directory')
    $definitions=Get-LabGraph "/roleManagement/directory/roleDefinitions?`$filter=isBuiltIn eq true and displayName eq 'Application Administrator'"
    if (@($definitions.value).Count -ne 1) { throw 'Cannot resolve Application Administrator.' }
    $existing=Get-LabGraph "/roleManagement/directory/roleAssignments?`$filter=principalId eq '$OperatorId'"
    if (-not @($existing.value | Where-Object { $_.roleDefinitionId -eq $definitions.value[0].id -and $_.directoryScopeId -eq '/' }).Count) {
        $grant=Send-LabGraph POST '/roleManagement/directory/roleAssignments' @{principalId=$OperatorId.ToString();roleDefinitionId=$definitions.value[0].id;directoryScopeId='/'}
        Add-LabRecord "/roleManagement/directory/roleAssignments/$($grant.id)" @{principalId=$OperatorId.ToString();roleDefinitionId=$definitions.value[0].id}
    }
    $app=Get-LabObject 'APP-ACCESS-LAB-AdminScope'
    $role=Send-LabGraph POST '/roleManagement/directory/roleDefinitions' @{
        displayName='APP-ACCESS-LAB Credential Editor';isEnabled=$true
        rolePermissions=@(@{allowedResourceActions=@('microsoft.directory/applications/credentials/update')})
    }
    Add-LabRecord "/roleManagement/directory/roleDefinitions/$($role.id)" @{displayName='APP-ACCESS-LAB Credential Editor'}
    $assignment=Send-LabGraph POST '/roleManagement/directory/roleAssignments' @{
        principalId=$EditorId.ToString();roleDefinitionId=$role.id;directoryScopeId="/$($app.appObjectId)"
    }
    Add-LabRecord "/roleManagement/directory/roleAssignments/$($assignment.id)" @{principalId=$EditorId.ToString();directoryScopeId="/$($app.appObjectId)"}
}

function New-LabApi {
    $entry=New-LabRegistration -Name 'APP-ACCESS-LAB-API' -Platform None -AssignmentRequired $false
    $scopeId=[guid]::NewGuid().ToString()
    Send-LabGraph PATCH "/applications/$($entry.appObjectId)" @{
        identifierUris=@("api://$($entry.clientId)")
        api=@{oauth2PermissionScopes=@(@{id=$scopeId;value='access_as_user';type='Admin';isEnabled=$true
            adminConsentDisplayName='Access the lab API';adminConsentDescription='Access the disposable API as the signed-in user'})}
    } | Out-Null
    $entry
}

function Set-LabApiApplicationRole {
    Connect-LabGraph @('Application.ReadWrite.All')
    $entry=Get-LabObject 'APP-ACCESS-LAB-API'
    $app=Get-LabGraph "/applications/$($entry.appObjectId)"
    $roles=@($app['appRoles'] | Where-Object { $null -ne $_ -and $_.value -ne 'Lab.Api.Read' })
    $previous=@($app['appRoles'] | Where-Object { $null -ne $_ -and $_.value -eq 'Lab.Api.Read' })
    if ($previous.Count -gt 1) { throw 'Ambiguous API app role.' }
    $id=if ($previous.Count) { $previous[0].id } else { [guid]::NewGuid().ToString() }
    $roles+=@{id=$id;displayName='Lab API Reader';value='Lab.Api.Read';description='Read the lab API'
        allowedMemberTypes=@('Application');isEnabled=$true}
    Send-LabGraph PATCH "/applications/$($entry.appObjectId)" @{appRoles=$roles} | Out-Null
}

function Set-LabApplicationPermission {
    param([string]$ClientName='APP-ACCESS-LAB-Daemon')
    Connect-LabGraph @('Application.ReadWrite.All','AppRoleAssignment.ReadWrite.All')
    $client=Get-LabObject $ClientName;$api=Get-LabObject 'APP-ACCESS-LAB-API'
    $sp=Get-LabGraph "/servicePrincipals/$($api.spId)"
    $roles=@($sp.appRoles | Where-Object { $_.value -eq 'Lab.Api.Read' -and $_.isEnabled })
    if ($roles.Count -ne 1) { throw 'API application role not propagated. Retry after inspection.' }
    Set-LabRequestedPermission -ClientName $ClientName -ResourceClientId $api.clientId -PermissionId $roles[0].id -Type Role
    $grant=Send-LabGraph POST "/servicePrincipals/$($client.spId)/appRoleAssignments" @{
        principalId=$client.spId;resourceId=$api.spId;appRoleId=$roles[0].id
    }
    Add-LabRecord "/servicePrincipals/$($client.spId)/appRoleAssignments/$($grant.id)" @{resourceId=$api.spId;appRoleId=$roles[0].id}
}

function New-LabMfaPolicy {
    param([Parameter(Mandatory)][guid[]]$EmergencyAdminIds)
    Connect-LabGraph @('Policy.ReadWrite.ConditionalAccess')
    $allowed=Get-LabObject 'lab-app-allowed';$denied=Get-LabObject 'lab-app-denied';$app=Get-LabObject 'APP-ACCESS-LAB-Web'
    $policy=Send-LabGraph POST '/identity/conditionalAccess/policies' @{
        displayName='APP-ACCESS-LAB-MFA';state='enabledForReportingButNotEnforced'
        conditions=@{users=@{includeUsers=@($allowed.id,$denied.id);excludeUsers=@($EmergencyAdminIds | ForEach-Object { $_.ToString() })}
            applications=@{includeApplications=@($app.clientId)};clientAppTypes=@('all')}
        grantControls=@{operator='OR';builtInControls=@('mfa')}
    }
    Add-LabRecord "/identity/conditionalAccess/policies/$($policy.id)" @{displayName='APP-ACCESS-LAB-MFA'}
    $policy.id
}

function New-LabLogExport {
    param([Parameter(Mandatory)][guid]$SubscriptionId, [Parameter(Mandatory)][string]$Location,
        [Parameter(Mandatory)][ValidatePattern('^law-app-access-')][string]$WorkspaceName)
    Connect-AzAccount -Tenant $script:LabTenantId -Subscription $SubscriptionId | Out-Null
    $context=Get-AzContext
    if ($context.Tenant.Id -ne $script:LabTenantId -or $context.Subscription.Id -ne $SubscriptionId.ToString()) { throw 'Wrong Azure tenant/subscription.' }
    if (@(Get-AzResourceGroup | Where-Object { $_.ResourceGroupName -eq 'rg-app-access-lab' }).Count) {
        throw 'The resource group already exists. Do not adopt or delete a shared resource group.'
    }
    New-AzResourceGroup -Name 'rg-app-access-lab' -Location $Location | Out-Null
    $script:LabState.objects.AzureLogs=@{subscriptionId=$SubscriptionId.ToString();resourceGroup='rg-app-access-lab';location=$Location}
    Save-LabState
    $workspace=New-AzOperationalInsightsWorkspace -ResourceGroupName 'rg-app-access-lab' -Name $WorkspaceName -Location $Location -RetentionInDays 30
    $script:LabState.objects.AzureLogs.workspaceId=$workspace.ResourceId
    Save-LabState
    $path='/providers/microsoft.aadiam/diagnosticSettings/APP-ACCESS-LAB-Logs?api-version=2017-04-01'
    $settings=Invoke-AzRestMethod -Method GET -Path '/providers/microsoft.aadiam/diagnosticSettings?api-version=2017-04-01'
    if ($settings.StatusCode -ne 200) { throw "Cannot inspect diagnostic settings: $($settings.StatusCode)" }
    $existing=($settings.Content | ConvertFrom-Json -AsHashtable).value
    if (@($existing | Where-Object { $_.name -eq 'APP-ACCESS-LAB-Logs' }).Count) { throw 'The diagnostic setting already exists. Do not overwrite it.' }
    $script:LabState.objects.AzureLogs.diagnosticPath=$path
    Save-LabState
    $body=@{properties=@{workspaceId=$workspace.ResourceId;logs=@(
        @{category='SignInLogs';enabled=$true},@{category='AuditLogs';enabled=$true}
    )}}
    $response=Invoke-AzRestMethod -Method PUT -Path $path -Payload ($body | ConvertTo-Json -Depth 8)
    if ($response.StatusCode -notin @(200,201)) { throw "Diagnostic setting write failed: $($response.StatusCode)" }
}

function Remove-LabLogExport {
    $logs=Get-LabObject 'AzureLogs'
    Connect-AzAccount -Tenant $script:LabTenantId -Subscription $logs.subscriptionId | Out-Null
    $context=Get-AzContext
    if ($context.Tenant.Id -ne $script:LabTenantId -or $context.Subscription.Id -ne $logs.subscriptionId) { throw 'Wrong Azure cleanup context.' }
    $resources=@(Get-AzResource -ResourceGroupName $logs.resourceGroup)
    $workspaceId=if ($logs.ContainsKey('workspaceId')) { $logs.workspaceId } else { '' }
    if (@($resources | Where-Object { $_.ResourceId -ne $workspaceId }).Count) { throw 'Other resources now use this group. Do not delete it.' }
    if ((Read-Host "Type $($logs.resourceGroup) to delete only this recorded lab resource group") -cne $logs.resourceGroup) { throw 'Azure cleanup not confirmed.' }
    if ($logs.ContainsKey('diagnosticPath')) {
        $settings=Invoke-AzRestMethod -Method GET -Path '/providers/microsoft.aadiam/diagnosticSettings?api-version=2017-04-01'
        if ($settings.StatusCode -ne 200) { throw "Cannot inspect diagnostic settings: $($settings.StatusCode)" }
        $matches=@(($settings.Content | ConvertFrom-Json -AsHashtable).value | Where-Object { $_.name -eq 'APP-ACCESS-LAB-Logs' })
        if ($matches.Count -gt 1) { throw 'Ambiguous diagnostic setting.' }
        if ($matches.Count) {
            if ($matches[0].properties.workspaceId -ne $workspaceId) { throw 'The diagnostic setting destination changed. Do not delete it.' }
            $response=Invoke-AzRestMethod -Method DELETE -Path $logs.diagnosticPath
            if ($response.StatusCode -notin @(200,204)) { throw "Diagnostic cleanup failed: $($response.StatusCode)" }
        }
    }
    Remove-AzResourceGroup -Name $logs.resourceGroup -Force | Out-Null
    $script:LabState.objects.Remove('AzureLogs');Save-LabState
}

function Remove-LabRecordedObject {
    param([Parameter(Mandatory)][string]$Path)
    $records=@($script:LabState.records | Where-Object { $_.path -eq $Path -and $_.active })
    if ($records.Count -ne 1) { throw 'Delete only an active, recorded object created by these commands.' }
    $record=$records[0];$actual=Get-LabGraph $Path
    foreach ($key in $record.identity.Keys) {
        if ($actual[$key] -ne $record.identity[$key]) { throw "Object identity changed: $Path ($key). Stop." }
    }
    Send-LabGraph DELETE $Path | Out-Null
    $record.active=$false;Save-LabState
}

function Remove-LabAutomation {
    if ((Read-Host 'Type the lab tenant GUID to delete only recorded lab objects') -cne $script:LabTenantId) { throw 'Cleanup not confirmed.' }
    if ($script:LabState.baselines.ContainsKey('consent')) { Restore-LabConsentWorkflow }
    Connect-LabGraph @('Application.ReadWrite.All','User.ReadWrite.All','Group.ReadWrite.All','AppRoleAssignment.ReadWrite.All',
        'DelegatedPermissionGrant.ReadWrite.All','RoleManagement.ReadWrite.Directory','Policy.ReadWrite.ConditionalAccess',
        'Policy.ReadWrite.ApplicationConfiguration')
    $records=@($script:LabState.records | Where-Object { $_.active })
    [array]::Reverse($records)
    foreach ($record in $records) { Remove-LabRecordedObject $record.path }
    if (Test-Path Env:CLIENT_SECRET) { Remove-Item Env:CLIENT_SECRET }
    $script:LabSecrets.Clear()
    Write-Host 'Recorded Graph objects deleted. Complete shared vendor/infrastructure cleanup from section 15.'
}
