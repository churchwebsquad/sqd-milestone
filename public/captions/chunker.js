/**
 * Shared caption chunker — ONE file used by BOTH the renderer composition and
 * (later) the in-app picker/proofing preview, so preview = bake.
 *
 * Splits a transcript words[] into caption "sections" sized for on-screen
 * display (spec from Duane, 2026-06-12; side-margin revision 2026-07-06):
 *   - max ~20 characters per line (down from 24: keeps sections short enough to
 *     stay inside the crop-safe central 80% of the frame — see FIT_SAFE_W in
 *     engine.jsx — so long segments break to the next card sooner and never run
 *     edge-to-edge where mobile devices crop the sides)
 *   - max 1 line per section (each section is its own timed card)
 *   - never split mid-word; a sentence end (. ! ?) also ends the section
 *
 * Each chunk carries its own words (original clip-relative timings untouched)
 * plus a display window [showFrom, showUntil): a section appears at its first
 * word's start and persists through pauses until the next section begins.
 *
 * Plain JS (no JSX), registered on window for both consumers.
 */
(function () {
  var DEFAULTS = {
    // "auto" targets a SINGLE line for short, uniform captions (consistent font;
    // the renderer only shrinks overflow). wordsPerSegment still overrides.
    // 20 chars keeps a line within the crop-safe central 80% width at the design
    // font size, so long phrases break to the next card (e.g. "WE ALWAYS, ALWAYS"
    // then "CHOOSE") instead of stretching edge-to-edge and clipping on crop.
    maxCharsPerLine: 20,
    maxLines: 1,
    splitAtSentenceEnd: true,
  };

  // Common title/abbreviation words whose trailing period is NOT a sentence
  // end (case-insensitive; the display words may already be upper-cased). Kept
  // deliberately conservative — only tokens that virtually never end a real
  // spoken sentence, so we don't accidentally glue two sentences together.
  var ABBREVIATIONS = {
    mr: 1, mrs: 1, ms: 1, dr: 1, prof: 1, sr: 1, jr: 1, st: 1, mt: 1,
    rev: 1, fr: 1, gen: 1, gov: 1, sen: 1, rep: 1, vs: 1, etc: 1,
  };

  // A period only *sometimes* ends a sentence. Initials ("C.", "S."), dotted
  // acronyms ("U.S.", "e.g."), and known abbreviations ("Mr.", "Dr.") keep the
  // caption flowing so a name like "C. S. Lewis" stays on one card. ! and ?
  // are always sentence ends.
  function isSentenceEnd(word) {
    // Drop any trailing closing quote/bracket before inspecting the punctuation.
    var core = (word || "").replace(/["')\]]+$/, "");
    if (/[!?]$/.test(core)) return true;
    if (!/\.$/.test(core)) return false;

    // Initials / dotted acronyms: a run of single-letter-plus-period groups
    // ("C.", "S.", "U.S.", "A.B.C.", "e.g.", "i.e.") — names/acronyms, not ends.
    if (/^(?:[A-Za-z]\.)+$/.test(core)) return false;

    // Known abbreviations, matched on the letters before the trailing period(s).
    var alpha = core.replace(/\.+$/, "").toLowerCase();
    if (ABBREVIATIONS.hasOwnProperty(alpha)) return false;

    return true;
  }

  function chunkWords(words, opts) {
    var cfg = Object.assign({}, DEFAULTS, opts || {});
    var maxChars = cfg.maxCharsPerLine * cfg.maxLines;
    var chunks = [];
    var cur = [];
    var curLen = 0;

    function flush() {
      if (!cur.length) return;
      chunks.push({ words: cur });
      cur = [];
      curLen = 0;
    }

    // "words per segment" override: when set (3..10), segment strictly by word
    // count (the user's explicit control). Otherwise fall back to the char/line
    // budget. Sentence ends still split early in both modes.
    var wps = Number(cfg.wordsPerSegment) || 0;

    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      var wordLen = (w.word || "").length;
      if (wps > 0) {
        if (cur.length >= wps) flush();
      } else {
        // +1 for the joining space when the section already has content
        var nextLen = curLen === 0 ? wordLen : curLen + 1 + wordLen;
        if (cur.length > 0 && nextLen > maxChars) flush();
      }
      cur.push(w);
      curLen = curLen === 0 ? wordLen : curLen + 1 + wordLen;
      if (cfg.splitAtSentenceEnd && isSentenceEnd(w.word || "")) flush();
    }
    flush();

    // Display windows: show at first word start, hold through silence until
    // the next section starts (last section holds to Infinity; the clip end
    // bounds it naturally).
    for (var c = 0; c < chunks.length; c++) {
      var first = chunks[c].words[0];
      var next = chunks[c + 1];
      chunks[c].showFrom = first.start;
      chunks[c].showUntil = next ? next.words[0].start : Infinity;
    }
    return chunks;
  }

  /** The chunk to display at time t (sections persist through pauses). */
  function chunkAt(chunks, t) {
    if (!chunks.length) return null;
    if (t < chunks[0].showFrom) return chunks[0]; // pre-roll: first section's own pre-state
    for (var i = 0; i < chunks.length; i++) {
      if (t >= chunks[i].showFrom && t < chunks[i].showUntil) return chunks[i];
    }
    return chunks[chunks.length - 1];
  }

  window.chunkWords = chunkWords;
  window.chunkAt = chunkAt;
  window.CHUNKER_DEFAULTS = DEFAULTS;
})();
