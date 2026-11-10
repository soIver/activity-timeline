import { App, Modal, Notice, Setting } from 'obsidian';
import { Activity, Project, TimeTrackerSettings } from '../types';
import { ColorPalette } from '../components/ColorPalette';
import { setModalTitle } from './ModalLayout';
import { t } from '../i18n';

type Category = Activity | Project;
type Kind = 'activity' | 'project';

export class ActivityModal extends Modal {
    constructor(app: App, private readonly settings: TimeTrackerSettings,
        private readonly saveSettings: () => Promise<void>, private readonly category?: Category,
        private readonly onSave: (category: Category) => void = () => {}, private readonly kind: Kind = 'activity') {
        super(app);
    }

    onOpen(): void {
        this.contentEl.empty();
        setModalTitle(this, this.kind === 'activity'
            ? t(this.category ? 'Edit activity' : 'New activity') : t(this.category ? 'Edit project' : 'Add project'));
        let name = this.category?.name || '';
        let color = this.category?.color || '#708a9b';
        const nameInput = this.contentEl.createEl('input', {
            type: 'text',
            cls: 'at-category-name',
            attr: { placeholder: t('Name'), 'aria-label': t('Name') },
        });
        nameInput.value = name;
        nameInput.addEventListener('input', () => { name = nameInput.value; });
        nameInput.focus();
        new ColorPalette(this.contentEl, color, value => { color = value; });
        const buttons = this.contentEl.createDiv('modal-button-row');
        buttons.createEl('button', { text: t('Cancel') }).addEventListener('click', () => this.close());
        const save = buttons.createEl('button', { text: t('Save'), cls: 'mod-cta' });
        save.addEventListener('click', () => {
            void (async () => {
                const list: Category[] = this.kind === 'activity' ? this.settings.activities : this.settings.projects;
                const trimmed = name.trim();
                if (!trimmed) { new Notice(t('Please enter a name')); return; }
                if (list.some(item => item.id !== this.category?.id &&
                    [item.name, ...(item.aliases || [])].some(value => value.toLocaleLowerCase() === trimmed.toLocaleLowerCase()))) {
                    new Notice(t('This name is already in use')); return;
                }
                save.disabled = true;
                const updated: Category = {
                    ...this.category,
                    id: this.category?.id || `${this.kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                    name: trimmed, color,
                    aliases: [...new Set([...(this.category?.aliases || []), ...(this.category && this.category.name !== trimmed ? [this.category.name] : [])])],
                    ...(this.kind === 'project' ? { archived: (this.category as Project)?.archived || false } : {}),
                };
                const index = this.category ? list.findIndex(item => item.id === this.category.id) : -1;
                if (index >= 0) list[index] = updated;
                else list.push(updated);
                try {
                    await this.saveSettings();
                    this.onSave(updated);
                    this.close();
                } catch (error) {
                    if (index >= 0) list[index] = this.category;
                    else list.splice(list.indexOf(updated), 1);
                    new Notice(t('Failed to save settings: {message}', { message: String(error) }));
                    save.disabled = false;
                }
            })();
        });
    }

    onClose(): void { this.contentEl.empty(); }
}

export class ActivityManagerModal extends Modal {
    constructor(app: App, private readonly settings: TimeTrackerSettings,
        private readonly saveSettings: () => Promise<void>, private readonly onChange: () => void = () => {},
        private readonly kind: Kind = 'activity') { super(app); }

    onOpen(): void { this.render(); }

    private render(): void {
        this.contentEl.empty();
        setModalTitle(this, t(this.kind === 'activity' ? 'Activities' : 'Projects'));
        new Setting(this.contentEl).addButton(button => button
            .setButtonText(t(this.kind === 'activity' ? 'New activity' : 'Add project')).setCta().onClick(() => {
                new ActivityModal(this.app, this.settings, this.saveSettings, undefined, () => {
                    this.onChange(); this.render();
                }, this.kind).open();
            }));
        const list: Category[] = this.kind === 'activity' ? this.settings.activities : this.settings.projects;
        if (!list.length) this.contentEl.createEl('p', { text: t(this.kind === 'activity' ? 'No activities yet' : 'No projects yet') });
        for (const item of list) {
            const setting = new Setting(this.contentEl).setName(item.name);
            const dot = setting.nameEl.createSpan('at-category-color');
            dot.style.backgroundColor = item.color;
            setting.addButton(button => button.setButtonText(t('Edit')).onClick(() => {
                new ActivityModal(this.app, this.settings, this.saveSettings, item, () => {
                    this.onChange(); this.render();
                }, this.kind).open();
            }));
            if (this.kind === 'project') {
                setting.addButton(button => button.setButtonText(t((item as Project).archived ? 'Unarchive' : 'Archive')).onClick(() => {
                    const project = item as Project;
                    project.archived = !project.archived;
                    void this.saveSettings().then(() => { this.onChange(); this.render(); }).catch(error => {
                        project.archived = !project.archived;
                        new Notice(t('Failed to save settings: {message}', { message: String(error) }));
                    });
                }));
            }
            setting.addButton(button => button.setButtonText(t('Delete')).setDestructive().onClick(() => {
                const confirm = new Modal(this.app);
                setModalTitle(confirm, t('Delete'));
                confirm.contentEl.createEl('p', { text: t('Delete “{name}”? Existing time entries will be kept.', { name: item.name }) });
                const row = confirm.contentEl.createDiv('modal-button-row');
                row.createEl('button', { text: t('Cancel') }).addEventListener('click', () => confirm.close());
                const remove = row.createEl('button', { text: t('Delete'), cls: 'mod-warning' });
                remove.addEventListener('click', () => {
                    remove.disabled = true;
                    const index = list.indexOf(item);
                    if (index < 0) return;
                    list.splice(index, 1);
                    const defaultKey = this.kind === 'activity' ? 'defaultActivity' : 'defaultProject';
                    const previousDefault = this.settings[defaultKey];
                    if ([item.id, item.name, ...(item.aliases || [])].includes(previousDefault)) this.settings[defaultKey] = '';
                    void this.saveSettings().then(() => { confirm.close(); this.onChange(); this.render(); }).catch(error => {
                        list.splice(index, 0, item);
                        this.settings[defaultKey] = previousDefault;
                        remove.disabled = false;
                        new Notice(t('Failed to save settings: {message}', { message: String(error) }));
                    });
                });
                confirm.open();
            }));
        }
    }

    onClose(): void { this.contentEl.empty(); }
}
