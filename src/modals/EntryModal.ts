import { t } from '../i18n';
import { App, Modal, Setting, TextComponent, Notice, FuzzySuggestModal, TFile } from 'obsidian';
import { TimeEntry, TimeTrackerSettings, Activity } from '../types';
import { DataManager } from '../data/DataManager';
import { TableParser } from '../data/TableParser';
import { Logger } from '../utils/Logger';
import { ActivityManagerModal } from './ActivityModal';
import { setModalTitle } from './ModalLayout';
import { CategorySuggest } from '../components/CategorySuggest';
import { NotePathSuggest } from '../components/NotePathSuggest';
import { bindFieldValidation } from '../components/FieldValidation';
import { ValidationMessage } from '../components/ValidationMessage';
import { TimeInput } from '../components/TimeInput';

type EntryField = 'project' | 'activity' | 'note';

/**
 * Simple confirmation modal to replace browser confirm()
 */
class ConfirmModal extends Modal {
    private message: string;
    private onConfirm: () => void;

    constructor(app: App, message: string, onConfirm: () => void) {
        super(app);
        this.message = message;
        this.onConfirm = onConfirm;
    }

    onOpen(): void {
        const { contentEl } = this;
        setModalTitle(this, t('Delete entry'));
        contentEl.createEl('p', { text: this.message });

        const buttonRow = contentEl.createDiv('modal-button-row');

        const cancelBtn = buttonRow.createEl('button', { text: t('Cancel') });
        cancelBtn.addEventListener('click', () => this.close());

        const confirmBtn = buttonRow.createEl('button', { text: t('Delete'), cls: 'mod-warning' });
        confirmBtn.addEventListener('click', () => {
            this.onConfirm();
            this.close();
        });
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}

/**
 * Mode for the entry modal
 */
export type EntryModalMode = 'create' | 'edit';

/**
 * Data passed when opening the modal
 */
export interface EntryModalData {
    mode: EntryModalMode;
    /** For create mode: the date to create the entry on */
    date?: Date;
    /** For create mode: optional pre-filled start time */
    startTime?: string;
    /** For create mode: optional pre-filled end time (from drag selection) */
    endTime?: string;
    /** For edit mode: the existing entry to edit */
    entry?: TimeEntry;
}

/**
 * Modal for creating or editing time entries
 */
export class EntryModal extends Modal {
    private settings: TimeTrackerSettings;
    private dataManager: DataManager;
    private data: EntryModalData;
    private onSave: () => void;

    // Form values
    private startDateValue: string;
    private startTimeValue: string;
    private endDateValue: string;
    private endTimeValue: string;
    private descriptionValue: string;
    private clientValue: string;
    private projectValue: string;
    private activityValue: string;
    private linkedNoteValue: string;

    private static nextId = 0;
    private readonly fieldPrefix = `at-entry-${EntryModal.nextId++}`;
    private readonly fieldInputs: Partial<Record<EntryField, TextComponent>> = {};
    private readonly fieldErrors: Partial<Record<EntryField, ValidationMessage>> = {};
    private fieldRevision = 0;
    private isSaving = false;

    // Cleanup handlers
    private cleanupHandlers: (() => void)[] = [];

    // Input references for updating
    private endDateInput: TextComponent | null = null;
    private endTimeInput: TimeInput | null = null;
    private startDateInput: TextComponent | null = null;
    private startTimeInput: TimeInput | null = null;

    // Overlap validation UI
    private saveButton: HTMLButtonElement | null = null;
    private warningBanner: ValidationMessage | null = null;
    private startOverlap: TimeEntry | null = null;
    private endOverlap: TimeEntry | null = null;
    private encompassedEntry: TimeEntry | null = null;

    // Snap hints for adjacent entries
    private previousEntry: TimeEntry | null = null;
    private nextEntry: TimeEntry | null = null;
    private startSnapHint: HTMLElement | null = null;
    private endSnapHint: HTMLElement | null = null;

    // Validation request counter to prevent race conditions
    private validationRequestId: number = 0;

    // Duration validation state
    private hasInvalidDuration: boolean = false;

