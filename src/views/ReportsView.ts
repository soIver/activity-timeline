import { t, getLocale, formatDuration } from '../i18n';
import { ItemView, WorkspaceLeaf, Notice } from 'obsidian';
import { VIEW_TYPE_REPORTS, TimeEntry, TimeTrackerSettings, TimeRangePreset, ProjectReport, ProjectActivityBreakdown, ActivityReport } from '../types';
import { DataManager } from '../data/DataManager';
import { TableParser } from '../data/TableParser';
import { Logger } from '../utils/Logger';

/** Maximum days allowed for report range to prevent performance issues */
const MAX_REPORT_DAYS = 90;

/**
 * Reports view showing time breakdowns by project and tag
 */
export class ReportsView extends ItemView {
    private settings: TimeTrackerSettings;
    private dataManager: DataManager;

    // Current report state
    private selectedPreset: TimeRangePreset = 'this-week';
    private customStartDate: Date | null = null;
    private customEndDate: Date | null = null;
    private projectReports: ProjectReport[] = [];
    private activityReports: ActivityReport[] = [];
    private totalMinutes: number = 0;

    // DOM references
    private contentContainer: HTMLElement;
    private rangeSelector: HTMLElement;
    private customDateInputs: HTMLElement;
    private summaryContainer: HTMLElement;
    private reportsContainer: HTMLElement;
    private activityContainer: HTMLElement;

    private expandedProjects: Set<string> = new Set();
    private reportRequest = 0;

    constructor(
        leaf: WorkspaceLeaf,
        settings: TimeTrackerSettings,
        dataManager: DataManager
    ) {
        super(leaf);
        this.settings = settings;
        this.dataManager = dataManager;
    }

    getViewType(): string {
        return VIEW_TYPE_REPORTS;
    }

    getDisplayText(): string {
        return t('Reports');
    }

    getIcon(): string {
        return 'pie-chart';
    }

    async onOpen(): Promise<void> {
        this.render();
        await this.loadReport();
    }

    async onClose(): Promise<void> {
        await super.onClose();
    }

    updateSettings(settings: TimeTrackerSettings): void {
        this.settings = settings;
        this.render();
        void this.loadReport();
    }

    async refresh(): Promise<void> {
        await this.loadReport();
    }

    /**
     * Main render function
     */
    private render(): void {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass('time-tracker-reports');

        // Header
        this.renderHeader(container);

        // Content container
        this.contentContainer = container.createDiv('reports-content');

        // Range selector
        this.rangeSelector = this.contentContainer.createDiv('reports-range-selector');
        this.renderRangeSelector();

        // Custom date inputs (hidden by default)
        this.customDateInputs = this.contentContainer.createDiv('reports-custom-dates');
        this.customDateInputs.toggleClass('is-hidden', this.selectedPreset !== 'custom');
        this.renderCustomDateInputs();

        // Summary section
        this.summaryContainer = this.contentContainer.createDiv('reports-summary');

        // Reports table (By Project)
        this.reportsContainer = this.contentContainer.createDiv('reports-table-container');

        // Activity breakdown section
        this.activityContainer = this.contentContainer.createDiv('reports-table-container');


    }

    /**
     * Render the header
     */
    private renderHeader(container: HTMLElement): void {
        const header = container.createDiv('reports-header');

        const titleSection = header.createDiv('reports-header-title');
        titleSection.createEl('h2', { text: t('Time reports') });

        const controls = header.createDiv('reports-header-controls');

        // Export CSV button
        const exportCsvBtn = controls.createEl('button', {
            text: t('Export CSV'),
            cls: 'reports-btn',
        });
        exportCsvBtn.addEventListener('click', () => { void this.exportToCSV(); });

        // Export JSON button
        const exportJsonBtn = controls.createEl('button', {
            text: t('Export JSON'),
            cls: 'reports-btn',
        });
        exportJsonBtn.addEventListener('click', () => { void this.exportToJSON(); });

        // Refresh button
        const refreshBtn = controls.createEl('button', {
            text: t('Refresh'),
            cls: 'reports-btn',
        });
        refreshBtn.addEventListener('click', () => { void this.loadReport(); });
    }

