const enhancementBacklog = require('../src/services/enhancementBacklog');
const connectorRegistry = require('../src/services/connectorRegistry');
const workSignalAdapterService = require('../src/services/workSignalAdapterService');

describe('enhancement backlog connector coverage', () => {
  test('derives ENH-001 adapter and catalog counts from the live connector services', () => {
    const catalogCount = connectorRegistry.getConnectors().length;
    const adapterCount = workSignalAdapterService.listAdapters()
      .filter(adapter => adapter.capabilities?.credentialBackedSync)
      .length;
    const enhancement = enhancementBacklog.getEnhancement('ENH-001');

    expect(enhancement.evidence).toContain(`${adapterCount} read-only credential-backed adapters`);
    expect(enhancement.evidence).toContain(`${catalogCount} catalog tools`);
    expect(enhancement.evidence).not.toContain('111 read-only credential-backed adapters');
  });
});
