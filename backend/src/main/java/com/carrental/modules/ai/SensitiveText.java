package com.carrental.modules.ai;

import java.util.regex.Pattern;

/**
 * Common sensitive identifiers refused before any text reaches a model: e-mail addresses, Vietnamese phone
 * numbers (also written with spaces, dots or dashes, or with +84) and long digit runs such as ID or licence
 * numbers. This is a guard for the usual cases, not a detector of every kind of personal data.
 */
public final class SensitiveText {
    private static final Pattern EMAIL = Pattern.compile("[^\\s@]+@[^\\s@]+\\.[^\\s@]+");
    private static final Pattern NUMBER = Pattern.compile("(?<!\\d)(?:0\\d{9}|84\\d{9}|\\d{12,16})(?!\\d)");
    /**
     * A Vietnamese mobile or landline number split by single spaces, dots or dashes: a leading 0 (or +84 / 84)
     * followed by nine (mobile) or ten (landline) more digits, not continuing into another dotted/dashed number.
     * Dates, money and the sample hotline do not have that shape.
     */
    private static final Pattern SPLIT_PHONE = Pattern.compile("(?<![\\d.,])(?:\\+84|84|0)(?:[ .\\-]?\\d){9,10}(?!\\d|[.,\\-]\\d)");

    private SensitiveText() {}

    public static boolean contains(String text) {
        return text != null && (EMAIL.matcher(text).find() || NUMBER.matcher(text).find() || SPLIT_PHONE.matcher(text).find());
    }
}
