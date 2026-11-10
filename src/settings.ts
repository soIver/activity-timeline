import { App, PluginSettingTab, SettingDefinitionItem } from 'obsidian';
import { DEFAULT_SETTINGS, TimeTrackerSettings } from './types';
import type WhereDidTheTimeGoPlugin from '../main';
import { ActivityManagerModal } from './modals/ActivityModal';
import { t } from './i18n';

type SettingKey = keyof TimeTrackerSettings;

export class TimeTrackerSettingTab extends PluginSettingTab {
    constructor(app: App, public plugin: WhereDidTheTimeGoPlugin) { super(app, plugin); }

    getSettingDefinitions(): SettingDefinitionItem<SettingKey>[] {
        const hours: Record<string, string> = {};
        for (let hour = 0; hour < 24; hour++) hours[String(hour)] = `${String(hour).padStart(2, '0')}:00`;
        return [
            { type: 'group', heading: t('Language'), items: [
                { name: t('Interface language'), desc: t('Automatic follows the Obsidian language. Other languages use English.'),
                    control: { type: 'dropdown', key: 'language', options: { auto: t('Automatic'), en: 'English', ru: 'Русский' } } },
            ] },
            { type: 'group', heading: t('Storage'), items: [
                { name: t('Time tracking folder'), desc: t('Folder where time entries will be stored (relative to vault root)'),
                    control: { type: 'text', key: 'timeTrackingFolder', placeholder: 'TimeTracking' } },
                { name: t('Auto-create folder'), desc: t('Automatically create the time tracking folder if it does not exist'),
                    control: { type: 'toggle', key: 'autoCreateFolder' } },
                { name: t('Hide tables in reading view'), desc: t('Wrap data tables in %% comment markers to hide them in reading view.'),
                    control: { type: 'toggle', key: 'hideTablesInPreview' } },
            ] },
            { type: 'group', heading: t('Timeline display'), items: [
                { name: t('Hour height'), desc: t('Height in pixels for each hour in the timeline view'),
                    control: { type: 'slider', key: 'hourHeight', min: 200, max: 240, step: 10 } },
                { name: t('Day start hour'), desc: t('Hour shown when navigating to a day'),
                    control: { type: 'dropdown', key: 'dayStartHour', options: hours } },
                { name: t('24-hour format'), control: { type: 'toggle', key: 'use24HourFormat' } },
                { name: t('Description max length'), desc: t('Maximum characters for entry descriptions (0 = no limit)'),
                    control: { type: 'number', key: 'descriptionMaxLength', min: 0 } },
                { name: t('Week start'), control: { type: 'dropdown', key: 'weekStart', options: { monday: t('Monday'), sunday: t('Sunday') } } },
            ] },
            { type: 'group', heading: t('Activities and projects'), items: [
                { name: t('Activities'), render: setting => {
                    setting.settingEl.addClass('at-settings-actions');
                    setting.addButton(button => button.setButtonText(t('Manage activities')).onClick(() => {
                        new ActivityManagerModal(this.app, this.plugin.settings, () => this.plugin.saveSettings()).open();
                    }));
                } },
                { name: t('Projects'), render: setting => {
                    setting.settingEl.addClass('at-settings-actions');
                    setting.addButton(button => button.setButtonText(t('Manage projects')).onClick(() => {
                        new ActivityManagerModal(this.app, this.plugin.settings, () => this.plugin.saveSettings(), () => {}, 'project').open();
                    }));
                } },
                { name: t('Default activity'), control: { type: 'dropdown', key: 'defaultActivity', options: {
                    '': t('No activity'), ...Object.fromEntries(this.plugin.settings.activities.map(item => [item.id, item.name])),
                } } },
                { name: t('Default project'), control: { type: 'dropdown', key: 'defaultProject', options: {
                    '': t('No project'), ...Object.fromEntries(this.plugin.settings.projects.filter(item => !item.archived).map(item => [item.id, item.name])),
                } } },
            ] },
            { type: 'group', heading: t('Developer'), items: [
                { name: t('Debug mode'), desc: t('Enable verbose logging to the developer console'),
                    control: { type: 'toggle', key: 'debugMode' } },
            ] },
        ];
    }

    getControlValue(key: string): unknown {
        if (key === 'dayStartHour') return String(this.plugin.settings.dayStartHour);
        if (key === 'defaultActivity' || key === 'defaultProject') {
            const value = this.plugin.settings[key];
            const items = key === 'defaultActivity' ? this.plugin.settings.activities : this.plugin.settings.projects;
            return items.find(item => item.id === value || item.name === value || item.aliases?.includes(value))?.id || '';
        }
        return this.plugin.settings[key as SettingKey];
    }

    async setControlValue(key: string, value: unknown): Promise<void> {
        let normalized = value;
        if (key === 'timeTrackingFolder') normalized = value || DEFAULT_SETTINGS.timeTrackingFolder;
        if (key === 'dayStartHour') normalized = Number(value);
        if (key === 'descriptionMaxLength') normalized = Math.max(0, Math.trunc(value as number) || 0);
        (this.plugin.settings as unknown as Record<string, unknown>)[key] = normalized;
        await this.plugin.saveSettings();
        if (key === 'language') this.update();
    }
}