    constructor(
        app: App,
        settings: TimeTrackerSettings,
        dataManager: DataManager,
        data: EntryModalData,
        onSave: () => void,
        private readonly saveSettings: () => Promise<void> = async () => {},
    ) {
        super(app);
        this.settings = settings;
        this.dataManager = dataManager;
        this.data = data;
        this.onSave = onSave;

        // Initialize form values
        if (data.mode === 'edit' && data.entry) {
            // Use the computed DateTime objects for accuracy
            this.startDateValue = TableParser.getDateString(data.entry.startDateTime);
            this.startTimeValue = data.entry.start;
            this.endDateValue = TableParser.getDateString(data.entry.endDateTime);
            this.endTimeValue = data.entry.end;
            this.descriptionValue = data.entry.description;
            this.clientValue = data.entry.client;
            this.projectValue = this.resolveProjectName(data.entry.project);
            this.activityValue = this.resolveActivityName(data.entry.activity);
            this.linkedNoteValue = data.entry.linkedNote || '';
        } else {
            // Create mode defaults
            const date = data.date || new Date();
            this.startDateValue = TableParser.getDateString(date);
            this.startTimeValue = data.startTime || this.getCurrentTimeRounded();

            // Calculate end date/time
            if (data.endTime) {
                // From drag selection - check if end < start (spans midnight)
                const startMins = this.timeToMinutes(this.startTimeValue);
                const endMins = this.timeToMinutes(data.endTime);
                if (endMins < startMins) {
                    // Spans midnight - end date is next day
                    const nextDay = new Date(date);
                    nextDay.setDate(nextDay.getDate() + 1);
                    this.endDateValue = TableParser.getDateString(nextDay);
                } else {
                    this.endDateValue = this.startDateValue;
                }
                this.endTimeValue = data.endTime;
            } else {
                // Default +1 hour
                this.endDateValue = this.startDateValue;
                const minutes = this.timeToMinutes(this.startTimeValue) + 60;
                this.endTimeValue = `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
            }

            this.descriptionValue = '';
            // Preserve the original storage format without exposing clients.
            this.clientValue = 'personal';
            this.projectValue = this.resolveProjectName(this.settings.defaultProject);
            this.activityValue = this.resolveActivityName(this.settings.defaultActivity);
            this.linkedNoteValue = '';
        }
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('time-tracker-entry-modal');

        // Title
        const title = this.data.mode === 'edit' ? t('Edit Time Entry') : t('New Time Entry');
        setModalTitle(this, title);

        const interval = contentEl.createDiv('at-entry-range');

        // Start row: Date and Time with magnet button
        const startRow = interval.createDiv('time-row');

        const startSetting = new Setting(startRow)
            .setName(t('Start'))
            .addText((text) => {
                this.startDateInput = text;
                text.setValue(this.startDateValue);
                text.inputEl.type = 'date';
                text.onChange((value) => {
                    this.startDateValue = value;
                    this.resetTimeValidation();
                    void this.findAdjacentEntries();
                });
            });
        this.startTimeInput = new TimeInput(startSetting.controlEl, this.settings.use24HourFormat,
            t('Start'), this.startTimeValue, (value) => {
                this.startTimeValue = value;
                this.resetTimeValidation();
                void this.findAdjacentEntries();
            });

        // Magnet button for start (snap to end of previous entry)
        this.startSnapHint = startSetting.controlEl.createEl('button', {
            cls: 'time-magnet-btn',
            text: '🧲',
        });
        this.startSnapHint.addClass('is-hidden'); // Hidden until adjacent entry found
        this.startSnapHint.addEventListener('click', (e) => {
            e.preventDefault();
            this.snapStartToPrevious();
        });

        // End row: Date and Time with magnet button
        const endRow = interval.createDiv('time-row');

        const endSetting = new Setting(endRow)
            .setName(t('End'))
            .addText((text) => {
                this.endDateInput = text;
                text.setValue(this.endDateValue);
                text.inputEl.type = 'date';
                text.onChange((value) => {
                    this.endDateValue = value;
                    this.resetTimeValidation();
                    void this.findAdjacentEntries();
                });
            });
        this.endTimeInput = new TimeInput(endSetting.controlEl, this.settings.use24HourFormat,
            t('End'), this.endTimeValue, (value) => {
                this.endTimeValue = value;
                this.resetTimeValidation();
                void this.findAdjacentEntries();
            });

        this.cleanupHandlers.push(bindFieldValidation(interval,
            () => this.validateTimeOnBlur(), () => this.resetTimeValidation()));

        // Magnet button for end (snap to start of next entry)
        this.endSnapHint = endSetting.controlEl.createEl('button', {
            cls: 'time-magnet-btn',
            text: '🧲',
        });
        this.endSnapHint.addClass('is-hidden'); // Hidden until adjacent entry found
        this.endSnapHint.addEventListener('click', (e) => {
            e.preventDefault();
            this.snapEndToNext();
        });

        // Overlap warning banner (hidden by default)
        this.warningBanner = new ValidationMessage(contentEl);

        const projectSetting = new Setting(contentEl).setName(t('Project'));
        projectSetting.settingEl.addClass('at-category-setting');
        this.addEntryField(projectSetting, 'project', t('Project name'), this.projectValue, value => {
            this.projectValue = value;
        });
        const projectSuggest = new CategorySuggest(this.app, this.fieldInputs.project.inputEl,
            () => this.settings.projects.filter(project => !project.archived), name => {
                this.fieldInputs.project.setValue(name);
                this.projectValue = name;
                this.clearEntryFieldError('project');
            });
        this.cleanupHandlers.push(() => projectSuggest.close());
        projectSetting.addButton(button => button.setButtonText(t('Manage projects')).onClick(() => {
            new ActivityManagerModal(this.app, this.settings, this.saveSettings, () => {
                this.projectValue = this.resolveProjectName(this.projectValue);
                this.fieldInputs.project.setValue(this.projectValue);
                this.clearEntryFieldError('project');
            }, 'project').open();
        }));

        const activitySetting = new Setting(contentEl).setName(t('Activity'));
        activitySetting.settingEl.addClass('at-category-setting');
        this.addEntryField(activitySetting, 'activity', t('Activity name'), this.activityValue, value => {
            this.activityValue = value;
        });
        const activitySuggest = new CategorySuggest(this.app, this.fieldInputs.activity.inputEl,
            () => this.settings.activities, name => {
                this.fieldInputs.activity.setValue(name);
                this.activityValue = name;
                this.clearEntryFieldError('activity');
            });
        this.cleanupHandlers.push(() => activitySuggest.close());
        activitySetting.addButton(button => button.setButtonText(t('Manage activities')).onClick(() => {
            new ActivityManagerModal(this.app, this.settings, this.saveSettings, () => {
                this.activityValue = this.resolveActivityName(this.activityValue);
                this.fieldInputs.activity.setValue(this.activityValue);
                this.clearEntryFieldError('activity');
            }).open();
        }));

        // Description with character counter in label
        const maxLen = this.settings.descriptionMaxLength;
        const descSetting = new Setting(contentEl);
        descSetting.settingEl.addClass('at-entry-description');

        // Create label with counter
        const descLabel = descSetting.nameEl;
        descLabel.setText(t('Description '));
        const counterEl = descLabel.createSpan('description-counter');
        const updateCounter = (len: number) => {
            if (maxLen > 0) {
                counterEl.setText(`(${len}/${maxLen})`);
                counterEl.toggleClass('is-over-limit', len > maxLen);
                counterEl.toggleClass('is-near-limit', len > maxLen * 0.8 && len <= maxLen);
            }
        };
        updateCounter(this.descriptionValue.length);

        descSetting.addTextArea((text) => {
            text.setValue(this.descriptionValue);
            text.setPlaceholder(t('What did you work on?'));
            text.inputEl.rows = 3;

            text.onChange((value) => {
                let cleaned = value;
                if (maxLen > 0 && cleaned.length > maxLen) {
                    cleaned = cleaned.substring(0, maxLen);
                    text.setValue(cleaned);
                }
                this.descriptionValue = cleaned;
                updateCounter(cleaned.length);
            });
        });

        // Linked note
        const linkedNoteSetting = new Setting(contentEl)
            .setName(t('Linked note'));
        linkedNoteSetting.settingEl.addClass('at-linked-note');

        const linkedNoteInput = this.addEntryField(linkedNoteSetting, 'note', t('Note path'), this.linkedNoteValue, value => {
            this.linkedNoteValue = value;
        });
        const noteSuggest = new NotePathSuggest(this.app, linkedNoteInput.inputEl, path => {
            linkedNoteInput.setValue(path);
            this.linkedNoteValue = path;
            this.clearEntryFieldError('note');
        });
        this.cleanupHandlers.push(() => noteSuggest.close());

        // Browse existing notes button
        linkedNoteSetting.addButton((btn) => {
            btn.setButtonText(t('Browse'))
                .setTooltip(t('Select an existing note'))
                .onClick(() => {
                    new NoteSuggestModal(this.app, (file) => {
                        // Remove .md extension for the link
                        const path = file.path.replace(/\.md$/, '');
                        linkedNoteInput.setValue(path);
                        this.linkedNoteValue = path;
                        this.clearEntryFieldError('note');
                    }).open();
                });
        });

        // Create new note button
        linkedNoteSetting.addButton((btn) => {
            btn.setButtonText(t('Create new'))
                .setTooltip(t('Create a new linked note'))
                .onClick(() => {
                    this.showCreateNoteInput(contentEl, linkedNoteInput);
                });
        });

        // Button row
        const buttonRow = contentEl.createDiv('modal-button-row');

        // Delete button (only for edit mode)
        if (this.data.mode === 'edit') {
            const deleteBtn = buttonRow.createEl('button', {
                text: t('Delete'),
                cls: 'mod-warning',
            });
            deleteBtn.addEventListener('click', () => this.handleDelete());
        }

        // Spacer
        buttonRow.createDiv('button-spacer');

        // Cancel button
        const cancelBtn = buttonRow.createEl('button', {
            text: t('Cancel'),
        });
        cancelBtn.addEventListener('click', () => this.close());

        // Save button
        this.saveButton = buttonRow.createEl('button', {
            text: t('Save'),
            cls: 'mod-cta',
        });
        this.saveButton.addEventListener('click', () => { void this.handleSave(); });

        // Adjacent entries only provide snap hints; initial values do not show errors.
        void this.findAdjacentEntries();
    }

    onClose(): void {
        ++this.validationRequestId;
        ++this.fieldRevision;
        // Run cleanup handlers
        this.startTimeInput?.destroy();
        this.endTimeInput?.destroy();
        for (const handler of this.cleanupHandlers) {
            handler();
        }
        this.cleanupHandlers = [];

        const { contentEl } = this;
        contentEl.empty();
    }

    /**
     * Handle save button click
     */
    private async handleSave(): Promise<void> {
        if (this.isSaving) return;
        this.isSaving = true;
        this.updateSaveButtonState();
        const revision = this.fieldRevision;
        try {
            const referencesValid = this.validateEntryFields();
            const timeValid = await this.validateTimeFields();
            if (!referencesValid || !timeValid || revision !== this.fieldRevision) return;
            const startForStorage = `${this.startDateValue} ${this.startTimeValue}`;
            const endForStorage = `${this.endDateValue} ${this.endTimeValue}`;

            if (this.data.mode === 'edit' && this.data.entry) {
                // Update existing entry
                await this.dataManager.updateEntry(this.data.entry, {
                    date: this.startDateValue,
                    start: startForStorage,
                    end: endForStorage,
                    description: this.descriptionValue,
                    client: this.clientValue,
                    project: this.projectValue || undefined,
                    activity: this.activityValue || undefined,
                    linkedNote: this.linkedNoteValue || undefined,
                });
            } else {
                // Create new entry
                await this.dataManager.createEntry({
                    date: this.startDateValue,
                    start: startForStorage,
                    end: endForStorage,
                    description: this.descriptionValue,
                    client: this.clientValue,
                    project: this.projectValue || undefined,
                    activity: this.activityValue || undefined,
                    linkedNote: this.linkedNoteValue || undefined,
                });
            }

            this.onSave();
            this.close();
        } catch (error) {
            Logger.error('EntryModal: Error saving entry:', error);
            new Notice(t('Failed to save entry: {message}', { message: String(error) }));
        } finally {
            this.isSaving = false;
            this.updateSaveButtonState();
        }
    }

    /**
     * Handle delete button click
     */
    private handleDelete(): void {
        if (this.data.mode !== 'edit' || !this.data.entry) {
            return;
        }

        // Show confirmation modal
        const modal = new ConfirmModal(
            this.app,
            'Are you sure you want to delete this entry?',
            () => {
                void this.performDelete();
            }
        );
        modal.open();
    }

    /**
     * Perform the actual entry deletion
     */
    private async performDelete(): Promise<void> {
        if (!this.data.entry) return;

        try {
            await this.dataManager.deleteEntry(this.data.entry);
            this.onSave();
            this.close();
        } catch (error) {
            Logger.error('EntryModal: Error deleting entry:', error);
            new Notice(t('Failed to delete entry: {message}', { message: String(error) }));
        }
    }

    /** Match stored IDs and aliases too, so existing entries survive category renames. */
    private findCategory(items: Activity[], value: string): Activity | undefined {
        const normalized = value.trim().toLocaleLowerCase();
        return items.find(item => [item.name, item.id, ...(item.aliases || [])]
            .some(name => name.toLocaleLowerCase() === normalized));
    }

    private addEntryField(setting: Setting, field: EntryField, placeholder: string, value: string,
        onChange: (value: string) => void): TextComponent {
        setting.addText(text => {
            this.fieldInputs[field] = text;
            text.setValue(value).setPlaceholder(placeholder);
            const wrapper = setting.controlEl.createDiv('at-entry-field');
            wrapper.appendChild(text.inputEl);
            const error = new ValidationMessage(setting.settingEl.parentElement, `${this.fieldPrefix}-${field}-error`);
            this.fieldErrors[field] = error;
            text.inputEl.setAttribute('aria-label', placeholder);
            text.inputEl.setAttribute('aria-describedby', error.element.id);
            text.inputEl.setAttribute('aria-invalid', 'false');
            text.onChange(next => {
                onChange(next);
                this.clearEntryFieldError(field);
            });
            this.cleanupHandlers.push(bindFieldValidation(text.inputEl,
                () => { this.validateEntryFields([field]); }, () => this.clearEntryFieldError(field)));
        });
        return this.fieldInputs[field];
    }

    private clearEntryFieldError(field: EntryField): void {
        ++this.fieldRevision;
        this.fieldInputs[field]?.inputEl.setAttribute('aria-invalid', 'false');
        this.fieldErrors[field]?.setMessages([]);
    }

    /** Blur checks one reference; saving checks all references without short-circuiting. */
    private validateEntryFields(fields: readonly EntryField[] = ['project', 'activity', 'note']): boolean {
        const messages = { project: t('The specified project does not exist'),
            activity: t('The specified activity does not exist'), note: t('The specified note does not exist') };
        let valid = true;
        for (const field of fields) {
            const current = field === 'project' ? this.projectValue : field === 'activity' ? this.activityValue : this.linkedNoteValue;
            let value = (this.fieldInputs[field]?.getValue() ?? current).trim();
            let exists = true;
            if (value) {
                if (field === 'note') {
                    const path = /\.md$/i.test(value) ? value : `${value}.md`;
                    exists = this.app.vault.getAbstractFileByPath(path) instanceof TFile;
                } else {
                    const category = this.findCategory(field === 'project' ? this.settings.projects : this.settings.activities, value);
                    exists = category !== undefined;
                    if (category) value = category.name;
                }
            }
            if (field === 'project') this.projectValue = value;
            else if (field === 'activity') this.activityValue = value;
            else this.linkedNoteValue = value;
            this.fieldInputs[field]?.inputEl.setAttribute('aria-invalid', String(!exists));
            this.fieldErrors[field]?.setMessages(exists ? [] : [messages[field]]);
            if (!exists) valid = false;
        }
        return valid;
    }

    /** Match the command palette's quarter-hour default without producing 24:00. */
    private getCurrentTimeRounded(): string {
        const now = new Date();
        const minutes = Math.round(now.getMinutes() / 15) * 15;
        return `${now.getHours().toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    }

    /**
     * Resolve a project ID or name to the actual project name
     * Handles both old lowercase ID format and new name format
     */
    private resolveProjectName(projectIdOrName?: string): string {
        if (!projectIdOrName) return '';

        // First try exact match by name
        const byName = this.settings.projects.find(p => p.name === projectIdOrName || p.aliases?.includes(projectIdOrName));
        if (byName) return byName.name;

        // Then try match by ID (for old entries with lowercased IDs)
        const byId = this.settings.projects.find(p => p.id === projectIdOrName);
        if (byId) return byId.name;

        // Return as-is if no match found
        return projectIdOrName;
    }

    /**
     * Resolve an activity ID or name to the actual activity name
     * Handles both lowercase ID format and display name format
     */
    private resolveActivityName(activityIdOrName?: string): string {
        if (!activityIdOrName) return '';

        // First try exact match by name
        const byName = this.settings.activities.find(a => a.name === activityIdOrName || a.aliases?.includes(activityIdOrName));
        if (byName) return byName.name;

        // Then try match by ID (for lowercased slugs)
        const byId = this.settings.activities.find(a => a.id === activityIdOrName);
        if (byId) return byId.name;

        // Return as-is if no match found
        return activityIdOrName;
    }

    /**
     * Convert HH:mm time string to minutes since midnight
     */
    private timeToMinutes(time: string): number {
        const [h, m] = time.split(':').map(Number);
        return h * 60 + m;
    }

    private resetTimeValidation(): void {
        ++this.fieldRevision;
        ++this.validationRequestId;
        this.hasInvalidDuration = false;
        this.startOverlap = this.endOverlap = this.encompassedEntry = null;
        this.startTimeInput?.clearValidation();
        this.endTimeInput?.clearValidation();
        this.updateOverlapUI();
    }

    /** Commit the visible values only after blur or a save attempt. */
    private validateTimeRange(): boolean {
        this.startDateValue = this.startDateInput?.getValue() ?? this.startDateValue;
        this.endDateValue = this.endDateInput?.getValue() ?? this.endDateValue;
        this.startTimeValue = this.startTimeInput?.getValue() ?? this.startTimeValue;
        this.endTimeValue = this.endTimeInput?.getValue() ?? this.endTimeValue;
        const start = new Date(`${this.startDateValue}T${this.startTimeValue}`);
        const end = new Date(`${this.endDateValue}T${this.endTimeValue}`);
        this.hasInvalidDuration = !/^\d{4}-\d{2}-\d{2}$/.test(this.startDateValue) ||
            !/^\d{4}-\d{2}-\d{2}$/.test(this.endDateValue) ||
            !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start;
        this.startTimeInput?.validate();
        this.endTimeInput?.validate();
        this.updateOverlapUI();
        return !this.hasInvalidDuration;
    }

    private async validateTimeFields(): Promise<boolean> {
        this.startOverlap = this.endOverlap = this.encompassedEntry = null;
        if (!this.validateTimeRange()) {
            ++this.validationRequestId;
            return false;
        }
        return this.validateOverlap();
    }

    private validateTimeOnBlur(): void {
        if (this.isSaving) return;
        void this.validateTimeFields().catch(error => {
            new Notice(t('Failed to load entries: {message}', { message: String(error) }));
        });
    }

    /**
     * Show the create note input UI
     */
    private showCreateNoteInput(contentEl: HTMLElement, linkedNoteInput: TextComponent): void {
        // Create inline input row
        const createNoteRow = contentEl.createDiv('create-note-row');

        const maxLength = 80;
        const defaultName = `${this.startDateValue}-`;

        // Full filename input (user can edit everything including date)
        const nameInput = createNoteRow.createEl('input', {
            type: 'text',
            placeholder: 'note-name',
            cls: 'create-note-slug',
            value: defaultName,
        });
        nameInput.maxLength = maxLength;

        // Character counter
        const counterSpan = createNoteRow.createSpan('create-note-counter');
        counterSpan.setText(`${defaultName.length}/${maxLength}`);

        nameInput.addEventListener('input', () => {
            // Allow Unicode letters, numbers, and hyphens in note filenames.
            const cursorPos = nameInput.selectionStart || 0;
            nameInput.value = nameInput.value
                .toLowerCase()
                .replace(/[^\p{L}\p{N}-]/gu, '-')
                .replace(/-+/g, '-');
            nameInput.selectionStart = nameInput.selectionEnd = Math.min(cursorPos, nameInput.value.length);
            counterSpan.setText(`${nameInput.value.length}/${maxLength}`);
        });

        // Create button
        const createBtn = createNoteRow.createEl('button', {
            text: t('Create'),
            cls: 'mod-cta',
        });

        // Cancel button
        const cancelBtn = createNoteRow.createEl('button', {
            text: t('Cancel'),
        });

        createBtn.addEventListener('click', () => {
            const noteName = nameInput.value.trim().replace(/^-+|-+$/g, '');
            if (!noteName) {
                new Notice(t('Please enter a note name'));
                return;
            }

            void this.createLinkedNote(noteName).then((notePath) => {
                linkedNoteInput.setValue(notePath);
                this.linkedNoteValue = notePath;
                this.clearEntryFieldError('note');
                createNoteRow.remove();
                new Notice(t('Note created!'));
            }).catch((err: Error) => {
                new Notice(t('Failed to create note: {message}', { message: err.message }));
            });
        });

        cancelBtn.addEventListener('click', () => {
            createNoteRow.remove();
        });

        // Focus the input and position cursor at end
        nameInput.focus();
        nameInput.selectionStart = nameInput.selectionEnd = nameInput.value.length;
    }

    /**
     * Create a linked note in the Notes subfolder
     */
    private async createLinkedNote(slug: string): Promise<string> {
        const vault = this.app.vault;
        const notesFolder = `${this.settings.timeTrackingFolder}/Notes`;
        const notePath = `${notesFolder}/${slug}.md`;

        // Ensure Notes subfolder exists
        const folder = vault.getAbstractFileByPath(notesFolder);
        if (!folder) {
            await vault.createFolder(notesFolder);
        }

        // Check if note already exists
        const existing = vault.getAbstractFileByPath(notePath);
        if (existing) {
            throw new Error(t('Note already exists'));
        }

        // Create note with template content
        const content = this.generateNoteTemplate(slug);
        await vault.create(notePath, content);

        // Return path without .md extension for the linkedNote field
        return `${notesFolder}/${slug}`;
    }

    /**
     * Generate template content for a new linked note
     * Loosely coupled - no properties that would need updating if entry changes
     */
    private generateNoteTemplate(_noteName: string): string {
        // Just a blank note - user can add whatever they want
        return '';
    }

    /**
     * Validate overlap with existing entries and update UI
     * Uses request ID to prevent race conditions from concurrent async calls
     */
    private async validateOverlap(): Promise<boolean> {
        // Increment and capture request ID to handle race conditions
        const requestId = ++this.validationRequestId;

        // Read directly from inputs to ensure we validate what the user sees
        const startDate = this.startDateInput !== null ? this.startDateInput.getValue() : this.startDateValue;
        const startTime = this.startTimeInput !== null ? this.startTimeInput.getValue() : this.startTimeValue;
        const endDate = this.endDateInput !== null ? this.endDateInput.getValue() : this.endDateValue;
        const endTime = this.endTimeInput !== null ? this.endTimeInput.getValue() : this.endTimeValue;

        // Build datetime from current values
        const startDateTime = new Date(`${startDate}T${startTime}`);
        const endDateTime = new Date(`${endDate}T${endTime}`);

        // Check for invalid dates
        if (isNaN(startDateTime.getTime()) || isNaN(endDateTime.getTime())) {
            Logger.log('EntryModal: Invalid dates, skipping overlap check');
            // Only update if this is still the latest request
            if (requestId !== this.validationRequestId) return false;
            this.startOverlap = null;
            this.endOverlap = null;
            this.encompassedEntry = null;
            this.updateOverlapUI();
            return false;
        }

        Logger.log('EntryModal: Checking conflicts for', {
            start: startDateTime.toISOString(),
            end: endDateTime.toISOString(),
            requestId
        });

        // Check for overlaps (exclude self in edit mode)
        const excludeEntry = this.data.mode === 'edit' ? this.data.entry : undefined;

        // Find all overlaps classified by type
        const result = await this.dataManager.findOverlaps(startDateTime, endDateTime, excludeEntry);

        // Race condition guard: only apply results if this is still the latest request
        if (requestId !== this.validationRequestId) {
            Logger.log('EntryModal: Discarding stale validation result', { requestId, currentId: this.validationRequestId });
            return false;
        }

        this.startOverlap = result.startOverlap;
        this.endOverlap = result.endOverlap;
        this.encompassedEntry = result.encompassedEntry;

        Logger.log('EntryModal: startOverlap =', this.startOverlap
            ? `${this.startOverlap.start} - ${this.startOverlap.end}` : 'null');
        Logger.log('EntryModal: endOverlap =', this.endOverlap
            ? `${this.endOverlap.start} - ${this.endOverlap.end}` : 'null');
        Logger.log('EntryModal: encompassedEntry =', this.encompassedEntry
            ? `${this.encompassedEntry.start} - ${this.encompassedEntry.end}` : 'null');

        this.updateOverlapUI();
        return !this.startOverlap && !this.endOverlap && !this.encompassedEntry;
    }

    /**
     * Update UI based on overlap state
     */
    private updateOverlapUI(): void {
        const hasStartOverlap = this.startOverlap !== null;
        const hasEndOverlap = this.endOverlap !== null;
        const hasEncompassed = this.encompassedEntry !== null;
        const durationWarning = !this.startTimeValue || !this.endTimeValue || !this.startDateValue || !this.endDateValue
            ? t('Enter a valid start and end date/time')
            : t('End time must be after start time');

        // Red border on start inputs if start is inside an entry
        if (this.startDateInput?.inputEl) {
            this.startDateInput.inputEl.toggleClass('time-input-error', hasStartOverlap);
        }
        if (this.startTimeInput?.inputEl) {
            this.startTimeInput.inputEl.toggleClass('time-input-error', hasStartOverlap);
        }

        // Red border on end inputs if end is inside an entry
        if (this.endDateInput?.inputEl) {
            this.endDateInput.inputEl.toggleClass('time-input-error', hasEndOverlap);
        }
        if (this.endTimeInput?.inputEl) {
            this.endTimeInput.inputEl.toggleClass('time-input-error', hasEndOverlap);
        }

        const messages: string[] = [];
        if (hasStartOverlap) {
            const entry = this.startOverlap;
            messages.push(t('Start overlaps with {label} ({start} – {end})', {
                label: this.formatEntryLabel(entry), start: entry.start, end: entry.end,
            }));
        }
        if (hasEndOverlap) {
            const entry = this.endOverlap;
            messages.push(t('End overlaps with {label} ({start} – {end})', {
                label: this.formatEntryLabel(entry), start: entry.start, end: entry.end,
            }));
        }
        if (hasEncompassed) {
            const entry = this.encompassedEntry;
            messages.push(t('Conflicts with {label} ({start} – {end})', {
                label: this.formatEntryLabel(entry), start: entry.start, end: entry.end,
            }));
        }
        if (this.hasInvalidDuration) messages.push(durationWarning);
        this.warningBanner?.setMessages(messages);

        // Update save button state
        this.updateSaveButtonState();
    }

    /**
     * Update save button enabled/disabled state based on all validation
     */
    private updateSaveButtonState(): void {
        if (this.saveButton) {
            this.saveButton.disabled = this.isSaving;
            this.saveButton.toggleClass('is-disabled', this.isSaving);
        }
    }

    /**
     * Format a label for conflict warnings and time snapping
     */
    private formatEntryLabel(entry: TimeEntry): string {
        const parts: string[] = [];


        // Project (if present)
        if (entry.project) {
            parts.push(this.resolveProjectName(entry.project));
        }

        // Activity (if present)
        if (entry.activity) {
            parts.push(this.resolveActivityName(entry.activity));
        }

        return parts.join(' > ') || entry.description || t('(No description)');
    }
    /**
     * Check if two entries are same (helper for filtering)
     */
    private isSameEntry(a: TimeEntry, b: TimeEntry): boolean {
        return (
            a.startDateTime.getTime() === b.startDateTime.getTime() &&
            a.endDateTime.getTime() === b.endDateTime.getTime() &&
            a.description === b.description
        );
    }

    /**
     * Find adjacent entries (previous ending before start, next starting after end)
     */
    private async findAdjacentEntries(): Promise<void> {
        const startDateTime = new Date(`${this.startDateValue}T${this.startTimeValue}`);
        const endDateTime = new Date(`${this.endDateValue}T${this.endTimeValue}`);

        if (isNaN(startDateTime.getTime()) || isNaN(endDateTime.getTime())) {
            this.previousEntry = null;
            this.nextEntry = null;
            this.updateMagnetButtons();
            return;
        }

        const excludeEntry = this.data.mode === 'edit' ? this.data.entry : undefined;
        const { previous, next } = await this.dataManager.findAdjacentEntries(startDateTime, endDateTime, excludeEntry);

        this.previousEntry = previous;
        this.nextEntry = next;
        this.updateMagnetButtons();
    }

    /**
     * Update magnet button visibility and tooltips
     */
    private updateMagnetButtons(): void {
        // Start magnet - snaps to end of previous entry
        if (this.startSnapHint) {
            if (this.previousEntry) {
                this.startSnapHint.removeClass('is-hidden');
                const prevEnd = this.previousEntry.end;
                const previousLabel = this.formatEntryLabel(this.previousEntry);
                this.startSnapHint.setAttribute('aria-label', t('Snap to {time} (end of {label})', { time: prevEnd, label: previousLabel }));
            } else {
                this.startSnapHint.addClass('is-hidden');
            }
        }

        // End magnet - snaps to start of next entry
        if (this.endSnapHint) {
            if (this.nextEntry) {
                this.endSnapHint.removeClass('is-hidden');
                const nextStart = this.nextEntry.start;
                const nextLabel = this.formatEntryLabel(this.nextEntry);
                this.endSnapHint.setAttribute('aria-label', t('Snap to {time} (start of {label})', { time: nextStart, label: nextLabel }));
            } else {
                this.endSnapHint.addClass('is-hidden');
            }
        }
    }

    /**
     * Snap start time to end of previous entry
     */
    private snapStartToPrevious(): void {
        if (!this.previousEntry) return;

        // Use the previous entry's end date/time
        this.startDateValue = TableParser.getDateString(this.previousEntry.endDateTime);
        this.startTimeValue = this.previousEntry.end;

        if (this.startDateInput !== null) {
            this.startDateInput.setValue(this.startDateValue);
        }
        if (this.startTimeInput !== null) {
            this.startTimeInput.setValue(this.startTimeValue);
        }

        this.resetTimeValidation();
        void this.findAdjacentEntries();
    }

    /**
     * Snap end time to start of next entry
     */
    private snapEndToNext(): void {
        if (!this.nextEntry) return;

        // Use the next entry's start date/time
        this.endDateValue = TableParser.getDateString(this.nextEntry.startDateTime);
        this.endTimeValue = this.nextEntry.start;

        if (this.endDateInput !== null) {
            this.endDateInput.setValue(this.endDateValue);
        }
        if (this.endTimeInput !== null) {
            this.endTimeInput.setValue(this.endTimeValue);
        }

        this.resetTimeValidation();
        void this.findAdjacentEntries();
    }
}

/**
 * Modal for selecting an existing note via fuzzy search
 */
class NoteSuggestModal extends FuzzySuggestModal<TFile> {
    private onSelect: (file: TFile) => void;

    constructor(app: App, onSelect: (file: TFile) => void) {
        super(app);
        this.onSelect = onSelect;
        this.setPlaceholder(t('Search for a note...'));
    }

    getItems(): TFile[] {
        return this.app.vault.getMarkdownFiles();
    }

    getItemText(file: TFile): string {
        return file.path;
    }

    onChooseItem(file: TFile, _evt: MouseEvent | KeyboardEvent): void {
        this.onSelect(file);
    }
}
