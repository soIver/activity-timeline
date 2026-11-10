import { jest } from '@jest/globals';
import { JSDOM } from 'jsdom';
import { WorkspaceLeaf } from 'obsidian';
import { DataManager } from '../src/data/DataManager';
import { TimelineView } from '../src/views/TimelineView';
import { DEFAULT_SETTINGS, TimeEntry } from '../src/types';
import { installElementHelpers, installObsidianDomHelpers } from './__mocks__/obsidianDom';

type Mode = 'move' | 'resize-top' | 'resize-bottom';
function setup(mode: Mode, minutes: number, use24HourFormat = true, centerDate = new Date(2026, 9, 9)) {
    const dom = new JSDOM();
    installObsidianDomHelpers(dom.window.Node.prototype);
    installElementHelpers(dom.window.HTMLElement.prototype);
    const updateEntry = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const settings = { ...DEFAULT_SETTINGS, hourHeight: 200, use24HourFormat };
    const view = new TimelineView({} as WorkspaceLeaf, settings, { updateEntry } as unknown as DataManager);
    view['centerDate'] = centerDate;
    view['dayHeight'] = 24 * settings.hourHeight;
    const card = dom.window.document.createElement('div');
    card.style.top = `${(1440 + minutes) / 60 * settings.hourHeight}px`;
    card.style.height = `${settings.hourHeight}px`;
    view['entryDragCard'] = card;
    view['entryDragMode'] = mode;
    view['entryDragStartY'] = 0;
    view['entryDragOriginalTop'] = parseFloat(card.style.top);
    view['entryDragOriginalHeight'] = parseFloat(card.style.height);
    view['entryDragEntry'] = {
        date: '2026-10-09', start: '09:00', end: '10:00', client: 'personal', description: '',
        startDateTime: new Date(2026, 9, 9, 9), endDateTime: new Date(2026, 9, 9, 10), lineNumber: 1, durationMinutes: 60,
    } as TimeEntry;
    const tooltip = dom.window.document.createElement('div');
    view['entryDragTooltipEl'] = tooltip;
    view.refresh = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    return { view, updateEntry, tooltip };
}

describe('Timeline drag time normalization', () => {
    it.each([
        ['move', 9 * 60 + 45, 30, '10:00 – 11:00', '2026-10-09 10:00', '2026-10-09 11:00'],
        ['resize-top', 9 * 60, -10, '09:00 – 10:00', '2026-10-09 09:00', '2026-10-09 10:00'],
        ['resize-bottom', 9 * 60, -10, '09:00 – 10:00', '2026-10-09 09:00', '2026-10-09 10:00'],
        ['move', 23 * 60 + 45, 30, '00:00 – 01:00', '2026-10-10 00:00', '2026-10-10 01:00'],
        ['resize-bottom', 23 * 60, -10, '23:00 – 00:00', '2026-10-09 23:00', '2026-10-10 00:00'],
        ['move', -15, 30, '00:00 – 01:00', '2026-10-09 00:00', '2026-10-09 01:00'],
    ])('%s previews and saves the same range across rounded hours', async (mode, minutes, delta, label, start, end) => {
        const { view, tooltip, updateEntry } = setup(mode as Mode, minutes as number);
        view['updateEntryDragPosition'](delta as number);
        expect(tooltip.textContent).toBe(label);
        expect(tooltip.textContent).not.toContain(':60');
        await view['finalizeEntryDrag'](delta as number);
        expect(updateEntry).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ start, end }));
    });

    it('normalizes previews for every pixel around an hour boundary in 12-hour mode', () => {
        const { view, tooltip } = setup('move', 11 * 60 + 45, false);
        for (let pixel = 26; pixel < 75; pixel++) {
            view['updateEntryDragPosition'](pixel);
            expect(tooltip.textContent).toBe('12:00 PM – 1:00 PM');
        }
    });

    it('advances the calendar month when rounding a move past midnight', async () => {
        const { view, updateEntry } = setup('move', 23 * 60 + 45, true, new Date(2026, 9, 31));
        view['updateEntryDragPosition'](30);
        await view['finalizeEntryDrag'](30);
        expect(updateEntry).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            date: '2026-11-01', start: '2026-11-01 00:00', end: '2026-11-01 01:00',
        }));
    });
});
