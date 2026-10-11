package com.carrental;

import org.springframework.jdbc.core.JdbcTemplate;
import java.util.*;

final class IncidentEvidence {
    static Map<String, Object> snapshot(JdbcTemplate jdbc) {
        Map<String, Object> result = new TreeMap<>();
        // Bao gồm toàn bộ các bảng liên quan đến sự cố, xe, booking, lịch sử, chứng từ và bảng đại diện không liên quan (reviews)
        for (String table : List.of(
                "incident_cases",
                "incident_events",
                "vehicles",
                "bookings",
                "booking_status_history",
                "vehicle_handover_records",
                "contracts",
                "invoices",
                "invoice_items",
                "reviews")) {
            result.put(table, jdbc.queryForList("SELECT * FROM " + table + " ORDER BY id"));
        }
        return result;
    }
}

