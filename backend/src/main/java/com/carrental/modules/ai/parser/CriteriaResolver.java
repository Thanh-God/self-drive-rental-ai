package com.carrental.modules.ai.parser;

import com.carrental.modules.booking.service.RentalBranchCatalog;
import java.text.Normalizer;
import java.util.*;

/**
 * Turns a model's criteria draft into a reviewable draft that only keeps what the customer's own text supports:
 * dates must appear in full in the text, branch names must match exactly one ACTIVE branch the text mentions,
 * stated roles, party sizes, budgets and gearbox choices are read deterministically from the text and win over
 * the model. Shared by the criteria parser and the chat vehicle search.
 */
public final class CriteriaResolver {
    private final RentalBranchCatalog branches;

    public CriteriaResolver(RentalBranchCatalog branches) { this.branches = branches; }

    /** The ACTIVE branches the text names, and their distinct names in sorted order (for the model schema). */
    public record Mentioned(List<RentalBranchCatalog.Item> candidates, List<String> names) {}

    public Mentioned mentioned(String text) {
        String words = StatedCriteria.words(text);
        var candidates = branches.active().stream().filter(branch -> StatedCriteria.mentioned(words, branch.name())).toList();
        return new Mentioned(candidates, candidates.stream().map(RentalBranchCatalog.Item::name).distinct().sorted().toList());
    }

    public CriteriaExtractionService.Result resolve(String text, CriteriaParser.Extraction extracted, Mentioned mentioned) {
        var candidates = mentioned.candidates();
        var names = mentioned.names();
        if ("OUT_OF_SCOPE".equals(extracted.intent())) return new CriteriaExtractionService.Result("OUT_OF_SCOPE", null, List.of());
        if (!extracted.conflicts().isEmpty()) return new CriteriaExtractionService.Result("NEEDS_CLARIFICATION", null, List.of("conflicts"));
        var stated = StatedCriteria.from(text, names);
        String pickup = resolve(stated.getOrDefault(StatedCriteria.PICKUP, extracted.pickupBranchName()), candidates);
        String destination = resolve(stated.getOrDefault(StatedCriteria.RETURN, extracted.returnBranchName()), candidates);
        String start = explicitDate(extracted.pickupDate(), text), end = explicitDate(extracted.returnDate(), text);
        var missing = new LinkedHashSet<>(extracted.unresolvedFields());
        missing.remove("transmission");
        if (stated.containsKey(StatedCriteria.PICKUP) && pickup != null) missing.remove(StatedCriteria.PICKUP);
        if (stated.containsKey(StatedCriteria.RETURN) && destination != null) missing.remove(StatedCriteria.RETURN);
        if (pickup != null && pickup.equals(destination) && names.size() == 1 && StatedCriteria.confirmsPair(text, names.get(0))) {
            missing.remove(StatedCriteria.PICKUP);
            missing.remove(StatedCriteria.RETURN);
        }
        if (missing.contains(StatedCriteria.PICKUP)) pickup = null;
        if (missing.contains(StatedCriteria.RETURN)) destination = null;
        if (firmDatePair(text, start, end)) { missing.remove("pickupDate"); missing.remove("returnDate"); }
        if (start == null) missing.add("pickupDate");
        if (end == null) missing.add("returnDate");
        if (pickup == null) missing.add("pickupBranchName");
        if (destination == null) missing.add("returnBranchName");
        Integer passengers = stated.containsKey(StatedCriteria.PEOPLE) ? null : extracted.passengers();
        if (passengers == null) missing.add("passengers");
        var statedBudget = ExplicitBudget.fromText(text);
        Long budget = statedBudget.fixed() ? statedBudget.value() : extracted.budgetVndTotal();
        if (statedBudget.fixed() && budget != null) missing.remove("budgetVndTotal");
        if (budget == null) missing.add("budgetVndTotal");
        var transmission = TransmissionPreference.fromText(text);
        if (transmission.ambiguous()) missing.add("transmission");
        return new CriteriaExtractionService.Result(missing.isEmpty() ? "READY_FOR_REVIEW" : "NEEDS_CLARIFICATION",
            new CriteriaExtractionService.Draft(start, end, pickup, destination, passengers, budget, transmission.value()),
            List.copyOf(missing));
    }

    /** The gearbox the text states, or null; and whether the text leaves it ambiguous. */
    public static String statedTransmission(String text) { return TransmissionPreference.fromText(text).value(); }

    private static final java.util.regex.Pattern FULL_DATE = java.util.regex.Pattern.compile(
        "(?<![0-9])(?:([0-9]{4})-([0-9]{2})-([0-9]{2})|([0-9]{1,2})\\s*[/.-]\\s*([0-9]{1,2})\\s*[/.-]\\s*([0-9]{4}))(?![0-9])");
    private static final java.util.regex.Pattern DATE_HEDGE = java.util.regex.Pattern.compile(
        "\\b(?:chua|hoac|hay|khoang|co the|du kien)\\b");

    /**
     * The text itself settles both dates: exactly two full dates, in pickup-then-return order, matching the
     * verified values, with no hedging or alternatives. Then a model "unresolved" flag on the dates is overridden.
     */
    static boolean firmDatePair(String text, String start, String end) {
        if (start == null || end == null || start.compareTo(end) >= 0) return false;
        if (DATE_HEDGE.matcher(StatedCriteria.words(text)).find()) return false;
        var found = new ArrayList<String>();
        var m = FULL_DATE.matcher(text);
        while (m.find()) {
            try {
                found.add(m.group(1) != null
                    ? java.time.LocalDate.of(Integer.parseInt(m.group(1)), Integer.parseInt(m.group(2)), Integer.parseInt(m.group(3))).toString()
                    : java.time.LocalDate.of(Integer.parseInt(m.group(6)), Integer.parseInt(m.group(5)), Integer.parseInt(m.group(4))).toString());
            } catch (java.time.DateTimeException invalid) { return false; }
        }
        return found.size() == 2 && found.get(0).equals(start) && found.get(1).equals(end);
    }

    private static String explicitDate(String date, String text) {
        if (date == null) return null;
        var day = java.time.LocalDate.parse(date);
        String d = (day.getDayOfMonth() < 10 ? "0?" : "") + day.getDayOfMonth(), m = (day.getMonthValue() < 10 ? "0?" : "") + day.getMonthValue();
        String form = "(?<![0-9])(?:" + java.util.regex.Pattern.quote(date) + "|" + d + "\\s*[/.-]\\s*" + m + "\\s*[/.-]\\s*" + day.getYear() + ")(?![0-9])";
        return java.util.regex.Pattern.compile(form).matcher(text).find() ? date : null;
    }

    private static String resolve(String name, List<RentalBranchCatalog.Item> active) {
        if (name == null) return null;
        var matches = active.stream().filter(b -> normalize(b.name()).equals(normalize(name))).toList();
        return matches.size() == 1 ? matches.get(0).id() : null;
    }

    private static String normalize(String name) {
        return Normalizer.normalize(name, Normalizer.Form.NFD).replaceAll("\\p{M}", "").toLowerCase(Locale.ROOT)
            .replace('đ', 'd').replaceFirst("^kdrive\\s*", "").replaceAll("[^a-z0-9]", "");
    }
}
