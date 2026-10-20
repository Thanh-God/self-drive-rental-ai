package com.carrental.modules.ai.itinerary;

import com.carrental.exception.DomainException;
import com.carrental.modules.ai.itinerary.dto.ItineraryPreviewRequest;
import com.carrental.modules.ai.itinerary.dto.ItineraryPreviewResponse;
import com.carrental.modules.ai.itinerary.service.ItineraryPreviewService;
import com.carrental.modules.ai.itinerary.service.QwenItinerarySequencePlanner;
import com.carrental.modules.ai.routing.OsrmRoutingClient;
import com.carrental.modules.location.service.LocationService;
import com.carrental.modules.location.service.LocationService.PublicView;
import com.carrental.modules.location.service.VisitMetadata;
import com.carrental.modules.location.service.VisitMetadata.*;
import com.carrental.security.Actor;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class ItineraryPreviewServiceTest {
    private final Actor user = new Actor("user-1", "USER", "Khách");
    private final LocationService locations = mock(LocationService.class);
    private final OsrmRoutingClient routing = mock(OsrmRoutingClient.class);
    private final ObjectMapper json = new ObjectMapper();
    private final Clock clock = Clock.fixed(Instant.parse("2026-10-20T08:00:00Z"), ZoneId.of("Asia/Ho_Chi_Minh"));

    private QwenItinerarySequencePlanner planner;
    private ItineraryPreviewService service;

    private PublicView locA;
    private PublicView locB;
    private PublicView locC;

    @BeforeEach
    void setUp() {
        planner = new QwenItinerarySequencePlanner(json, "qwen3:8b", false);
        service = new ItineraryPreviewService(locations, routing, planner, json, clock);

        var hoursA = new Hours(State.INTERVALS, List.of(new Interval("07:30", "17:00", false)));
        var metaA = new VisitMetadata("Asia/Ho_Chi_Minh", Map.of(DayOfWeek.TUESDAY, hoursA), Map.of(), 60,
            new Evidence("https://example.com/a", Instant.parse("2026-10-01T00:00:00Z")),
            new Evidence("https://example.com/a", Instant.parse("2026-10-01T00:00:00Z")));

        var hoursB = new Hours(State.INTERVALS, List.of(new Interval("07:00", "17:30", false)));
        var metaB = new VisitMetadata("Asia/Ho_Chi_Minh", Map.of(DayOfWeek.TUESDAY, hoursB), Map.of(), 90,
            new Evidence("https://example.com/b", Instant.parse("2026-10-01T00:00:00Z")),
            new Evidence("https://example.com/b", Instant.parse("2026-10-01T00:00:00Z")));

        var hoursC = new Hours(State.OPEN_24H, List.of());
        var metaC = new VisitMetadata("Asia/Ho_Chi_Minh", Map.of(DayOfWeek.TUESDAY, hoursC), Map.of(), 45,
            new Evidence("https://example.com/c", Instant.parse("2026-10-01T00:00:00Z")),
            new Evidence("https://example.com/c", Instant.parse("2026-10-01T00:00:00Z")));

        locA = new PublicView("loc-a", "cat-1", "Văn hóa", "Bảo tàng Điêu khắc Chăm", new BigDecimal("16.0601"), new BigDecimal("108.2235"), metaA);
        locB = new PublicView("loc-b", "cat-2", "Thắng cảnh", "Di tích Ngũ Hành Sơn", new BigDecimal("16.0041"), new BigDecimal("108.2638"), metaB);
        locC = new PublicView("loc-c", "cat-2", "Bãi biển", "Bãi biển Mỹ Khê", new BigDecimal("16.0620"), new BigDecimal("108.2470"), metaC);
    }

    @Test
    void successfulPreviewWithCalculatedTimelineAndFingerprint() {
        when(locations.activeCatalog(user)).thenReturn(List.of(locA, locB, locC));

        // 2026-10-20 là Thứ Ba
        LocalDate tripDate = LocalDate.parse("2026-10-20");
        ItineraryPreviewRequest req = new ItineraryPreviewRequest(tripDate, "08:00", "14:00", "loc-a", null);

        var leg1 = new OsrmRoutingClient.Leg(10000.0, 900.0); // 10km, 15 phút
        var leg2 = new OsrmRoutingClient.Leg(8000.0, 720.0);  // 8km, 12 phút
        var estimate = new OsrmRoutingClient.Estimate(OsrmRoutingClient.Status.VERIFIED, 18000.0, 1620.0, "OSM", List.of(leg1, leg2));

        when(routing.route(anyList())).thenReturn(estimate);

        ItineraryPreviewResponse res = service.preview(user, req);

        assertEquals(ItineraryPreviewResponse.Status.VALIDATED, res.status());
        assertEquals("loc-a", res.criteria().startLocationId());
        assertTrue(res.orderedLocationIds().size() >= 2);
        assertEquals("loc-a", res.orderedLocationIds().get(0));

        assertNotNull(res.fingerprint());
        assertFalse(res.fingerprint().isBlank());

        // Kiểm tra item 1: Bắt đầu lúc 08:00, dwell 60 phút -> rời lúc 09:00
        var item1 = res.items().get(0);
        assertEquals("08:00", item1.arrival());
        assertEquals("09:00", item1.departure());
        assertEquals(60, item1.dwellMinutes());
        assertEquals(0, item1.waitMinutes());
        assertEquals(15, item1.travelToNextMinutes());
        assertEquals(10000.0, item1.distanceToNextMeters());

        // Kiểm tra item 2: Đến lúc 09:15 (09:00 + 15 phút)
        var item2 = res.items().get(1);
        assertEquals("09:15", item2.arrival());
        assertEquals(90, item2.dwellMinutes());
        assertEquals(0, item2.waitMinutes());
        assertEquals("10:45", item2.departure());

        assertTrue(res.totals().totalDwellMinutes() > 0);
        assertTrue(res.totals().totalTravelMinutes() > 0);
        assertTrue(res.totals().totalDistanceMeters() > 0);
    }

    @Test
    void rejectsPastDateOrWindowLessThanTwoHours() {
        LocalDate pastDate = LocalDate.parse("2026-10-19");
        ItineraryPreviewRequest pastReq = new ItineraryPreviewRequest(pastDate, "08:00", "12:00", "loc-a", null);
        assertThrows(DomainException.class, () -> service.preview(user, pastReq));

        LocalDate validDate = LocalDate.parse("2026-10-21");
        ItineraryPreviewRequest shortReq = new ItineraryPreviewRequest(validDate, "08:00", "09:30", "loc-a", null);
        assertThrows(DomainException.class, () -> service.preview(user, shortReq));

        ItineraryPreviewRequest invertedReq = new ItineraryPreviewRequest(validDate, "14:00", "09:30", "loc-a", null);
        assertThrows(DomainException.class, () -> service.preview(user, invertedReq));
    }

    @Test
    void returnsNeedsDataWhenStartLocationHasNoMetadata() {
        PublicView unverified = new PublicView("loc-x", "cat-1", "Loại", "Điểm chưa kiểm chứng", new BigDecimal("16.0"), new BigDecimal("108.0"), null);
        when(locations.activeCatalog(user)).thenReturn(List.of(unverified, locB));

        LocalDate validDate = LocalDate.parse("2026-10-20");
        ItineraryPreviewRequest req = new ItineraryPreviewRequest(validDate, "08:00", "12:00", "loc-x", null);

        var res = service.preview(user, req);
        assertEquals(ItineraryPreviewResponse.Status.NEEDS_DATA, res.status());
        assertNull(res.fingerprint());
    }

    @Test
    void returnsNoFeasiblePlanWhenOsrmHasNoRoute() {
        when(locations.activeCatalog(user)).thenReturn(List.of(locA, locB));
        LocalDate validDate = LocalDate.parse("2026-10-20");
        ItineraryPreviewRequest req = new ItineraryPreviewRequest(validDate, "08:00", "12:00", "loc-a", null);

        when(routing.route(anyList())).thenReturn(new OsrmRoutingClient.Estimate(OsrmRoutingClient.Status.NO_ROUTE, null, null, "OSM"));

        var res = service.preview(user, req);
        assertEquals(ItineraryPreviewResponse.Status.NO_FEASIBLE_PLAN, res.status());
        assertTrue(res.notices().get(0).contains("Không tìm được tuyến đường lái xe"));
    }

    @Test
    void returnsNoFeasiblePlanWhenTimeExceedsEndTime() {
        when(locations.activeCatalog(user)).thenReturn(List.of(locA, locB));
        LocalDate validDate = LocalDate.parse("2026-10-20");
        // Giờ bắt đầu 08:00, dwell 60, đi 90 phút (đến 10:30), dwell 90 phút -> 12:00 vượt quá endTime 11:00
        ItineraryPreviewRequest req = new ItineraryPreviewRequest(validDate, "08:00", "11:00", "loc-a", null);

        var leg1 = new OsrmRoutingClient.Leg(30000.0, 5400.0); // 90 phút
        when(routing.route(anyList())).thenReturn(new OsrmRoutingClient.Estimate(OsrmRoutingClient.Status.VERIFIED, 30000.0, 5400.0, "OSM", List.of(leg1)));

        var res = service.preview(user, req);
        assertEquals(ItineraryPreviewResponse.Status.NO_FEASIBLE_PLAN, res.status());
        assertTrue(res.notices().get(0).contains("vượt quá giờ kết thúc hành trình"));
    }

    @Test
    void nonUserActorIsRejected() {
        Actor staff = new Actor("s", "STAFF", "Nhân viên");
        LocalDate validDate = LocalDate.parse("2026-10-20");
        ItineraryPreviewRequest req = new ItineraryPreviewRequest(validDate, "08:00", "12:00", "loc-a", null);
        assertThrows(DomainException.class, () -> service.preview(staff, req));
    }
}
