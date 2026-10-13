package com.carrental;

import static org.junit.jupiter.api.Assertions.*;

import com.carrental.modules.branch.service.BranchService;
import com.carrental.modules.user.service.AccountService;
import com.carrental.security.TokenService;
import com.carrental.security.Actor;
import java.util.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
    "app.jwt-secret=branch-status-test-secret-at-least-32-bytes",
    "app.seed-enabled=true", "app.seed-password=BranchStatusTestOnly123!"
})
class BranchStatusHttpServerTest {
    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String url = System.getenv("KDRIVE_TEST_DB_URL");
        if (url != null && !url.isBlank()) {
            CancelBoundaryTest.verifySafeIsolatedDatabase(url,
                System.getenv("KDRIVE_TEST_REQUIRED_SCHEMA_PREFIX"),
                System.getenv("KDRIVE_TEST_FIXTURE_MARKER_TOKEN"),
                System.getenv("KDRIVE_TEST_DB_USER"), System.getenv("KDRIVE_TEST_DB_PASSWORD"));
        }
        registry.add("spring.datasource.url", () -> url == null || url.isBlank()
            ? "jdbc:h2:mem:branchstatus;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1" : url);
        registry.add("spring.datasource.username", () -> url == null || url.isBlank() ? "sa" : System.getenv("KDRIVE_TEST_DB_USER"));
        registry.add("spring.datasource.password", () -> url == null || url.isBlank() ? "" : System.getenv("KDRIVE_TEST_DB_PASSWORD"));
    }

    @Autowired TestRestTemplate http;
    @Autowired JdbcTemplate jdbc;
    @Autowired TokenService tokens;
    @Autowired AccountService accounts;
    @Autowired BranchService branches;
    String admin;
    String user;
    String staff;

    @BeforeEach void actors() {
        admin = "Bearer " + tokens.issue(accounts.require("demo-admin"));
        user = "Bearer " + tokens.issue(accounts.require("demo-user"));
        staff = "Bearer " + tokens.issue(accounts.require("demo-staff-dn"));
    }

    private ResponseEntity<Map> put(String id, Object input, String token) {
        return request(HttpMethod.PUT, "/api/v1/admin/branches/" + id + "/status", input, token);
    }

    private ResponseEntity<Map> request(HttpMethod method, String path, Object input, String token) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        if (token != null) headers.set("Authorization", token);
        return http.exchange(path, method, new HttpEntity<>(input, headers), Map.class);
    }

    private String create() {
        var result = request(HttpMethod.POST, "/api/v1/admin/branches",
            Map.of("name", "  A1 " + UUID.randomUUID() + "  ", "address", "  Test address  "), admin);
        assertEquals(HttpStatus.OK, result.getStatusCode()); // existing create contract
        assertEquals("ACTIVE", result.getBody().get("status"));
        assertEquals(0L, ((Number) result.getBody().get("version")).longValue());
        assertEquals("Test address", result.getBody().get("address"));
        return (String) result.getBody().get("id");
    }

    private long version(String id) {
        return jdbc.queryForObject("select version from branches where id=?", Long.class, id);
    }

    private List<Map<String, Object>> row(String id) {
        return jdbc.queryForList("select * from branches where id=?", id);
    }

    private ResponseEntity<Map> status(String id, String status, long version) {
        return put(id, Map.of("status", status, "expectedVersion", version), admin);
    }

    @Test void closeRenameReopenAndNoOpUseCurrentVersion() {
        String id = create();
        long initial = version(id);
        var closed = status(id, "INACTIVE", initial);
        assertEquals(HttpStatus.OK, closed.getStatusCode());
        assertEquals("INACTIVE", closed.getBody().get("status"));
        assertEquals(initial + 1, version(id));
        List<Map<String, Object>> publicList = http.getForObject("/api/v1/branches", List.class);
        assertEquals("INACTIVE", publicList.stream().filter(b -> id.equals(b.get("id"))).findFirst().orElseThrow().get("status"));
        var closedRow = row(id);
        var noop = status(id, "INACTIVE", initial + 1);
        assertEquals(HttpStatus.OK, noop.getStatusCode());
        assertEquals(initial + 1, ((Number) noop.getBody().get("version")).longValue());
        assertEquals(closedRow, row(id), "Same status at current version is a no-op");

        var rename = request(HttpMethod.PUT, "/api/v1/admin/branches/" + id,
            Map.of("name", " Renamed closed ", "address", " New address ", "version", initial + 1), admin);
        assertEquals(HttpStatus.OK, rename.getStatusCode());
        assertEquals("INACTIVE", rename.getBody().get("status"));
        assertEquals("Renamed closed", rename.getBody().get("name"));
        assertEquals("New address", rename.getBody().get("address"));
        assertEquals(initial + 2, version(id));

        assertEquals(HttpStatus.CONFLICT, status(id, "ACTIVE", initial + 1).getStatusCode());
        assertEquals("INACTIVE", jdbc.queryForObject("select status from branches where id=?", String.class, id));
        var reopened = status(id, "ACTIVE", initial + 2);
        assertEquals(HttpStatus.OK, reopened.getStatusCode());
        assertEquals("ACTIVE", reopened.getBody().get("status"));
        assertEquals(initial + 3, version(id));
        BranchService.BranchView listed = branches.list().stream().filter(b -> b.id().equals(id)).findFirst().orElseThrow();
        assertEquals("ACTIVE", listed.status());
        assertEquals(initial + 3, listed.version());
    }

    @Test void validationNotFoundPermissionsAndStaleRequestsDoNotWrite() {
        String id = create();
        var before = row(id);
        for (Object input : List.of(Map.of(), Map.of("status", "INACTIVE"),
            Map.of("expectedVersion", 0), Map.of("status", "CLOSED", "expectedVersion", 0),
            Map.of("status", "inactive", "expectedVersion", 0),
            Map.of("status", "", "expectedVersion", 0), Map.of("status", "INACTIVE", "expectedVersion", -1),
            Map.of("status", "INACTIVE", "expectedVersion", "invalid"))) {
            assertEquals(HttpStatus.BAD_REQUEST, put(id, input, admin).getStatusCode(), input.toString());
            assertEquals(before, row(id));
        }
        assertEquals(HttpStatus.NOT_FOUND, status("missing-" + UUID.randomUUID(), "INACTIVE", 0).getStatusCode());
        for (String token : List.of(user, staff)) {
            assertEquals(HttpStatus.FORBIDDEN, put(id, Map.of("status", "INACTIVE", "expectedVersion", 0), token).getStatusCode());
        }
        assertEquals(HttpStatus.UNAUTHORIZED, put(id, Map.of("status", "INACTIVE", "expectedVersion", 0), null).getStatusCode());
        assertEquals(before, row(id));
        assertEquals(HttpStatus.OK, status(id, "INACTIVE", 0).getStatusCode());
        var closed = row(id);
        var stale = status(id, "ACTIVE", 0);
        assertEquals(HttpStatus.CONFLICT, stale.getStatusCode());
        assertTrue(stale.getBody().toString().contains("Chi nhánh đã thay đổi"));
        assertEquals(closed, row(id));
        assertEquals(HttpStatus.CONFLICT, status(id, "INACTIVE", 0).getStatusCode(), "No-op still requires current version");
        assertEquals(closed, row(id));
    }

    @Test void closeAllBranchesWithoutMinimumAndRecover() {
        var initial = jdbc.queryForList("select id,status from branches order by id");
        assertFalse(initial.isEmpty());
        try {
            for (var branch : initial) {
                String id = (String) branch.get("id");
                assertEquals(HttpStatus.OK, status(id, "INACTIVE", version(id)).getStatusCode());
            }
            assertEquals(0L, jdbc.queryForObject("select count(*) from branches where status='ACTIVE'", Long.class));
            for (var branch : initial) {
                String id = (String) branch.get("id");
                assertEquals(HttpStatus.OK, status(id, "ACTIVE", version(id)).getStatusCode());
            }
            assertEquals((long) initial.size(), jdbc.queryForObject("select count(*) from branches where status='ACTIVE'", Long.class));
        } finally {
            for (var branch : initial) {
                String id = (String) branch.get("id");
                assertEquals(HttpStatus.OK, status(id, (String) branch.get("status"), version(id)).getStatusCode());
            }
        }
    }

    @Test void closeAndReopenPreserveExistingBusinessRowsAndSnapshots() {
        // Representative historical data on the isolated fixture; A2 tests workflow actions separately.
        String booking = UUID.randomUUID().toString();
        jdbc.update("insert into bookings(id,user_id,vehicle_id,pickup_branch_id,return_branch_id,start_at,end_at,created_at,expires_at,status,daily_price,rental_days,rental_total,one_way_fee,total,customer_name,vehicle_name,pickup_name,return_name,policy_version) values (?,'demo-user','v1','dn','dn','2026-10-01 08:00:00','2026-10-02 08:00:00','2026-09-30 08:00:00','2026-09-30 10:00:00','COMPLETED',100,1,100,0,100,'Historical renter','Historical vehicle','Snapshot pickup','Snapshot return','branch-test')", booking);
        String snapshot = "{\"branchName\":\"Original snapshot\"}";
        jdbc.update("insert into contracts(id,booking_id,issued_at,snapshot,terms_version) values (?,?,'2026-09-30 09:00:00',?,'branch-test')", UUID.randomUUID().toString(), booking, snapshot);
        jdbc.update("insert into invoices(id,booking_id,issued_at,total,snapshot) values (?,?,'2026-10-02 09:00:00',100,?)", UUID.randomUUID().toString(), booking, snapshot);
        Map<String, List<Map<String, Object>>> before = new LinkedHashMap<>();
        for (String table : List.of("vehicles", "branch_routes", "staff_branches", "bookings", "booking_status_history", "contracts", "invoices", "flyway_schema_history")) {
            before.put(table, businessRows(table));
        }
        String originalStatus = jdbc.queryForObject("select status from branches where id='dn'", String.class);
        try {
            assertEquals(HttpStatus.OK, status("dn", "INACTIVE", version("dn")).getStatusCode());
            for (var entry : before.entrySet()) assertEquals(entry.getValue(), businessRows(entry.getKey()), entry.getKey());
            assertTrue(branches.assigned(new Actor("demo-staff-dn", "STAFF", "Fixture staff"), "dn"));
            assertEquals(HttpStatus.OK, status("dn", "ACTIVE", version("dn")).getStatusCode());
            for (var entry : before.entrySet()) assertEquals(entry.getValue(), businessRows(entry.getKey()), entry.getKey());
        } finally {
            assertEquals(HttpStatus.OK, status("dn", originalStatus, version("dn")).getStatusCode());
        }
    }

    private List<Map<String, Object>> businessRows(String table) {
        String order = table.equals("staff_branches") ? "user_id,branch_id"
            : table.equals("flyway_schema_history") ? "installed_rank" : "id";
        return jdbc.queryForList("select * from " + table + " order by " + order);
    }
}
