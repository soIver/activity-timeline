import { configureLanguage, formatDuration, getLocale, t } from '../src/i18n';
import { setMockLanguage } from './__mocks__/obsidian';

afterEach(() => { configureLanguage('en'); setMockLanguage('en'); });

describe('Plugin localization', () => {
    it('follows the Obsidian language and falls back to English for unsupported locales', () => {
        configureLanguage('auto');
        setMockLanguage('ru-RU');
        expect(getLocale()).toBe('ru'); expect(t('Save')).toBe('Сохранить');
        setMockLanguage('de');
        expect(getLocale()).toBe('en'); expect(t('Save')).toBe('Save');
    });
    it('allows explicit language override and interpolates parameters', () => {
        setMockLanguage('en'); configureLanguage('ru');
        expect(t('Snap to {time} (end of {label})', { time: '12:30', label: 'Чтение' })).toBe('Установить 12:30 (окончание «Чтение»)');
        expect(formatDuration(90)).toBe('1 ч 30 мин');
        expect(formatDuration(0)).toBe('0 мин');
        configureLanguage('en'); expect(formatDuration(90)).toBe('1h 30m');
    });
});