    /**
     * Render time range preset buttons
     */
    private renderRangeSelector(): void {
        this.rangeSelector.empty();

        const presets: { value: TimeRangePreset; label: string }[] = [
            { value: 'today', label: t('Today') },
            { value: 'yesterday', label: t('Yesterday') },
            { value: 'this-week', label: t('This Week') },
            { value: 'last-week', label: t('Last Week') },
            { value: 'this-month', label: t('This Month') },
            { value: 'last-month', label: t('Last Month') },
            { value: 'custom', label: t('Custom') },
        ];

        for (const preset of presets) {
            const btn = this.rangeSelector.createEl('button', {
                text: preset.label,
                cls: `reports-range-btn ${this.selectedPreset === preset.value ? 'is-active' : ''}`,
            });
            btn.addEventListener('click', () => this.selectPreset(preset.value));
        }
    }

    /**
     * Render custom date inputs
     */
    private renderCustomDateInputs(): void {
        this.customDateInputs.empty();

        const startLabel = this.customDateInputs.createEl('label', { text: t('From: ') });
        const startInput = startLabel.createEl('input', { type: 'date' });
        if (this.customStartDate) {
            startInput.value = TableParser.getDateString(this.customStartDate);
        }
        startInput.addEventListener('change', (e) => {
            this.customStartDate = new Date((e.target as HTMLInputElement).value);
            void this.loadReport();
        });

        const endLabel = this.customDateInputs.createEl('label', { text: t('To: ') });
        const endInput = endLabel.createEl('input', { type: 'date' });
        if (this.customEndDate) {
            endInput.value = TableParser.getDateString(this.customEndDate);
        }
        endInput.addEventListener('change', (e) => {
            this.customEndDate = new Date((e.target as HTMLInputElement).value);
            void this.loadReport();
        });
    }

    /**
     * Select a time range preset
     */
    private selectPreset(preset: TimeRangePreset): void {
        this.selectedPreset = preset;
        this.renderRangeSelector();

        // Show/hide custom date inputs
        if (preset === 'custom') {
            this.customDateInputs.removeClass('is-hidden');
            // Set default custom range to this week if not set
            if (!this.customStartDate || !this.customEndDate) {
                const { start, end } = this.getDateRange('this-week');
                this.customStartDate = start;
                this.customEndDate = end;
                this.renderCustomDateInputs();
            }
        } else {
            this.customDateInputs.addClass('is-hidden');
        }

        void this.loadReport();
    }

