import { AbstractInputSuggest, App, prepareFuzzySearch, TFile } from 'obsidian';

/** Native Obsidian suggestions for Markdown note names and their folder paths. */
export class NotePathSuggest extends AbstractInputSuggest<TFile> {
    constructor(app: App, input: HTMLInputElement, private readonly onChoose: (path: string) => void) {
        super(app, input);
        this.limit = 50;
    }

    getSuggestions(query: string): TFile[] {
        const files = this.app.vault.getMarkdownFiles();
        const normalized = query.trim().replace(/^\[\[/, '').replace(/\]\]$/, '');
        if (!normalized) return [...files].sort((a, b) => a.path.localeCompare(b.path)).slice(0, this.limit);
        const search = prepareFuzzySearch(normalized);
        return files.map(file => ({ file, match: search(file.path) }))
            .filter(result => result.match !== null)
            .sort((a, b) => b.match.score - a.match.score || a.file.path.localeCompare(b.file.path))
            .slice(0, this.limit)
            .map(result => result.file);
    }

    renderSuggestion(file: TFile, element: HTMLElement): void {
        element.setText(file.path.replace(/\.md$/i, ''));
    }

    selectSuggestion(file: TFile): void {
        const path = file.path.replace(/\.md$/i, '');
        this.setValue(path);
        this.onChoose(path);
        this.close();
    }
}
