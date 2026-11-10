import { t } from '../i18n';

export function rgbToHsv(color: string): [number, number, number] {
    const values = color.slice(1).match(/../g).map(part => parseInt(part, 16) / 255);
    const [r, g, b] = values;
    const max = Math.max(...values), min = Math.min(...values), delta = max - min;
    let hue = 0;
    if (delta) {
        if (max === r) hue = ((g - b) / delta) % 6;
        else if (max === g) hue = (b - r) / delta + 2;
        else hue = (r - g) / delta + 4;
    }
    return [(hue * 60 + 360) % 360, max ? delta / max : 0, max];
}

export function hsvToHex(h: number, s: number, v: number): string {
    const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
    const rgb = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
        : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return '#' + rgb.map(channel => Math.round((channel + m) * 255).toString(16).padStart(2, '0')).join('');
}

/** Embedded palette avoids platform-specific native color dialogs. */
export class ColorPalette {
    private hue: number;
    private saturation: number;
    private brightness: number;
    private readonly field: HTMLElement;
    private readonly cursor: HTMLElement;
    private readonly hueInput: HTMLInputElement;
    private readonly hex: HTMLInputElement;
    private readonly rgb: HTMLInputElement[] = [];
    private readonly preview: HTMLElement;
    value: string;

    constructor(container: HTMLElement, color: string, private readonly onChange: (color: string) => void) {
        this.value = /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : '#708a9b';
        [this.hue, this.saturation, this.brightness] = rgbToHsv(this.value);
        const root = container.createDiv('at-color-palette');
        this.field = root.createDiv('at-color-field');
        this.field.tabIndex = 0;
        this.field.setAttribute('role', 'group');
        this.field.setAttribute('aria-label', t('Color palette. Arrow keys adjust saturation and brightness.'));
        this.cursor = this.field.createSpan('at-color-cursor');
        const select = (event: PointerEvent) => {
            const rect = this.field.getBoundingClientRect();
            this.saturation = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
            this.brightness = 1 - Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
            this.commit();
        };
        this.field.addEventListener('pointerdown', event => {
            if (event.button !== 0) return;
            event.preventDefault();
            this.field.focus();
            this.field.setPointerCapture(event.pointerId);
            select(event);
        });
        this.field.addEventListener('pointermove', event => {
            if (this.field.hasPointerCapture(event.pointerId)) select(event);
        });
        this.field.addEventListener('pointerup', event => {
            if (this.field.hasPointerCapture(event.pointerId)) this.field.releasePointerCapture(event.pointerId);
        });
        this.field.addEventListener('keydown', event => {
            const step = event.shiftKey ? 0.1 : 0.01;
            switch (event.key) {
                case 'ArrowLeft': this.saturation -= step; break;
                case 'ArrowRight': this.saturation += step; break;
                case 'ArrowDown': this.brightness -= step; break;
                case 'ArrowUp': this.brightness += step; break;
                default: return;
            }
            event.preventDefault();
            this.saturation = Math.max(0, Math.min(1, this.saturation));
            this.brightness = Math.max(0, Math.min(1, this.brightness));
            this.commit();
        });
        const hueLabel = root.createEl('label', { text: t('Hue') });
        this.hueInput = hueLabel.createEl('input', { type: 'range' });
        this.hueInput.min = '0'; this.hueInput.max = '359'; this.hueInput.step = '1';
        this.hueInput.setAttribute('aria-label', t('Hue'));
        this.hueInput.addEventListener('input', () => { this.hue = Number(this.hueInput.value); this.commit(); });
        const row = root.createDiv('at-color-values');
        this.preview = row.createSpan('at-color-preview');
        const hexLabel = row.createEl('label', { text: 'HEX' });
        this.hex = hexLabel.createEl('input', { type: 'text' });
        this.hex.maxLength = 7;
        this.hex.addEventListener('input', () => {
            const valid = /^#?[0-9a-f]{6}$/i.test(this.hex.value);
            this.hex.setAttribute('aria-invalid', String(!valid));
            if (valid) this.setHex('#' + this.hex.value.replace('#', ''));
        });
        this.hex.addEventListener('blur', () => this.sync());
        for (const channel of ['R', 'G', 'B']) {
            const label = row.createEl('label', { text: channel });
            const input = label.createEl('input', { type: 'number' });
            input.min = '0'; input.max = '255'; input.step = '1';
            input.addEventListener('input', () => {
                if (this.rgb.every(item => item.value !== '' && item.validity.valid)) {
                    this.setHex('#' + this.rgb.map(item => Number(item.value).toString(16).padStart(2, '0')).join(''));
                }
            });
            input.addEventListener('blur', () => this.sync());
            this.rgb.push(input);
        }
        this.sync();
    }

    private setHex(color: string): void {
        this.value = color.toLowerCase();
        [this.hue, this.saturation, this.brightness] = rgbToHsv(this.value);
        this.sync();
        this.onChange(this.value);
    }

    private commit(): void {
        this.value = hsvToHex(this.hue, this.saturation, this.brightness);
        this.sync();
        this.onChange(this.value);
    }

    private sync(): void {
        this.field.style.backgroundColor = `hsl(${this.hue}, 100%, 50%)`;
        this.cursor.style.left = `${this.saturation * 100}%`;
        this.cursor.style.top = `${(1 - this.brightness) * 100}%`;
        this.hueInput.value = String(this.hue);
        this.hex.value = this.value;
        this.hex.setAttribute('aria-invalid', 'false');
        this.preview.style.backgroundColor = this.value;
        this.rgb.forEach((input, index) => { input.value = String(parseInt(this.value.slice(1 + index * 2, 3 + index * 2), 16)); });
    }
}
