import type { Modal } from 'obsidian';

/** Keep plugin titles in Obsidian's native header beside the close control. */
export function setModalTitle(modal: Modal, title: string): void {
    modal.setTitle(title);
    modal.modalEl.addClass('at-modal');
}
