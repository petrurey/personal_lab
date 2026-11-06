import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const file = resolve(root, "labs", "app-access-lab.html");
const escape = value => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const auth = scopes => `$ErrorActionPreference='Stop'
$TenantId=[guid](Read-Host 'Lab tenant GUID')
$AdminId=[guid](Read-Host 'Administrator USER object GUID')
Connect-MgGraph -TenantId $TenantId -Scopes '${[...new Set([...scopes, "User.Read"])].join("','")}' -ContextScope Process -NoWelcome
if ((Get-MgContext).TenantId -ne $TenantId.ToString()) { throw 'Wrong tenant.' }
$Graph='https://graph.microsoft.com/v1.0'
$me=Invoke-MgGraphRequest -Method GET -Uri "$Graph/me?\\$select=id" -OutputType Hashtable
if ($me.id -ne $AdminId.ToString()) { throw 'Wrong administrator.' }
if ((Read-Host 'Type APP-ACCESS-LAB to authorize lab writes') -cne 'APP-ACCESS-LAB') { throw 'Writes not confirmed.' }`.replaceAll("\\$", "`$");
const get = (variable, path) => `${variable}=Invoke-MgGraphRequest -Method GET -Uri "${path}" -OutputType Hashtable`;
const send = (method, path, body = "$body", result = "") =>
  `${result ? `${result}=` : ""}Invoke-MgGraphRequest -Method ${method} -Uri "${path}"${method === "DELETE" ? "" : ` -Body (${body} | ConvertTo-Json -Depth 30) -ContentType 'application/json'`}${result ? " -OutputType Hashtable" : " | Out-Null"}`;
const record = (path, identity) => `@{path="${path}";identity=@{${identity}}} | ConvertTo-Json -Compress`;
const appScopes = ["Application.ReadWrite.All"];
const permissionScopes = [...appScopes, "DelegatedPermissionGrant.ReadWrite.All"];
const assignmentScopes = [...appScopes, "AppRoleAssignment.ReadWrite.All"];
const register = (name, { platform = "Web", audience = "AzureADMyOrg", assigned = true, redirect = "'http://localhost:4300/callback'", secret = false } = {}) =>
  `$Name='${name}'
${get("$existing", "$Graph/applications?`$filter=displayName eq '$Name'")}
if (@($existing.value).Count) { throw 'This app already exists. Do not create/adopt a duplicate.' }
$body=@{displayName=$Name;description='APP-ACCESS-LAB only. Delete after training.'
    signInAudience='${audience}';isFallbackPublicClient=$false
    requiredResourceAccess=@(@{resourceAppId='00000003-0000-0000-c000-000000000000'
        resourceAccess=@(@{id='e1fe6dd8-ba31-4d61-89e7-88639da4683d';type='Scope'})})${platform === "None" ? "" : platform === "Spa" ? `
    spa=@{redirectUris=@(${redirect})}` : `
    web=@{redirectUris=@(${redirect});implicitGrantSettings=@{enableAccessTokenIssuance=$false;enableIdTokenIssuance=$false}}`}
}
${send("POST", "$Graph/applications", "$body", "$app")}
${record("$Graph/applications/$($app.id)".replace("$Graph", ""), "appId=$app.appId;displayName=$Name")}
$body=@{appId=$app.appId;accountEnabled=$true;appRoleAssignmentRequired=$${assigned}
    tags=@('WindowsAzureActiveDirectoryIntegratedApp')}
