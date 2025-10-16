// shared.js — нейтральный, БЕЗ требований initData и БЕЗ prompt'ов.
// Даёт опциональные хелперы: получить tg_user_id из WebApp/URL/localStorage.

(function () {
  function resolveTgUserId() {
    try {
      const id = window.Telegram?.WebApp?.initDataUnsafe?.user?.id;
      if (id) return Number(id);
    } catch (_) {}
    try {
      const url = new URL(window.location.href);
      const q = url.searchParams.get("tg_user_id");
      if (q && Number(q)) return Number(q);
    } catch (_) {}
    try {
      const ls = localStorage.getItem("tg_user_id");
      if (ls && Number(ls)) return Number(ls);
    } catch (_) {}
    return null;
  }

  function saveTgUserId(id) {
    try {
      if (Number(id)) localStorage.setItem("tg_user_id", String(Number(id)));
    } catch (_) {}
  }

  // Никаких prompt/алертов здесь — всё тихо.
  window.AppShared = { resolveTgUserId, saveTgUserId };
})();
