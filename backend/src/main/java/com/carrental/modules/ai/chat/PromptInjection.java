package com.carrental.modules.ai.chat;

import java.text.Normalizer;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Common wordings that try to change the assistant's instructions, in Vietnamese and English. Used on the
 * current question and on every earlier turn the client sends back. A match is a signal, not a guarantee:
 * the answer still goes through the grounding checks whatever this says.
 */
final class PromptInjection {
    private static final Pattern PATTERN = Pattern.compile(
        "\\b(?:bo qua|phot lo|quen|ignore|disregard|forget)\\b.{0,40}\\b(?:chi dan|huong dan|quy tac|lenh|instruction|instructions|rules|prompt)\\b"
        + "|\\bsystem\\s*prompt\\b|\\bprompt he thong\\b|\\bdong vai\\b|\\byou are now\\b|\\bact as\\b|\\bjailbreak\\b"
        + "|\\b(?:tiet lo|in ra|hien thi)\\b.{0,30}\\b(?:prompt|huong dan|quy tac|chi dan)\\b|(?:^|\\s)system\\s*:");

    private PromptInjection() {}

    static boolean matches(String text) {
        if (text == null) return false;
        String folded = Normalizer.normalize(text.toLowerCase(Locale.ROOT), Normalizer.Form.NFD)
            .replace('đ', 'd').replaceAll("\\p{M}", "").replaceAll("\\s+", " ").strip();
        return PATTERN.matcher(folded).find();
    }
}
