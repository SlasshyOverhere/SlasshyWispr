## 2025-03-27 - Refactor List Rendering to Programmatic DOM
**Learning:** Although `innerHTML` can be quick for simple templating, dynamically regenerating long user lists (like dictionary terms, snippets, and notes) and querying the DOM afterward to attach event listeners introduces measurable overhead via HTML reparsing, layout recalculation, and potential security risks if strings are not escaped perfectly. Using `document.createElement`, `textContent`, and attaching listeners explicitly bypasses the parser entirely.

**Action:** When rendering dynamic collections on the frontend, especially those driven by user state, prioritize explicit programmatic DOM creation instead of `innerHTML` with template strings. This prevents XSS and avoids string-to-DOM parsing bottlenecks, lowering overall UI rendering latency.

## 2025-03-27 - Avoid Micro-Optimizing Cold Execution Paths
**Learning:** Replaced `for...of` iteration over `MediaStream.getTracks()` with an indexed `for` loop to save an iterator object allocation. This was an unmeasurable micro-optimization on a very cold path (microphone startup/shutdown) that unnecessarily degraded code readability without providing any tangible performance value.

**Action:** Focus performance efforts strictly on code paths that execute frequently (e.g., render loops, audio processing chunks, real-time event handlers). Never micro-optimize cold initialization or teardown paths unless a definitive benchmark proves it acts as a critical bottleneck.
