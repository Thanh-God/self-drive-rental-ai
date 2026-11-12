package com.carrental.modules.ai.chat;

import com.carrental.exception.DomainException;
import com.carrental.modules.ai.parser.CriteriaExtractionService;
import com.carrental.modules.ai.parser.CriteriaParser;
import com.carrental.modules.ai.parser.CriteriaResolver;
import com.carrental.modules.ai.recommendation.RecommendationModels;
import com.carrental.modules.ai.recommendation.RecommendationService;
import com.carrental.modules.booking.service.RentalBranchCatalog;
import com.carrental.security.Actor;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.*;
import org.springframework.stereotype.Component;

/**
 * Vehicle search inside the chat. The model's criteria draft for the current message is re-checked against
 * the customer's own text (same rules as the criteria parser), merged with the criteria the client sends back
 * from earlier turns, and only then passed to the rule-based recommendation. Missing information is asked one
 * field at a time with backend wording; prices and vehicles come only from the recommendation. Nothing is
 * booked or stored.
 */
@Component
public class ChatVehicleSearch {
    public static final int MAX_CARDS = 3;
    static final List<String> REQUIRED = List.of("pickupDate", "returnDate", "pickupBranchId", "returnBranchId",
        "passengers", "budgetVndTotal");
    private static final DateTimeFormatter VN_DATE = DateTimeFormatter.ofPattern("dd/MM/yyyy");

    /**
     * Criteria carried between turns by the client. Untrusted: every value is re-validated. {@code askedField} is
     * the required field the last backend question asked for (null when nothing was asked).
     */
    public record Session(String pickupDate, String returnDate, String pickupBranchId, String returnBranchId,
                          Integer passengers, Long budgetVndTotal, String transmission, String askedField) {
        public Session(String pickupDate, String returnDate, String pickupBranchId, String returnBranchId,
                       Integer passengers, Long budgetVndTotal, String transmission) {
            this(pickupDate, returnDate, pickupBranchId, returnBranchId, passengers, budgetVndTotal, transmission, null);
        }

        boolean active() {
            return pickupDate != null || returnDate != null || pickupBranchId != null || returnBranchId != null
                || passengers != null || budgetVndTotal != null;
        }
    }

    public record Card(String vehicleId, String vehicleName, int seats, String transmission, int rentalDays,
                       long rentalTotal, long oneWayFee, long total, List<String> reasonCodes) {}

    public record Result(String intent, String reply, Session criteria, List<String> missing, List<Card> cards) {}

    private final RentalBranchCatalog branches;
    private final CriteriaResolver resolver;
    private final RecommendationService recommendations;

    public ChatVehicleSearch(RentalBranchCatalog branches, RecommendationService recommendations) {
        this.branches = branches;
        this.resolver = new CriteriaResolver(branches);
        this.recommendations = recommendations;
    }

    /** R7: the ACTIVE branches, read once per chat request and passed to every step below. */
    public List<RentalBranchCatalog.Item> activeBranches() { return branches.active(); }

    /** Branch names the message mentions and the gearbox it states: all the model may fill in. */
    public QwenChatModel.SearchHints hints(String message, List<RentalBranchCatalog.Item> active) {
        return new QwenChatModel.SearchHints(resolver.mentioned(message, active).names(), CriteriaResolver.statedTransmission(message));
    }

    /**
     * R3 (REVIEW #5): the model may only start or continue a vehicle search when the customer asks for one, states
     * at least one criterion the backend can read itself, or a search is already under way.
     */
    public boolean searchRequested(String message, Session session, List<RentalBranchCatalog.Item> active) {
        return CriteriaResolver.asksForVehicles(message) || resolver.statesCriterion(message, active)
            || (session != null && sanitize(session, ids(active)).active());
    }

    /** "Xe tôi đặt hôm qua…": a question about the customer's own booking, which the assistant cannot read. */
    public boolean asksAboutOwnBooking(String message) { return CriteriaResolver.asksAboutOwnBooking(message); }