    /**
     * Get date range for a preset
     */
    private getDateRange(preset: TimeRangePreset): { start: Date; end: Date } {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        switch (preset) {
            case 'today':
                return {
                    start: today,
                    end: new Date(today.getTime() + 24 * 60 * 60 * 1000 - 1),
                };

            case 'yesterday': {
                const yesterday = new Date(today);
                yesterday.setDate(today.getDate() - 1);
                const yesterdayEnd = new Date(yesterday);
                yesterdayEnd.setHours(23, 59, 59, 999);
                return { start: yesterday, end: yesterdayEnd };
            }

            case 'this-week': {
                const dayOfWeek = today.getDay();
                const mondayOffset = this.settings.weekStart === 'monday'
                    ? (dayOfWeek === 0 ? -6 : 1 - dayOfWeek)
                    : -dayOfWeek;
                const weekStart = new Date(today);
                weekStart.setDate(today.getDate() + mondayOffset);
                const weekEnd = new Date(weekStart);
                weekEnd.setDate(weekStart.getDate() + 6);
                weekEnd.setHours(23, 59, 59, 999);
                return { start: weekStart, end: weekEnd };
            }

            case 'last-week': {
                const dayOfWeek = today.getDay();
                const mondayOffset = this.settings.weekStart === 'monday'
                    ? (dayOfWeek === 0 ? -6 : 1 - dayOfWeek)
                    : -dayOfWeek;
                const thisWeekStart = new Date(today);
                thisWeekStart.setDate(today.getDate() + mondayOffset);
                const lastWeekStart = new Date(thisWeekStart);
                lastWeekStart.setDate(thisWeekStart.getDate() - 7);
                const lastWeekEnd = new Date(lastWeekStart);
                lastWeekEnd.setDate(lastWeekStart.getDate() + 6);
                lastWeekEnd.setHours(23, 59, 59, 999);
                return { start: lastWeekStart, end: lastWeekEnd };
            }

            case 'this-month': {
                const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
                const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
                monthEnd.setHours(23, 59, 59, 999);
                return { start: monthStart, end: monthEnd };
            }

            case 'last-month': {
                const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
                const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
                lastMonthEnd.setHours(23, 59, 59, 999);
                return { start: lastMonthStart, end: lastMonthEnd };
            }

            case 'custom': {
                const customStart = this.customStartDate || today;
                const customEnd = this.customEndDate || today;
                // Set end to end of day (23:59:59.999) so the full day is included
                const customEndEOD = new Date(customEnd);
                customEndEOD.setHours(23, 59, 59, 999);
                return { start: customStart, end: customEndEOD };
            }

            default: {
                // Set end to end of day
                const defaultEnd = new Date(today);
                defaultEnd.setHours(23, 59, 59, 999);
                return { start: today, end: defaultEnd };
            }
        }
    }

    /**
     * Load report data for the selected time range
     */
    private async loadReport(): Promise<void> {
        const { start, end } = this.getDateRange(this.selectedPreset);

        // Check if range exceeds maximum
        const daysDiff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
        if (daysDiff > MAX_REPORT_DAYS) {
            new Notice(t('Report range limited to {days} days for performance. Please select a shorter range.', { days: MAX_REPORT_DAYS }));
            return;
        }

        Logger.log('ReportsView: Loading report for', start.toDateString(), 'to', end.toDateString());

        // Load entries for the date range (includes overlapping entries)
        const request = ++this.reportRequest;
        const entries = await this.dataManager.loadDateRange(start, end);
        if (request !== this.reportRequest) return;

        Logger.log('ReportsView: Found', entries.length, 'entries');

        // Calculate reports with effective durations (handles midnight-spanning)
        this.calculateReports(entries, start, end);
        this.calculateActivityReports(entries, start, end);

        // Render the results
        this.renderSummary(start, end);
        this.renderTables();
    }

    /**
     * Calculate project and activity reports from entries
     * Uses effective duration to handle midnight-spanning entries correctly
     */
    private calculateReports(entries: TimeEntry[], rangeStart: Date, rangeEnd: Date): void {
        // Group by project, with activity breakdown within each project
        const projectMap = new Map<string, { minutes: number; activityMap: Map<string, number> }>();

        this.totalMinutes = 0;

        for (const entry of entries) {
            // Calculate effective duration within the query range
            // This handles midnight-spanning entries correctly
            const effectiveMinutes = this.dataManager.getEffectiveDuration(entry, rangeStart, rangeEnd);

            if (effectiveMinutes <= 0) continue;

            const projectName = this.projectName(entry.project);

            if (!projectMap.has(projectName)) {
                projectMap.set(projectName, { minutes: 0, activityMap: new Map() });
            }

            const projectData = projectMap.get(projectName);
            projectData.minutes += effectiveMinutes;
            this.totalMinutes += effectiveMinutes;

            // Track activity within this project (mutually exclusive - each entry has 0 or 1 activity)
            const activityName = this.activityName(entry.activity);
            const current = projectData.activityMap.get(activityName) || 0;
            projectData.activityMap.set(activityName, current + effectiveMinutes);
        }

        // Convert to ProjectReport array
        this.projectReports = [];

        for (const [projectName, data] of projectMap) {
            const projectColor = this.getProjectColor(projectName);
            const percentage = this.totalMinutes > 0
                ? (data.minutes / this.totalMinutes) * 100
                : 0;

            // Build activity breakdown (percentages add up to 100% since activities are mutually exclusive)
            const activityBreakdown: ProjectActivityBreakdown[] = [];
            for (const [activityName, activityMinutes] of data.activityMap) {
                const activityColor = this.getActivityColor(activityName);
                activityBreakdown.push({
                    activity: activityName,
                    color: activityColor,
                    totalMinutes: activityMinutes,
                    percentageOfProject: data.minutes > 0
                        ? (activityMinutes / data.minutes) * 100
                        : 0,
                });
            }

            // Sort activities by time descending
            activityBreakdown.sort((a, b) => b.totalMinutes - a.totalMinutes);

            this.projectReports.push({
                project: projectName,
                color: projectColor,
                totalMinutes: data.minutes,
                percentage,
                activityBreakdown,
            });
        }

        // Sort projects by time descending
        this.projectReports.sort((a, b) => b.totalMinutes - a.totalMinutes);
    }

