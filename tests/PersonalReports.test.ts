import { JSDOM } from 'jsdom';
import { WorkspaceLeaf } from 'obsidian';
import { DataManager } from '../src/data/DataManager';
import { ReportsView } from '../src/views/ReportsView';
import { DEFAULT_SETTINGS, TimeEntry } from '../src/types';
import { configureLanguage } from '../src/i18n';
import { installObsidianDomHelpers, installElementHelpers } from './__mocks__/obsidianDom';

const entry = (client: string, activity: string, start: number): TimeEntry => ({
    date: '2026-11-09', start: `${start}:00`, end: `${start + 1}:00`, durationMinutes: 60, lineNumber: start,
    client, activity, project: 'default', description: 'Focus',
    startDateTime: new Date(2026, 10, 9, start), endDateTime: new Date(2026, 10, 9, start + 1),
});

function setup() {
    const dom = new JSDOM();
    installObsidianDomHelpers(dom.window.Node.prototype);
    installElementHelpers(dom.window.HTMLElement.prototype);
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.activities = [{ id: 'reading', name: 'Чтение', aliases: ['Read'], clientId: 'personal', color: '#708a9b' }];
    const manager = new DataManager({} as never, settings);
    const view = new ReportsView({} as WorkspaceLeaf, settings, manager);
    view['reportsContainer'] = dom.window.document.createElement('div');
    view['activityContainer'] = dom.window.document.createElement('div');
    return { view, settings };
}
afterEach(() => configureLanguage('en'));

describe('Personal reports', () => {
    it('combines entries across legacy clients and resolves renamed activities', () => {
        const { view } = setup();
        const entries = [entry('old-client', 'Read', 9), entry('personal', 'reading', 10)];
        const start = new Date(2026, 10, 9), end = new Date(2026, 10, 10);
        view['calculateReports'](entries, start, end);
        view['calculateActivityReports'](entries, start, end);
        expect(view['totalMinutes']).toBe(120);
        expect(view['projectReports']).toHaveLength(1);
        expect(view['activityReports']).toEqual([expect.objectContaining({ name: 'Чтение', totalMinutes: 120, percentage: 100 })]);
        view['renderTables']();
        expect(view['reportsContainer'].textContent).not.toMatch(/Client|Billable|Invoice/);
        expect(view['activityContainer'].textContent).toContain('Чтение');
        expect(view['reportsContainer'].querySelector('button')?.getAttribute('aria-expanded')).toBe('false');
        view['reportsContainer'].querySelector('button')!.click();
        expect(view['reportsContainer'].textContent).toContain('Чтение');
    });
    it('clips overnight entries to the selected range', () => {
        const { view } = setup();
        const overnight = { ...entry('personal', 'reading', 9), startDateTime: new Date(2026, 10, 8, 23), endDateTime: new Date(2026, 10, 9, 2) };
        view['calculateReports']([overnight], new Date(2026, 10, 9), new Date(2026, 10, 10));
        expect(view['totalMinutes']).toBe(120);
    });
    it('omits clients and billing from exports and exports current category names', () => {
        const { view } = setup();
        const entries = [entry('old-client', 'Read', 9)];
        const csv = view['generateCSV'](entries);
        const json = JSON.parse(view['generateJSON'](entries, new Date(2026, 10, 9), new Date(2026, 10, 10)));
        expect(csv).not.toMatch(/Client|old-client/);
        expect(csv).toContain('Чтение');
        expect(json.entries[0]).not.toHaveProperty('client');
        expect(json.entries[0].activity).toBe('Чтение');
    });
});
