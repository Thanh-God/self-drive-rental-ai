package com.carrental.modules.contract.service;

import com.carrental.modules.booking.service.DepositPolicy;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/** L7: the numbered terms follow each booking's own facts. */
class ContractTermsTest {
    static ContractTerms.Facts facts(boolean deposit, String policy, long remaining, boolean balance, boolean returnPolicy) {
        return new ContractTerms.Facts(deposit, deposit ? 390000 : 0, policy, remaining, balance, returnPolicy, "10008888");
    }

    static List<String> clauses(List<ContractTerms.Article> articles, int number) {
        var a = articles.get(number - 1);
        assertEquals(number, a.number());
        return a.clauses();
    }

    @Test
    void twelveNumberedArticlesInAFixedOrder() {
        var articles = ContractTerms.articles(facts(false, null, 1300000, false, false));
        assertEquals(12, articles.size());
        for (int i = 0; i < articles.size(); i++) {
            assertEquals(i + 1, articles.get(i).number());
            assertFalse(articles.get(i).clauses().isEmpty());
        }
        assertEquals("Hiệu lực", articles.get(11).title());
        assertFalse(articles.toString().contains("đồ án"), "the disclaimer lives in the note");
        assertTrue(ContractTerms.NOTE.contains("đồ án"));
        assertEquals("contract-2026-11-12", ContractTerms.VERSION_L7);
        assertEquals("contract-2026-11-12-v2", ContractTerms.VERSION);
        assertTrue(ContractTerms.VERSION.length() <= 30, "contracts.terms_version is VARCHAR(30)");
    }

    @Test
    void depositPolicyV2StatesTheFixedRules() {
        var a = ContractTerms.articles(facts(true, DepositPolicy.QR_VERSION, 910000, true, false));
        var cancel = clauses(a, 3);
        assertTrue(cancel.contains("Hủy dưới 24 giờ trước mốc nhận (liên hệ nhân viên chi nhánh nhận): hoàn toàn bộ cọc."));
        assertTrue(cancel.stream().anyMatch(c -> c.startsWith("Không đến nhận xe") && c.contains("không được hoàn")));
        assertTrue(cancel.stream().noneMatch(c -> c.contains("0–100%")));
        var pay = clauses(a, 2);
        assertTrue(pay.contains("Bên thuê đã đặt cọc giữ chỗ 390.000 đ (30% tiền thuê); khoản cọc được trừ vào tổng tiền."));
        assertTrue(pay.stream().anyMatch(c -> c.startsWith("Phần tiền thuê còn lại 910.000 đ") && c.contains("trước khi bàn giao xe")));
        assertTrue(clauses(a, 9).get(1).contains("hoàn toàn bộ tiền cọc"));
    }

    @Test
    void olderDepositPoliciesKeepTheAdminDecision() {
        for (String policy : List.of(DepositPolicy.QR_VERSION_V1, DepositPolicy.VNPAY_VERSION)) {
            var cancel = clauses(ContractTerms.articles(facts(true, policy, 910000, false, false)), 3);
            assertTrue(cancel.stream().anyMatch(c -> c.contains("quản trị viên quyết định mức hoàn 0–100%")), policy);
            assertTrue(cancel.stream().noneMatch(c -> c.startsWith("Không đến nhận xe")), policy);
            var pay = clauses(ContractTerms.articles(facts(true, policy, 910000, false, false)), 2);
            assertTrue(pay.stream().anyMatch(c -> c.equals("Phần tiền thuê còn lại 910.000 đ được thanh toán tại chi nhánh theo hướng dẫn của nhân viên.")));
        }
    }

    @Test
    void withoutDepositNothingIsRefundedAndTheTotalIsPaidAtTheBranch() {
        var a = ContractTerms.articles(facts(false, null, 1300000, true, false));
        assertEquals("Đơn không có tiền cọc: hủy đơn khi chưa thanh toán không phát sinh khoản hoàn.", clauses(a, 3).get(0));
        assertTrue(clauses(a, 2).contains("Tổng tiền 1.300.000 đ được thanh toán tại chi nhánh nhận trước khi bàn giao xe; nhân viên ghi nhận khoản đã nhận trên hệ thống."),
            "R9: the remaining-rent policy needs the whole total before handover");
        var legacy = ContractTerms.articles(facts(false, null, 1300000, false, false));
        assertTrue(clauses(legacy, 2).contains("Tổng tiền được thanh toán tại chi nhánh theo hướng dẫn của nhân viên."), "bookings without L4 keep the branch guidance");
        assertTrue(clauses(legacy, 2).stream().noneMatch(c -> c.contains("trước khi bàn giao")));
        assertTrue(clauses(a, 2).stream().noneMatch(c -> c.contains("đặt cọc")));
        assertTrue(clauses(a, 9).get(1).contains("không phải trả khoản nào"));
        assertEquals("Đơn không có tiền cọc: hủy đơn không phát sinh khoản hoàn.", clauses(legacy, 3).get(0), "bookings without L4 keep the old line");
        assertEquals(2, clauses(legacy, 3).size());
        assertFalse(clauses(legacy, 9).get(1).contains("tiền thuê đã thanh toán"));
    }