    /**
     * Calculate activity reports from entries
     * Activities are mutually exclusive so percentages add up to 100%
     */
    private calculateActivityReports(entries: TimeEntry[], rangeStart: Date, rangeEnd: Date): void {
        const activityMap = new Map<string, number>();

        for (const entry of entries) {
            // Calculate effective duration within the query range
            const effectiveMinutes = this.dataManager.getEffectiveDuration(entry, rangeStart, rangeEnd);

            if (effectiveMinutes <= 0) continue;

            const activityName = this.activityName(entry.activity);

            const current = activityMap.get(activityName) || 0;
            activityMap.set(activityName, current + effectiveMinutes);
        }

        // Convert to ActivityReport array
        this.activityReports = [];

        for (const [activityName, minutes] of activityMap) {
            const activityColor = this.getActivityColor(activityName);
            const percentage = this.totalMinutes > 0
                ? (minutes / this.totalMinutes) * 100
                : 0;

            this.activityReports.push({
                activity: activityName,
                name: activityName,
                color: activityColor,
                totalMinutes: minutes,
                percentage,
            });
        }

        // Sort activities by time descending
        this.activityReports.sort((a, b) => b.totalMinutes - a.totalMinutes);
    }

    /**
     * Render the summary section
     */
    private renderSummary(start: Date, end: Date): void {
        this.summaryContainer.empty();

        // Date range label
        const rangeLabel = this.summaryContainer.createDiv('reports-range-label');
        rangeLabel.setText(this.formatDateRange(start, end));

        // Total hours
        const totalCard = this.summaryContainer.createDiv('reports-total-card');
        totalCard.createDiv({ text: t('Total Time'), cls: 'reports-total-label' });
        totalCard.createDiv({ text: this.formatDuration(this.totalMinutes), cls: 'reports-total-value' });

        // Project count
        const projectCard = this.summaryContainer.createDiv('reports-summary-card');
        projectCard.createDiv({ text: t('Projects'), cls: 'reports-summary-label' });
        projectCard.createDiv({ text: String(this.projectReports.length), cls: 'reports-summary-value' });

        const activityCard = this.summaryContainer.createDiv('reports-summary-card');
        activityCard.createDiv({ text: t('Activities'), cls: 'reports-summary-label' });
        activityCard.createDiv({ text: String(this.activityReports.length), cls: 'reports-summary-value' });
    }

