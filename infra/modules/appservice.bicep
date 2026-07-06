@description('Location for all resources')
param location string

@description('Tags for all resources')
param tags object = {}

@description('App Service Plan name')
param appServicePlanName string

@description('App Service name')
param appServiceName string

@description('App Service Plan SKU')
param planSku string = 'B1'

@description('Node.js runtime name')
param runtimeName string = 'node'

@description('Node.js runtime version')
param runtimeVersion string = '24-lts'

@description('App settings key-value pairs')
param appSettings object = {}

@description('Entra ID (AAD) client ID for Easy Auth. Leave empty to skip auth configuration.')
param authClientId string = ''

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
      appSettings: [for key in objectKeys(appSettings): {
        name: key
        value: appSettings[key]
      }]
    }
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
        enabled: true
      }
    }
  }
}
