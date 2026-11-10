/** Commit a logical field only when focus leaves all of its controls, including popovers. */
export function bindFieldValidation(element: HTMLElement, onCommit: () => void, onEdit: () => void): () => void {
    let disposed = false;
    const enter = (event: FocusEvent) => {
        if (!element.contains(event.relatedTarget as Node | null)) onEdit();
    };
    const leave = (event: FocusEvent) => {
        if (element.contains(event.relatedTarget as Node | null)) return;
        queueMicrotask(() => {
            if (!disposed && !element.contains(element.ownerDocument.activeElement)) onCommit();
        });
    };
    element.addEventListener('focusin', enter);
    element.addEventListener('focusout', leave);
    return () => {
        disposed = true;
        element.removeEventListener('focusin', enter);
        element.removeEventListener('focusout', leave);
    };
}
