package com.carrental;

import com.carrental.modules.booking.service.BookingService;
import com.carrental.modules.operation.service.RentalWorkflow;
import com.carrental.modules.user.service.AccountService;
import com.carrental.modules.user.service.LicenseService;
import com.carrental.security.Actor;
import com.carrental.security.TokenService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

/** L7 (12/11/2026): new contracts carry numbered terms and the parties, vehicle and branch facts; old contracts stay as saved. */
@SpringBootTest(properties = {"app.jwt-secret=contract-content-test-secret-at-least-32-bytes", "app.seed-enabled=true",
    "app.seed-password=ContractContentTestOnly123!", "app.deposit-enabled=false", "app.payment-reconcile-ms=86400000",
    "spring.jpa.properties.hibernate.type.preferred_instant_jdbc_type=TIMESTAMP"})
@AutoConfigureMockMvc
@Import(ContractContentHttpTest.TimeConfig.class)
class ContractContentHttpTest {
    static final Path ROOT;
    static {
        try { ROOT = Files.createTempDirectory("contract-content-synthetic-photos-"); } catch (Exception e) { throw new IllegalStateException(e); }
    }

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry r) {
        String url = System.getenv("KDRIVE_TEST_DB_URL");
        if (url != null) CancelBoundaryTest.verifySafeIsolatedDatabase(url, System.getenv("KDRIVE_TEST_REQUIRED_SCHEMA_PREFIX"),
            System.getenv("KDRIVE_TEST_FIXTURE_MARKER_TOKEN"), System.getenv("KDRIVE_TEST_DB_USER"), System.getenv("KDRIVE_TEST_DB_PASSWORD"));
        r.add("spring.datasource.url", () -> url == null ? "jdbc:h2:mem:contractcontent;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1" : url);
        r.add("spring.datasource.username", () -> url == null ? "sa" : System.getenv("KDRIVE_TEST_DB_USER"));
        r.add("spring.datasource.password", () -> url == null ? "" : System.getenv("KDRIVE_TEST_DB_PASSWORD"));
        r.add("app.license-photo-directory", ROOT::toString);
    }

    static class FixtureClock extends Clock {
        Instant value = Instant.parse("2026-10-23T03:00:00Z");
        public ZoneId getZone() { return ZoneOffset.UTC; }
        public Clock withZone(ZoneId z) { return this; }
        public Instant instant() { return value; }
    }

    @TestConfiguration
    static class TimeConfig { @Bean @Primary FixtureClock contractContentClock() { return new FixtureClock(); } }

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired FixtureClock clock;
    @Autowired LicenseService licenses;
    @Autowired BookingService bookings;
    @Autowired RentalWorkflow rental;
    @Autowired TokenService tokens;
    @Autowired AccountService accounts;
    final ObjectMapper json = new ObjectMapper();
    final Actor user = new Actor("demo-user", "USER", "Synthetic");
    final Actor staff = new Actor("demo-staff-dn", "STAFF", "Synthetic");

    @BeforeEach
    void setup() {
        CancelBoundaryTest.verifySafeIsolatedDatabase(jdbc);
        for (String t : List.of("payment_events", "payment_refunds", "payment_transactions", "reviews", "incident_events", "incident_cases",
            "vehicle_handover_records", "invoice_items", "invoices", "contracts", "booking_status_history", "bookings"))
            jdbc.update("delete from " + t);
        jdbc.update("update vehicles set current_branch_id='dn',status='ACTIVE' where id='v1'");
        jdbc.update("update users set phone='0900000007' where id='demo-user'");
        clock.value = Instant.parse("2026-10-23T03:00:00Z");
        var old = licenses.mine(user);
        licenses.save(user, new LicenseService.View(null, "SYNTHETIC-CONTRACT-NOT-REAL", "VN_2025", "B", LocalDate.of(2035, 12, 31), false,
            "PENDING", old == null ? 0 : old.version()));
        LicensePhotoFixture.approved(licenses, user);
    }

    BookingService.View confirmedOneWay() {
        var b = bookings.create(user, new BookingService.Input("v1", "dn", "hn", null, null, 2800000L, LocalDate.of(2026, 10, 26), LocalDate.of(2026, 10, 28)));
        assertFalse(b.deposit().required(), "fixture must be a booking without a deposit");
        rental.apply(staff, b.id(), new BookingService.Action("CONFIRMED", b.version(), null, null, false, false));
        return b;
    }

    JsonNode contract(String actorId, String bookingId, int expectedStatus) throws Exception {
        var response = mvc.perform(get("/api/v1/bookings/" + bookingId + "/contract")
            .header("Authorization", "Bearer " + tokens.issue(accounts.require(actorId)))).andReturn().getResponse();
        assertEquals(expectedStatus, response.getStatus(), response.getContentAsString());
        return expectedStatus == 200 ? json.readTree(response.getContentAsString()) : null;
    }

    static List<String> clauses(JsonNode snapshot, int number) {
        var article = snapshot.path("articles").get(number - 1);
        assertEquals(number, article.path("number").asInt());
        var out = new ArrayList<String>();
        article.path("clauses").forEach(c -> out.add(c.asText()));
        return out;
    }

    @Test
    void newContractCarriesPartiesVehicleBranchesAndTwelveNumberedArticles() throws Exception {
        var b = confirmedOneWay();
        var rows = contract("demo-user", b.id(), 200);
        assertEquals(1, rows.size());
        assertEquals("contract-2026-11-12", rows.get(0).path("terms_version").asText());
        var s = json.readTree(rows.get(0).path("snapshot").asText());

        assertEquals("HĐ-20261023-" + b.id().replace("-", "").substring(0, 8).toUpperCase(), s.path("contractNumber").asText());
        assertEquals("2026-10-23T03:00:00Z", s.path("issuedAt").asText());
        assertEquals("10008888", s.at("/lessor/hotline").asText());
        assertTrue(s.at("/lessor/sample").asBoolean());
        assertTrue(s.at("/lessor/name").asText().contains("chưa đăng ký pháp nhân"));
        assertEquals("0900000007", s.path("customerPhone").asText());
        assertEquals(jdbc.queryForObject("select email from users where id='demo-user'", String.class), s.path("customerEmail").asText());
        assertEquals("SYNTHETIC-CONTRACT-NOT-REAL", s.at("/license/number").asText());
        assertEquals("B", s.at("/license/licenseClass").asText());
        assertEquals(jdbc.queryForObject("select plate from vehicles where id='v1'", String.class), s.path("vehiclePlate").asText());
        assertEquals(jdbc.queryForObject("select seats from vehicles where id='v1'", Integer.class), s.path("vehicleSeats").asInt());
        assertEquals(jdbc.queryForObject("select transmission from vehicles where id='v1'", String.class), s.path("vehicleTransmission").asText());
        assertEquals(jdbc.queryForObject("select address from branches where id='dn'", String.class), s.path("pickupAddress").asText());
        assertEquals(jdbc.queryForObject("select address from branches where id='hn'", String.class), s.path("returnAddress").asText());
        assertNotEquals(s.path("pickupAddress").asText(), s.path("returnAddress").asText());
        assertEquals(2800000, s.path("total").asLong());
        assertEquals(0, s.path("depositAmount").asLong());
        assertEquals(2800000, s.path("remainingRent").asLong());

        assertEquals(12, s.path("articles").size());
        var titles = new ArrayList<String>();
        s.path("articles").forEach(a -> titles.add(a.path("title").asText()));
        assertEquals(List.of("Đối tượng hợp đồng", "Giá thuê và thanh toán", "Hủy đơn và hoàn cọc", "Giao và nhận xe", "Người lái và sử dụng xe",
            "Trả xe", "Vi phạm giao thông (phạt nguội)", "Sự cố, thiệt hại và bảo hiểm", "Trách nhiệm của Bên cho thuê", "Dữ liệu cá nhân",
            "Giải quyết tranh chấp", "Hiệu lực"), titles);
        assertTrue(clauses(s, 3).contains("Đơn không có tiền cọc: hủy đơn không phát sinh khoản hoàn."));
        assertTrue(clauses(s, 5).get(0).contains("ảnh GPLX đã lưu trên hệ thống"));
        assertTrue(clauses(s, 7).get(0).contains("thời gian giữ xe thực tế"));
        assertTrue(clauses(s, 8).get(1).contains("bảo hiểm bắt buộc trách nhiệm dân sự"));
        assertTrue(clauses(s, 11).get(0).contains("10008888"));
        assertTrue(clauses(s, 11).get(2).contains("Tòa án"));
        assertFalse(s.path("articles").toString().contains("đồ án"), "the project disclaimer is a note, not a term");
        assertTrue(s.path("termsNote").asText().contains("đồ án"));
        assertTrue(s.path("terms").isMissingNode(), "new contracts no longer carry the one-paragraph terms");

        // The return branch of the route reads the same contract.
        assertEquals(rows, contract("demo-staff-hn", b.id(), 200));
    }

    @Test
    void issuedContractDoesNotFollowLaterChangesToTheCustomerVehicleOrBranches() throws Exception {
        var b = confirmedOneWay();
        String before = jdbc.queryForObject("select snapshot from contracts where booking_id=?", String.class, b.id());
        String plate = jdbc.queryForObject("select plate from vehicles where id='v1'", String.class);
        var addresses = jdbc.queryForList("select id,address from branches where id in ('dn','hn')");
        try {
            jdbc.update("update users set phone='0911111111' where id='demo-user'");
            jdbc.update("update vehicles set plate='SYN-CHANGED' where id='v1'");
            jdbc.update("update branches set address='Synthetic changed address' where id in ('dn','hn')");
            assertEquals(before, contract("demo-user", b.id(), 200).get(0).path("snapshot").asText());
        } finally {
            jdbc.update("update vehicles set plate=? where id='v1'", plate);
            for (var a : addresses) jdbc.update("update branches set address=? where id=?", a.get("address"), a.get("id"));
        }
    }

    @Test
    void contractIssuedBeforeL7IsReturnedAsSavedAndStaysScopedToTheRoute() throws Exception {
        var b = bookings.create(user, new BookingService.Input("v1", "dn", "dn", null, null, 1300000L, LocalDate.of(2026, 10, 26), LocalDate.of(2026, 10, 28)));
        String old = "{\"customer\":\"Synthetic\",\"vehicle\":\"Synthetic car\",\"pickup\":\"dn\",\"return\":\"dn\",\"total\":1300000,"
            + "\"terms\":\"Synthetic old terms. Hợp đồng phục vụ đồ án.\"}";
        jdbc.update("insert into contracts(id,booking_id,issued_at,snapshot,terms_version) values(?,?,'2026-10-01 03:00:00',?,'terms-2026-09-28')",
            UUID.randomUUID().toString(), b.id(), old);
        var row = contract("demo-user", b.id(), 200).get(0);
        assertEquals("terms-2026-09-28", row.path("terms_version").asText());
        assertEquals(old, row.path("snapshot").asText());
        contract("demo-staff-hn", b.id(), 404); // outside the route: the booking is not visible at all
    }
}