    /**
     * D2 (REVIEW #8): when the backend asked for one field and the message answers it in a way the backend reads
     * itself (a full date, a branch name, "4 người", "3 triệu"), the criteria for this turn without any model call.
     * Null when the message does not answer the asked field that way.
     */
    public QwenChatModel.Criteria answerToAskedField(String message, Session session, List<RentalBranchCatalog.Item> active) {
        if (session == null) return null;
        var base = sanitize(session, ids(active));
        String asked = base.askedField();
        if (asked == null) return null;
        var dates = CriteriaResolver.fullDates(message);
        String start = null, end = null;
        if (dates.size() >= 2) { start = dates.get(0); end = dates.get(1); }
        else if (dates.size() == 1) {
            if ("returnDate".equals(asked)) end = dates.get(0);
            else if ("pickupDate".equals(asked)) start = dates.get(0);
        }
        var names = resolver.mentioned(message, active).names();
        String pickupName = null, returnName = null;
        if (names.size() == 1) {
            if ("pickupBranchId".equals(asked)) pickupName = names.get(0);
            if ("returnBranchId".equals(asked)) returnName = names.get(0);
        }
        var drafted = new QwenChatModel.Criteria(start, end, pickupName, returnName,
            CriteriaResolver.statedPassengers(message, "passengers".equals(asked)),
            CriteriaResolver.statedBudget(message, true), null, List.of());
        var draft = resolve(message, drafted, base, active);
        boolean answered = switch (asked) {
            case "pickupDate" -> draft.pickupDate() != null;
            case "returnDate" -> draft.returnDate() != null;
            case "pickupBranchId" -> draft.pickupBranchId() != null;
            case "returnBranchId" -> draft.returnBranchId() != null;
            case "passengers" -> draft.passengers() != null;
            default -> draft.budgetVndTotal() != null;
        };
        return answered ? drafted : null;
    }

    private static List<String> ids(List<RentalBranchCatalog.Item> active) {
        return active.stream().map(RentalBranchCatalog.Item::id).toList();
    }

    /** This turn's values that the customer's own text supports (dates and branches as the parser checks them). */
    private CriteriaExtractionService.Draft resolve(String message, QwenChatModel.Criteria c, Session base,
                                                     List<RentalBranchCatalog.Item> active) {
        var extraction = new CriteriaParser.Extraction("NEEDS_CLARIFICATION", c.pickupDate(), c.returnDate(),
            c.pickupBranchName(), c.returnBranchName(), c.passengers(), c.budgetVndTotal(), c.transmission(),
            c.unresolvedFields(), List.of());
        var r = resolver.resolve(message, extraction, resolver.mentioned(message, active)).draft();
        String asked = base == null ? null : base.askedField();
        // D8 (REVIEW #6): party size and budget only when the text states them; a model guess is asked again.
        // One plain amount without a daily rate counts as the budget; a lone number counts as people only when asked.
        return new CriteriaExtractionService.Draft(r.pickupDate(), r.returnDate(), r.pickupBranchId(), r.returnBranchId(),
            CriteriaResolver.statedPassengers(message, "passengers".equals(asked)),
            CriteriaResolver.statedBudget(message, true), r.transmission());
    }

