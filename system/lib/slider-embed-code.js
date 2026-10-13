const CLASS_NAME = /^-?[_a-zA-Z]+[_a-zA-Z0-9-]*$/;

function buildSliderEmbedCode(config) {
  const names = ['rootClass', 'itemClass', 'previousClass', 'nextClass'];
  if (!config || !['slides', 'scroll'].includes(config.mode) || names.some(name => !CLASS_NAME.test(config[name] || '')) || (config.bulletClass && !CLASS_NAME.test(config.bulletClass))) {
    throw new TypeError('SLIDER_CONFIG_INVALID');
  }
  const safe = JSON.stringify(config).replace(/</g, '\\u003c');
  const root = `.${config.rootClass}`;
  const style = config.mode === 'slides' ? `<style>
${root} { visibility: visible !important; }
${root} .t-slds__items-wrapper { width: 100% !important; transform: none !important; }
${root} .${config.itemClass} { display: none !important; width: 100% !important; float: none !important; }
${root} .${config.itemClass}.toolkit-slide-active { display: block !important; }
</style>` : '';
  return `${style}
<script>
(function () {
  'use strict';
  const config = ${safe};
  const bindControl = (element, action) => {
    if (!element) return;
    element.setAttribute('role', 'button');
    element.setAttribute('tabindex', '0');
    element.addEventListener('click', action);
    element.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); action(); }
    });
  };
  const init = () => document.querySelectorAll('.' + config.rootClass).forEach(root => {
    if (root.dataset.taptopSliderBound === 'true') return;
    root.dataset.taptopSliderBound = 'true';
    const items = [...root.querySelectorAll('.' + config.itemClass)];
    if (items.length < 2) return;
    const previous = root.querySelector('.' + config.previousClass);
    const next = root.querySelector('.' + config.nextClass);
    if (config.mode === 'scroll') {
      const scroller = root.querySelector('.t1196__slider');
      if (!scroller) return;
      const step = () => items.length > 1 ? items[1].offsetLeft - items[0].offsetLeft : items[0].offsetWidth;
      bindControl(previous, () => scroller.scrollBy({ left: -step(), behavior: 'smooth' }));
      bindControl(next, () => scroller.scrollBy({ left: step(), behavior: 'smooth' }));
      return;
    }
    root.setAttribute('role', 'region');
    root.setAttribute('aria-roledescription', 'carousel');
    root.setAttribute('tabindex', '0');
    const bullets = config.bulletClass ? [...root.querySelectorAll('.' + config.bulletClass)] : [];
    let index = Math.max(0, items.findIndex(item => item.classList.contains('toolkit-slide-active')));
    const show = nextIndex => {
      index = (nextIndex + items.length) % items.length;
      items.forEach((item, n) => {
        const active = n === index;
        item.classList.toggle('toolkit-slide-active', active);
        item.classList.toggle('t-slds__item_active', active);
        item.setAttribute('aria-hidden', String(!active));
      });
      bullets.forEach((bullet, n) => {
        const active = n === index;
        bullet.classList.toggle('toolkit-bullet-active', active);
        bullet.classList.toggle('t-slds__bullet_active', active);
        const control = bullet.querySelector('button') || bullet;
        if (active) control.setAttribute('aria-current', 'true');
        else control.removeAttribute('aria-current');
      });
    };
    bindControl(previous, () => show(index - 1));
    bindControl(next, () => show(index + 1));
    bullets.forEach((bullet, n) => bindControl(bullet.querySelector('button') || bullet, () => show(n)));
    root.addEventListener('keydown', event => {
      if (event.key === 'ArrowLeft') { event.preventDefault(); show(index - 1); }
      if (event.key === 'ArrowRight') { event.preventDefault(); show(index + 1); }
    });
    let touchX = null;
    root.addEventListener('touchstart', event => { touchX = event.changedTouches[0]?.clientX ?? null; }, { passive: true });
    root.addEventListener('touchend', event => {
      if (touchX === null) return;
      const delta = (event.changedTouches[0]?.clientX ?? touchX) - touchX;
      touchX = null;
      if (Math.abs(delta) > 40) show(index + (delta < 0 ? 1 : -1));
    }, { passive: true });
    show(index);
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
</script>`;
}

module.exports = { buildSliderEmbedCode };
