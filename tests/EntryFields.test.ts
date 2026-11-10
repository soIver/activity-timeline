import { jest } from '@jest/globals';
import { JSDOM } from 'jsdom';
import { App, TFile } from 'obsidian';
import { CategorySuggest } from '../src/components/CategorySuggest';
import { DataManager } from '../src/data/DataManager';
import { EntryModal, EntryModalData } from '../src/modals/EntryModal';
import { DEFAULT_SETTINGS } from '../src/types';
import { configureLanguage } from '../src/i18n';
import { installElementHelpers, installObsidianDomHelpers } from './__mocks__/obsidianDom';

function setup(data: Partial<EntryModalData> = {}) {
    const dom = new JSDOM();
    installObsidianDomHelpers(dom.window.Node.prototype);
    installElementHelpers(dom.window.HTMLElement.prototype);
    configureLanguage('ru');
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.dayStartHour = 12;
    settings.projects = [{ id: 'study', name: 'Учёба', aliases: ['Старый проект'], color: '#708a9b', archived: false }];
    settings.activities = [{ id: 'read', name: 'Чтение', color: '#708a9b' }];
    const note = Object.assign(new TFile(), { path: 'Заметки/Книга.md' });
    const app = { vault: { getMarkdownFiles: () => [note], getAbstractFileByPath: (path: string) => path === note.path ? note : null } } as unknown as App;
    const createEntry = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const findOverlaps = jest.fn<DataManager['findOverlaps']>().mockResolvedValue({ startOverlap: null, endOverlap: null, encompassedEntry: null });
    const manager = {
        createEntry,
        findOverlaps,
        findAdjacentEntries: async (): ReturnType<DataManager['findAdjacentEntries']> => ({ previous: null, next: null }),
    } as unknown as DataManager;
    const modal = new EntryModal(app, settings, manager,
        { mode: 'create', date: new Date(2026, 9, 9), startTime: '09:00', ...data }, () => {});
    modal.contentEl = dom.window.document.body;
    modal.onOpen();
    const input = (placeholder: string) => dom.window.document.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`)!;
    const project = input('Название проекта'), activity = input('Название активности'), linkedNote = input('Путь к заметке');
    const type = (field: HTMLInputElement, value: string) => {
        field.value = value; field.dispatchEvent(new dom.window.Event('input'));
    };
    return { dom, app, modal, settings, project, activity, linkedNote, type, createEntry, findOverlaps };
}

afterEach(() => configureLanguage('en'));

describe('Entry references with native input suggestions', () => {
    it('allows empty fields and stores no category or linked note', async () => {
        const { modal, createEntry } = setup();
        await modal['handleSave']();
        expect(createEntry).toHaveBeenCalledWith(expect.objectContaining({ project: undefined, activity: undefined, linkedNote: undefined }));
    });

    it('blocks unknown values, shows inline errors, and clears them after correction', async () => {
        const { modal, dom, project, activity, linkedNote, type, createEntry } = setup();
        type(project, 'Несуществующий проект'); type(activity, 'Несуществующая активность'); type(linkedNote, 'Нет/заметки');
        // Errors are shown only after the first save attempt.
        expect(activity.getAttribute('aria-invalid')).toBe('false');
        await modal['handleSave']();
        expect(createEntry).not.toHaveBeenCalled();
        for (const field of [project, activity, linkedNote]) {
            expect(field.getAttribute('aria-invalid')).toBe('true');
            const error = dom.window.document.getElementById(field.getAttribute('aria-describedby')!)!;
            expect(error.classList.contains('is-hidden')).toBe(false);
            expect(error.getAttribute('role')).toBe('alert');
            expect(error.classList.contains('validation-message')).toBe(true);
            expect(error.previousElementSibling).toBe(field.closest('.setting-item'));
            expect(error.parentElement).toBe(modal.contentEl);
            expect(error.querySelector('.overlap-warning-icon')).not.toBeNull();
        }
        expect(dom.window.document.body.textContent).toContain('Указанного проекта не существует');
        expect(dom.window.document.body.textContent).toContain('Указанной активности не существует');
        expect(dom.window.document.body.textContent).toContain('Указанной заметки не существует');
        // Time errors and reference errors use the same full-width banner structure.
        const endHour = dom.window.document.querySelectorAll('.time-row')[1].querySelector<HTMLInputElement>('.time-picker input')!;
        endHour.focus();
        type(endHour, '08');
        linkedNote.focus();
        await new Promise<void>(resolve => setImmediate(resolve));
        const timeError = dom.window.document.querySelector('.at-entry-range')!.nextElementSibling!;
        const activityError = dom.window.document.getElementById(activity.getAttribute('aria-describedby')!)!;
        expect(timeError.className).toBe(activityError.className);
        expect(timeError.getAttribute('role')).toBe('alert');
        expect(timeError.querySelector('.overlap-message')!.textContent).toBe('Время окончания должно быть позже времени начала');
        expect(timeError.querySelector('.overlap-warning-messages')!.children).toHaveLength(1);
        endHour.focus();
        type(endHour, '10');
        project.focus();
        await new Promise<void>(resolve => setImmediate(resolve));
        type(project, 'Учёба'); type(activity, 'Чтение'); type(linkedNote, 'Заметки/Книга');
        expect(activity.getAttribute('aria-invalid')).toBe('false');
        expect(dom.window.document.querySelectorAll('.validation-message:not(.is-hidden)')).toHaveLength(0);
        await modal['handleSave']();
        expect(createEntry).toHaveBeenCalledWith(expect.objectContaining({ project: 'Учёба', activity: 'Чтение', linkedNote: 'Заметки/Книга' }));
    });

    it('accepts renamed categories and trims blank optional fields', async () => {
        const { modal, project, activity, type, createEntry } = setup();
        type(project, ' Старый проект '); type(activity, '   ');
        await modal['handleSave']();
        expect(createEntry).toHaveBeenCalledWith(expect.objectContaining({ project: 'Учёба', activity: undefined }));
    });

    it('rejects a category deleted after the form opened', async () => {
        const { modal, activity, settings, type, createEntry } = setup();
        type(activity, 'Чтение'); settings.activities = [];
        await modal['handleSave']();
        expect(activity.getAttribute('aria-invalid')).toBe('true');
        expect(createEntry).not.toHaveBeenCalled();
    });

    it('offers configured names, reacts to manager changes, and selects a name', () => {
        const { app, settings, activity } = setup();
        const onChoose = jest.fn();
        const suggest = new CategorySuggest(app, activity, () => settings.activities, onChoose);
        expect(suggest.getSuggestions('').map(item => item.name)).toEqual(['Чтение']);
        expect(suggest.getSuggestions('Нет')).toEqual([]);
        settings.activities.push({ id: 'walk', name: 'Прогулка', color: '#708a9b' });
        expect(suggest.getSuggestions('прог').map(item => item.name)).toEqual(['Прогулка']);
        suggest.selectSuggestion(settings.activities[1]);
        expect(activity.value).toBe('Прогулка');
        expect(onChoose).toHaveBeenCalledWith('Прогулка');
    });
});

const flushValidation = () => new Promise<void>(resolve => setImmediate(resolve));

describe('Unified validation timing', () => {
    it.each(['project', 'activity', 'note'] as const)('checks only %s on blur, with no warnings while typing', async field => {
        const fixture = setup();
        const { dom, project, activity, linkedNote, type, findOverlaps } = fixture;
        const inputs = { project, activity, note: linkedNote };
        const selected = inputs[field];
        // Other fields can contain unfinished text, but leaving one field must not validate them.
        for (const input of Object.values(inputs)) type(input, 'Не существует');
        selected.focus();
        type(selected, 'Ещё не существует');
        expect(selected.getAttribute('aria-invalid')).toBe('false');
        expect(dom.window.document.querySelectorAll('.validation-message:not(.is-hidden)')).toHaveLength(0);
        selected.blur();
        await flushValidation();
        expect(selected.getAttribute('aria-invalid')).toBe('true');
        for (const [name, input] of Object.entries(inputs)) {
            if (name !== field) expect(input.getAttribute('aria-invalid')).toBe('false');
        }
        expect(dom.window.document.querySelectorAll('.validation-message:not(.is-hidden)')).toHaveLength(1);
        expect(findOverlaps).not.toHaveBeenCalled();
        selected.focus();
        type(selected, 'В процессе исправления');
        expect(selected.getAttribute('aria-invalid')).toBe('false');
        selected.blur();
        await flushValidation();
        expect(selected.getAttribute('aria-invalid')).toBe('true');
    });

    it('waits until the whole time interval loses focus, including transitions between dates and time segments', async () => {
        const { dom, project, type, findOverlaps } = setup();
        const rows = dom.window.document.querySelectorAll('.time-row');
        const startDate = rows[0].querySelector<HTMLInputElement>('input[type=date]')!;
        const startHour = rows[0].querySelector<HTMLInputElement>('.time-picker input')!;
        const [endHour, endMinute] = rows[1].querySelectorAll<HTMLInputElement>('.time-picker input');
        const banner = dom.window.document.querySelector('.at-entry-range')!.nextElementSibling!;
        expect(findOverlaps).not.toHaveBeenCalled();
        startDate.focus(); startHour.focus(); endHour.focus();
        type(endHour, '08');
        endMinute.focus();
        await flushValidation();
        expect(banner.classList.contains('is-hidden')).toBe(true);
        expect(findOverlaps).not.toHaveBeenCalled();
        project.focus();
        await flushValidation();
        expect(banner.classList.contains('is-hidden')).toBe(false);
        expect(banner.textContent).toContain('Время окончания должно быть позже времени начала');
        endHour.focus(); type(endHour, '10');
        expect(banner.classList.contains('is-hidden')).toBe(true);
        expect(findOverlaps).not.toHaveBeenCalled();
        project.focus();
        await flushValidation();
        expect(findOverlaps).toHaveBeenCalledTimes(1);
        expect(banner.classList.contains('is-hidden')).toBe(true);
    });

    it('treats the time picker popup as part of the active interval', async () => {
        const { dom, project, findOverlaps } = setup();
        const row = dom.window.document.querySelectorAll('.time-row')[1];
        row.querySelector<HTMLInputElement>('.time-picker input')!.focus();
        row.querySelector<HTMLButtonElement>('.time-picker-toggle')!.click();
        const popup = row.querySelector<HTMLElement>('.time-picker-popup')!;
        popup.querySelector<HTMLButtonElement>('[data-value="11"]')!.click();
        popup.querySelector<HTMLButtonElement>('.time-picker-done')!.click();
        await flushValidation();
        expect(findOverlaps).not.toHaveBeenCalled();
        project.focus();
        await flushValidation();
        expect(findOverlaps).toHaveBeenCalledTimes(1);
    });

    it('validates all references and time together on Save, and keeps Save available after an invalid attempt', async () => {
        const { modal, dom, project, activity, linkedNote, type, createEntry } = setup();
        for (const input of [project, activity, linkedNote]) type(input, 'Не существует');
        const endHour = dom.window.document.querySelectorAll('.time-row')[1].querySelector<HTMLInputElement>('.time-picker input')!;
        type(endHour, '');
        const save = dom.window.document.querySelector<HTMLButtonElement>('.modal-button-row .mod-cta')!;
        expect(save.disabled).toBe(false);
        await modal['handleSave']();
        expect(createEntry).not.toHaveBeenCalled();
        expect(dom.window.document.querySelectorAll('.validation-message:not(.is-hidden)')).toHaveLength(4);
        expect(save.disabled).toBe(false);
    });

    it('does not display a stale overlap result after time editing resumes', async () => {
        const { dom, project, type, findOverlaps } = setup();
        let finish: (result: Awaited<ReturnType<DataManager['findOverlaps']>>) => void;
        findOverlaps.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        const endHour = dom.window.document.querySelectorAll('.time-row')[1].querySelector<HTMLInputElement>('.time-picker input')!;
        const banner = dom.window.document.querySelector('.at-entry-range')!.nextElementSibling!;
        endHour.focus(); type(endHour, '11'); project.focus();
        await flushValidation();
        expect(findOverlaps).toHaveBeenCalledTimes(1);
        endHour.focus(); type(endHour, '12');
        finish!({ startOverlap: { start: '09:00', end: '13:00', description: 'Занято' } as never,
            endOverlap: null, encompassedEntry: null });
        await flushValidation();
        expect(banner.classList.contains('is-hidden')).toBe(true);
        expect(findOverlaps).toHaveBeenCalledTimes(1);
        project.focus();
        await flushValidation();
        expect(findOverlaps).toHaveBeenCalledTimes(2);
    });

    it('does not save values changed while asynchronous validation was pending', async () => {
        const { modal, activity, type, findOverlaps, createEntry } = setup();
        let finish: (result: Awaited<ReturnType<DataManager['findOverlaps']>>) => void;
        findOverlaps.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        const saving = modal['handleSave']();
        type(activity, 'Несуществующая активность');
        finish!({ startOverlap: null, endOverlap: null, encompassedEntry: null });
        await saving;
        expect(createEntry).not.toHaveBeenCalled();
        expect(activity.getAttribute('aria-invalid')).toBe('false');
        await modal['handleSave']();
        expect(activity.getAttribute('aria-invalid')).toBe('true');
        expect(createEntry).not.toHaveBeenCalled();
    });
});
