package com.carrental.modules.ai.parser;

import static org.junit.jupiter.api.Assertions.*;

import java.util.List;
import org.junit.jupiter.api.Test;

/** R3: deterministic readers the chat uses instead of trusting model-filled criteria (REVIEW #6, #7, #8). */
class ChatReadersTest {
    @Test
    void partySizeNeedsTheTextToStateIt() {
        assertEquals(4, CriteriaResolver.statedPassengers("Tìm xe cho 4 người", false));
        assertEquals(4, CriteriaResolver.statedPassengers("nhóm bốn khách đi Hội An", false));
        assertEquals(4, CriteriaResolver.statedPassengers("đi tư người", false));
        assertEquals(7, CriteriaResolver.statedPassengers("7 người, tổng 5 triệu", false));
        assertNull(CriteriaResolver.statedPassengers("Tìm xe tổng 3 triệu", false), "no count stated");
        assertNull(CriteriaResolver.statedPassengers("đi 3 hoặc 5 người", false), "undecided");
        assertNull(CriteriaResolver.statedPassengers("Mình chưa biết bao nhiêu người", false));
        assertNull(CriteriaResolver.statedPassengers("12 người", false), "outside 2-9");
        assertNull(CriteriaResolver.statedPassengers("4 người hay 6 người", false), "two counts");
        assertNull(CriteriaResolver.statedPassengers("4", false), "a lone number only counts as an answer");
        assertEquals(4, CriteriaResolver.statedPassengers("4", true));
        assertEquals(4, CriteriaResolver.statedPassengers("Bốn", true));
        assertEquals(5, CriteriaResolver.statedPassengers("nhóm 5", true));
        assertNull(CriteriaResolver.statedPassengers("ngày 4", true));
    }

    @Test
    void budgetNeedsAStatedTotalOrAPlainAnswerToTheBudgetQuestion() {
        assertEquals(3_000_000L, CriteriaResolver.statedBudget("tổng ngân sách 3 triệu", false));
        assertNull(CriteriaResolver.statedBudget("3 triệu", false), "a bare amount is not a stated total");
        assertEquals(3_000_000L, CriteriaResolver.statedBudget("3 triệu", true));
        assertEquals(2_500_000L, CriteriaResolver.statedBudget("2 triệu rưỡi", true));
        assertEquals(800_000L, CriteriaResolver.statedBudget("800 nghìn", true));
        assertNull(CriteriaResolver.statedBudget("700k mỗi ngày", true), "a daily rate is not a total");
        assertNull(CriteriaResolver.statedBudget("3 hoặc 4 triệu", true), "alternatives");
        assertNull(CriteriaResolver.statedBudget("4 người", true));
    }

    @Test
    void fullDatesOnlyWithAYear() {
        assertEquals(List.of("2026-12-22", "2026-12-26"), CriteriaResolver.fullDates("từ 22/12/2026 đến 26/12/2026"));
        assertEquals(List.of("2026-12-22"), CriteriaResolver.fullDates("2026-12-22"));
        assertEquals(List.of(), CriteriaResolver.fullDates("ngày 22/12"));
        assertEquals(List.of(), CriteriaResolver.fullDates("31/02/2026"), "invalid date gives nothing");
    }

    @Test
    void gearboxChangesAreKeepSetOrClear() {
        assertEquals("KEEP", CriteriaResolver.transmissionChange("Tổng ngân sách 3 triệu"));
        assertEquals("AUTO", CriteriaResolver.transmissionChange("xe số tự động"));
        assertEquals("MANUAL", CriteriaResolver.transmissionChange("đổi sang số sàn"));
        assertEquals("CLEAR", CriteriaResolver.transmissionChange("Loại số nào cũng được."));
        assertEquals("CLEAR", CriteriaResolver.transmissionChange("số tự động hay số sàn đều được"));
        assertEquals("CLEAR", CriteriaResolver.transmissionChange("không cần số tự động nữa"));
    }

    @Test
    void searchRequestsAndOwnBookingQuestionsAreRecognised() {
        for (String yes : List.of("Mình muốn tìm một chiếc xe để đi chơi.", "Gợi ý xe giúp mình", "thuê xe 7 chỗ", "Tìm xe nhận tại Đà Nẵng"))
            assertTrue(CriteriaResolver.asksForVehicles(yes), yes);
        for (String no : List.of("Xe có sẵn ghế cho trẻ em không?", "Xe có gắn camera hành trình không?", "Ngày nhận xe thì lấy xe khi nào?"))
            assertFalse(CriteriaResolver.asksForVehicles(no), no);
        for (String own : List.of("Chiếc xe tôi đặt hôm qua đang ở trạng thái nào?", "Đơn của tôi có bị hủy chưa?", "Đơn thuê của mình đã duyệt chưa?"))
            assertTrue(CriteriaResolver.asksAboutOwnBooking(own), own);
        for (String no : List.of("Hủy đơn có được hoàn tiền không?", "Thuê xe cần giấy tờ gì?"))
            assertFalse(CriteriaResolver.asksAboutOwnBooking(no), no);
    }
}
