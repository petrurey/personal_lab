"use strict";
    const learnModule = slug => "https://learn.microsoft.com/en-us/training/modules/" + slug + "/";
    const learnPath = slug => "https://learn.microsoft.com/en-us/training/paths/" + slug + "/";
    const studyGuide = "https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/sc-300";
    const certification = "https://learn.microsoft.com/en-us/credentials/certifications/identity-and-access-administrator/";
    const labs = "https://microsoftlearning.github.io/SC-300-Identity-and-Access-Administrator/";
    const stages = [
      {id:"identities",date:"5-9 Nov",label:"Domain 1",title:"Implement and manage user identities",topic:"Tenants, users, groups, external identities and hybrid identity.",output:"Lab goal: document a tenant setup and a B2B / hybrid identity scenario."},
      {id:"access",date:"10-15 Nov",label:"Domain 2",title:"Implement authentication and access management",topic:"Authentication methods, Conditional Access, Identity Protection and Global Secure Access.",output:"Lab goal: test a risk-based policy in report-only mode and explain its results."},
      {id:"workloads",date:"16-20 Nov",label:"Domain 3",title:"Plan and implement workload identities",topic:"Managed identities, enterprise applications, app registrations and Defender for Cloud Apps.",output:"Lab goal: build an app integration and explain permissions and consent."},
      {id:"governance",date:"21-25 Nov",label:"Domain 4",title:"Plan and automate identity governance",topic:"Entitlement management, access reviews, privileged access and identity monitoring.",output:"Lab goal: walk through an access package, PIM approval and a log investigation."},
      {id:"readiness",date:"26-29 Nov",label:"Final preparation",title:"Practise, review & get exam-ready",topic:"Repeat the practice assessment, revisit weak areas and try the exam sandbox.",output:"Personal readiness goal: explain every missed answer without notes. Confirm booking and exam-day requirements."},
      {id:"exam",date:"30 Nov",label:"Target date",title:"Sit the SC-300 exam",tag:"FINAL MILESTONE",topic:"A focused finish to your November development plan.",output:"Mark this checkpoint after attending the exam. Record your result separately; this checkbox does not certify a pass."}
    ];
    const studyDetails = {
      identities:{source:learnPath("implement-identity-management-solution"),items:[
        {id:"tenant",title:"Configure your Entra tenant",focus:"Roles, administrative units, domains, branding and tenant settings.",url:learnModule("implement-initial-configuration-of-azure-active-directory")},
        {id:"users",title:"Manage users, groups & devices",focus:"Licensing, bulk operations, custom attributes and device identities.",url:learnModule("create-configure-manage-identities")},
        {id:"external",title:"Manage external identities",focus:"Guest invitations, collaboration settings and cross-tenant access.",url:learnModule("implement-manage-external-identities")},
        {id:"hybrid",title:"Implement hybrid identity",focus:"Connect / Cloud Sync, authentication choices and hybrid health.",url:learnModule("implement-manage-hybrid-identity")}
      ]},
      access:{source:learnPath("implement-authentication-access-management-solution"),items:[
        {id:"mfa",title:"Secure users with MFA",focus:"Registration, authentication methods and rollout decisions.",url:learnModule("secure-aad-users-with-mfa")},
        {id:"authentication",title:"Manage user authentication",focus:"Passwordless methods, SSPR and authentication troubleshooting.",url:learnModule("manage-user-authentication")},
        {id:"conditional-access",title:"Plan & administer Conditional Access",focus:"Assignments, controls, report-only testing and policy troubleshooting.",url:learnModule("plan-implement-administer-conditional-access")},
        {id:"protection",title:"Manage Identity Protection",focus:"User / sign-in risk, remediation and workload identity risk.",url:learnModule("manage-azure-active-directory-identity-protection")},
        {id:"azure-access",title:"Manage access to Azure resources",focus:"Azure roles, RBAC and managed identity access.",url:learnModule("implement-access-management-for-azure-resources")},
        {id:"global-access",title:"Deploy Global Secure Access",focus:"Clients, Private Access, Internet Access and traffic profiles.",url:learnModule("deploy-configure-microsoft-entra-global-secure-access")}
      ]},
      workloads:{source:learnPath("implement-access-management-for-apps"),items:[
        {id:"sso-design",title:"Design enterprise app SSO",focus:"Choose an integration approach and plan application access.",url:learnModule("plan-design-integration-of-enterprise-apps-for-sso")},
        {id:"sso-implementation",title:"Implement & monitor enterprise apps",focus:"SaaS / on-premises integration, app assignments and Application Proxy.",url:learnModule("implement-monitor-integration-of-enterprise-apps-for-sso")},
        {id:"registration",title:"Implement app registration",focus:"Authentication, API permissions, app roles and consent.",url:learnModule("implement-app-registration")},
        {id:"register-apps",title:"Register apps in Microsoft Entra ID",focus:"Practise registration settings and review the resulting application identity.",url:learnModule("register-apps-use-microsoft-entra-id")},
        {id:"managed-identities",title:"Review managed identities",focus:"System- versus user-assigned identities and resource access. Supplemental reading.",url:"https://learn.microsoft.com/en-us/entra/identity/managed-identities-azure-resources/overview",source:"Docs"},
        {id:"cloud-apps",title:"Review Defender for Cloud Apps",focus:"Discovery, app protection and OAuth governance. Supplemental reading.",url:"https://learn.microsoft.com/en-us/defender-cloud-apps/what-is-defender-for-cloud-apps",source:"Docs"}
      ]},
      governance:{source:learnPath("plan-implement-identity-governance-strategy"),items:[
        {id:"entitlements",title:"Implement entitlement management",focus:"Catalogs, access packages, requests and external-user lifecycle.",url:learnModule("plan-implement-entitlement-management")},
        {id:"reviews",title:"Plan & manage access reviews",focus:"Review scope, recurrence, reviewer decisions and outcomes.",url:learnModule("plan-implement-manage-access-review")},
        {id:"privileged-access",title:"Implement privileged access",focus:"PIM for roles / groups, approval settings and emergency access.",url:learnModule("plan-implement-privileged-access")},
        {id:"monitoring",title:"Monitor & maintain Entra ID",focus:"Sign-in / audit logs, diagnostics, workbooks and KQL.",url:learnModule("monitor-maintain-azure-active-directory")}
      ]},
      readiness:{source:certification+"#practice-for-the-exam",items:[
        {id:"practice",title:"Repeat the assessment & close gaps",focus:"Review every missed answer; explain the scenario without notes.",url:certification+"#practice-for-the-exam",source:"Practice"},
        {id:"sandbox",title:"Try the exam sandbox",focus:"Launch the sandbox from the certification page and practise the interface.",url:certification+"#practice-for-the-exam",source:"Sandbox"},
        {id:"check-in",title:"Confirm booking & exam-day requirements",focus:"Check your appointment, check-in instructions and required identification.",url:certification+"#take-the-exam",source:"Exam"}
      ]},
      exam:{source:certification+"#take-the-exam",items:[
        {id:"attend",title:"Attend the SC-300 exam",focus:"Target: 30 November 2026. Mark only after attending; not proof of a pass.",url:certification+"#take-the-exam",source:"Exam"},
        {id:"result",title:"Record your result & next steps",focus:"Keep your result and note any domains needing follow-up.",url:studyGuide,source:"Guide"}
      ]}
    };
    for (const stage of stages) Object.assign(stage,studyDetails[stage.id]);
    const studyItems = stages.flatMap(stage => stage.items.map(item => ({...item,key:stage.id+":"+item.id})));
