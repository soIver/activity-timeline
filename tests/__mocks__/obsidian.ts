// Mock for Obsidian API - only what we need for testing

export class Modal {
    app: unknown;
    contentEl: HTMLElement;
    modalEl: HTMLElement;
    titleEl: HTMLElement;
    setTitle(title: string): this {
        const doc = this.contentEl.ownerDocument;
        if (!this.modalEl) this.modalEl = doc.createElement('div');
        if (!this.titleEl) { this.titleEl = doc.createElement('div'); this.modalEl.appendChild(this.titleEl); }
        this.titleEl.textContent = title;
        return this;
    }
    constructor(app: unknown) { this.app = app; }
    open(): void { this.onOpen(); }
    onOpen(): void {}
    close(): void {}
}

export class FuzzySuggestModal extends Modal {}

export class ItemView {
    constructor(..._args: unknown[]) {}
}

class MockInput {
    inputEl: HTMLInputElement | HTMLTextAreaElement;
    constructor(container: HTMLElement, textarea = false) { this.inputEl = container.createEl(textarea ? 'textarea' : 'input'); }
    setValue(value: string): this { this.inputEl.value = value; return this; }
    getValue(): string { return this.inputEl.value; }
    setPlaceholder(value: string): this { this.inputEl.placeholder = value; return this; }
    onChange(callback: (value: string) => void): this {
        this.inputEl.addEventListener('input', () => callback(this.inputEl.value)); return this;
    }
}
class MockButton {
    buttonEl: HTMLButtonElement;
    constructor(container: HTMLElement) { this.buttonEl = container.createEl('button'); }
    setButtonText(text: string): this { this.buttonEl.textContent = text; return this; }
    setTooltip(text: string): this { this.buttonEl.title = text; return this; }
    setCta(): this { return this; }
    setDestructive(): this { return this; }
    onClick(callback: () => void): this { this.buttonEl.addEventListener('click', callback); return this; }
}
class MockDropdown {
    selectEl: HTMLSelectElement;
    constructor(container: HTMLElement) { this.selectEl = container.createEl('select'); }
    addOption(value: string, label: string): this {
        if (!Array.from(this.selectEl.options).some(option => option.value === value)) {
            const option = this.selectEl.createEl('option'); option.value = value; option.textContent = label;
        }
        return this;
    }
    setValue(value: string): this { this.selectEl.value = value; return this; }
    onChange(callback: (value: string) => void): this { this.selectEl.addEventListener('change', () => callback(this.selectEl.value)); return this; }
}
export class Setting {
    settingEl: HTMLElement;
    nameEl: HTMLElement;
    controlEl: HTMLElement;
    constructor(container: HTMLElement) {
        this.settingEl = container.createDiv('setting-item');
        const info = this.settingEl.createDiv('setting-item-info');
        this.nameEl = info.createDiv('setting-item-name');
        this.controlEl = this.settingEl.createDiv('setting-item-control');
    }
    setName(name: string): this { this.nameEl.textContent = name; return this; }
    addText(callback: (text: MockInput) => void): this { callback(new MockInput(this.controlEl)); return this; }
    addTextArea(callback: (text: MockInput) => void): this { callback(new MockInput(this.controlEl, true)); return this; }
    addDropdown(callback: (dropdown: MockDropdown) => void): this { callback(new MockDropdown(this.controlEl)); return this; }
    addButton(callback: (button: MockButton) => void): this { callback(new MockButton(this.controlEl)); return this; }
}

export class PluginSettingTab {
    constructor(..._args: unknown[]) {}
    update(): void {}
}

export class Notice {
    constructor(message: string) {
        // Mock notice
    }
}

export class TFile {
    path: string = '';
    name: string = '';
    basename: string = '';
    extension: string = 'md';
}

export class TFolder {
    path: string = '';
    name: string = '';
}

export class Vault {
    async read(file: TFile): Promise<string> {
        return '';
    }

    async modify(file: TFile, content: string): Promise<void> {}

    async create(path: string, content: string): Promise<TFile> {
        return new TFile();
    }

    getAbstractFileByPath(path: string): TFile | TFolder | null {
        return null;
    }
}

let mockLanguage = 'en';
export function setMockLanguage(value: string): void { mockLanguage = value; }
export function getLanguage(): string { return mockLanguage; }
export function setIcon(element: HTMLElement, _icon: string): void {
    const svg = element.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.appendChild(element.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path'));
    element.appendChild(svg);
}

export class AbstractInputSuggest<T> {
    limit = 100;
    constructor(public app: unknown, private readonly input: HTMLInputElement) {}
    setValue(value: string): void { this.input.value = value; }
    getValue(): string { return this.input.value; }
    close(): void {}
}

export function prepareFuzzySearch(query: string): (text: string) => { score: number; matches: [number, number][] } | null {
    return text => {
        const index = text.toLowerCase().indexOf(query.toLowerCase());
        return index < 0 ? null : { score: -index, matches: [[index, index + query.length]] };
    };
}