    /** L9 (Q8): with the remaining-rent policy, rent paid at the branch is refunded in full on any cancellation and blocks no-show. */
    @Test
    void paidRentIsRefundedInFullOnCancellationUnderTheRemainingRentPolicy() {
        String paid = "Phần tiền thuê đã thanh toán tại chi nhánh trước khi bị hủy được hoàn toàn bộ, kể cả khi hủy sát giờ; đơn đã thanh toán khoản này không bị xử lý là không đến nhận xe.";
        var noDeposit = ContractTerms.articles(facts(false, null, 1300000, true, false));
        assertTrue(clauses(noDeposit, 3).contains(paid));
        assertTrue(clauses(noDeposit, 3).contains("Khoản hoàn được ghi nhận trên hệ thống; trong chế độ thử nghiệm không chuyển tiền thật."));
        assertTrue(clauses(noDeposit, 9).get(1).contains("hoàn toàn bộ tiền thuê đã thanh toán tại chi nhánh (nếu có)"));
        var deposit = ContractTerms.articles(facts(true, DepositPolicy.QR_VERSION, 910000, true, false));
        assertTrue(clauses(deposit, 3).contains(paid));
        assertTrue(clauses(deposit, 9).get(1).endsWith("hoàn toàn bộ tiền cọc cùng phần tiền thuê đã thanh toán tại chi nhánh (nếu có)."));
        var withoutPolicy = ContractTerms.articles(facts(true, DepositPolicy.QR_VERSION, 910000, false, false));
        assertFalse(clauses(withoutPolicy, 3).contains(paid));
        assertTrue(clauses(withoutPolicy, 9).get(1).endsWith("hoàn toàn bộ tiền cọc."));
    }

    /** L9 (Q9): the no-show rule says the customer did not cancel and how the branch records it. */
    @Test
    void noShowClauseNeedsTheCustomerNotToHaveCancelled() {
        var cancel = clauses(ContractTerms.articles(facts(true, DepositPolicy.QR_VERSION, 910000, false, false)), 3);
        assertTrue(cancel.stream().anyMatch(c -> c.startsWith("Không đến nhận xe và không báo hủy trước khi hết ngày nhận")
            && c.contains("ghi kênh, thời điểm liên hệ") && c.contains("không được hoàn")));
    }

    @Test
    void fullyPaidDepositHasNoRemainingRentLineAndReturnPolicyIsReferenced() {
        var a = ContractTerms.articles(facts(true, DepositPolicy.QR_VERSION, 0, true, true));
        assertTrue(clauses(a, 2).stream().noneMatch(c -> c.contains("còn lại")));
        assertTrue(clauses(a, 6).stream().anyMatch(c -> c.contains("chính sách trả xe đã lưu cùng đơn")));
        assertTrue(ContractTerms.articles(facts(false, null, 1, false, false)).get(5).clauses().stream()
            .anyMatch(c -> c.contains("chỉ có hiệu lực khi chi nhánh xác nhận")));
    }

    @Test
    void withTheAcceptanceStepTheContractTakesEffectWhenTheCustomerAgrees() {
        var withStep = ContractTerms.articles(new ContractTerms.Facts(false, 0, null, 1300000, false, false, "10008888", true));
        assertEquals(12, withStep.size());
        assertTrue(clauses(withStep, 12).get(0).contains("có hiệu lực khi Bên thuê bấm \"Đồng ý\""));
        assertTrue(clauses(withStep, 12).get(0).contains("chỉ bàn giao xe sau khi Bên thuê đã đồng ý"));
        var without = ContractTerms.articles(facts(false, null, 1300000, false, false));
        assertTrue(clauses(without, 12).get(0).startsWith("Hợp đồng có hiệu lực từ thời điểm lập"));
        assertEquals(withStep.subList(0, 11), without.subList(0, 11), "only article 12 differs");
        assertTrue(ContractTerms.acceptanceRequired("contract-2026-11-12-v2"));
        for (String older : List.of("contract-2026-11-12", "terms-2026-09-28", DepositPolicy.QR_VERSION_V1, DepositPolicy.VNPAY_VERSION))
            assertFalse(ContractTerms.acceptanceRequired(older), older);
        assertTrue(ContractTerms.VERSION.length() <= 30);
    }

    @Test
    void amountsUseVietnameseGrouping() {
        assertEquals("1.300.000 đ", ContractTerms.vnd(1300000));
        assertEquals("0 đ", ContractTerms.vnd(0));
    }
}
