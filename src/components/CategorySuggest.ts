import { AbstractInputSuggest, App, prepareFuzzySearch } from 'obsidian';
import type { Activity } from '../types';

/** Native suggestions contain only configured categories; an empty field means no category. */
export class CategorySuggest extends AbstractInputSuggest<Activity> {
    constructor(app: App, input: HTMLInputElement, private readonly getItems: () => Activity[],
        private readonly onChoose: (name: string) => void) {
        super(app, input);
        this.limit = 50;
    }

    getSuggestions(query: string): Activity[] {
        const items = this.getItems();
        if (!query.trim()) return [...items].sort((a, b) => a.name.localeCompare(b.name)).slice(0, this.limit);
        const search = prepareFuzzySearch(query.trim());
        return items.map(item => ({ item, match: search(item.name) }))
            .filter(result => result.match !== null)
            .sort((a, b) => b.match.score - a.match.score || a.item.name.localeCompare(b.item.name))
            .slice(0, this.limit).map(result => result.item);
    }

    renderSuggestion(item: Activity, element: HTMLElement): void { element.setText(item.name); }

    selectSuggestion(item: Activity): void {
        this.setValue(item.name);
        this.onChoose(item.name);
        this.close();
    }
}
