import { jest } from '@jest/globals';
import type { App, SettingDefinitionItem } from 'obsidian';
import type WhereDidTheTimeGoPlugin from '../main';
import { TimeTrackerSettingTab } from '../src/settings';
import { DEFAULT_SETTINGS } from '../src/types';
import { configureLanguage } from '../src/i18n';

function createTab() {
    const plugin = { settings: structuredClone(DEFAULT_SETTINGS), saveSettings: jest.fn<() => Promise<void>>().mockResolvedValue(undefined) };
    const tab = new TimeTrackerSettingTab({} as App, plugin as unknown as WhereDidTheTimeGoPlugin);
    return { tab, plugin };
}
function keys(items: SettingDefinitionItem[]): string[] {
    return items.flatMap(item => 'items' in item && item.items ? keys(item.items)
        : 'control' in item && item.control ? [item.control.key] : []);
}
afterEach(() => configureLanguage('en'));

describe('Personal tracking settings', () => {
    it('round-trips all exposed controls and keeps legacy billing data out of the UI', async () => {
        const { tab, plugin } = createTab();
        const controls = keys(tab.getSettingDefinitions());
        expect(controls).toContain('language');
        expect(controls).toContain('defaultActivity');
        for (const key of ['enableBilling', 'clients', 'invoiceFolder', 'billFrom.name']) expect(controls).not.toContain(key);
        for (const key of controls) await tab.setControlValue(key, tab.getControlValue(key));
        expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
    });
    it('normalizes empty folder, numeric hours and description limits', async () => {
        const { tab, plugin } = createTab();
        await tab.setControlValue('timeTrackingFolder', '');
        await tab.setControlValue('dayStartHour', '4');
        await tab.setControlValue('descriptionMaxLength', -5);
        expect(plugin.settings.timeTrackingFolder).toBe(DEFAULT_SETTINGS.timeTrackingFolder);
        expect(plugin.settings.dayStartHour).toBe(4);
        expect(plugin.settings.descriptionMaxLength).toBe(0);
        await tab.setControlValue('descriptionMaxLength', 120.7);
        expect(plugin.settings.descriptionMaxLength).toBe(120);
    });
    it('provides Russian labels', () => {
        configureLanguage('ru');
        const { tab } = createTab();
        expect(JSON.stringify(tab.getSettingDefinitions())).toContain('Активности и проекты');
        expect(JSON.stringify(tab.getSettingDefinitions())).not.toMatch(/Clients|Billing|Bill from/);
    });
});
