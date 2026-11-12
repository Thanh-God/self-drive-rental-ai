package com.carrental.modules.contract.service;

import com.carrental.modules.booking.service.DepositPolicy;
import java.text.NumberFormat;
import java.util.*;

/**
 * L7 (12/11/2026): numbered contract terms built from the booking's own facts (deposit policy, remaining rent, return
 * policy). Contracts issued before keep the terms saved in their snapshot; this text only applies to new contracts.
 */
public final class ContractTerms {
    private ContractTerms() {}
    /** L7 terms; contracts issued with it do not need the customer's acceptance on the website. */
    public static final String VERSION_L7 = "contract-2026-11-12";
    /** L8 (12/11/2026): the contract takes effect when the customer presses "Đồng ý" (article 12), and handover waits for it. */
    public static final String VERSION = "contract-2026-11-12-v2";

    public static boolean acceptanceRequired(String termsVersion) {
        return VERSION.equals(termsVersion);
    }
    public static final String NOTE = "Mẫu hợp đồng phục vụ đồ án, chưa được thẩm định pháp lý; thông tin bên cho thuê và số hotline là thông tin minh họa. Hệ thống đang ở chế độ thử nghiệm, không thu tiền thật.";
    public static final String LESSOR_NAME = "KDrive (dự án thử nghiệm, chưa đăng ký pháp nhân)";

    public record Facts(boolean depositRequired, long depositAmount, String depositPolicy, long remainingRent,
                        boolean rentalBalancePolicy, boolean returnPolicy, String hotline, boolean acceptanceRequired) {
        /** Contracts without the website acceptance step (L7 terms). */
        public Facts(boolean depositRequired, long depositAmount, String depositPolicy, long remainingRent,
                     boolean rentalBalancePolicy, boolean returnPolicy, String hotline) {
            this(depositRequired, depositAmount, depositPolicy, remainingRent, rentalBalancePolicy, returnPolicy, hotline, false);
        }
    }
    public record Article(int number, String title, List<String> clauses) {}

    public static String vnd(long amount) {
        return NumberFormat.getIntegerInstance(Locale.forLanguageTag("vi-VN")).format(amount) + " đ";
    }

