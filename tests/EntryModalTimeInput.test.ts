import { jest } from '@jest/globals';
import { JSDOM } from 'jsdom';
import { App } from 'obsidian';
import { TimeInput } from '../src/components/TimeInput';
import { DataManager } from '../src/data/DataManager';
import { EntryModal } from '../src/modals/EntryModal';
import { DEFAULT_SETTINGS } from '../src/types';
import { installObsidianDomHelpers, installElementHelpers } from './__mocks__/obsidianDom';

function setup(use24HourFormat = true) {
    const dom = new JSDOM();
    installObsidianDomHelpers(dom.window.Node.prototype);
    installElementHelpers(dom.window.HTMLElement.prototype);
    const doc = dom.window.document;
    const createEntry = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const dataManager = {
        createEntry,
        findOverlaps: async (): ReturnType<DataManager['findOverlaps']> => ({ startOverlap: null, endOverlap: null, encompassedEntry: null }),
        findAdjacentEntries: async (): ReturnType<DataManager['findAdjacentEntries']> => ({ previous: null, next: null }),
    } as unknown as DataManager;
    const modal = new EntryModal({} as App, { ...DEFAULT_SETTINGS, use24HourFormat }, dataManager,
        { mode: 'create', date: new Date(2026, 6, 23), startTime: '19:15', endTime: '20:46' }, () => {});
    modal['clientValue'] = 'client';
    const start = new TimeInput(doc.body, use24HourFormat, 'Start', '19:15', (value) => {
        modal['startTimeValue'] = value;
        modal['resetTimeValidation']();
    });
    const end = new TimeInput(doc.body, use24HourFormat, 'End', '20:46', (value) => {
        modal['endTimeValue'] = value;
        modal['resetTimeValidation']();
    });
    modal['startTimeInput'] = start;
    modal['endTimeInput'] = end;
    const save = doc.createElement('button');
    save.toggleClass = (names, enabled) => {
        for (const name of typeof names === 'string' ? [names] : names) save.classList.toggle(name, enabled);
    };
    modal['saveButton'] = save;
    const type = (control: TimeInput, value: string) => {
        const hours = control.inputEl.querySelector('input')!;
        hours.value = value;
        hours.dispatchEvent(new dom.window.Event('input'));
    };
    return { modal, start, end, save, createEntry, type };
}

describe('EntryModal custom time integration', () => {
    it.each([true, false])('stores canonical times with 24-hour setting %s', async (use24HourFormat) => {
        const { modal, createEntry } = setup(use24HourFormat);
        await modal['handleSave']();
        expect(createEntry).toHaveBeenCalledWith(expect.objectContaining({
            start: '2026-07-23 19:15', end: '2026-07-23 20:46',
        }));
    });

    it('keeps saving available but rejects incomplete time on a save attempt', async () => {
        const { modal, start, save, createEntry, type } = setup();
        type(start, '');
        expect(save.disabled).toBe(false);
        expect(modal['hasInvalidDuration']).toBe(false);
        await modal['handleSave']();
        expect(createEntry).not.toHaveBeenCalled();
        type(start, '20');
        expect(save.disabled).toBe(false);
        expect(modal['hasInvalidDuration']).toBe(false);
        await modal['handleSave']();
        expect(createEntry).toHaveBeenCalledWith(expect.objectContaining({ start: '2026-07-23 20:15' }));
    });

    it('accepts an end time on the next day in 12-hour mode', async () => {
        const { modal, end, save, createEntry } = setup(false);
        modal['endDateValue'] = '2026-07-24';
        end.setValue('00:15');
        modal['endTimeValue'] = end.getValue();
        modal['validateTimeRange']();
        expect(end.inputEl.querySelector('select')?.value).toBe('AM');
        expect(save.disabled).toBe(false);
        await modal['handleSave']();
        expect(createEntry).toHaveBeenCalledWith(expect.objectContaining({ end: '2026-07-24 00:15' }));
    });

    it('blocks equal or reversed start/end times without a duration control', async () => {
        const { modal, start, end, save, createEntry } = setup();
        for (const endValue of ['19:15', '19:00']) {
            end.setValue(endValue);
            modal['endTimeValue'] = end.getValue();
            modal['validateTimeRange']();
            expect(save.disabled).toBe(false);
            await modal['handleSave']();
        }
        expect(start.getValue()).toBe('19:15');
        expect(createEntry).not.toHaveBeenCalled();
    });
});
