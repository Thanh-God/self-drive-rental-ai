package com.carrental.modules.ai.chat;

import com.carrental.exception.DomainException;
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

    /** Criteria carried between turns by the client. Untrusted: every value is re-validated. */
    public record Session(String pickupDate, String returnDate, String pickupBranchId, String returnBranchId,
                          Integer passengers, Long budgetVndTotal, String transmission) {}

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

    /** Branch names the message mentions and the gearbox it states: all the model may fill in. */
    public QwenChatModel.SearchHints hints(String message) {
        return new QwenChatModel.SearchHints(resolver.mentioned(message).names(), CriteriaResolver.statedTransmission(message));
    }

    public Result run(Actor actor, String message, QwenChatModel.Criteria drafted, Session session) {
        var active = branches.active();
        var activeIds = active.stream().map(RentalBranchCatalog.Item::id).toList();
        var base = sanitize(session, activeIds);
        var c = drafted == null ? new QwenChatModel.Criteria(null, null, null, null, null, null, null, List.of()) : drafted;
        var extraction = new CriteriaParser.Extraction("NEEDS_CLARIFICATION", c.pickupDate(), c.returnDate(),
            c.pickupBranchName(), c.returnBranchName(), c.passengers(), c.budgetVndTotal(), c.transmission(),
            c.unresolvedFields(), List.of());
        var resolved = resolver.resolve(message, extraction, resolver.mentioned(message)).draft();
        var undecided = c.unresolvedFields();

        String pickupDate = pick(resolved.pickupDate(), base.pickupDate(), undecided.contains("pickupDate"));
        String returnDate = pick(resolved.returnDate(), base.returnDate(), undecided.contains("returnDate"));
        String pickupBranch = pick(resolved.pickupBranchId(), base.pickupBranchId(), undecided.contains("pickupBranchName"));
        String returnBranch = pick(resolved.returnBranchId(), base.returnBranchId(), undecided.contains("returnBranchName"));
        Integer passengers = pick(resolved.passengers(), base.passengers(), undecided.contains("passengers"));
        Long budget = pick(resolved.budgetVndTotal(), base.budgetVndTotal(), undecided.contains("budgetVndTotal"));
        String transmission = resolved.transmission() != null ? resolved.transmission() : base.transmission();
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
        if (!missing.isEmpty())
            return new Result("ASK_MISSING", question(missing.get(0), active), merged, List.copyOf(missing), List.of());

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
        if (s == null) return new Session(null, null, null, null, null, null, null);
        String start = date(s.pickupDate()), end = date(s.returnDate());
        return new Session(start, end,
            activeIds.contains(s.pickupBranchId()) ? s.pickupBranchId() : null,
            activeIds.contains(s.returnBranchId()) ? s.returnBranchId() : null,
            s.passengers() != null && s.passengers() >= 2 && s.passengers() <= 9 ? s.passengers() : null,
            s.budgetVndTotal() != null && s.budgetVndTotal() >= 0 && s.budgetVndTotal() <= 9007199254740991L ? s.budgetVndTotal() : null,
            "AUTO".equals(s.transmission()) || "MANUAL".equals(s.transmission()) ? s.transmission() : null);
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
