// Keep dialogs inside the visible area when the iPad keyboard opens or rotates.
(function () {
  let frame;
  function update() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const viewport = window.visualViewport;
      document.documentElement.style.setProperty('--visit-viewport-height', `${viewport?.height || window.innerHeight}px`);
      document.documentElement.style.setProperty('--visit-viewport-top', `${viewport?.offsetTop || 0}px`);
    });
  }
  window.visualViewport?.addEventListener('resize', update);
  window.visualViewport?.addEventListener('scroll', update);
  window.addEventListener('resize', update);
  window.addEventListener('pageshow', update);
  update();
})();
