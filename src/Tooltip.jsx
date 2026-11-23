import React, { useEffect, useRef } from 'react';

const HOVER_DELAY = 350;
const MARGIN = 8;
const GAP = 8;

// One tooltip for the whole app. Any element with a `data-tip` attribute shows its text on hover or keyboard focus.
// The tooltip is a manual popover so it sits in the top layer, above open <dialog> modals.
export function TooltipLayer() {
  const tip = useRef(null);
  useEffect(() => {
    const element = tip.current;
    const popover = typeof element.showPopover === 'function';
    let target = null;
    let timer = 0;

    function place() {
      const box = target.getBoundingClientRect();
      const { offsetWidth: width, offsetHeight: height } = element;
      const left = Math.min(Math.max(MARGIN, box.left + box.width / 2 - width / 2), innerWidth - width - MARGIN);
      const below = box.bottom + GAP;
      const top = below + height > innerHeight - MARGIN ? Math.max(MARGIN, box.top - GAP - height) : below;
      element.style.left = left + 'px';
      element.style.top = top + 'px';
    }
    function show(next) {
      clearTimeout(timer);
      const text = next.dataset.tip;
      if (!text || !next.isConnected) return;
      if (target && target !== next) target.removeAttribute('aria-describedby');
      target = next;
      element.textContent = text;
      if (popover) {
        if (element.matches(':popover-open')) element.hidePopover();
        element.showPopover();
      }
      element.dataset.open = '';
      place();
      target.setAttribute('aria-describedby', element.id);
    }
    function hide() {
      clearTimeout(timer);
      if (target?.getAttribute('aria-describedby') === element.id) target.removeAttribute('aria-describedby');
      target = null;
      delete element.dataset.open;
      if (popover && element.matches(':popover-open')) element.hidePopover();
    }
    const tipped = node => node instanceof Element ? node.closest('[data-tip]') : null;
    function over(event) {
      const next = tipped(event.target);
      if (!next || next === target) return;
      clearTimeout(timer);
      timer = setTimeout(() => show(next), target ? 0 : HOVER_DELAY);
    }
    function out(event) {
      const from = tipped(event.target);
      if (from && from.contains(event.relatedTarget)) return;
      hide();
    }
    function focus(event) {
      const next = tipped(event.target);
      if (next && next.matches(':focus-visible')) show(next);
    }
    function key(event) {
      if (event.key === 'Escape' && target) hide();
    }
    const listeners = [['pointerover', over], ['pointerout', out], ['focusin', focus], ['focusout', hide],
      ['pointerdown', hide], ['keydown', key], ['scroll', hide]];
    for (const [type, listener] of listeners) document.addEventListener(type, listener, true);
    return () => {
      hide();
      for (const [type, listener] of listeners) document.removeEventListener(type, listener, true);
    };
  }, []);
  return <div ref={tip} id="app-tooltip" className="tooltip" role="tooltip" popover="manual" />;
}
