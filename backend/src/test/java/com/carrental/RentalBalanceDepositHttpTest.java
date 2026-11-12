package com.carrental;

import com.carrental.modules.booking.service.BookingService;
import com.carrental.modules.booking.service.RentalBalanceService;
import com.carrental.modules.operation.service.DepositWorkflow;
import com.carrental.modules.payment.service.PaymentService;
import com.carrental.modules.payment.service.VnpayGateway;
import com.carrental.modules.operation.service.RentalWorkflow;
import com.carrental.modules.user.service.LicenseService;
import com.carrental.security.Actor;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.*;
import java.util.List;
import java.util.TreeMap;

import static org.junit.jupiter.api.Assertions.*;

/** L4 with a deposit: the remaining rent is total minus the applied deposit, never the whole total. Synthetic VNPAY receipt only. */
@SpringBootTest(properties = {"app.jwt-secret=rental-balance-deposit-test-secret-at-least-32-bytes", "app.seed-enabled=true",
    "app.seed-password=RentalBalanceDeposit123!", "app.deposit-enabled=true", "app.rental-balance-enabled=true",
    "app.vnpay-tmn-code=TESTONLY", "app.vnpay-hash-secret=synthetic-secret-not-real-merchant", "app.payment-reconcile-ms=86400000",
    "spring.jpa.properties.hibernate.type.preferred_instant_jdbc_type=TIMESTAMP"})
@Import(RentalBalanceDepositHttpTest.TimeConfig.class)
class RentalBalanceDepositHttpTest {
    static final Path ROOT;
    static {
        try { ROOT = Files.createTempDirectory("rental-balance-deposit-photos-"); } catch (Exception e) { throw new IllegalStateException(e); }
    }

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry r) {
        String url = System.getenv("KDRIVE_TEST_DB_URL");
        if (url != null) CancelBoundaryTest.verifySafeIsolatedDatabase(url, System.getenv("KDRIVE_TEST_REQUIRED_SCHEMA_PREFIX"),
            System.getenv("KDRIVE_TEST_FIXTURE_MARKER_TOKEN"), System.getenv("KDRIVE_TEST_DB_USER"), System.getenv("KDRIVE_TEST_DB_PASSWORD"));
        r.add("spring.datasource.url", () -> url == null ? "jdbc:h2:mem:rentalbalancedeposit;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1" : url);
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
    static class TimeConfig { @Bean @Primary FixtureClock rentalBalanceDepositClock() { return new FixtureClock(); } }

    @Autowired JdbcTemplate jdbc;
    @Autowired FixtureClock clock;
    @Autowired LicenseService licenses;
    @Autowired BookingService bookings;
    @Autowired DepositWorkflow workflow;
    @Autowired PaymentService payments;
    @Autowired VnpayGateway gateway;
    @Autowired RentalWorkflow rental;
    final Actor user = new Actor("demo-user", "USER", "Synthetic");
    final Actor staff = new Actor("demo-staff-dn", "STAFF", "Synthetic");

    @BeforeEach
    void setup() {
        CancelBoundaryTest.verifySafeIsolatedDatabase(jdbc);
        for (String t : List.of("payment_events", "payment_refunds", "payment_transactions", "reviews", "incident_events", "incident_cases",
            "vehicle_handover_records", "invoice_items", "invoices", "contracts", "booking_status_history", "bookings"))
            jdbc.update("delete from " + t);
        jdbc.update("update vehicles set current_branch_id='dn',status='ACTIVE' where id='v1'");
        clock.value = Instant.parse("2026-10-23T03:00:00Z");
        var old = licenses.mine(user);
        licenses.save(user, new LicenseService.View(null, "SYNTHETIC-BALANCE-DEPOSIT", "VN_2025", "B", LocalDate.of(2035, 12, 31), false,
            "PENDING", old == null ? 0 : old.version()));
        LicensePhotoFixture.approved(licenses, user);
    }

    void receipt(String ref, long amount, String number) {
        var fields = new TreeMap<String, String>();
        fields.put("vnp_TmnCode", "TESTONLY"); fields.put("vnp_TxnRef", ref); fields.put("vnp_Amount", Long.toString(amount * 100));
        fields.put("vnp_TransactionNo", number); fields.put("vnp_PayDate", VnpayGateway.date(clock.instant()));
        fields.put("vnp_ResponseCode", "00"); fields.put("vnp_TransactionStatus", "00");
        fields.put("vnp_SecureHash", gateway.sign(VnpayGateway.canonical(fields)));
        workflow.notification(fields);
    }

    RentalBalanceService.Input input(long amount, String key, long version) {
        return new RentalBalanceService.Input(BigDecimal.valueOf(amount), "CASH", "PT-0001", key, version, true);
    }

    @Test
    void remainingRentIsTotalMinusTheAppliedDepositAndUnpaidDepositCannotBeRecorded() {
        var b = bookings.create(user, new BookingService.Input("v1", "dn", "dn", null, null, 1300000L, LocalDate.of(2026, 10, 26), LocalDate.of(2026, 10, 28)));
        assertEquals(390000, b.deposit().amount());
        assertEquals(910000, b.rentalBalance().dueAmount(), "quote/pending already shows total minus the deposit");
        var approved = (BookingService.View) workflow.approve(staff, b.id(), b.version());
        assertThrows(com.carrental.exception.DomainException.class, () -> bookings.recordRentalBalance(staff, b.id(), input(910000, "early", approved.version())),
            "PENDING: deposit not applied yet");

        var payment = payments.start(user, b.id(), "127.0.0.1");
        receipt(payment.transactionId(), 390000, "20001");
        var confirmed = bookings.list(user).getFirst();
        assertEquals("CONFIRMED", confirmed.status());
        assertEquals(910000, confirmed.rentalBalance().dueAmount());

        var whole = assertThrows(com.carrental.exception.DomainException.class, () -> bookings.recordRentalBalance(staff, b.id(), input(1300000, "k0", confirmed.version())));
        assertEquals(409, whole.status.value(), "the deposit is already part of the rent");
        var recorded = bookings.recordRentalBalance(staff, b.id(), input(910000, "k1", confirmed.version()));
        assertEquals("RECORDED", recorded.rentalBalance().status());
        assertEquals(910000, recorded.rentalBalance().recorded().amount());

        clock.value = Instant.parse("2026-10-26T03:00:00Z");
        rental.apply(staff, b.id(), TestActions.handover(recorded.version(), null, "Synthetic handover", true, false));
        assertEquals("IN_PROGRESS", bookings.list(user).getFirst().status());
        assertEquals(0, jdbc.queryForObject("select count(*) from payment_transactions where booking_id=? and amount=910000", Integer.class, b.id()),
            "the remaining rent never enters the deposit ledger");
    }
}