    private renderTables(): void {
        this.reportsContainer.empty();
        this.activityContainer.empty();
        if (!this.projectReports.length) {
            this.reportsContainer.createDiv({ text: t('No time entries found for this period.'), cls: 'reports-empty' });
            return;
        }
        this.reportsContainer.createEl('h3', { text: t('By project') });
        const projects = this.createTable(this.reportsContainer, t('Project / activity'));
        for (const report of this.projectReports) {
            const row = this.reportRow(projects, report.project, report.color, report.totalMinutes, report.percentage);
            const toggle = row.firstElementChild.createEl('button', {
                text: this.expandedProjects.has(report.project) ? '▾' : '▸',
                attr: { 'aria-label': t('Show activities'), 'aria-expanded': String(this.expandedProjects.has(report.project)) },
            });
            toggle.addEventListener('click', () => {
                if (this.expandedProjects.has(report.project)) this.expandedProjects.delete(report.project);
                else this.expandedProjects.add(report.project);
                this.renderTables();
            });
            if (this.expandedProjects.has(report.project)) {
                for (const activity of report.activityBreakdown) {
                    this.reportRow(projects, activity.activity, activity.color, activity.totalMinutes,
                        activity.percentageOfProject).addClass('reports-activity-nested-row');
                }
            }
        }
        this.activityContainer.createEl('h3', { text: t('By activity') });
        const activities = this.createTable(this.activityContainer, t('Activity'));
        for (const report of this.activityReports) {
            this.reportRow(activities, report.name, report.color, report.totalMinutes, report.percentage);
        }
    }

    private createTable(container: HTMLElement, label: string): HTMLElement {
        const table = container.createEl('table', { cls: 'reports-table' });
        const header = table.createEl('thead').createEl('tr');
        for (const name of [label, t('Duration'), '%', '']) header.createEl('th', { text: name });
        return table.createEl('tbody');
    }

    private reportRow(body: HTMLElement, name: string, color: string, minutes: number, percentage: number): HTMLElement {
        const row = body.createEl('tr');
        const cell = row.createEl('td');
        cell.createSpan('reports-color-dot').style.backgroundColor = color;
        cell.createSpan({ text: name });
        row.createEl('td', { text: this.formatDuration(minutes), cls: 'reports-col-hours' });
        row.createEl('td', { text: `${percentage.toFixed(1)}%`, cls: 'reports-col-percent' });
        const bar = row.createEl('td', { cls: 'reports-col-bar' }).createDiv('reports-bar');
        bar.style.width = `${Math.min(100, percentage)}%`;
        bar.style.backgroundColor = color;
        return row;
    }

    private projectName(value?: string): string {
        if (!value) return t('No project');
        return this.settings.projects.find(item => item.id === value || item.name === value || item.aliases?.includes(value))?.name || value;
    }

    private activityName(value?: string): string {
        if (!value) return t('No activity');
        return this.settings.activities.find(item => item.id === value || item.name === value || item.aliases?.includes(value))?.name || value;
    }

    // Helper methods

    private formatDuration(minutes: number): string { return formatDuration(minutes); }

    private formatDateRange(start: Date, end: Date): string {
        const sameDay = start.toDateString() === end.toDateString();
        const options: Intl.DateTimeFormatOptions = {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
        };

        if (sameDay) {
            return start.toLocaleDateString(getLocale(), options);
        }

        return `${start.toLocaleDateString(getLocale(), { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString(getLocale(), options)}`;
    }

    private getProjectColor(projectName: string): string {
        if (projectName === t('No project')) return '#666';
        const project = this.settings.projects.find(p => p.name === projectName || p.id === projectName || p.aliases?.includes(projectName));
        return project?.color || '#4f46e5';
    }

    private getActivityColor(activityName: string): string {
        if (activityName === t('No activity')) return '#666';
        const activity = this.settings.activities.find(a => a.name === activityName || a.id === activityName || a.aliases?.includes(activityName));
        return activity?.color || '#f59e0b';
    }

    /**
     * Export current report data to CSV
     */
    private async exportToCSV(): Promise<void> {
        const { start, end } = this.getDateRange(this.selectedPreset);

        // Load entries for the date range
        const entries = await this.dataManager.loadDateRange(start, end);

        if (entries.length === 0) {
            Logger.log('ReportsView: No entries to export');
            return;
        }

        // Generate CSV content
        const csv = this.generateCSV(entries);

        // Create filename with date range
        const startStr = TableParser.getDateString(start);
        const endStr = TableParser.getDateString(end);
        const filename = `time-entries-${startStr}-to-${endStr}.csv`;

        // Trigger download
        this.downloadCSV(csv, filename);
    }

