/** Shared validation banner for time ranges and optional entry references. */
export class ValidationMessage {
    readonly element: HTMLDivElement;
    private readonly messagesEl: HTMLDivElement;

    constructor(container: HTMLElement, id?: string) {
        this.element = container.createDiv('validation-message overlap-warning-banner is-hidden');
        this.element.setAttribute('role', 'alert');
        if (id) this.element.id = id;
        const icon = this.element.createSpan('overlap-warning-icon');
        icon.setText('⚠️');
        icon.setAttribute('aria-hidden', 'true');
        this.messagesEl = this.element.createDiv('overlap-warning-messages');
    }

    setMessages(messages: readonly string[]): void {
        this.messagesEl.empty();
        for (const message of messages) {
            this.messagesEl.createDiv('overlap-message').setText(message);
        }
        this.element.toggleClass('is-hidden', messages.length === 0);
    }
}
