/**
 * Wall-clock waiting for the drills.
 *
 * WHY THIS EXISTS. Every drill used to wait like this:
 *
 *     for (let i = 0; i < 60 && !document.querySelector('.ccard'); i++)
 *       await wait(150);
 *
 * which reads as "wait up to nine seconds" and is not. It is "wait up to sixty
 * timers", and the browser pane these run in is a HIDDEN page — measured
 * 2026-08-21, `document.hidden === true` and a `setTimeout(…, 150)` actually
 * takes about three seconds, roughly twenty times slow. Sixty of those is three
 * minutes, so the loop is far too generous on time; but the loop does not care
 * about time, it cares about count, and when the count runs out it just carries
 * on. No error, no timeout, no mention in the report. The drill then asserts
 * against whatever half-built DOM it happens to be looking at and reports the
 * result as if it had waited properly. A drill that cannot fail honestly is
 * worse than no drill.
 *
 * `until()` fixes both halves:
 *
 *   - The deadline is WALL CLOCK (`Date.now()`), so "15 seconds" means fifteen
 *     seconds whether or not timers are being throttled.
 *   - The success path is a MutationObserver, not a poll, so it resolves the
 *     instant the app renders instead of on the next throttled tick. This is
 *     what takes the naming drill from twenty-five minutes back to under one.
 *   - It RETURNS FALSE on timeout instead of falling through silently. Callers
 *     record that as a failed check, so a timeout shows up in the report as a
 *     timeout rather than as a mysterious assertion failure further down.
 *
 * The interval is a backstop for conditions that no DOM mutation announces
 * (a value settling, a fetch resolving into existing nodes). It is deliberately
 * slow, because under throttling it will not fire faster anyway.
 */
(function () {
  /**
   * @param {() => any}   cond     truthy when the wait is over
   * @param {object}      [opts]
   * @param {number}      [opts.timeout=15000]  wall-clock milliseconds
   * @param {string}      [opts.label]          what we were waiting for
   * @returns {Promise<boolean>} true if `cond` came true, false on timeout
   */
  globalThis.until = function until(cond, opts) {
    const { timeout = 15000 } = opts || {};
    if (cond()) return Promise.resolve(true);

    const deadline = Date.now() + timeout;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        obs.disconnect();
        clearInterval(tick);
        resolve(ok);
      };
      const check = () => {
        let hit = false;
        try { hit = !!cond(); } catch (_) { hit = false; }
        if (hit) finish(true);
        else if (Date.now() >= deadline) finish(false);
      };
      const obs = new MutationObserver(check);
      obs.observe(document.documentElement,
        { childList: true, subtree: true, characterData: true, attributes: true });
      const tick = setInterval(check, 250);
    });
  };

  /** Every `until` that timed out, so a drill can report them as failures. */
  globalThis.__untilTimeouts = [];

  /**
   * The usual call: wait, and remember it if we gave up. Drills push these
   * into their own results so a timeout is never invisible.
   */
  globalThis.untilOr = async function untilOr(cond, label, timeout) {
    const ok = await globalThis.until(cond, { timeout });
    if (!ok) globalThis.__untilTimeouts.push(label);
    return ok;
  };
}());