    /**
     * Generate CSV content from time entries
     */
    private generateCSV(entries: TimeEntry[]): string {
        // CSV headers - Start/End include full datetime since entries can span days
        const headers = ['Start', 'End', 'Duration', 'Description', 'Project', 'Activity', 'Notes'];

        // Sort entries by date/time
        const sorted = [...entries].sort((a, b) =>
            a.startDateTime.getTime() - b.startDateTime.getTime()
        );

        // Build rows
        const rows: string[][] = [headers];

        for (const entry of sorted) {
            const row = [
                TableParser.formatDateTime(entry.startDateTime),
                TableParser.formatDateTime(entry.endDateTime),
                this.formatDuration(entry.durationMinutes),
                entry.description || '',
                entry.project ? this.projectName(entry.project) : '',
                entry.activity ? this.activityName(entry.activity) : '',
                entry.linkedNote || '',
            ];
            rows.push(row);
        }

        // Convert to CSV string with proper escaping
        return rows.map(row =>
            row.map(cell => this.escapeCSVCell(cell)).join(',')
        ).join('\n');
    }

    /**
     * Escape a cell value for CSV format
     */
    private escapeCSVCell(value: string): string {
        // If value contains comma, quote, or newline, wrap in quotes and escape quotes
        if (value.includes(',') || value.includes('"') || value.includes('\n')) {
            return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
    }

    /**
     * Trigger browser download of CSV file
     */
    private downloadCSV(content: string, filename: string): void {
        const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);

        const link = createEl('a');
        link.href = url;
        link.download = filename;
        link.classList.add('is-hidden');

        activeDocument.body.appendChild(link);
        link.click();
        activeDocument.body.removeChild(link);

        URL.revokeObjectURL(url);

        Logger.log('ReportsView: Exported CSV -', filename);
    }

    /**
     * Export current report data to JSON
     */
    private async exportToJSON(): Promise<void> {
        const { start, end } = this.getDateRange(this.selectedPreset);

        // Load entries for the date range
        const entries = await this.dataManager.loadDateRange(start, end);

        if (entries.length === 0) {
            new Notice(t('No entries to export'));
            return;
        }

        // Generate JSON content
        const json = this.generateJSON(entries, start, end);

        // Create filename with date range
        const startStr = TableParser.getDateString(start);
        const endStr = TableParser.getDateString(end);
        const filename = `time-entries-${startStr}-to-${endStr}.json`;

        this.downloadJSON(json, filename);
    }

    /**
     * Generate JSON content from time entries
     */
    private generateJSON(entries: TimeEntry[], start: Date, end: Date): string {
        // Sort entries by date/time
        const sorted = [...entries].sort((a, b) =>
            a.startDateTime.getTime() - b.startDateTime.getTime()
        );

        // Build export object
        const exportData = {
            exportedAt: new Date().toISOString(),
            dateRange: {
                start: TableParser.getDateString(start),
                end: TableParser.getDateString(end),
            },
            totalEntries: sorted.length,
            entries: sorted.map(entry => ({
                date: entry.date,
                start: entry.start,
                end: entry.end,
                durationMinutes: entry.durationMinutes,
                description: entry.description,
                project: entry.project ? this.projectName(entry.project) : null,
                activity: entry.activity ? this.activityName(entry.activity) : null,
                linkedNote: entry.linkedNote || null,
            })),
        };

        return JSON.stringify(exportData, null, 2);
    }

    /**
     * Trigger browser download of JSON file
     */
    private downloadJSON(content: string, filename: string): void {
        const blob = new Blob([content], { type: 'application/json;charset=utf-8;' });
        const url = URL.createObjectURL(blob);

        const link = createEl('a');
        link.href = url;
        link.download = filename;
        link.classList.add('is-hidden');

        activeDocument.body.appendChild(link);
        link.click();
        activeDocument.body.removeChild(link);

        URL.revokeObjectURL(url);

        Logger.log('ReportsView: Exported JSON -', filename);
    }
}
