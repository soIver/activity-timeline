import { jest } from '@jest/globals';
import { JSDOM } from 'jsdom';
import { App } from 'obsidian';
import { ColorPalette, hsvToHex, rgbToHsv } from '../src/components/ColorPalette';
import { ActivityModal, ActivityManagerModal } from '../src/modals/ActivityModal';
import { NotePathSuggest } from '../src/components/NotePathSuggest';
import { EntryModal } from '../src/modals/EntryModal';
import { DataManager } from '../src/data/DataManager';
import { DEFAULT_SETTINGS } from '../src/types';
import { configureLanguage } from '../src/i18n';
import { installElementHelpers, installObsidianDomHelpers } from './__mocks__/obsidianDom';

function setup() {
    const dom = new JSDOM();
    installObsidianDomHelpers(dom.window.Node.prototype);
    installElementHelpers(dom.window.HTMLElement.prototype);
    return { dom, doc: dom.window.document, settings: structuredClone(DEFAULT_SETTINGS) };
}
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
afterEach(() => configureLanguage('en'));

describe('Embedded color palette', () => {
    it.each(['#708a9b', '#ffffff', '#000000', '#ff0000', '#00ff00', '#0000ff', '#8f72c5'])(
        'restores %s and round-trips RGB without changing color', color => {
            const { doc } = setup();
            const change = jest.fn();
            const palette = new ColorPalette(doc.body, color, change);
            expect(palette.value).toBe(color);
            expect(doc.querySelector<HTMLInputElement>('input[type=text]')!.value).toBe(color);
            expect(hsvToHex(...rgbToHsv(color))).toBe(color);
            expect(change).not.toHaveBeenCalled();
        });
    it('synchronizes HEX, RGB, palette position, and keyboard selection', () => {
        const { doc, dom } = setup();
        const change = jest.fn();
        new ColorPalette(doc.body, '#708a9b', change);
        const hex = doc.querySelector<HTMLInputElement>('input[type=text]')!;
        hex.value = '#ff0000'; hex.dispatchEvent(new dom.window.Event('input'));
        const rgb = Array.from(doc.querySelectorAll<HTMLInputElement>('input[type=number]'));
        expect(rgb.map(input => input.value)).toEqual(['255', '0', '0']);
        rgb[1].value = '255'; rgb[1].dispatchEvent(new dom.window.Event('input'));
        expect(hex.value).toBe('#ffff00');
        doc.querySelector('.at-color-field')!.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown' }));
        expect(hex.value).toBe('#fcfc00');
        hex.value = 'bad'; hex.dispatchEvent(new dom.window.Event('input'));
        expect(hex.getAttribute('aria-invalid')).toBe('true');
        hex.dispatchEvent(new dom.window.Event('blur'));
        expect(hex.value).toBe('#fcfc00');
    });
});

describe('Activity editor persistence', () => {
    it('creates a named activity with the selected color after saving', async () => {
        const { doc, dom, settings } = setup();
        const save = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
        const done = jest.fn();
        const modal = new ActivityModal({} as App, settings, save, undefined, done);
        modal.contentEl = doc.body;
        modal.onOpen();
        const name = doc.querySelector<HTMLInputElement>('.at-category-name')!;
        expect(modal.titleEl.textContent).toBe('New activity');
        expect(modal.modalEl.classList.contains('at-modal')).toBe(true);
        expect(modal.contentEl.querySelector('h2')).toBeNull();
        expect(name.placeholder).toBe('Name');
        expect(name.getAttribute('aria-label')).toBe('Name');
        expect(doc.querySelector('.setting-item')).toBeNull();
        name.value = 'Чтение'; name.dispatchEvent(new dom.window.Event('input'));
        const hex = doc.querySelector<HTMLInputElement>('.at-color-values input[type=text]')!;
        hex.value = '#8f72c5'; hex.dispatchEvent(new dom.window.Event('input'));
        doc.querySelector<HTMLButtonElement>('button.mod-cta')!.click();
        await flush();
        expect(save).toHaveBeenCalledTimes(1);
        expect(settings.activities).toEqual([expect.objectContaining({ name: 'Чтение', color: '#8f72c5' })]);
        expect(done).toHaveBeenCalledWith(settings.activities[0]);
    });
    it('preserves the ID, previous name, and initial color on rename', async () => {
        const { doc, dom, settings } = setup();
        settings.activities = [{ id: 'read', name: 'Read', color: '#8f72c5', clientId: 'personal' }];
        const modal = new ActivityModal({} as App, settings, async () => {}, settings.activities[0]);
        modal.contentEl = doc.body; modal.onOpen();
        expect(doc.querySelector<HTMLInputElement>('.at-color-values input[type=text]')!.value).toBe('#8f72c5');
        const input = doc.querySelector<HTMLInputElement>('.at-category-name')!;
        input.value = 'Чтение'; input.dispatchEvent(new dom.window.Event('input'));
        doc.querySelector<HTMLButtonElement>('button.mod-cta')!.click(); await flush();
        expect(settings.activities[0]).toEqual(expect.objectContaining({ id: 'read', name: 'Чтение', aliases: ['Read'], color: '#8f72c5' }));
    });
    it('rolls back when settings cannot be saved', async () => {
        const { doc, dom, settings } = setup();
        const done = jest.fn();
        const modal = new ActivityModal({} as App, settings, async () => { throw new Error('Disk full'); }, undefined, done);
        modal.contentEl = doc.body; modal.onOpen();
        const input = doc.querySelector<HTMLInputElement>('.at-category-name')!;
        input.value = 'Read'; input.dispatchEvent(new dom.window.Event('input'));
        doc.querySelector<HTMLButtonElement>('button.mod-cta')!.click(); await flush();
        expect(settings.activities).toEqual([]);
        expect(done).not.toHaveBeenCalled();
        expect(doc.querySelector<HTMLButtonElement>('button.mod-cta')!.disabled).toBe(false);
    });
    it('rejects empty and duplicate names without saving', async () => {
        const { doc, dom, settings } = setup();
        settings.activities = [{ id: 'read', name: 'Read', color: '#8f72c5', clientId: 'personal' }];
        const save = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
        const modal = new ActivityModal({} as App, settings, save);
        modal.contentEl = doc.body; modal.onOpen();
        doc.querySelector<HTMLButtonElement>('button.mod-cta')!.click(); await flush();
        const input = doc.querySelector<HTMLInputElement>('.at-category-name')!;
        input.value = ' read '; input.dispatchEvent(new dom.window.Event('input'));
        doc.querySelector<HTMLButtonElement>('button.mod-cta')!.click(); await flush();
        expect(save).not.toHaveBeenCalled(); expect(settings.activities).toHaveLength(1);
    });
});

