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

@description('Entra ID app registration client ID for Easy Auth. When set, all requests require Entra ID sign-in.')
param authClientId string = ''

var abbrs = loadJsonContent('abbreviations.json')
var resourceToken = toLower(uniqueString(subscription().id, environmentName, location))
var tags = { 'azd-env-name': environmentName }

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
    appServiceName: '${abbrs.webSitesAppService}${resourceToken}'
    planSku: planSku
    runtimeName: 'node'
    runtimeVersion: '24-lts'
    authClientId: authClientId
    appSettings: {
      NODE_ENV: 'production'
      USE_MANAGED_IDENTITY: 'true'
      SCM_DO_BUILD_DURING_DEPLOYMENT: 'true'
      // App Service fronts the app with its own HTTPS ingress; the app must
      // bind 0.0.0.0 inside the sandbox. This is the ONLY deployment path
      // where ALLOW_REMOTE_BIND is set by default — deliberate opt-in.
      HOST: '0.0.0.0'
      ALLOW_REMOTE_BIND: 'true'
    }
  }
}

output AZURE_LOCATION string = location
output SERVICE_WEB_NAME string = web.outputs.appServiceName
output SERVICE_WEB_URI string = web.outputs.uri
