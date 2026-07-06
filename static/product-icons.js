/**
 * Product icon resolver.
 *
 * Maps a free-form product / service name (e.g. "Microsoft Teams",
 * "Power BI", "Azure Functions") to one of the SVG icons in /public/
 * using a small alias table plus token-based fuzzy matching.
 *
 * Usage (browser):
 *   const html = ProductIcons.productIconImg('Microsoft Teams');
 *   // → '<img class="product-icon" src="/public/teams.svg" ...>'
 *
 *   const file = ProductIcons.getProductIcon('Power BI');
 *   // → 'PowerBI_scalable.svg'
 */
(function () {
  'use strict';

  // Keep this list in sync with the actual files in /public/
  const ICON_FILES = [
    '10329-icon-service-Intune.svg',
    'Access.svg',
    'AIBuilder_scalable.svg',
    'API Management.svg',
    'App Service.svg',
    'Application Gateway.svg',
    'Azure AI Speech.svg',
    'Azure Arc.svg',
    'Azure Chaos Studio.svg',
    'Azure Container Apps.svg',
    'Azure Container Storage.svg',
    'Azure Data Explorer.svg',
    'Azure Database for MySQL.svg',
    'Azure Database Migration Service.svg',
    'Azure ExpressRoute.svg',
    'Azure Firewall.svg',
    'Azure Functions.svg',
    'Azure Monitor.svg',
    'Azure NetApp Files.svg',
    'Azure Red Hat OpenShift.svg',
    'Azure SignalR Service.svg',
    'azure-logo.svg',
    'Azure.svg',
    'Bookings.svg',
    'BusinessCentral_scalable.svg',
    'clipchamp.svg',
    'Commerce_scalable.svg',
    'ConnectedStore_scalable.svg',
    'ContactCenter_scalable.svg',
    'copilot.svg',
    'CopilotStudio_scalable.svg',
    'CoreHR_scalable.svg',
    'CustomerInsights_scalable.svg',
    'CustomerService_scalable.svg',
    'CustomerServiceInsights_scalable.svg',
    'CustomerVoice_scalable.svg',
    'databricks.svg',
    'Dataverse_scalable.svg',
    'defender.svg',
    'Dynamics365_scalable.svg',
    'edge.svg',
    'entra.svg',
    'Excel.svg',
    'exchange.svg',
    'fabric_48_color.svg',
    'FieldService_scalable.svg',
    'Finance_scalable.svg',
    'Finance+Operations_scalable.svg',
    'forms.svg',
    'FraudProtection_scalable.svg',
    'graph.svg',
    'IntelligentOrderManagement_scalable (1).svg',
    'intune.svg',
    'Load Balancers.svg',
    'Logic Apps.svg',
    'loop.svg',
    'm365.svg',
    'Marketing_scalable.svg',
    'MarketInsights_scalable.svg',
    'Microsoft Cost Management.svg',
    'onedrive.svg',
    'OneNote.svg',
    'Outlook.svg',
    'planner.svg',
    'PowerApps_scalable.svg',
    'PowerAutomate_scalable.svg',
    'PowerBI_scalable.svg',
    'PowerFx_scalable.svg',
    'PowerPages_scalable.svg',
    'PowerPlatform_scalable.svg',
    'PowerPoint.svg',
    'Product_Insights__scalable.svg',
    'Project.svg',
    'ProjectOperations_scalable.svg',
    'ProjectServiceAutomation_scalable.svg',
    'purview.svg',
    'Sales_scalable.svg',
    'SalesInsights_scalable.svg',
    'sharepoint.svg',
    'stream.svg',
    'SupplyChainManagement_scalable.svg',
    'SustainabilityCalculator_scalable.svg',
    'Talent_scalable.svg',
    'TalentAttract_scalable.svg',
    'TalentOnboard_scalable.svg',
    'teams.svg',
    'todo.svg',
    'Virtual Network.svg',
    'Visio.svg',
    'Visual Studio.svg',
    'viva.svg',
    'vscode.svg',
    'Windows.svg',
    'Word.svg',
  ];

  // Curated aliases. Keys are normalized (lowercase, alphanumeric+spaces).
  // These win over fuzzy matching and disambiguate names that the
  // file-name based scoring can't handle on its own (e.g. "Power BI" vs.
  // the single-token "PowerBI" filename).
  const ALIASES = {
    // Power Platform
    'power apps':                     'PowerApps_scalable.svg',
    'powerapps':                      'PowerApps_scalable.svg',
    'power automate':                 'PowerAutomate_scalable.svg',
    'power automate desktop':         'PowerAutomate_scalable.svg',
    'power automate for desktop':     'PowerAutomate_scalable.svg',
    'powerautomate':                  'PowerAutomate_scalable.svg',
    'power bi':                       'PowerBI_scalable.svg',
    'powerbi':                        'PowerBI_scalable.svg',
    'power bi service':               'PowerBI_scalable.svg',
    'power bi pro':                   'PowerBI_scalable.svg',
    'power bi premium':               'PowerBI_scalable.svg',
    'power pages':                    'PowerPages_scalable.svg',
    'powerpages':                     'PowerPages_scalable.svg',
    'power fx':                       'PowerFx_scalable.svg',
    'powerfx':                        'PowerFx_scalable.svg',
    'power platform':                 'PowerPlatform_scalable.svg',
    'microsoft power platform':       'PowerPlatform_scalable.svg',
    'copilot studio':                 'CopilotStudio_scalable.svg',
    'microsoft copilot studio':       'CopilotStudio_scalable.svg',
    'ai builder':                     'AIBuilder_scalable.svg',
    'microsoft dataverse':            'Dataverse_scalable.svg',
    'dataverse':                      'Dataverse_scalable.svg',
    'dataverse for teams':            'Dataverse_scalable.svg',

    // Dynamics 365
    'dynamics 365':                              'Dynamics365_scalable.svg',
    'microsoft dynamics 365':                    'Dynamics365_scalable.svg',
    'business central':                          'BusinessCentral_scalable.svg',
    'dynamics 365 business central':             'BusinessCentral_scalable.svg',
    'dynamics 365 sales':                        'Sales_scalable.svg',
    'sales':                                     'Sales_scalable.svg',
    'sales insights':                            'SalesInsights_scalable.svg',
    'dynamics 365 sales insights':               'SalesInsights_scalable.svg',
    'customer service':                          'CustomerService_scalable.svg',
    'dynamics 365 customer service':             'CustomerService_scalable.svg',
    'customer service insights':                 'CustomerServiceInsights_scalable.svg',
    'dynamics 365 customer service insights':    'CustomerServiceInsights_scalable.svg',
    'customer insights':                         'CustomerInsights_scalable.svg',
    'dynamics 365 customer insights':            'CustomerInsights_scalable.svg',
    'customer insights data':                    'CustomerInsights_scalable.svg',
    'customer insights journeys':                'CustomerInsights_scalable.svg',
    'customer voice':                            'CustomerVoice_scalable.svg',
    'dynamics 365 customer voice':               'CustomerVoice_scalable.svg',
    'field service':                             'FieldService_scalable.svg',
    'dynamics 365 field service':                'FieldService_scalable.svg',
    'finance':                                   'Finance_scalable.svg',
    'dynamics 365 finance':                      'Finance_scalable.svg',
    'finance and operations':                    'Finance+Operations_scalable.svg',
    'finance + operations':                      'Finance+Operations_scalable.svg',
    'dynamics 365 finance and operations':       'Finance+Operations_scalable.svg',
    'marketing':                                 'Marketing_scalable.svg',
    'dynamics 365 marketing':                    'Marketing_scalable.svg',
    'market insights':                           'MarketInsights_scalable.svg',
    'supply chain management':                   'SupplyChainManagement_scalable.svg',
    'dynamics 365 supply chain management':      'SupplyChainManagement_scalable.svg',
    'project operations':                        'ProjectOperations_scalable.svg',
    'dynamics 365 project operations':           'ProjectOperations_scalable.svg',
    'project service automation':                'ProjectServiceAutomation_scalable.svg',
    'fraud protection':                          'FraudProtection_scalable.svg',
    'dynamics 365 fraud protection':             'FraudProtection_scalable.svg',
    'commerce':                                  'Commerce_scalable.svg',
    'dynamics 365 commerce':                     'Commerce_scalable.svg',
    'intelligent order management':              'IntelligentOrderManagement_scalable (1).svg',
    'dynamics 365 intelligent order management': 'IntelligentOrderManagement_scalable (1).svg',
    'contact center':                            'ContactCenter_scalable.svg',
    'dynamics 365 contact center':               'ContactCenter_scalable.svg',
    'connected store':                           'ConnectedStore_scalable.svg',
    'dynamics 365 connected store':              'ConnectedStore_scalable.svg',
    'core hr':                                   'CoreHR_scalable.svg',
    'talent':                                    'Talent_scalable.svg',
    'talent attract':                            'TalentAttract_scalable.svg',
    'talent onboard':                            'TalentOnboard_scalable.svg',
    'sustainability calculator':                 'SustainabilityCalculator_scalable.svg',
    'product insights':                          'Product_Insights__scalable.svg',

    // Microsoft 365 / Office apps
    'microsoft 365':                  'm365.svg',
    'microsoft 365 apps':             'm365.svg',
    'microsoft 365 suite':            'm365.svg',
    'office 365':                     'm365.svg',
    'office for the web':             'm365.svg',
    'microsoft teams':                'teams.svg',
    'teams':                          'teams.svg',
    'microsoft teams premium':        'teams.svg',
    'microsoft teams rooms':          'teams.svg',
    'sharepoint online':              'sharepoint.svg',
    'sharepoint':                     'sharepoint.svg',
    'sharepoint server':              'sharepoint.svg',
    'onedrive':                       'onedrive.svg',
    'onedrive for business':          'onedrive.svg',
    'outlook':                        'Outlook.svg',
    'outlook mobile':                 'Outlook.svg',
    'outlook on the web':             'Outlook.svg',
    'microsoft outlook':              'Outlook.svg',
    'exchange online':                'exchange.svg',
    'exchange':                       'exchange.svg',
    'microsoft excel':                'Excel.svg',
    'excel':                          'Excel.svg',
    'microsoft word':                 'Word.svg',
    'word':                           'Word.svg',
    'microsoft powerpoint':           'PowerPoint.svg',
    'powerpoint':                     'PowerPoint.svg',
    'microsoft onenote':              'OneNote.svg',
    'onenote':                        'OneNote.svg',
    'microsoft loop':                 'loop.svg',
    'loop':                           'loop.svg',
    'microsoft planner':              'planner.svg',
    'planner':                        'planner.svg',
    'microsoft to do':                'todo.svg',
    'to do':                          'todo.svg',
    'microsoft todo':                 'todo.svg',
    'microsoft forms':                'forms.svg',
    'forms':                          'forms.svg',
    'microsoft visio':                'Visio.svg',
    'visio':                          'Visio.svg',
    'microsoft project':              'Project.svg',
    'project':                        'Project.svg',
    'project for the web':            'Project.svg',
    'project online':                 'Project.svg',
    'microsoft access':               'Access.svg',
    'microsoft stream':               'stream.svg',
    'stream':                         'stream.svg',
    'microsoft bookings':             'Bookings.svg',
    'bookings':                       'Bookings.svg',
    'clipchamp':                      'clipchamp.svg',
    'microsoft clipchamp':            'clipchamp.svg',
    'microsoft viva':                 'viva.svg',
    'viva':                           'viva.svg',
    'viva engage':                    'viva.svg',
    'viva connections':               'viva.svg',
    'viva learning':                  'viva.svg',
    'viva insights':                  'viva.svg',
    'viva goals':                     'viva.svg',
    'viva pulse':                     'viva.svg',
    'viva amplify':                   'viva.svg',
    'viva topics':                    'viva.svg',
    'yammer':                         'viva.svg',
    'microsoft copilot':              'copilot.svg',
    'copilot':                        'copilot.svg',
    'microsoft 365 copilot':          'copilot.svg',
    'copilot for microsoft 365':      'copilot.svg',
    'microsoft graph':                'graph.svg',
    'graph':                          'graph.svg',
    'microsoft purview':              'purview.svg',
    'purview':                        'purview.svg',
    'microsoft defender':             'defender.svg',
    'defender':                       'defender.svg',
    'defender for cloud':             'defender.svg',
    'defender for endpoint':          'defender.svg',
    'defender for office 365':        'defender.svg',
    'defender xdr':                   'defender.svg',
    'microsoft entra':                'entra.svg',
    'entra':                          'entra.svg',
    'entra id':                       'entra.svg',
    'azure ad':                       'entra.svg',
    'azure active directory':         'entra.svg',
    'microsoft intune':               'intune.svg',
    'intune':                         'intune.svg',
    'microsoft edge':                 'edge.svg',
    'edge':                           'edge.svg',
    'edge for business':              'edge.svg',
    'visual studio':                  'Visual Studio.svg',
    'visual studio code':             'vscode.svg',
    'vs code':                        'vscode.svg',
    'windows':                        'Windows.svg',
    'windows 11':                     'Windows.svg',
    'windows 10':                     'Windows.svg',
    'windows 365':                    'Windows.svg',

    // Azure
    'azure':                                'Azure.svg',
    'microsoft azure':                      'Azure.svg',
    'azure portal':                         'Azure.svg',
    'azure functions':                      'Azure Functions.svg',
    'azure app service':                    'App Service.svg',
    'app service':                          'App Service.svg',
    'app services':                         'App Service.svg',
    'api management':                       'API Management.svg',
    'azure api management':                 'API Management.svg',
    'azure monitor':                        'Azure Monitor.svg',
    'log analytics':                        'Azure Monitor.svg',
    'application insights':                 'Azure Monitor.svg',
    'azure firewall':                       'Azure Firewall.svg',
    'azure arc':                            'Azure Arc.svg',
    'azure chaos studio':                   'Azure Chaos Studio.svg',
    'azure container apps':                 'Azure Container Apps.svg',
    'container apps':                       'Azure Container Apps.svg',
    'azure container storage':              'Azure Container Storage.svg',
    'azure data explorer':                  'Azure Data Explorer.svg',
    'data explorer':                        'Azure Data Explorer.svg',
    'azure database for mysql':             'Azure Database for MySQL.svg',
    'azure database migration service':     'Azure Database Migration Service.svg',
    'database migration service':           'Azure Database Migration Service.svg',
    'azure expressroute':                   'Azure ExpressRoute.svg',
    'expressroute':                         'Azure ExpressRoute.svg',
    'azure netapp files':                   'Azure NetApp Files.svg',
    'azure red hat openshift':              'Azure Red Hat OpenShift.svg',
    'aro':                                  'Azure Red Hat OpenShift.svg',
    'azure signalr service':                'Azure SignalR Service.svg',
    'signalr':                              'Azure SignalR Service.svg',
    'azure ai speech':                      'Azure AI Speech.svg',
    'speech service':                       'Azure AI Speech.svg',
    'logic apps':                           'Logic Apps.svg',
    'azure logic apps':                     'Logic Apps.svg',
    'load balancer':                        'Load Balancers.svg',
    'load balancers':                       'Load Balancers.svg',
    'azure load balancer':                  'Load Balancers.svg',
    'virtual network':                      'Virtual Network.svg',
    'azure virtual network':                'Virtual Network.svg',
    'vnet':                                 'Virtual Network.svg',
    'application gateway':                  'Application Gateway.svg',
    'azure application gateway':            'Application Gateway.svg',
    'microsoft cost management':            'Microsoft Cost Management.svg',
    'cost management':                      'Microsoft Cost Management.svg',
    'cost management billing':              'Microsoft Cost Management.svg',

    // Data & analytics
    'microsoft fabric':               'fabric_48_color.svg',
    'fabric':                         'fabric_48_color.svg',
    'azure databricks':               'databricks.svg',
    'databricks':                     'databricks.svg',
  };

  // Normalize a name to "lowercase tokens joined by single spaces",
  // stripping the _scalable suffix and other filename noise.
  function normalize(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .replace(/_scalable.*$/i, '')
      .replace(/\(\d+\)/g, '')
      .replace(/\.svg$/i, '')
      .replace(/[+]/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  // Build the normalized → filename lookup once at module load.
  const NORMALIZED_INDEX = (() => {
    const map = new Map();
    for (const f of ICON_FILES) {
      const n = normalize(f);
      if (n && !map.has(n)) map.set(n, f);
    }
    return map;
  })();

  function tokens(s) {
    const n = normalize(s);
    return n ? n.split(' ') : [];
  }

  // Hybrid Jaccard / coverage score in [0, 1].
  function score(queryTokens, iconTokens) {
    if (!queryTokens.length || !iconTokens.length) return 0;
    const qs = new Set(queryTokens);
    const is = new Set(iconTokens);
    let common = 0;
    for (const t of qs) if (is.has(t)) common++;
    if (!common) return 0;
    const union = new Set([...qs, ...is]).size;
    const jaccard = common / union;
    const coverage = common / is.size; // how much of the icon name is in the query
    return jaccard * 0.55 + coverage * 0.45;
  }

  const cache = new Map();

  function getProductIcon(name) {
    if (!name) return null;
    const rawKey = String(name).toLowerCase().trim();
    if (!rawKey) return null;
    if (cache.has(rawKey)) return cache.get(rawKey);

    const norm = normalize(rawKey);
    if (!norm) { cache.set(rawKey, null); return null; }

    // 1. Alias hit (try both raw lowercase and normalized).
    if (ALIASES[rawKey]) { cache.set(rawKey, ALIASES[rawKey]); return ALIASES[rawKey]; }
    if (ALIASES[norm])   { cache.set(rawKey, ALIASES[norm]);   return ALIASES[norm]; }

    // 2. Exact normalized filename match.
    if (NORMALIZED_INDEX.has(norm)) {
      const f = NORMALIZED_INDEX.get(norm);
      cache.set(rawKey, f);
      return f;
    }

    // 3. Token-based fuzzy across both filenames and alias keys.
    const qTokens = tokens(rawKey);
    let best = null;
    let bestScore = 0;

    for (const [iName, file] of NORMALIZED_INDEX) {
      const s = score(qTokens, iName.split(' '));
      if (s > bestScore) { bestScore = s; best = file; }
    }
    for (const aName of Object.keys(ALIASES)) {
      const s = score(qTokens, aName.split(' '));
      if (s > bestScore) { bestScore = s; best = ALIASES[aName]; }
    }

    // Require a reasonable match so we don't slap random icons on unknown products.
    const result = bestScore >= 0.5 ? best : null;
    cache.set(rawKey, result);
    return result;
  }

  function escapeAttr(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function productIconImg(name, opts) {
    const file = getProductIcon(name);
    if (!file) return '';
    const className = (opts && opts.className) || 'product-icon';
    const src = '/public/' + encodeURIComponent(file);
    const title = escapeAttr(name);
    return '<img class="' + className + '" data-product-icon="1" src="' + src + '" alt="" aria-hidden="true" loading="lazy" title="' + title + '">';
  }

  // Remove broken icon images. Delegated capture-phase listener instead of an
  // inline onerror="" attribute, which CSP (script-src without 'unsafe-inline'
  // or 'unsafe-hashes') blocks from executing.
  document.addEventListener('error', function (ev) {
    const t = ev.target;
    if (t && t.tagName === 'IMG' && t.getAttribute('data-product-icon') === '1') t.remove();
  }, true);

  window.ProductIcons = { getProductIcon, productIconImg };
})();
