import { jest } from '@jest/globals';
import { JSDOM } from 'jsdom';
import { App, TFile } from 'obsidian';
import { NotePathSuggest } from '../src/components/NotePathSuggest';
import { installElementHelpers } from './__mocks__/obsidianDom';

function setup() {
    const dom = new JSDOM();
    installElementHelpers(dom.window.HTMLElement.prototype);
    const input = dom.window.document.createElement('input');
    const paths = ['Работа/План.md', 'Личное/План.md', 'Книги/Конспект.md'];
    const files = paths.map(path => Object.assign(new TFile(), { path }));
    const app = { vault: { getMarkdownFiles: () => [...files] } } as unknown as App;
    const onChoose = jest.fn();
    const suggest = new NotePathSuggest(app, input, onChoose);
    return { input, files, suggest, onChoose };
}

describe('Native linked note suggestions', () => {
    it('searches by note name and folder path, including Cyrillic', () => {
        const { suggest } = setup();
        expect(suggest.getSuggestions('план').map(file => file.path)).toEqual(['Личное/План.md', 'Работа/План.md']);
        expect(suggest.getSuggestions('Личное/').map(file => file.path)).toEqual(['Личное/План.md']);
        expect(suggest.getSuggestions('[[Книги/Конспект]]').map(file => file.path)).toEqual(['Книги/Конспект.md']);
        expect(suggest.getSuggestions('Несуществующая заметка')).toEqual([]);
        expect(suggest.getSuggestions('')).toHaveLength(3);
    });

    it('chooses the full path without the extension and notifies the entry form', () => {
        const { suggest, input, files, onChoose } = setup();
        const close = jest.spyOn(suggest, 'close');
        suggest.selectSuggestion(files[1]);
        expect(input.value).toBe('Личное/План');
        expect(onChoose).toHaveBeenCalledWith('Личное/План');
        expect(close).toHaveBeenCalledTimes(1);
    });

    it('renders full paths so notes with the same name can be distinguished', () => {
        const { suggest, files, input } = setup();
        const row = input.ownerDocument.createElement('div');
        suggest.renderSuggestion(files[0], row);
        expect(row.textContent).toBe('Работа/План');
    });
});
