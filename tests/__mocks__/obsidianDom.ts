/** Obsidian DOM helpers for each JSDOM window used by component tests. */
export function installObsidianDomHelpers(nodePrototype: Node): void {
    nodePrototype.createEl = function <K extends keyof HTMLElementTagNameMap>(this: Node, tag: K, options?: string | DomElementInfo): HTMLElementTagNameMap[K] {
        const element = this.ownerDocument.createElement(tag);
        if (typeof options === 'string') element.className = options;
        else if (options) {
            if (options.cls) element.className = Array.isArray(options.cls) ? options.cls.join(' ') : options.cls;
            if (options.text !== undefined) element.textContent = String(options.text);
            for (const [key, value] of Object.entries(options.attr || {})) element.setAttribute(key, String(value));
            if (options.type) element.setAttribute('type', options.type);
            if (options.value) (element as HTMLInputElement).value = options.value;
        }
        this.appendChild(element);
        return element;
    };
    nodePrototype.createDiv = function (this: Node, options?: string | DomElementInfo): HTMLDivElement {
        return this.createEl('div', options);
    };
    nodePrototype.createSpan = function (this: Node, options?: string | DomElementInfo): HTMLSpanElement {
        return this.createEl('span', options);
    };
    nodePrototype.createSvg = function <K extends keyof SVGElementTagNameMap>(this: Node, tag: K): SVGElementTagNameMap[K] {
        const element = this.ownerDocument.createElementNS('http://www.w3.org/2000/svg', tag);
        this.appendChild(element);
        return element;
    };
    nodePrototype.empty = function (this: Node) { while (this.firstChild) this.removeChild(this.firstChild); };

}

export function installElementHelpers(prototype: HTMLElement): void {
    prototype.setText = function (text: string) { this.textContent = text; };
    prototype.addClass = function (...names: string[]) { this.classList.add(...names); };
    prototype.removeClass = function (...names: string[]) { this.classList.remove(...names); };
    prototype.toggleClass = function (names: string | string[], enabled: boolean) {
        for (const name of typeof names === 'string' ? [names] : names) this.classList.toggle(name, enabled);
    };
}
