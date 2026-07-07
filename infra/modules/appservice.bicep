@description('Location for all resources')
param location string

@description('Tags for all resources')
param tags object = {}

@description('App Service Plan name')
param appServicePlanName string

@description('App Service name')
param appServiceName string

@description('Log Analytics workspace name')
param logAnalyticsName string

@description('Application Insights name')
param appInsightsName string
param appServiceName string

@description('App Service Plan SKU')
param planSku string = 'B1'

@description('Node.js runtime name')
param runtimeName string = 'node'

@description('Node.js runtime version')
param runtimeVersion string = '24-lts'

@description('App settings key-value pairs')
param appSettings object = {}

@minLength(1)
@description('Entra ID (AAD) client ID for Easy Auth. Required to protect tenant-specific API endpoints.')
param authClientId string

@description('Entra ID tenant ID for Easy Auth. Defaults to the deployment tenant.')
param authTenantId string = tenant().tenantId

var linuxFxVersion = '${toUpper(runtimeName)}|${runtimeVersion}'

resource appServicePlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: appServicePlanName
  location: location
  tags: tags
  sku: {
    name: planSku
  }
  kind: 'linux'
  properties: {
    reserved: true
  }
}

resource appService 'Microsoft.Web/sites@2023-12-01' = {
  name: appServiceName
  location: location
  tags: union(tags, { 'azd-service-name': 'web' })
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: linuxFxVersion
      alwaysOn: true
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      appCommandLine: 'node server.js'
      appSettings: [for key in objectKeys(union(appSettings, {
        APPLICATIONINSIGHTS_CONNECTION_STRING: appInsights.properties.ConnectionString
      })): {
        name: key
        value: union(appSettings, {
          APPLICATIONINSIGHTS_CONNECTION_STRING: appInsights.properties.ConnectionString
        })[key]
      }]
    }
  }
}

// ── Log Analytics workspace ─────────────────────────────────────────────────
resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logAnalyticsName
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

// ── Application Insights ────────────────────────────────────────────────────
resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
  }
}

// ── Diagnostic settings (App Service → Log Analytics) ───────────────────────
resource diagnosticSettings 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  scope: appService
  name: '${appServiceName}-diag'
  properties: {
    workspaceId: logAnalytics.id
    logs: [
      {
        category: 'AppServiceHTTPLogs'
        enabled: true
      }
      {
        category: 'AppServiceConsoleLogs'
        enabled: true
      }
      {
        category: 'AppServiceAppLogs'
        enabled: true
      }
    ]
    metrics: [
      {
        category: 'AllMetrics'
        enabled: true
      }
    ]
  }
}

output appServiceName string = appService.name
output uri string = 'https://${appService.properties.defaultHostName}'

// ── Entra ID Easy Auth (authsettingsV2) ─────────────────────────────────────
// When authClientId is provided, require Entra ID sign-in for all requests.
// Unauthenticated requests receive a 401/302 instead of reaching the app.
resource authSettings 'Microsoft.Web/sites/config@2023-12-01' = if (!empty(authClientId)) {
  parent: appService
  name: 'authsettingsV2'
  properties: {
    globalValidation: {
      requireAuthentication: true
      unauthenticatedClientAction: 'RedirectToLoginPage'
      redirectToProvider: 'azureactivedirectory'
    }
    identityProviders: {
      azureActiveDirectory: {
        enabled: true
        registration: {
          clientId: authClientId
          openIdIssuer: 'https://sts.windows.net/${authTenantId}/v2.0'
        }
        validation: {
          allowedAudiences: [
            'api://${authClientId}'
          ]
        }
      }
    }
    login: {
      tokenStore: {
        enabled: false
      }
    }
  }
}
