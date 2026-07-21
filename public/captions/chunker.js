/**
 * Shared caption chunker — ONE file used by BOTH the renderer composition and
 * (later) the in-app picker/proofing preview, so preview = bake.
 *
 * Splits a transcript words[] into caption "sections" sized for on-screen
 * display (spec from Duane, 2026-06-12):
 *   - max ~25 characters per line
 *   - max 2 lines  → ~50 characters per section
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
    maxCharsPerLine: 25,
    maxLines: 2,
    splitAtSentenceEnd: true,
  };

  function isSentenceEnd(word) {
    return /[.!?]["')\]]?$/.test(word);
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
