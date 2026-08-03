targetScope = 'subscription'

@minLength(1)
@maxLength(64)
@description('Name of the environment (used to generate resource names)')
param environmentName string

@minLength(1)
@description('Primary location for all resources')
param location string

@description('App Service Plan SKU')
param planSku string = 'B1'

@description('Optional Entra ID app registration client ID for Easy Auth. When omitted, public feeds remain available while tenant and AI APIs fail closed in the application.')
param authClientId string = ''

@description('Deploy an Azure Static Web App in front of the App Service ("true"/"false"). The static web app serves the pages and proxies /api/* to the App Service, which is then reachable only through it.')
@allowed([
  'true'
  'false'
])
param deployStaticWebApp string = 'false'

@description('Region for the static web app. Static Web Apps is only available in a subset of regions; content is served globally regardless.')
@allowed([
  'westus2'
  'centralus'
  'eastus2'
  'westeurope'
  'eastasia'
])
param staticWebAppLocation string = 'eastus2'

@description('Client secret for authClientId, used by Static Web Apps managed authentication. Supply it at deploy time from a secret store — never commit it.')
@secure()
param authClientSecret string = ''

var abbrs = loadJsonContent('abbreviations.json')
var resourceToken = toLower(uniqueString(subscription().id, environmentName, location))
var tags = { 'azd-env-name': environmentName }
var appServiceName = '${abbrs.webSitesAppService}${resourceToken}'
var staticWebAppName = '${abbrs.webStaticSites}${resourceToken}'
var useStaticWebApp = toLower(deployStaticWebApp) == 'true'
// Behind a static web app the App Service must not own its own Easy Auth
// configuration: linking adds an "Azure Static Web Apps (Linked)" identity
// provider to the same authsettingsV2 resource, and redeploying our own copy
// would strip it and break the link.
var appServiceAuthClientId = useStaticWebApp ? '' : authClientId
var readerRoleDefinitionId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  'acdd72a7-3385-48ef-bd42-f606fba81ae7'
)

resource rg 'Microsoft.Resources/resourceGroups@2022-09-01' = {
  name: '${abbrs.resourcesResourceGroups}${environmentName}'
  location: location
  tags: tags
}

module web 'modules/appservice.bicep' = {
  name: 'web'
  scope: rg
  params: {
    location: location
    tags: tags
    appServicePlanName: '${abbrs.webServerFarms}${resourceToken}'
    appServiceName: appServiceName
    logAnalyticsName: 'log-${resourceToken}'
    appInsightsName: 'appi-${resourceToken}'
    planSku: planSku
    runtimeName: 'node'
    runtimeVersion: '24-lts'
    authClientId: appServiceAuthClientId
    appSettings: {
      NODE_ENV: 'production'
      USE_MANAGED_IDENTITY: 'true'
      AZURE_SUBSCRIPTION_ID: subscription().subscriptionId
      SCM_DO_BUILD_DURING_DEPLOYMENT: 'true'
      // App Service fronts the app with its own HTTPS ingress; the app must
      // bind 0.0.0.0 inside the sandbox. This is the ONLY deployment path
      // where ALLOW_REMOTE_BIND is set by default — deliberate opt-in.
      HOST: '0.0.0.0'
      ALLOW_REMOTE_BIND: 'true'
      // App Service is a reverse proxy — enable proxy-header trust so the
      // rate limiter sees real client IPs instead of the single proxy IP.
      TRUST_PROXY: 'true'
      // Behind a static web app the caller is described by the Static Web Apps
      // client principal, which is a different shape from an Easy Auth one.
      AUTH_MODE: useStaticWebApp ? 'swa' : 'easyauth'
    }
  }
}

module staticWebApp 'modules/staticwebapp.bicep' = if (useStaticWebApp) {
  name: 'frontend'
  scope: rg
  params: {
    location: staticWebAppLocation
    tags: tags
    staticWebAppName: staticWebAppName
    backendResourceId: web.outputs.appServiceId
    backendRegion: location
    authClientId: authClientId
    authClientSecret: authClientSecret
  }
}

// Resource Health is an ARM management-plane API. The managed identity needs
// subscription read access in addition to its Microsoft Graph permissions.
resource resourceHealthReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(subscription().id, appServiceName, readerRoleDefinitionId)
  properties: {
    principalId: web.outputs.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: readerRoleDefinitionId
  }
}

output AZURE_LOCATION string = location
output SERVICE_WEB_NAME string = web.outputs.appServiceName
output SERVICE_WEB_URI string = web.outputs.uri
output SERVICE_FRONTEND_NAME string = useStaticWebApp ? staticWebApp!.outputs.staticWebAppName : ''
output SERVICE_FRONTEND_URI string = useStaticWebApp ? staticWebApp!.outputs.uri : ''