    public Result run(Actor actor, String message, QwenChatModel.Criteria drafted, Session session,
                      List<RentalBranchCatalog.Item> active) {
        var base = sanitize(session, ids(active));
        var c = drafted == null ? new QwenChatModel.Criteria(null, null, null, null, null, null, null, List.of()) : drafted;
        var resolved = resolve(message, c, base, active);
        var undecided = c.unresolvedFields();

        String pickupDate = pick(resolved.pickupDate(), base.pickupDate(), undecided.contains("pickupDate"));
        String returnDate = pick(resolved.returnDate(), base.returnDate(), undecided.contains("returnDate"));
        String pickupBranch = pick(resolved.pickupBranchId(), base.pickupBranchId(), undecided.contains("pickupBranchName"));
        String returnBranch = pick(resolved.returnBranchId(), base.returnBranchId(), undecided.contains("returnBranchName"));
        Integer passengers = pick(resolved.passengers(), base.passengers(), undecided.contains("passengers"));
        Long budget = pick(resolved.budgetVndTotal(), base.budgetVndTotal(), undecided.contains("budgetVndTotal"));
        // REVIEW #7: "loại số nào cũng được" drops an earlier preference; not mentioning the gearbox keeps it.
        String transmission = switch (CriteriaResolver.transmissionChange(message)) {
            case "AUTO" -> "AUTO";
            case "MANUAL" -> "MANUAL";
            case "CLEAR" -> null;
            default -> base.transmission();
        };
        if (pickupDate != null && returnDate != null && !LocalDate.parse(returnDate).isAfter(LocalDate.parse(pickupDate)))
            returnDate = null;
        var merged = new Session(pickupDate, returnDate, pickupBranch, returnBranch, passengers, budget, transmission);

        var missing = new ArrayList<String>();
        if (pickupDate == null) missing.add("pickupDate");
        if (returnDate == null) missing.add("returnDate");
        if (pickupBranch == null) missing.add("pickupBranchId");
        if (returnBranch == null) missing.add("returnBranchId");
        if (passengers == null) missing.add("passengers");
        if (budget == null) missing.add("budgetVndTotal");
        if (!missing.isEmpty()) {
            var asking = new Session(pickupDate, returnDate, pickupBranch, returnBranch, passengers, budget, transmission, missing.get(0));
            return new Result("ASK_MISSING", question(missing.get(0), active), asking, List.copyOf(missing), List.of());
        }

        var request = new RecommendationModels.Request("chat-" + UUID.randomUUID(), new RecommendationModels.Criteria(
            LocalDate.parse(pickupDate), LocalDate.parse(returnDate), pickupBranch, returnBranch, passengers, budget,
            new RecommendationModels.Preferences(transmission, List.of())));
        RecommendationModels.Response found;
        try {
            found = recommendations.recommend(actor, request);
        } catch (DomainException e) {
            if (e.status.value() == 400)
                return new Result("ASK_MISSING", e.getMessage() + " Bạn kiểm tra lại ngày nhận, ngày trả và chi nhánh giúp mình nhé.",
                    merged, List.of(), List.of());
            if (e.status.value() == 503)
                return new Result("SEARCH_VEHICLES", "Tìm xe trong trò chuyện hiện chưa được bật. Bạn dùng trang Tìm xe nhé.",
                    merged, List.of(), List.of());
            throw e;
        }
        if (!"OK".equals(found.status()) || found.results().isEmpty())
            return new Result("SEARCH_VEHICLES", "Chưa có xe phù hợp với tiêu chí này. Bạn thử đổi ngày, chi nhánh, số người "
                + "hoặc tăng ngân sách nhé.", merged, List.of(), List.of());
        var cards = found.results().stream().limit(MAX_CARDS).map(i -> new Card(i.vehicleId(), i.vehicleName(), i.seats(),
            i.transmission(), i.rentalDays(), i.rentalTotal(), i.oneWayFee(), i.total(), i.reasonCodes())).toList();
        String reply = "Mình tìm được " + cards.size() + " xe phù hợp cho chuyến từ " + LocalDate.parse(pickupDate).format(VN_DATE)
            + " đến " + LocalDate.parse(returnDate).format(VN_DATE) + " (" + cards.get(0).rentalDays() + " ngày). "
            + "Tổng tiền đã gồm phí tuyến; kết quả chưa giữ chỗ, giá và lịch được kiểm tra lại khi bạn đặt.";
        return new Result("SEARCH_VEHICLES", reply, merged, List.of(), cards);
    }

    private static <T> T pick(T current, T earlier, boolean undecidedNow) {
        if (current != null) return current;
        return undecidedNow ? null : earlier;
    }

    /** Drops anything the client sent that is not a valid, currently usable value. */
    static Session sanitize(Session s, List<String> activeIds) {
        if (s == null) return new Session(null, null, null, null, null, null, null, null);
        String start = date(s.pickupDate()), end = date(s.returnDate());
        return new Session(start, end,
            activeIds.contains(s.pickupBranchId()) ? s.pickupBranchId() : null,
            activeIds.contains(s.returnBranchId()) ? s.returnBranchId() : null,
            s.passengers() != null && s.passengers() >= 2 && s.passengers() <= 9 ? s.passengers() : null,
            s.budgetVndTotal() != null && s.budgetVndTotal() >= 0 && s.budgetVndTotal() <= 9007199254740991L ? s.budgetVndTotal() : null,
            "AUTO".equals(s.transmission()) || "MANUAL".equals(s.transmission()) ? s.transmission() : null,
            s.askedField() != null && REQUIRED.contains(s.askedField()) ? s.askedField() : null);
    }

    private static String date(String value) {
        if (value == null || value.length() != 10) return null;
        try { return LocalDate.parse(value).toString(); } catch (DateTimeParseException e) { return null; }
    }

    static String question(String field, List<RentalBranchCatalog.Item> active) {
        String names = String.join(", ", active.stream().map(RentalBranchCatalog.Item::name).toList());
        return "Mình cần thêm một thông tin để tìm xe: " + switch (field) {
            case "pickupDate" -> "bạn muốn nhận xe ngày nào? Vui lòng ghi đủ ngày/tháng/năm, ví dụ 20/12/2026.";
            case "returnDate" -> "bạn định trả xe ngày nào? Vui lòng ghi đủ ngày/tháng/năm, sau ngày nhận.";
            case "pickupBranchId" -> "bạn muốn nhận xe ở chi nhánh nào? Chi nhánh đang hoạt động: " + names + ".";
            case "returnBranchId" -> "bạn trả xe ở chi nhánh nào? Chi nhánh đang hoạt động: " + names + ".";
            case "passengers" -> "chuyến đi có bao nhiêu người, gồm cả tài xế?";
            default -> "tổng ngân sách cho cả chuyến là bao nhiêu (VND)?";
        };
    }
}