    public static List<Article> articles(Facts f) {
        var list = new ArrayList<Article>();
        add(list, "Đối tượng hợp đồng",
            "Bên cho thuê giao cho Bên thuê sử dụng chiếc xe nêu tại phần Thông tin xe trong thời gian thuê ghi trên hợp đồng; Bên thuê trả tiền thuê và trả lại xe theo thỏa thuận.",
            "Xe được nhận tại chi nhánh nhận và trả tại chi nhánh trả ghi trên hợp đồng; điểm trả không tự thay đổi trong chuyến.");
        add(list, "Giá thuê và thanh toán", payment(f));
        add(list, "Hủy đơn và hoàn cọc", cancellation(f));
        add(list, "Giao và nhận xe",
            "Trước khi giao xe, nhân viên chi nhánh nhận đối chiếu bản gốc giấy phép lái xe (GPLX) với thông tin đã khai; không đủ điều kiện thì không giao xe.",
            "Biên bản bàn giao và biên bản nhận trả (tình trạng xe, mức nhiên liệu hoặc pin, số km) là một phần của hợp đồng và là căn cứ xác định trách nhiệm.",
            "Thời gian giữ xe thực tế tính từ lúc bàn giao đến lúc chi nhánh trả ghi nhận đã nhận lại xe.");
        add(list, "Người lái và sử dụng xe",
            "Chỉ Bên thuê — người có ảnh GPLX đã lưu trên hệ thống, GPLX phù hợp với xe và còn hiệu lực đến hết thời gian thuê — được điều khiển xe.",
            "Không giao xe cho người khác lái; không cho thuê lại, cầm cố, thế chấp hoặc dùng xe làm tài sản bảo đảm.",
            "Không dùng xe vào mục đích trái pháp luật, chở hàng cấm hoặc đua xe; không điều khiển xe khi trong cơ thể có nồng độ cồn hoặc chất ma túy.",
            "Bên thuê giữ gìn xe và giấy tờ xe, không tự ý thay đổi kết cấu, phụ tùng của xe.");
        add(list, "Trả xe", f.returnPolicy()
            ? new String[] {
                "Bên thuê trả xe tại chi nhánh trả ghi trên hợp đồng.",
                "Trả sớm hoặc trả muộn được xử lý theo chính sách trả xe đã lưu cùng đơn (phần Chính sách trả xe).",
                "Xe được trả trong tình trạng như lúc nhận, trừ hao mòn tự nhiên." }
            : new String[] {
                "Bên thuê trả xe đúng thời gian và chi nhánh trả ghi trên hợp đồng.",
                "Muốn trả sớm hoặc trả muộn, Bên thuê liên hệ chi nhánh trước; thay đổi chỉ có hiệu lực khi chi nhánh xác nhận.",
                "Xe được trả trong tình trạng như lúc nhận, trừ hao mòn tự nhiên." });
        add(list, "Vi phạm giao thông (phạt nguội)",
            "Bên thuê chịu trách nhiệm với vi phạm hành chính về giao thông xảy ra trong thời gian giữ xe thực tế, kể cả vi phạm được cơ quan chức năng thông báo sau khi trả xe.",
            "Bên cho thuê thông báo cho Bên thuê kèm thông tin vi phạm (thời điểm, địa điểm, căn cứ) để đối chiếu với thời gian giữ xe theo biên bản.",
            "Vi phạm xảy ra ngoài thời gian giữ xe thực tế không thuộc trách nhiệm của Bên thuê.");
        add(list, "Sự cố, thiệt hại và bảo hiểm",
            "Khi xảy ra sự cố, Bên thuê báo ngay cho chi nhánh hoặc qua hệ thống, giữ nguyên hiện trường khi pháp luật yêu cầu và không tự ý sửa chữa xe.",
            "Xe có bảo hiểm bắt buộc trách nhiệm dân sự của chủ xe cơ giới còn hiệu lực; bảo hiểm này chi trả thiệt hại gây ra cho người khác theo quy định, không chi trả hư hỏng của chính chiếc xe.",
            "Khoản do bảo hiểm hoặc bên khác chi trả không thu lại từ Bên thuê. Bên thuê chịu phần thiệt hại do lỗi của mình mà không được chi trả, theo hồ sơ sự cố và căn cứ đã ghi nhận.",
            "Không tự động khấu trừ tiền cọc để bù thiệt hại; yêu cầu bồi thường phải nêu thiệt hại, căn cứ trách nhiệm và khoản đã được bảo hiểm hoặc bên khác chi trả.",
            "Hao mòn tự nhiên khi sử dụng bình thường không bị tính phí.");
        add(list, "Trách nhiệm của Bên cho thuê",
            "Giao xe đúng thời gian, đúng chi nhánh, bảo đảm an toàn kỹ thuật; xe có giấy tờ hợp lệ và bảo hiểm bắt buộc còn hiệu lực.",
            f.depositRequired()
                ? "Nếu không giao được xe (xe hỏng, không bảo đảm an toàn hoặc lý do từ phía doanh nghiệp), Bên cho thuê liên hệ báo Bên thuê, hủy đơn và hoàn toàn bộ tiền cọc."
                : "Nếu không giao được xe (xe hỏng, không bảo đảm an toàn hoặc lý do từ phía doanh nghiệp), Bên cho thuê liên hệ báo Bên thuê và hủy đơn; Bên thuê không phải trả khoản nào.",
            "Hỗ trợ Bên thuê khi xe gặp sự cố kỹ thuật không do lỗi của Bên thuê.");
        add(list, "Dữ liệu cá nhân",
            "Thông tin cá nhân và ảnh GPLX chỉ dùng để xác minh điều kiện thuê, thực hiện hợp đồng và giải quyết sự cố, vi phạm liên quan đến đơn.",
            "Bên cho thuê không cung cấp các thông tin này cho bên thứ ba, trừ cơ quan nhà nước có thẩm quyền theo quy định của pháp luật.");
        add(list, "Giải quyết tranh chấp",
            "Bên thuê gửi khiếu nại tới chi nhánh hoặc hotline " + f.hotline() + "; Bên cho thuê phản hồi trong 7 ngày làm việc.",
            "Hai bên thương lượng trên cơ sở hợp đồng, biên bản bàn giao, biên bản nhận trả và hồ sơ sự cố.",
            "Nếu không thương lượng được, mỗi bên có quyền yêu cầu Tòa án nhân dân có thẩm quyền giải quyết theo pháp luật Việt Nam.");
        String unchanged = "Nội dung hợp đồng được lưu nguyên bản tại thời điểm lập và không chỉnh sửa sau đó; thay đổi (nếu có) được ghi nhận bằng biên bản hoặc thao tác riêng trên hệ thống.";
        if (f.acceptanceRequired()) add(list, "Hiệu lực",
            "Hợp đồng được lập khi đơn được xác nhận và có hiệu lực khi Bên thuê bấm \"Đồng ý\" trên hệ thống; Bên cho thuê chỉ bàn giao xe sau khi Bên thuê đã đồng ý.",
            "Hợp đồng chấm dứt khi đơn hoàn tất hoặc bị hủy.",
            unchanged);
        else add(list, "Hiệu lực",
            "Hợp đồng có hiệu lực từ thời điểm lập (khi đơn được xác nhận) đến khi đơn hoàn tất hoặc bị hủy.",
            unchanged);
        return List.copyOf(list);
    }

