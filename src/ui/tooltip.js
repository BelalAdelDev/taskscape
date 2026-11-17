/** One hover tooltip per chart. Elements register a render function; hovering them shows it. */
export class Tooltip {
  renderers = new WeakMap();
  doc = activeDocument;
  win = activeWindow;
  seenConnected = false;
  destroyed = false;
  /** `host` is the chart's container: the tooltip removes itself once the host leaves the page. */
  constructor(host) {
    this.host = host;
    this.el = this.doc.body.createDiv({ cls: ['taskscape-tip', 'is-hidden'] });
    this.doc.addEventListener('mousemove', this.onMove, { passive: true });
    this.doc.addEventListener('mouseout', this.onOut);
    this.doc.addEventListener('scroll', this.hide, true);
    this.doc.addEventListener('wheel', this.hide, { capture: true, passive: true });
    this.doc.addEventListener('visibilitychange', this.onVisibility);
    this.win.addEventListener('blur', this.hide);
    this.observer =
      typeof IntersectionObserver === 'function'
        ? new IntersectionObserver(() => {
            if (this.hostIsAlive()) this.hide();
          })
        : null;
    this.observer?.observe(host);
  }
  register(target, render) {
    this.renderers.set(target, render);
  }
  hide = () => {
    this.el.classList.add('is-hidden');
  };
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.doc.removeEventListener('mousemove', this.onMove);
    this.doc.removeEventListener('mouseout', this.onOut);
    this.doc.removeEventListener('scroll', this.hide, true);
    this.doc.removeEventListener('wheel', this.hide, true);
    this.doc.removeEventListener('visibilitychange', this.onVisibility);
    this.win.removeEventListener('blur', this.hide);
    this.observer?.disconnect();
    this.el.remove();
  }
  /** False (and cleans up) once the host has been removed from the page, e.g. the note changed. */
  hostIsAlive() {
    if (this.host.isConnected) {
      this.seenConnected = true;
      return true;
    }
    if (this.seenConnected) this.destroy();
    return false;
  }
  onMove = (e) => {
    if (!this.hostIsAlive()) return;
    let render;
    const hit = e.target; // instanceOf() also works for nodes in pop-out windows
    for (let node = hit?.instanceOf(Element) ? hit : null; node && node !== this.host; node = node.parentElement) {
      render = this.renderers.get(node);
      if (render) break;
    }
    if (!render) {
      this.hide();
      return;
    }
    this.el.empty();
    render(this.el);
    this.el.classList.remove('is-hidden');
    const x = Math.min(e.clientX + 14, this.win.innerWidth - this.el.offsetWidth - 8);
    const below = e.clientY + 18;
    const y = below + this.el.offsetHeight > this.win.innerHeight ? e.clientY - this.el.offsetHeight - 10 : below;
    this.el.style.left = Math.max(4, x) + 'px';
    this.el.style.top = y + 'px';
  };
  onOut = (e) => {
    if (!e.relatedTarget) this.hide(); // cursor left the window
  };
  onVisibility = () => {
    if (this.doc.hidden) this.hide();
  };
}
