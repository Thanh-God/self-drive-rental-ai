package com.carrental.modules.ai;

import static org.junit.jupiter.api.Assertions.*;

import java.util.List;
import org.junit.jupiter.api.Test;

/** R5 (REVIEW #13): phone numbers written with separators are refused; dates, money and the sample hotline are not. */
class SensitiveTextTest {
    @Test
    void phoneNumbersEmailsAndIdsAreRecognisedHoweverTheyAreWritten() {
        for (String text : List.of("Gọi 0901234567", "Số 84901234567", "Liên hệ 090 123 4567 nhé", "SĐT: 090.123.4567",
                "090-123-4567", "+84 90 123 4567 là số của mình", "+84901234567", "0236 3 123 456",
                "Email: le.thi.b@example.org", "CCCD 012345678901", "GPLX 1234567890123"))
            assertTrue(SensitiveText.contains(text), text);
    }

    @Test
    void datesMoneyCountsAndTheSampleHotlineAreNotMistakenForPhones() {
        for (String text : List.of("Nhận 05.12.2026, trả 08.12.2026", "05-12-2026 08-12-2026", "từ 02/12/2026 đến 05/12/2026",
                "2026-12-05 đến 2026-12-08", "Ngân sách 3.000.000đ", "tổng 10.000.000 đồng", "84.000.000 đồng",
                "hotline 10008888", "hotline mẫu 1000 8888", "4 người, 3 ngày, 2 vali", "0 đồng phí hủy", "Giờ nhận 09:30",
                "Xe 7 chỗ, 0 km phát sinh", ""))
            assertFalse(SensitiveText.contains(text), text);
        assertFalse(SensitiveText.contains(null));
    }
}
