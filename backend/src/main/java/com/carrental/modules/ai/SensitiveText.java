package com.carrental.modules.ai;

import java.util.regex.Pattern;

/**
 * Common sensitive identifiers refused before any text reaches a model: e-mail addresses, Vietnamese phone
 * numbers and long digit runs such as ID or licence numbers. This is a guard for the usual cases, not a
 * detector of every kind of personal data.
 */
public final class SensitiveText {
    private static final Pattern EMAIL = Pattern.compile("[^\\s@]+@[^\\s@]+\\.[^\\s@]+");
    private static final Pattern NUMBER = Pattern.compile("(?<!\\d)(?:0\\d{9}|84\\d{9}|\\d{12,16})(?!\\d)");

    private SensitiveText() {}

    public static boolean contains(String text) {
        return text != null && (EMAIL.matcher(text).find() || NUMBER.matcher(text).find());
    }
}