describe('Entry form and timeline actions', () => {
    it('shows shared activities and projects with Russian UI and no client selector', async () => {
        const { dom, doc, settings } = setup();
        configureLanguage('ru');
        settings.activities = [{ id: 'read', name: 'Чтение', clientId: 'old-client', color: '#8f72c5' }];
        settings.projects.push({ id: 'study', name: 'Учёба', clientId: 'another-client', color: '#708a9b', archived: false });
        const manager = { findOverlaps: async (): ReturnType<DataManager['findOverlaps']> => ({ startOverlap: null, endOverlap: null, encompassedEntry: null }),
            findAdjacentEntries: async (): ReturnType<DataManager['findAdjacentEntries']> => ({ previous: null, next: null }) } as unknown as DataManager;
        const suggestClose = jest.spyOn(NotePathSuggest.prototype, 'close');
        const modal = new EntryModal({} as App, settings, manager,
            { mode: 'create', date: new Date(2026, 10, 9), startTime: '09:00', endTime: '10:00' }, () => {});
        modal.contentEl = doc.body; modal.onOpen(); await flush();
        expect(modal.titleEl.textContent).toBe('Новая запись времени');
        expect(doc.body.textContent).toContain('Управление активностями');
        expect(doc.body.textContent).toContain('Управление проектами');
        expect(doc.body.textContent).not.toContain('Продолжительность');
        expect(doc.querySelectorAll('.at-category-setting')).toHaveLength(2);
        expect(doc.body.textContent).not.toMatch(/Добавить активность|Новая активность/);
        expect(doc.body.textContent).not.toMatch(/Client|Клиент|Personal/);
        expect(doc.querySelectorAll('select')).toHaveLength(0);
        expect(doc.querySelector<HTMLInputElement>('[placeholder="Название проекта"]')).not.toBeNull();
        expect(doc.querySelector<HTMLInputElement>('[placeholder="Название активности"]')).not.toBeNull();
        expect(doc.querySelector<HTMLInputElement>('[placeholder="Путь к заметке"]')).not.toBeNull();
        modal.onClose();
        expect(suggestClose).toHaveBeenCalledTimes(1);
        suggestClose.mockRestore();
        dom.window.close();
    });
    it('opens project management and refreshes renamed projects without clearing the entry', async () => {
        const { doc, dom, settings } = setup();
        settings.projects = [{ id: 'study', name: 'Study', color: '#708a9b', archived: false }];
        settings.defaultProject = 'study';
        const saveSettings = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
        const manager = {
            findOverlaps: async (): ReturnType<DataManager['findOverlaps']> => ({ startOverlap: null, endOverlap: null, encompassedEntry: null }),
            findAdjacentEntries: async (): ReturnType<DataManager['findAdjacentEntries']> => ({ previous: null, next: null }),
        } as unknown as DataManager;
        const modal = new EntryModal({} as App, settings, manager,
            { mode: 'create', date: new Date(2026, 10, 9), startTime: '09:00', endTime: '10:00' }, () => {}, saveSettings);
        modal.contentEl = doc.body; modal.onOpen(); await flush();
        const description = doc.querySelector<HTMLTextAreaElement>('textarea')!;
        description.value = 'Draft entry'; description.dispatchEvent(new dom.window.Event('input'));
        let projects: ActivityManagerModal | undefined;
        const open = jest.spyOn(ActivityManagerModal.prototype, 'open').mockImplementation(function (this: ActivityManagerModal) {
            projects = this;
        });
        try {
            const row = doc.querySelector('.at-category-setting')!;
            expect(row.querySelector('button')!.textContent).toBe('Manage projects');
            row.querySelector('button')!.click();
            expect(projects).toBeDefined();
            expect(projects!['kind']).toBe('project');
            settings.projects[0] = { ...settings.projects[0], name: 'Учёба', aliases: ['Study'] };
            projects!['onChange']();
            expect(row.querySelector('input')!.value).toBe('Учёба');
            expect(description.value).toBe('Draft entry');
            expect(modal['descriptionValue']).toBe('Draft entry');
        } finally {
            open.mockRestore(); modal.onClose();
        }
    });
});