${send("POST", "$Graph/servicePrincipals", "$body", "$sp")}
${record("/servicePrincipals/$($sp.id)", "appId=$app.appId;displayName=$Name")}
[pscustomobject]@{AppObjectId=$app.id;ClientId=$app.appId;SpId=$sp.id}
${secret ? credential("$app.id") : ""}`;
const credential = id => `$body=@{passwordCredential=@{displayName='APP-ACCESS-LAB temporary';endDateTime=[datetime]::UtcNow.AddDays(1).ToString('o')}}
${send("POST", `$Graph/applications/$(${id})/addPassword`, "$body", "$credential")}
$env:TENANT_ID=$TenantId.ToString()
$env:CLIENT_ID=$app.appId
$env:CLIENT_SECRET=$credential.secretText
Write-Host 'One-day secret set in process memory only; do not print or record its value.'`;
const readClient = (name = "APP-ACCESS-LAB-Web") => `$AppObjectId=[guid](Read-Host '${name === "APP-ACCESS-LAB-Web" ? "Web registration OBJECT GUID" : `${name} registration OBJECT GUID`}')
${get("$app", "$Graph/applications/$AppObjectId")}
if ($app.displayName -ne '${name}') { throw 'Wrong registration.' }
$SpId=[guid](Read-Host '${name === "APP-ACCESS-LAB-Web" ? "Web enterprise app SP GUID" : `${name} enterprise app SP GUID`}')
${get("$sp", "$Graph/servicePrincipals/$SpId")}
if ($sp.appId -ne $app.appId) { throw 'SP does not match this registration.' }`;
const delegated = (resource = "'00000003-0000-0000-c000-000000000000'", scope = "User.Read", consent = true) => `$ResourceClientId=${resource}
$Scope='${scope}'
${get("$resources", "$Graph/servicePrincipals?`$filter=appId eq '$ResourceClientId'")}
if (@($resources.value).Count -ne 1) { throw 'Expected one resource SP.' }
$resource=$resources.value[0]
$permissions=@($resource['oauth2PermissionScopes'] | Where-Object { $null -ne $_ -and $_.value -eq $Scope -and $_.isEnabled })
if ($permissions.Count -ne 1) { throw 'Scope missing/not propagated; inspect before retrying.' }
$AppObjectId=$app.id
$SpId=$sp.id
${get("$app", "$Graph/applications/$AppObjectId")}
$access=@($app['requiredResourceAccess'] | Where-Object { $null -ne $_ -and $_.resourceAppId -ne $ResourceClientId })
$current=@($app['requiredResourceAccess'] | Where-Object { $null -ne $_ -and $_.resourceAppId -eq $ResourceClientId })
if ($current.Count -gt 1) { throw 'Ambiguous resource permissions.' }
$requested=if ($current.Count) { @($current[0].resourceAccess) } else { @() }
if (@($requested | Where-Object { $_.id -eq $permissions[0].id -and $_.type -eq 'Scope' }).Count -eq 0) {
    $requested+=@{id=$permissions[0].id;type='Scope'}
}
$access+=@{resourceAppId=$ResourceClientId;resourceAccess=$requested}
${send("PATCH", "$Graph/applications/$AppObjectId", "@{requiredResourceAccess=$access}")}
${consent ? `${get("$grants", "$Graph/oauth2PermissionGrants?`$filter=clientId eq '$SpId'")}
$matching=@($grants.value | Where-Object { $_.resourceId -eq $resource.id -and $_.consentType -eq 'AllPrincipals' })
if ($matching.Count -gt 1) { throw 'Ambiguous admin grant.' }
if ($matching.Count -eq 0) {
    $body=@{clientId=$SpId.ToString();resourceId=$resource.id;consentType='AllPrincipals';scope=$Scope}
    ${send("POST", "$Graph/oauth2PermissionGrants", "$body", "$grant")}
    ${record("/oauth2PermissionGrants/$($grant.id)", "clientId=$SpId.ToString();resourceId=$resource.id")}
} else {
    $names=@($matching[0].scope -split ' ' | Where-Object { $_ })
    if ($names -notcontains $Scope) { $names+=$Scope }
    ${send("PATCH", "$Graph/oauth2PermissionGrants/$($matching[0].id)", "@{scope=($names -join ' ')}")}
}` : "Write-Host 'Permission requested only; no admin grant created.'"}
`;
const roles = `$roles=@($app['appRoles'] | Where-Object { $null -ne $_ -and $_.value -notin @('Lab.Reader','Lab.Observer') })
foreach ($spec in @(
    @{value='Lab.Reader';name='Lab Reader';description='Read protected lab content'},
    @{value='Lab.Observer';name='Lab Observer';description='Sign in without protected access'}
)) {
    $previous=@($app['appRoles'] | Where-Object { $null -ne $_ -and $_.value -eq $spec.value })
    if ($previous.Count -gt 1) { throw 'Ambiguous app role.' }
    $id=if ($previous.Count) { $previous[0].id } else { [guid]::NewGuid().ToString() }
    $roles+=@{id=$id;displayName=$spec.name;value=$spec.value;description=$spec.description;allowedMemberTypes=@('User');isEnabled=$true}
}
${send("PATCH", "$Graph/applications/$($app.id)", "@{appRoles=$roles}")}
${send("PATCH", "$Graph/servicePrincipals/$($sp.id)", "@{appRoleAssignmentRequired=$true;accountEnabled=$true}")}`;
const assign = (principal = "$AllowedId", role = "Lab.Reader") => `${get("$sp", "$Graph/servicePrincipals/$($sp.id)")}
$selected=@($sp['appRoles'] | Where-Object { $null -ne $_ -and $_.value -eq '${role}' -and $_.isEnabled })
if ($selected.Count -ne 1) { throw 'Role not propagated. Retry only the assignment after inspection.' }
$body=@{principalId=${principal}.ToString();resourceId=$sp.id;appRoleId=$selected[0].id}
${send("POST", "$Graph/servicePrincipals/$($sp.id)/appRoleAssignedTo", "$body", "$assignment")}
${record("/servicePrincipals/$($sp.id)/appRoleAssignedTo/$($assignment.id)", `principalId=${principal}.ToString();appRoleId=$selected[0].id`)}`;
const assignDefault = `${get("$sp", "$Graph/servicePrincipals/$($sp.id)")}
$userRoles=@($sp['appRoles'] | Where-Object { $null -ne $_ -and $_.isEnabled -and $_.allowedMemberTypes -contains 'User' })
if ($userRoles.Count -gt 1) { throw 'Select an explicit role; do not guess.' }
$RoleId=if ($userRoles.Count) { $userRoles[0].id } else { [guid]::Empty.ToString() }
$AllowedId=[guid](Read-Host 'Allowed USER object GUID')
$body=@{principalId=$AllowedId.ToString();resourceId=$sp.id;appRoleId=$RoleId}
${send("POST", "$Graph/servicePrincipals/$($sp.id)/appRoleAssignedTo", "$body", "$assignment")}
${record("/servicePrincipals/$($sp.id)/appRoleAssignedTo/$($assignment.id)", "principalId=$AllowedId.ToString();appRoleId=$RoleId")}`;
const template = (name, templateName) => `$Name='${name}'
${get("$existing", "$Graph/applications?`$filter=displayName eq '$Name'")}
if (@($existing.value).Count) { throw 'App exists; do not create/adopt a duplicate.' }
${get("$templates", `$Graph/applicationTemplates?\`$filter=displayName eq '${templateName}'`)}
if (@($templates.value).Count -ne 1) { throw 'Resolve exactly one template.' }
${send("POST", "$Graph/applicationTemplates/$($templates.value[0].id)/instantiate", "@{displayName=$Name}", "$created")}
$app=$created.application
$sp=$created.servicePrincipal
${record("/applications/$($app.id)", "appId=$app.appId;displayName=$Name")}
${record("/servicePrincipals/$($sp.id)", "appId=$app.appId;displayName=$Name")}`;
const saml = (reply, signOn, entity = "") => `$ReplyUrl=${reply}
$SignOnUrl=${signOn}
$body=@{web=@{redirectUris=@($ReplyUrl)}}${entity ? `\n$body.identifierUris=@(${entity})` : ""}
${send("PATCH", "$Graph/applications/$($app.id)")}
$body=@{preferredSingleSignOnMode='saml';loginUrl=$SignOnUrl;replyUrls=@($ReplyUrl);appRoleAssignmentRequired=$true;accountEnabled=$true}
${send("PATCH", "$Graph/servicePrincipals/$($sp.id)")}
${get("$signing", "$Graph/servicePrincipals/$($sp.id)?`$select=id,preferredTokenSigningKeyThumbprint,keyCredentials")}
if (-not $signing['preferredTokenSigningKeyThumbprint']) {
    $body=@{displayName="CN=$($app.displayName)";endDateTime=[datetime]::UtcNow.AddYears(3).ToString('o')}
    ${send("POST", "$Graph/servicePrincipals/$($sp.id)/addTokenSigningCertificate", "$body", "$certificate")}
    ${send("PATCH", "$Graph/servicePrincipals/$($sp.id)", "@{preferredTokenSigningKeyThumbprint=$certificate.thumbprint}")}
    $encoded=$certificate.key
} else {
    $keys=@($signing.keyCredentials | Where-Object {
        $_.usage -eq 'Verify' -and $_.customKeyIdentifier -and
        ([BitConverter]::ToString([Convert]::FromBase64String($_.customKeyIdentifier))).Replace('-','') -eq $signing.preferredTokenSigningKeyThumbprint
    })
    if ($keys.Count -ne 1 -or -not $keys[0].key) { throw 'Cannot export the active certificate.' }
    $encoded=$keys[0].key
}
$CertificateFile=Join-Path $PWD ".app-access-lab-$($app.displayName).cer"
[IO.File]::WriteAllBytes($CertificateFile,[Convert]::FromBase64String($encoded))
[pscustomobject]@{LoginUrl="https://login.microsoftonline.com/$TenantId/saml2"
    EntraIdentifier="https://sts.windows.net/$TenantId/";LogoutUrl="https://login.microsoftonline.com/$TenantId/saml2";CertificateFile=$CertificateFile}`;
const block = (file, title, explanation, code, scope = "extension") => ({ file, title, explanation, code, scope });
const direct = {
  a00: [
    block("00-direct-install.ps1", "Install the official Graph authentication module", "Prerequisite only: this installs Microsoft's cmdlets, not a lab helper.", "Install-Module Microsoft.Graph.Authentication -Scope CurrentUser", "prerequisite"),
    block("00-direct-users.ps1", "Sign in, check for duplicates, and POST each user", "Enter the primary domain without @. Each password prompt is secure. Record the two returned IDs and cleanup records; complete the shared first-login/MFA steps.", `${auth(["User.ReadWrite.All"])}
$Domain=Read-Host 'Lab primary domain (without @)'
foreach ($Name in @('lab-app-allowed','lab-app-denied')) {
    $Upn="$Name@$Domain"
    $filter=[uri]::EscapeDataString("userPrincipalName eq '$($Upn.Replace("'","''"))'")
    ${get("$existing", "$Graph/users?`$filter=$filter")}
    if (@($existing.value).Count) { throw "User $Upn exists; do not adopt it." }
    $secure=Read-Host "Temporary password for $Upn" -AsSecureString
    $password=[System.Net.NetworkCredential]::new('', $secure).Password
    $body=@{accountEnabled=$true;displayName=$Name;mailNickname=$Name;userPrincipalName=$Upn;userType='Member'
        passwordProfile=@{password=$password;forceChangePasswordNextSignIn=$true}}
    ${send("POST", "$Graph/users", "$body", "$user")}
    ${record("/users/$($user.id)", "userPrincipalName=$Upn")}
    [pscustomobject]@{UserId=$user.id;Upn=$user.userPrincipalName}
    $password=$null
}`, "core")
  ],
  a02: [block("02-direct-admin.ps1", "Create the scoped app, then assign the two directory roles", "The ordinary editor/no-ownership prerequisite and both credential-editor browser tests remain shared. Record new assignments only; an existing operator role is retained.", `${auth([...appScopes, "RoleManagement.ReadWrite.Directory"])}
${register("APP-ACCESS-LAB-AdminScope")}
$OperatorId=[guid](Read-Host 'Lab operator USER object GUID')
$EditorId=[guid](Read-Host 'Ordinary editor USER object GUID')
${get("$definitions", "$Graph/roleManagement/directory/roleDefinitions?`$filter=isBuiltIn eq true and displayName eq 'Application Administrator'")}
if (@($definitions.value).Count -ne 1) { throw 'Cannot resolve the built-in role.' }
${get("$existing", "$Graph/roleManagement/directory/roleAssignments?`$filter=principalId eq '$OperatorId'")}
if (@($existing.value | Where-Object { $_.roleDefinitionId -eq $definitions.value[0].id -and $_.directoryScopeId -eq '/' }).Count -eq 0) {
    $body=@{principalId=$OperatorId.ToString();roleDefinitionId=$definitions.value[0].id;directoryScopeId='/'}
    ${send("POST", "$Graph/roleManagement/directory/roleAssignments", "$body", "$grant")}
    ${record("/roleManagement/directory/roleAssignments/$($grant.id)", "principalId=$OperatorId.ToString();roleDefinitionId=$definitions.value[0].id")}
}
$body=@{displayName='APP-ACCESS-LAB Credential Editor';isEnabled=$true
    rolePermissions=@(@{allowedResourceActions=@('microsoft.directory/applications/credentials/update')})}
${send("POST", "$Graph/roleManagement/directory/roleDefinitions", "$body", "$role")}
${record("/roleManagement/directory/roleDefinitions/$($role.id)", "displayName=$role.displayName")}
$body=@{principalId=$EditorId.ToString();roleDefinitionId=$role.id;directoryScopeId="/$($app.id)"}
${send("POST", "$Graph/roleManagement/directory/roleAssignments", "$body", "$assignment")}
${record("/roleManagement/directory/roleAssignments/$($assignment.id)", "principalId=$EditorId.ToString();directoryScopeId=$body.directoryScopeId")}`)],
  a03: [
    block("03-direct-saml.ps1", "Instantiate the gallery template and configure SAML/assignment", "Import the returned trust/certificate and register the allowed account in the toolkit using the same shared vendor steps. Retain the generated Entity ID.", `${auth(assignmentScopes)}
${template("APP-ACCESS-LAB-SAML", "Microsoft Entra SAML Toolkit")}
${saml("'https://samltoolkit.azurewebsites.net/SAML/Consume'", "'https://samltoolkit.azurewebsites.net/'")}
${assignDefault}`),
    block("03-direct-final-urls.ps1", "Write the toolkit-generated final URLs", "Run after the shared vendor configuration. Repeat the same two-user sign-in verification.", `${auth(appScopes)}
${readClient("APP-ACCESS-LAB-SAML")}
${saml("(Read-Host 'Toolkit-generated ACS URL')", "(Read-Host 'Toolkit-generated SP Initiated Login URL')")}`)
  ],
  a04: [
    block("04-direct-custom-saml.ps1", "Configure the non-gallery SAML app", "Vendor-specific NameID/claims, SaaS account mapping and vendor trust import remain the same shared steps.", `${auth(assignmentScopes)}
${template("APP-ACCESS-LAB-CustomSAML", "Custom")}
${saml("(Read-Host 'Vendor ACS URL')", "(Read-Host 'Vendor sign-on URL')", "(Read-Host 'Vendor Entity ID')")}
${assignDefault}`),
    block("04-direct-proxy.ps1", "Create the group, attach the lab connector, publish and assign", "First install/register only the new lab connector and verify host reachability. Use the exact internal/external URLs from the portal field table. The connector-group record is for shared infrastructure cleanup, not v1.0 Graph deletion.", `${auth(["Directory.ReadWrite.All", ...permissionScopes, "AppRoleAssignment.ReadWrite.All"])}
${template("APP-ACCESS-LAB-Proxy", "Custom")}
$ConnectorId=[guid](Read-Host 'NEW lab connector GUID')
$InternalUrl=Read-Host 'Exact internal test URL'
$ExternalUrl=Read-Host 'Same lab-only msappproxy.net external URL'
$Beta='https://graph.microsoft.com/beta'
${send("POST", "$Beta/onPremisesPublishingProfiles/applicationProxy/connectorGroups", "@{name='APP-ACCESS-LAB-Connectors'}", "$group")}
[pscustomobject]@{ConnectorGroupId=$group.id;ConnectorId=$ConnectorId}
${send("POST", "$Beta/onPremisesPublishingProfiles/applicationProxy/connectors/$ConnectorId/memberOf/`$ref", `@{'@odata.id'="$Beta/onPremisesPublishingProfiles/applicationProxy/connectorGroups/$($group.id)"}`)}
${send("PATCH", "$Graph/applications/$($app.id)", "@{identifierUris=@($ExternalUrl);web=@{redirectUris=@($ExternalUrl)}}")}
$body=@{onPremisesPublishing=@{internalUrl=$InternalUrl;externalUrl=$ExternalUrl;externalAuthenticationType='aadPreAuthentication';isOnPremPublishingEnabled=$true}}
${send("PATCH", "$Beta/applications/$($app.id)")}
${send("PUT", "$Beta/applications/$($app.id)/connectorGroup/`$ref", `@{'@odata.id'="$Beta/onPremisesPublishingProfiles/applicationProxy/connectorGroups/$($group.id)"}`)}
${send("PATCH", "$Graph/servicePrincipals/$($sp.id)", "@{accountEnabled=$true;appRoleAssignmentRequired=$true}")}
${delegated()}
${assignDefault}`),
    block("04-direct-kcd.ps1", "Set KCD's SPN/identity and replace the cloud-user assignment", "Complete the shared AD/host steps 1-3 first. Copy the previous cloud assignment's recorded ID; after deleting it, remove that record from your cleanup list. Test backend SSO with the synced users.", `${auth(["Directory.ReadWrite.All", ...assignmentScopes])}
${readClient("APP-ACCESS-LAB-Proxy")}
$Spn=Read-Host 'Exact registered HTTP SPN'
$body=@{onPremisesPublishing=@{singleSignOnSettings=@{singleSignOnMode='onPremisesKerberos'
    kerberosSignOnSettings=@{kerberosServicePrincipalName=$Spn;kerberosSignOnMappingAttributeType='onPremisesUserPrincipalName'}}}}
${send("PATCH", "https://graph.microsoft.com/beta/applications/$($app.id)")}
$OldAssignmentId=Read-Host 'Recorded cloud-user app-role assignment ID'
$CloudUserId=[guid](Read-Host 'Previously assigned cloud USER GUID')
${get("$old", "$Graph/servicePrincipals/$($sp.id)/appRoleAssignedTo/$OldAssignmentId")}
if ($old.principalId -ne $CloudUserId.ToString()) { throw 'Wrong assignment.' }
${send("DELETE", "$Graph/servicePrincipals/$($sp.id)/appRoleAssignedTo/$OldAssignmentId")}
${assignDefault.replace("Allowed USER object GUID", "Allowed AD-synced USER object GUID")}`)
  ],
  a06: [
    block("06-direct-email.ps1", "Add ID-token email without removing other optional claims", "Inspect the resulting token through the shared local test; no additional Graph email permission is added.", `${auth(appScopes)}
${readClient()}
$optional=if ($app['optionalClaims']) { $app['optionalClaims'] } else { @{} }
$idClaims=@($optional['idToken'] | Where-Object { $null -ne $_ })
if (@($idClaims | ForEach-Object { $_.name }) -notcontains 'email') {
    $optional.idToken=$idClaims+@(@{name='email';essential=$false})
}
${send("PATCH", "$Graph/applications/$($app.id)", "@{optionalClaims=$optional}")}`),
    block("06-direct-saml-claim.ps1", "Create and attach the SAML display-name mapping policy", "Only run after completing section 03. Inspect the received claim in the toolkit.", `${auth([...appScopes, "Policy.ReadWrite.ApplicationConfiguration"])}
${readClient("APP-ACCESS-LAB-SAML")}
${get("$existing", "$Graph/servicePrincipals/$($sp.id)/claimsMappingPolicies")}
if (@($existing.value).Count) { throw 'Do not replace an existing claims policy.' }
$definition=@{ClaimsMappingPolicy=@{Version=1;IncludeBasicClaimSet='true';ClaimsSchema=@(
    @{Source='user';ID='userprincipalname';SamlClaimType='http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier'},
    @{Source='user';ID='displayname';SamlClaimType='lab_display_name'}
)}}
$body=@{displayName='APP-ACCESS-LAB-SAML-Claims';definition=@($definition | ConvertTo-Json -Depth 10);isOrganizationDefault=$false}
${send("POST", "$Graph/policies/claimsMappingPolicies", "$body", "$policy")}
${record("/policies/claimsMappingPolicies/$($policy.id)", "displayName=$policy.displayName")}
${send("POST", "$Graph/servicePrincipals/$($sp.id)/claimsMappingPolicies/`$ref", `@{'@odata.id'="$Graph/policies/claimsMappingPolicies/$($policy.id)"}`)}`),
    block("06-direct-consent.ps1", "Save the baseline, write policy settings, and create the request client", "This JSON backup is an explicit undo operation, not helper initialization. Complete the shared browser request/reviewer approval; do not grant consent directly.", `${auth([...appScopes, "Policy.ReadWrite.Authorization", "Policy.ReadWrite.ConsentRequest"])}
if (Test-Path -LiteralPath '.app-access-direct-consent.json') { throw 'Baseline already exists; restore/inspect it first.' }
${get("$authorization", "$Graph/policies/authorizationPolicy")}
${get("$workflow", "$Graph/policies/adminConsentRequestPolicy")}
@{tenantId=$TenantId.ToString();adminId=$AdminId.ToString();authorization=$authorization;workflow=$workflow} |
    ConvertTo-Json -Depth 30 | Set-Content -LiteralPath '.app-access-direct-consent.json' -Encoding utf8
$policies=@($authorization.permissionGrantPolicyIdsAssignedToDefaultUserRole | Where-Object { $_ -notlike 'managePermissionGrantsForSelf.*' })
${send("PATCH", "$Graph/policies/authorizationPolicy", "@{permissionGrantPolicyIdsAssignedToDefaultUserRole=$policies}")}
$ReviewerId=[guid](Read-Host 'Consenting reviewer USER object GUID')
$body=@{isEnabled=$true;notifyReviewers=$true;remindersEnabled=$true;requestDurationInDays=7
    reviewers=@(@{query="/users/$ReviewerId";queryType='MicrosoftGraph'})}
${send("PUT", "$Graph/policies/adminConsentRequestPolicy")}
${register("APP-ACCESS-LAB-Consent", { assigned: false, secret: true })}
Write-Host 'Stop/restart the sample with this client; submit and approve the actual browser request.'`),
    block("06-direct-restore.ps1", "Restore the captured consent baseline", "After the browser test, restore these tenant settings and use section 13's direct environment block with the core IDs/secret.", `${auth(["Policy.ReadWrite.Authorization", "Policy.ReadWrite.ConsentRequest"])}
$baseline=Get-Content -LiteralPath '.app-access-direct-consent.json' -Raw | ConvertFrom-Json -AsHashtable
if ($baseline.tenantId -ne $TenantId.ToString() -or $baseline.adminId -ne $AdminId.ToString()) { throw 'Wrong baseline identity.' }
${send("PATCH", "$Graph/policies/authorizationPolicy", "@{permissionGrantPolicyIdsAssignedToDefaultUserRole=$baseline.authorization.permissionGrantPolicyIdsAssignedToDefaultUserRole}")}
$body=@{}
foreach ($key in @('isEnabled','notifyReviewers','remindersEnabled','requestDurationInDays','reviewers')) { $body[$key]=$baseline.workflow[$key] }
${send("PUT", "$Graph/policies/adminConsentRequestPolicy")}
Remove-Item -LiteralPath '.app-access-direct-consent.json' -Force`)
  ],
  a07: [block("07-direct-register.ps1", "POST the registration/SP, then add the one-day secret", "This performs section 07 only: the default User.Read request, but no grant, roles or user assignments. IDs/records are printed without the secret.", `${auth(appScopes)}
${register("APP-ACCESS-LAB-Web", { secret: true })}`, "core")],
  a08: [
    block("08-direct-core-consent.ps1", "Request User.Read and create/update its AllPrincipals grant", "Use the Web registration/SP IDs returned in 07. This does not assign users.", `${auth(permissionScopes)}
${readClient()}
${delegated()}`, "core"),
    block("08-direct-api.ps1", "Register the custom API/caller and grant access_as_user", "Shared: implement and test the separate API and caller. The API scope does not create an app-only role early.", `${auth(permissionScopes)}
${register("APP-ACCESS-LAB-API", { platform: "None", assigned: false })}
$scopeId=[guid]::NewGuid().ToString()
$body=@{identifierUris=@("api://$($app.appId)")
    api=@{oauth2PermissionScopes=@(@{id=$scopeId;value='access_as_user';type='Admin';isEnabled=$true
        adminConsentDisplayName='Access the lab API';adminConsentDescription='Access the disposable API as the signed-in user'})}}
${send("PATCH", "$Graph/applications/$($app.id)")}
$api=$app
${register("APP-ACCESS-LAB-Caller", { assigned: false, redirect: "(Read-Host 'Actual caller Web redirect URI')" })}
${delegated("$api.appId", "access_as_user")}`),
    block("08-direct-app-only.ps1", "Create the Applications-only API role, daemon and actual grant", "The User.Read request from registration is preserved. Configure the daemon/API implementation and test roles=Lab.Api.Read separately.", `${auth(assignmentScopes)}
${readClient("APP-ACCESS-LAB-API")}
$api=$app
$ApiSpId=$sp.id
$roles=@($api['appRoles'] | Where-Object { $null -ne $_ -and $_.value -ne 'Lab.Api.Read' })
$previous=@($api['appRoles'] | Where-Object { $null -ne $_ -and $_.value -eq 'Lab.Api.Read' })
if ($previous.Count -gt 1) { throw 'Ambiguous API role.' }
$roleId=if ($previous.Count) { $previous[0].id } else { [guid]::NewGuid().ToString() }
$roles+=@{id=$roleId;displayName='Lab API Reader';value='Lab.Api.Read';description='Read the lab API';allowedMemberTypes=@('Application');isEnabled=$true}
${send("PATCH", "$Graph/applications/$($api.id)", "@{appRoles=$roles}")}
${register("APP-ACCESS-LAB-Daemon", { platform: "None", assigned: false, secret: true })}
${get("$apiSp", "$Graph/servicePrincipals/$ApiSpId")}
$selected=@($apiSp['appRoles'] | Where-Object { $null -ne $_ -and $_.value -eq 'Lab.Api.Read' -and $_.isEnabled })
if ($selected.Count -ne 1) { throw 'API role not propagated; inspect before retrying the permission/grant steps.' }
$access=@($app['requiredResourceAccess'])
$access+=@{resourceAppId=$api.appId;resourceAccess=@(@{id=$selected[0].id;type='Role'})}
${send("PATCH", "$Graph/applications/$($app.id)", "@{requiredResourceAccess=$access}")}
$body=@{principalId=$sp.id;resourceId=$ApiSpId;appRoleId=$selected[0].id}
${send("POST", "$Graph/servicePrincipals/$($sp.id)/appRoleAssignments", "$body", "$grant")}
${record("/servicePrincipals/$($sp.id)/appRoleAssignments/$($grant.id)", "resourceId=$ApiSpId;appRoleId=$selected[0].id")}`),
    block("08-direct-obo.ps1", "Give the API delegated Graph consent and its own credential", "Shared: implement the validated incoming API token/OBO exchange and Graph call. The process environment now contains the API client, not the core client.", `${auth(permissionScopes)}
${readClient("APP-ACCESS-LAB-API")}
${delegated()}
${credential("$app.id")}`)
  ],
  a09: [
    block("09-direct-roles.ps1", "PATCH the two roles and assign allowed to the Reader GUID", "Use the Web IDs from 07 and allowed's ID from 00. A missing propagated role stops the script; retry only the assignment step after inspection.", `${auth(assignmentScopes)}
${readClient()}
${roles}
$AllowedId=[guid](Read-Host 'Allowed USER object GUID')
${assign()}`, "core"),
    block("09-direct-group.ps1", "Create an Assigned security group, assign Reader, remove direct access", "P1/P2 only. Keep the group/assignment records and remove the deleted direct-assignment record from your cleanup list.", `${auth([...assignmentScopes, "Group.ReadWrite.All"])}
${readClient()}
$AllowedId=[guid](Read-Host 'Allowed USER object GUID')
${get("$existing", "$Graph/groups?`$filter=displayName eq 'APP-ACCESS-LAB-Readers'")}
if (@($existing.value).Count) { throw 'Group exists; do not adopt it.' }
$body=@{displayName='APP-ACCESS-LAB-Readers';mailNickname='APP-ACCESS-LAB-Readers'
    mailEnabled=$false;securityEnabled=$true;groupTypes=@()
    'members@odata.bind'=@("$Graph/users/$AllowedId")}
${send("POST", "$Graph/groups", "$body", "$group")}
${record("/groups/$($group.id)", "displayName=$group.displayName")}
${assign("$group.id")}
${get("$assignments", "$Graph/servicePrincipals/$($sp.id)/appRoleAssignedTo")}
$direct=@($assignments.value | Where-Object { $_.principalId -eq $AllowedId.ToString() -and $_.appRoleId -eq $selected[0].id })
if ($direct.Count -ne 1) { throw 'Resolve the exact direct Reader assignment before removal.' }
${send("DELETE", "$Graph/servicePrincipals/$($sp.id)/appRoleAssignedTo/$($direct[0].id)")}
Write-Host "Removed direct assignment $($direct[0].id); update your cleanup records."`)
  ],
  a10: [
    block("10-direct-spa.ps1", "Create/configure the SPA, consent and allowed Reader access", "Shared: configure and run the separate MSAL browser implementation. No browser secret is created.", `${auth([...permissionScopes, "AppRoleAssignment.ReadWrite.All"])}
${register("APP-ACCESS-LAB-SPA", { platform: "Spa", redirect: "'http://localhost:5173'" })}
${delegated()}
${roles}
$AllowedId=[guid](Read-Host 'Allowed USER object GUID')
${assign()}`),
    block("10-direct-multi.ps1", "Create/configure the multitenant home registration", "Shared: actual implementation/optional credential, accepted-tenant list, second-tenant consent/SP assignment and two-user test. These commands stay in the home tenant.", `${auth(appScopes)}
${register("APP-ACCESS-LAB-Multi", { audience: "AzureADMultipleOrgs", redirect: "(Read-Host 'Actual multitenant Web redirect URI')" })}
${roles}`)
  ],
  a12: [block("12-direct-log-export.ps1", "Create the workspace and PUT the actual tenant diagnostic setting", "Shared: My Apps collection creation and Entra/KQL event checks. This is billable Azure configuration; record subscription, workspace resource ID and diagnostic path.", `$ErrorActionPreference='Stop'
$TenantId=[guid](Read-Host 'Lab tenant GUID')
$SubscriptionId=[guid](Read-Host 'Lab Azure subscription GUID')
$Location=Read-Host 'Supported lab region'
$WorkspaceName=Read-Host 'law-app-access-UNIQUE_SUFFIX'
if ($WorkspaceName -notmatch '^law-app-access-') { throw 'Use a lab workspace name.' }
Install-Module Az.Accounts,Az.Resources,Az.OperationalInsights -Scope CurrentUser
Connect-AzAccount -Tenant $TenantId -Subscription $SubscriptionId | Out-Null
$context=Get-AzContext
if ($context.Tenant.Id -ne $TenantId.ToString() -or $context.Subscription.Id -ne $SubscriptionId.ToString()) { throw 'Wrong Azure context.' }
if ((Read-Host 'Type APP-ACCESS-LAB to authorize lab writes') -cne 'APP-ACCESS-LAB') { throw 'Not confirmed.' }
if (@(Get-AzResourceGroup | Where-Object ResourceGroupName -eq 'rg-app-access-lab').Count) { throw 'Do not adopt a shared resource group.' }
$DiagnosticPath='/providers/microsoft.aadiam/diagnosticSettings/APP-ACCESS-LAB-Logs?api-version=2017-04-01'
$settings=Invoke-AzRestMethod -Method GET -Path '/providers/microsoft.aadiam/diagnosticSettings?api-version=2017-04-01'
if ($settings.StatusCode -ne 200) { throw 'Cannot inspect diagnostic settings.' }
if (@(($settings.Content | ConvertFrom-Json -AsHashtable).value | Where-Object name -eq 'APP-ACCESS-LAB-Logs').Count) { throw 'Do not overwrite an existing diagnostic setting.' }
New-AzResourceGroup -Name 'rg-app-access-lab' -Location $Location | Out-Null
$workspace=New-AzOperationalInsightsWorkspace -ResourceGroupName 'rg-app-access-lab' -Name $WorkspaceName -Location $Location -RetentionInDays 30
[pscustomobject]@{SubscriptionId=$SubscriptionId;ResourceGroup='rg-app-access-lab';WorkspaceId=$workspace.ResourceId;DiagnosticPath=$DiagnosticPath}
$body=@{properties=@{workspaceId=$workspace.ResourceId;logs=@(@{category='SignInLogs';enabled=$true},@{category='AuditLogs';enabled=$true})}}
$response=Invoke-AzRestMethod -Method PUT -Path $DiagnosticPath -Payload ($body | ConvertTo-Json -Depth 10)
if ($response.StatusCode -notin @(200,201)) { throw "Diagnostic setting write failed: $($response.StatusCode)" }`)],
  a13: [block("13-direct-runtime.ps1", "Set the three environment variables and run the sample", "Use the core client ID/secret from 07, not the consent/API/daemon client. Run from the sample folder; this requires no Graph sign-in.", `$env:TENANT_ID=([guid](Read-Host 'Lab tenant GUID')).ToString()
$env:CLIENT_ID=([guid](Read-Host 'Core Web CLIENT GUID')).ToString()
$secure=Read-Host 'Core one-day secret VALUE' -AsSecureString
$env:CLIENT_SECRET=[System.Net.NetworkCredential]::new('', $secure).Password
$NodeMajor=[int]((node --version).TrimStart('v').Split('.')[0])
if ($NodeMajor -lt 22) { throw 'Node.js 22+ required.' }
npm ci
if ($LASTEXITCODE) { throw 'Dependency installation failed.' }
npm test
if ($LASTEXITCODE) { throw 'Sample tests failed.' }
npm start`, "core")],
  a14: [
    block("14-direct-comparison.ps1", "Create/remove Observer, then revoke direct/group Reader access", "Shared: perform real browser tests at each pause. Mark deleted records removed. Group revocation deletes only the membership reference, never the user.", `${auth([...assignmentScopes, "Group.ReadWrite.All"])}
${readClient()}
$DeniedId=[guid](Read-Host 'Denied USER object GUID')
curl.exe -i http://localhost:4300/protected
Read-Host 'Verify allowed=200 and unassigned denied sign-in rejection; press Enter' | Out-Null
${assign("$DeniedId", "Lab.Observer")}
Read-Host 'Clear denied session, verify both protected routes=403; press Enter' | Out-Null
${send("DELETE", "$Graph/servicePrincipals/$($sp.id)/appRoleAssignedTo/$($assignment.id)")}
Write-Host 'Observer assignment removed; remove its cleanup record.'
$AllowedId=[guid](Read-Host 'Allowed USER object GUID')
$route=Read-Host 'Reader route: type direct or group'
if ($route -eq 'group') {
    $GroupId=[guid](Read-Host 'Recorded Readers GROUP GUID')
    ${get("$group", "$Graph/groups/$GroupId")}
    if ($group.displayName -ne 'APP-ACCESS-LAB-Readers') { throw 'Wrong group.' }
    ${send("DELETE", "$Graph/groups/$GroupId/members/$AllowedId/`$ref")}
} elseif ($route -eq 'direct') {
    ${get("$sp", "$Graph/servicePrincipals/$($sp.id)")}
    $reader=@($sp.appRoles | Where-Object value -eq 'Lab.Reader')
    if ($reader.Count -ne 1) { throw 'Ambiguous Reader role.' }
    ${get("$assigned", "$Graph/servicePrincipals/$($sp.id)/appRoleAssignedTo")}
    $direct=@($assigned.value | Where-Object { $_.principalId -eq $AllowedId.ToString() -and $_.appRoleId -eq $reader[0].id })
    if ($direct.Count -ne 1) { throw 'Resolve the exact direct Reader assignment.' }
    ${send("DELETE", "$Graph/servicePrincipals/$($sp.id)/appRoleAssignedTo/$($direct[0].id)")}
    Write-Host 'Direct Reader assignment removed; update cleanup records.'
} else { throw 'Choose direct or group.' }
Read-Host 'Observe existing allowed session, then logout/fresh sign-in denial; press Enter' | Out-Null`),
    block("14-direct-mfa.ps1", "POST the report-only MFA policy, then optionally test enforcement", "P1/P2 only. Restore Reader before an MFA success test. The policy is initially report-only; the optional enforcement/deletion is paused for the same shared browser/MFA checks.", `${auth(["Policy.ReadWrite.ConditionalAccess"])}
$AllowedId=[guid](Read-Host 'Allowed USER object GUID')
$DeniedId=[guid](Read-Host 'Denied USER object GUID')
$ClientId=[guid](Read-Host 'Core Web CLIENT GUID')
$EmergencyIds=@((Read-Host 'Emergency administrator USER GUIDs, comma-separated') -split ',' | ForEach-Object { ([guid]$_.Trim()).ToString() })
$body=@{displayName='APP-ACCESS-LAB-MFA';state='enabledForReportingButNotEnforced'
    conditions=@{users=@{includeUsers=@($AllowedId.ToString(),$DeniedId.ToString());excludeUsers=$EmergencyIds}
        applications=@{includeApplications=@($ClientId.ToString())};clientAppTypes=@('all')}
    grantControls=@{operator='OR';builtInControls=@('mfa')}}
${send("POST", "$Graph/identity/conditionalAccess/policies", "$body", "$policy")}
${record("/identity/conditionalAccess/policies/$($policy.id)", "displayName=$policy.displayName")}
Read-Host 'Inspect the real Report-only result; press Enter' | Out-Null
$choice=Read-Host 'Optional enforced test: type MFA-REGISTERED only after BOTH users register MFA; otherwise type SKIP'
if ($choice -ceq 'MFA-REGISTERED') {
    ${send("PATCH", "$Graph/identity/conditionalAccess/policies/$($policy.id)", "@{state='enabled'}")}
    Read-Host 'Run fresh browser MFA tests; press Enter to delete this policy' | Out-Null
    ${send("DELETE", "$Graph/identity/conditionalAccess/policies/$($policy.id)")}
    Write-Host 'Policy removed; remove its cleanup record.'
} elseif ($choice -cne 'SKIP') { throw 'Choose MFA-REGISTERED or SKIP.' }`)
  ],
  a15: [
    block("15-direct-graph-cleanup.ps1", "Verify and DELETE only your recorded created objects", "Shared first: stop the sample/provisioning and remove vendor policies/accounts/collection and second-tenant SP. If 06 changed consent settings, run its direct baseline-restore block first. Paste only remaining records from this direct route in creation order; exclude already deleted assignments/policies. Do not use the helper's state.", `${auth(["Application.ReadWrite.All", "User.ReadWrite.All", "Group.ReadWrite.All", "AppRoleAssignment.ReadWrite.All", "DelegatedPermissionGrant.ReadWrite.All", "RoleManagement.ReadWrite.Directory", "Policy.ReadWrite.ConditionalAccess", "Policy.ReadWrite.ApplicationConfiguration"])}
$records=@((Read-Host 'Paste remaining CREATED object records as one JSON array') | ConvertFrom-Json -AsHashtable)
if ((Read-Host 'Type the lab tenant GUID to confirm recorded-object deletion') -cne $TenantId.ToString()) { throw 'Cleanup not confirmed.' }
[array]::Reverse($records)
foreach ($record in $records) {
    if ($record.path -notmatch '^/(applications|servicePrincipals|users|groups|oauth2PermissionGrants|policies/claimsMappingPolicies|identity/conditionalAccess/policies|roleManagement/directory/roleDefinitions|roleManagement/directory/roleAssignments)/[A-Za-z0-9_/=+-]+$' -or -not $record.identity.Count) { throw 'Invalid recorded object path/identity.' }
    ${get("$actual", "$Graph$($record.path)")}
    foreach ($key in $record.identity.Keys) {
        if ($actual[$key] -ne $record.identity[$key]) { throw "Object identity changed: $($record.path)" }
    }
    ${send("DELETE", "$Graph$($record.path)")}
    Write-Host "Deleted $($record.path); remove this record from your local list."
}
if (Test-Path Env:CLIENT_SECRET) { Remove-Item Env:CLIENT_SECRET }
Disconnect-MgGraph`),
    block("15-direct-azure-cleanup.ps1", "Verify the diagnostic destination and lab-only group, then delete", "Only run for Azure resources created by the direct route. Complete the same shared connector/group/host/AD cleanup afterward.", `$ErrorActionPreference='Stop'
$TenantId=[guid](Read-Host 'Lab tenant GUID')
$SubscriptionId=[guid](Read-Host 'Recorded Azure subscription GUID')
$WorkspaceId=Read-Host 'Recorded workspace RESOURCE ID'
Connect-AzAccount -Tenant $TenantId -Subscription $SubscriptionId | Out-Null
$context=Get-AzContext
if ($context.Tenant.Id -ne $TenantId.ToString() -or $context.Subscription.Id -ne $SubscriptionId.ToString()) { throw 'Wrong Azure context.' }
$resources=@(Get-AzResource -ResourceGroupName 'rg-app-access-lab')
if (@($resources | Where-Object { $_.ResourceId -ne $WorkspaceId }).Count) { throw 'Other resources use this group; do not delete.' }
$settings=Invoke-AzRestMethod -Method GET -Path '/providers/microsoft.aadiam/diagnosticSettings?api-version=2017-04-01'
if ($settings.StatusCode -ne 200) { throw 'Cannot inspect diagnostic settings.' }
$matching=@(($settings.Content | ConvertFrom-Json -AsHashtable).value | Where-Object name -eq 'APP-ACCESS-LAB-Logs')
if ($matching.Count -ne 1 -or $matching[0].properties.workspaceId -ne $WorkspaceId) { throw 'Recorded diagnostic destination does not match.' }
if ((Read-Host 'Type rg-app-access-lab to delete this recorded group/export') -cne 'rg-app-access-lab') { throw 'Cleanup not confirmed.' }
$response=Invoke-AzRestMethod -Method DELETE -Path '/providers/microsoft.aadiam/diagnosticSettings/APP-ACCESS-LAB-Logs?api-version=2017-04-01'
if ($response.StatusCode -notin @(200,204)) { throw 'Diagnostic delete failed.' }
Remove-AzResourceGroup -Name 'rg-app-access-lab' -Force | Out-Null`)
  ]
};
const manual = {
  a01: "Use the same portal/agent steps for the snapshot, Microsoft 365 connector consent and AD FS reporting. No complete direct or helper route is offered; an inventory query cannot replace them.",
  a05: "Use the connector-specific credentials, mappings, assigned-only scope, notifications and lifecycle steps above. No unverified generic SCIM payload is substituted in either track.",
  a11: "Create the exact restricted alert-only policy in the supported Defender portal and perform the optional remediation test there. SP disable is not an automation substitute for policy creation."
};
const html = await readFile(file, "utf8");
let count = 0;
const updated = html.replace(/<section class="module" id="(a\d\d)"[\s\S]*?<\/section>/g, (section, id) => {
  const savedHelper = section.match(/<!-- helper-track:start -->\s*([\s\S]*?)\s*<!-- helper-track:end -->/);
  const existingHelper = section.match(/<details class="automation" data-parity="[^"]+"[^>]*>[\s\S]*?<\/details>/);
  const helper = savedHelper?.[1] || existingHelper?.[0] || (id === "a13" ?
    `<details class="automation" data-parity="shared"><summary>Helper route &mdash; set the core environment and run</summary><p><strong>Result:</strong> the same local runtime/environment. <strong>Shared:</strong> source downloads and browser checks; first load/initialize the helper as shown in 00.</p><pre data-file="13-helper-runtime.ps1"><code>Use-LabClient
npm ci
if ($LASTEXITCODE) { throw 'Dependency installation failed.' }
npm test
if ($LASTEXITCODE) { throw 'Sample tests failed.' }
npm start</code></pre></details>` : null);
  if (!helper || (!direct[id] && !manual[id])) throw new Error(`Missing automation track: ${id}`);
  const parity = helper.match(/data-parity="([^"]+)"/)[1];
  const body = manual[id] ? `<p>${manual[id]}</p>` : `<p>Run the blocks in order for the selected branch. All inputs, requests and payloads are explicit. ${id === "a13" ? "This local runtime block needs no Graph connection." : "Microsoft sign-in/installed cmdlets are still required."} No custom functions, dot-sourcing or helper initialization is used. Keep printed <code>path/identity</code> records in local notes for cleanup, never secrets. Do not rerun creation blocks after a partial failure.</p>${direct[id].map(item =>
    `<h5>${item.title}</h5><p>${item.explanation}</p><pre data-file="${item.file}" data-scope="${item.scope}"><code>${escape(item.code.trim())}</code></pre>`).join("\n")}`;
  const tracks = `<!-- automation-tracks:start -->
<div class="automation-grid">
<div class="automation-track" data-track="direct"><h4>Write it step by step</h4>
<details class="automation" data-parity="${parity}" data-track="direct"><summary>${manual[id] ? "Manual-only boundary &mdash; same for both tracks" : "Explicit commands &mdash; no helper required"}</summary>${body}</details>
</div>
<div class="automation-track" data-track="helper"><h4>Use automation.ps1</h4>
<!-- helper-track:start -->
${helper}
<!-- helper-track:end -->
</div>
</div>
<!-- automation-tracks:end -->`;
  const previous = section.match(/<!-- automation-tracks:start -->[\s\S]*?<!-- automation-tracks:end -->/);
  count++;
  if (previous) return section.replace(previous[0], () => tracks);
  if (existingHelper) return section.replace(existingHelper[0], () => tracks);
  return section.replace('<div class="callout check">', () => `${tracks}\n<div class="callout check">`);
});
if (count !== 16) throw new Error(`Expected 16 modules, found ${count}.`);
await writeFile(file, updated);
console.log("Rendered explicit native commands beside preserved helper routes in all 16 modules.");
