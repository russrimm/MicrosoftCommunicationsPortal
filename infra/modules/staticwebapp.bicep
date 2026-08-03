@description('Location for the static web app. Static Web Apps is available in a limited set of regions; the content itself is served globally.')
@allowed([
  'westus2'
  'centralus'
  'eastus2'
  'westeurope'
  'eastasia'
])
param location string

@description('Tags for all resources')
param tags object = {}

@description('Static web app name')
param staticWebAppName string

@description('Resource ID of the App Service to link as the /api backend. Linking configures the App Service to accept only traffic proxied through this static web app.')
param backendResourceId string

@description('Region of the linked backend resource')
param backendRegion string

@description('Entra ID app registration client ID used by Static Web Apps managed authentication. Leave empty to fall back to the preconfigured identity providers.')
param authClientId string = ''

@description('Client secret for the Entra ID app registration. Required when authClientId is set. Supply it from a secret store or CI secret — never commit it.')
@secure()
param authClientSecret string = ''

var hasCustomAuth = !empty(authClientId) && !empty(authClientSecret)

resource staticWebApp 'Microsoft.Web/staticSites@2023-12-01' = {
  name: staticWebAppName
  location: location
  tags: union(tags, { 'azd-service-name': 'frontend' })
  // Standard is required for linked backends and custom authentication.
  sku: {
    name: 'Standard'
    tier: 'Standard'
  }
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    // Deployments are pushed from CI with a deployment token rather than the
    // built-in GitHub integration, so no repository details are configured.
    provider: 'Custom'
    allowConfigFileUpdates: true
    stagingEnvironmentPolicy: 'Enabled'
    enterpriseGradeCdnStatus: 'Disabled'
  }
}

// Names referenced by staticwebapp.config.json → auth.identityProviders.
resource appSettings 'Microsoft.Web/staticSites/config@2023-12-01' = if (hasCustomAuth) {
  parent: staticWebApp
  name: 'appsettings'
  properties: {
    AZURE_CLIENT_ID: authClientId
    AZURE_CLIENT_SECRET: authClientSecret
  }
}

// Proxies every /api/* request to the App Service and locks that App Service
// down to Static Web Apps traffic by adding the "Azure Static Web Apps (Linked)"
// identity provider to it.
// https://learn.microsoft.com/azure/static-web-apps/apis-app-service
resource linkedBackend 'Microsoft.Web/staticSites/linkedBackends@2023-12-01' = {
  parent: staticWebApp
  name: 'backend'
  properties: {
    backendResourceId: backendResourceId
    region: backendRegion
  }
}

output staticWebAppName string = staticWebApp.name
output uri string = 'https://${staticWebApp.properties.defaultHostname}'
output principalId string = staticWebApp.identity.principalId