    private static String[] payment(Facts f) {
        var c = new ArrayList<String>();
        c.add("Tiền thuê, phí trả khác chi nhánh (nếu có) và tổng tiền được chốt tại thời điểm lập hợp đồng, tính bằng đồng Việt Nam.");
        if (f.depositRequired()) {
            c.add("Bên thuê đã đặt cọc giữ chỗ " + vnd(f.depositAmount()) + " (30% tiền thuê); khoản cọc được trừ vào tổng tiền.");
            if (f.remainingRent() > 0) c.add(f.rentalBalancePolicy()
                ? "Phần tiền thuê còn lại " + vnd(f.remainingRent()) + " được thanh toán tại chi nhánh nhận trước khi bàn giao xe; nhân viên ghi nhận khoản đã nhận trên hệ thống."
                : "Phần tiền thuê còn lại " + vnd(f.remainingRent()) + " được thanh toán tại chi nhánh theo hướng dẫn của nhân viên.");
        } else {
            c.add("Tổng tiền được thanh toán tại chi nhánh theo hướng dẫn của nhân viên.");
        }
        c.add("Hóa đơn được lập khi đơn hoàn tất và không phải chứng từ chứng minh đã thanh toán.");
        return c.toArray(String[]::new);
    }

    private static String[] cancellation(Facts f) {
        if (!f.depositRequired()) return new String[] {
            "Đơn không có tiền cọc: hủy đơn không phát sinh khoản hoàn.",
            "Bên thuê tự hủy trên hệ thống khi còn ít nhất 24 giờ trước giờ nhận xe; sau mốc này, liên hệ chi nhánh nhận." };
        var c = new ArrayList<String>(List.of(
            "Hủy trước mốc nhận ít nhất 24 giờ (đơn theo ngày lấy đầu ngày nhận): hoàn toàn bộ cọc.",
            "Bên cho thuê từ chối hoặc không giao được xe: hoàn toàn bộ cọc."));
        if (DepositPolicy.fixedCancellationRules(f.depositPolicy())) {
            c.add("Hủy dưới 24 giờ trước mốc nhận (liên hệ nhân viên chi nhánh nhận): hoàn toàn bộ cọc.");
            c.add("Không đến nhận xe và không báo trước khi hết ngày nhận: cọc giữ chỗ không được hoàn; khoản chuyển ngoài cọc (nếu có) được hoàn toàn bộ.");
        } else {
            c.add("Hủy dưới 24 giờ trước mốc nhận hoặc không đến nhận xe: quản trị viên quyết định mức hoàn 0–100%, có ghi lý do.");
        }
        c.add("Khoản hoàn được ghi nhận trên hệ thống; trong chế độ thử nghiệm không chuyển tiền thật.");
        return c.toArray(String[]::new);
    }

    private static void add(List<Article> list, String title, String... clauses) {
        list.add(new Article(list.size() + 1, title, List.of(clauses)));
    }
}
