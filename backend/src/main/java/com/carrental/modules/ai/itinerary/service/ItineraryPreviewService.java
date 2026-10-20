package com.carrental.modules.ai.itinerary.service;

import com.carrental.exception.DomainException;
import com.carrental.modules.ai.itinerary.dto.ItineraryPreviewRequest;
import com.carrental.modules.ai.itinerary.dto.ItineraryPreviewResponse;
import com.carrental.modules.ai.itinerary.dto.ItineraryPreviewResponse.*;
import com.carrental.modules.ai.routing.OsrmRoutingClient;
import com.carrental.modules.location.service.CatalogRevision;
import com.carrental.modules.location.service.LocationService;
import com.carrental.modules.location.service.LocationService.PublicView;
import com.carrental.modules.location.service.VisitMetadata;
import com.carrental.modules.location.service.VisitMetadata.Interval;
import com.carrental.modules.location.service.VisitMetadata.State;
import com.carrental.security.Actor;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.*;
import org.springframework.stereotype.Service;

@Service
public class ItineraryPreviewService {
    private final LocationService locationService;
    private final OsrmRoutingClient osrmRoutingClient;
    private final QwenItinerarySequencePlanner sequencePlanner;
    private final ObjectMapper json;
    private final Clock clock;

    public ItineraryPreviewService(
            LocationService locationService,
            OsrmRoutingClient osrmRoutingClient,
            QwenItinerarySequencePlanner sequencePlanner,
            ObjectMapper json,
            Clock clock) {
        this.locationService = locationService;
        this.osrmRoutingClient = osrmRoutingClient;
        this.sequencePlanner = sequencePlanner;
        this.json = json;
        this.clock = clock;
    }

    public ItineraryPreviewResponse preview(Actor actor, ItineraryPreviewRequest request) {
        actor.require("USER");
        validateRequest(request);

        LocalDate today = LocalDate.now(clock);
        if (request.tripDate().isBefore(today)) {
            throw DomainException.bad("Ngày hành trình không được ở trong quá khứ.");
        }
        if (request.tripDate().isAfter(today.plusDays(90))) {
            throw DomainException.bad("Ngày hành trình chỉ được lên lịch trong vòng 90 ngày tới.");
        }

        LocalTime startTime = request.parsedStartTime();
        LocalTime endTime = request.parsedEndTime();
        if (!startTime.isBefore(endTime)) {
            throw DomainException.bad("Giờ bắt đầu phải trước giờ kết thúc.");
        }

        int availableWindowMinutes = (endTime.getHour() * 60 + endTime.getMinute()) - (startTime.getHour() * 60 + startTime.getMinute());
        if (availableWindowMinutes < 120) {
            throw DomainException.bad("Thời gian hành trình tối thiểu phải từ 2 giờ (120 phút).");
        }

        List<PublicView> catalog = locationService.activeCatalog(actor);
        PublicView startLocation = catalog.stream()
            .filter(l -> l.id().equals(request.startLocationId()))
            .findFirst()
            .orElseThrow(() -> DomainException.bad("Địa điểm bắt đầu không tồn tại trong danh mục hoạt động."));

        CriteriaInfo criteria = new CriteriaInfo(
            request.tripDate().toString(),
            request.startTime(),
            request.endTime(),
            startLocation.id(),
            startLocation.name(),
            request.preferredCategoryId()
        );

        // Kiểm tra startLocation có metadata và có mở cửa ngày đó không
        if (startLocation.metadata() == null || startLocation.metadata().durationMinutes() == null) {
            return needsData(criteria, List.of("Địa điểm bắt đầu thiếu thông tin lịch trình hoặc thời lượng tham quan được kiểm chứng."));
        }

        var startHours = startLocation.metadata().hoursOn(request.tripDate());
        if (startHours.state() == State.CLOSED || startHours.state() == State.UNKNOWN) {
            return noFeasiblePlan(criteria, List.of(startLocation.id()),
                List.of("Địa điểm bắt đầu '" + startLocation.name() + "' đóng cửa hoặc chưa có lịch mở cửa vào ngày " + request.tripDate() + "."));
        }

        // Lọc candidate pool: ACTIVE, có metadata, thời lượng hợp lệ, mở cửa ngày đó
        List<PublicView> candidateViews = catalog.stream()
            .filter(l -> l.metadata() != null && l.metadata().durationMinutes() != null && l.metadata().durationMinutes() > 0)
            .filter(l -> {
                var h = l.metadata().hoursOn(request.tripDate());
                return h.state() == State.OPEN_24H || h.state() == State.INTERVALS;
            })
            .toList();

        if (candidateViews.size() < 2) {
            return needsData(criteria, List.of("Không đủ địa điểm có thông tin mở cửa hợp lệ để lập hành trình tối thiểu 2 điểm."));
        }

        // Ưu tiên theo preferredCategoryId nếu có
        List<PublicView> filteredCandidates = new ArrayList<>();
        filteredCandidates.add(startLocation);
        for (PublicView view : candidateViews) {
            if (!view.id().equals(startLocation.id())) {
                if (request.preferredCategoryId() != null && !request.preferredCategoryId().isBlank()
                        && view.categoryId().equals(request.preferredCategoryId())) {
                    filteredCandidates.add(view);
                }
            }
        }
        for (PublicView view : candidateViews) {
            if (!filteredCandidates.contains(view)) {
                filteredCandidates.add(view);
            }
        }
        if (filteredCandidates.size() > 8) {
            filteredCandidates = filteredCandidates.subList(0, 8);
        }

        // Quyết định targetCount điểm ghé (2 đến 4) dựa theo quỹ thời gian
        int targetCount = 2;
        if (availableWindowMinutes >= 360 && filteredCandidates.size() >= 4) {
            targetCount = 4;
        } else if (availableWindowMinutes >= 240 && filteredCandidates.size() >= 3) {
            targetCount = 3;
        }

        List<QwenItinerarySequencePlanner.Candidate> plannerCandidates = filteredCandidates.stream()
            .map(c -> new QwenItinerarySequencePlanner.Candidate(c.id(), c.name(), c.categoryName()))
            .toList();

        var planResult = sequencePlanner.planSequence(startLocation.id(), plannerCandidates, targetCount);
        List<String> orderedIds = planResult.orderedLocationIds();

        Map<String, PublicView> viewMap = new HashMap<>();
        for (PublicView v : filteredCandidates) {
            viewMap.put(v.id(), v);
        }
        List<PublicView> orderedLocations = orderedIds.stream().map(viewMap::get).toList();

        // Lấy định tuyến OSRM cho chuỗi điểm
        List<OsrmRoutingClient.Point> points = orderedLocations.stream()
            .map(l -> new OsrmRoutingClient.Point(l.latitude().doubleValue(), l.longitude().doubleValue()))
            .toList();

        var routeEstimate = osrmRoutingClient.route(points);
        if (routeEstimate.status() == OsrmRoutingClient.Status.NO_ROUTE) {
            return noFeasiblePlan(criteria, orderedIds, List.of("Không tìm được tuyến đường lái xe khả thi giữa các điểm tham quan đã chọn."));
        }
        if (routeEstimate.status() == OsrmRoutingClient.Status.UNAVAILABLE) {
            return unavailable(criteria, orderedIds, List.of("Dịch vụ định tuyến OSRM hiện không khả dụng."));
        }

        List<OsrmRoutingClient.Leg> legs = routeEstimate.legs();
        if (legs.size() != orderedLocations.size() - 1) {
            if (orderedLocations.size() == 2 && routeEstimate.distanceMeters() != null && routeEstimate.durationSeconds() != null) {
                legs = List.of(new OsrmRoutingClient.Leg(routeEstimate.distanceMeters(), routeEstimate.durationSeconds()));
            } else {
                List<OsrmRoutingClient.Leg> fetchedLegs = new ArrayList<>();
                boolean allLegsOk = true;
                for (int i = 0; i < points.size() - 1; i++) {
                    var pairRoute = osrmRoutingClient.route(List.of(points.get(i), points.get(i + 1)));
                    if (pairRoute.status() != OsrmRoutingClient.Status.VERIFIED) {
                        allLegsOk = false;
                        break;
                    }
                    fetchedLegs.add(new OsrmRoutingClient.Leg(pairRoute.distanceMeters(), pairRoute.durationSeconds()));
                }
                if (!allLegsOk || fetchedLegs.size() != orderedLocations.size() - 1) {
                    return noFeasiblePlan(criteria, orderedIds, List.of("Không thể xác định khoảng cách từng chặng giữa các điểm."));
                }
                legs = fetchedLegs;
            }
        }

        // Tính toán chi tiết lịch trình theo từng mốc thời gian
        LocalTime current = startTime;
        List<ScheduleItem> items = new ArrayList<>();
        List<Integer> dwellList = new ArrayList<>();
        List<Integer> waitList = new ArrayList<>();
        List<Integer> travelMinsList = new ArrayList<>();
        List<Double> distanceMetersList = new ArrayList<>();
        List<String> revisions = new ArrayList<>();

        for (int i = 0; i < orderedLocations.size(); i++) {
            PublicView loc = orderedLocations.get(i);
            revisions.add(computeRevision(loc));

            LocalTime arrival = current;
            int dwell = loc.metadata().durationMinutes();
            var hours = loc.metadata().hoursOn(request.tripDate());

            int wait = calculateWaitMinutes(arrival, dwell, hours);
            if (wait < 0) {
                return noFeasiblePlan(criteria, orderedIds,
                    List.of("Địa điểm '" + loc.name() + "' không có khung giờ mở cửa phù hợp cho thời điểm đến lúc " + arrival + "."));
            }

            int arrivalMins = arrival.getHour() * 60 + arrival.getMinute();
            int departureMins = arrivalMins + wait + dwell;
            if (departureMins >= 24 * 60) {
                return noFeasiblePlan(criteria, orderedIds,
                    List.of("Thời gian kết thúc tham quan tại '" + loc.name() + "' vượt quá trong ngày."));
            }

            LocalTime departure = LocalTime.of(departureMins / 60, departureMins % 60);
            if (departure.isAfter(endTime)) {
                return noFeasiblePlan(criteria, orderedIds,
                    List.of("Thời gian tham quan tại '" + loc.name() + "' kết thúc lúc " + departure
                        + ", vượt quá giờ kết thúc hành trình " + request.endTime() + "."));
            }

            Integer travelMinutes = null;
            Double travelDistanceMeters = null;
            if (i < orderedLocations.size() - 1) {
                OsrmRoutingClient.Leg leg = legs.get(i);
                travelMinutes = (int) Math.ceil(leg.durationSeconds() / 60.0);
                travelDistanceMeters = leg.distanceMeters();

                int nextArrivalMins = departureMins + travelMinutes;
                if (nextArrivalMins >= 24 * 60) {
                    return noFeasiblePlan(criteria, orderedIds, List.of("Thời gian di chuyển vượt quá trong ngày."));
                }
                current = LocalTime.of(nextArrivalMins / 60, nextArrivalMins % 60);
            }

            dwellList.add(dwell);
            waitList.add(wait);
            travelMinsList.add(travelMinutes);
            distanceMetersList.add(travelDistanceMeters);

            items.add(new ScheduleItem(
                i + 1,
                loc.id(),
                loc.name(),
                loc.categoryName(),
                loc.latitude().doubleValue(),
                loc.longitude().doubleValue(),
                arrival.toString(),
                departure.toString(),
                dwell,
                wait,
                travelMinutes,
                travelDistanceMeters,
                hours.state().name(),
                loc.metadata().hoursEvidence() != null ? loc.metadata().hoursEvidence().url() : null
            ));
        }

        int totalDwell = dwellList.stream().mapToInt(Integer::intValue).sum();
        int totalWait = waitList.stream().mapToInt(Integer::intValue).sum();
        int totalTravel = travelMinsList.stream().filter(Objects::nonNull).mapToInt(Integer::intValue).sum();
        double totalDistance = distanceMetersList.stream().filter(Objects::nonNull).mapToDouble(Double::doubleValue).sum();

        Totals totals = new Totals(totalDwell, totalWait, totalTravel, totalDistance, items.size());

        String fingerprint = ItineraryFingerprint.compute(
            criteria.tripDate(),
            criteria.startTime(),
            criteria.endTime(),
            criteria.startLocationId(),
            criteria.preferredCategoryId(),
            orderedIds,
            revisions,
            dwellList,
            waitList,
            travelMinsList,
            distanceMetersList
        );

        return new ItineraryPreviewResponse(
            Status.VALIDATED,
            criteria,
            orderedIds,
            items,
            totals,
            fingerprint,
            List.of()
        );
    }

    private static int calculateWaitMinutes(LocalTime arrival, int dwell, VisitMetadata.Hours hours) {
        if (hours.state() == State.OPEN_24H) {
            return 0;
        }
        if (hours.state() != State.INTERVALS || hours.intervals() == null || hours.intervals().isEmpty()) {
            return -1;
        }

        int arrivalMins = arrival.getHour() * 60 + arrival.getMinute();
        for (Interval interval : hours.intervals()) {
            int startMins = parseMinutes(interval.start());
            int endMins = parseMinutes(interval.end()) + (interval.nextDay() ? 1440 : 0);

            // Đến khi đang mở cửa
            if (arrivalMins >= startMins && arrivalMins < endMins) {
                if (arrivalMins + dwell <= endMins) {
                    return 0;
                }
            } else if (arrivalMins < startMins) {
                // Đến trước giờ mở cửa
                if (startMins + dwell <= endMins) {
                    return startMins - arrivalMins;
                }
            }
        }
        return -1;
    }

    private static int parseMinutes(String time) {
        LocalTime parsed = LocalTime.parse(time);
        return parsed.getHour() * 60 + parsed.getMinute();
    }

    private String computeRevision(PublicView view) {
        String metadataJson = "";
        if (view.metadata() != null) {
            try {
                metadataJson = json.writeValueAsString(view.metadata());
            } catch (Exception ignored) {}
        }
        return CatalogRevision.of(
            view.id(),
            view.categoryId(),
            view.name(),
            view.latitude().toPlainString(),
            view.longitude().toPlainString(),
            "ACTIVE",
            metadataJson
        );
    }

    private void validateRequest(ItineraryPreviewRequest request) {
        if (request == null) {
            throw DomainException.bad("Yêu cầu preview không được để trống.");
        }
        if (request.tripDate() == null) {
            throw DomainException.bad("Ngày hành trình không được để trống.");
        }
        if (request.startTime() == null || request.startTime().isBlank()) {
            throw DomainException.bad("Giờ bắt đầu không được để trống.");
        }
        if (request.endTime() == null || request.endTime().isBlank()) {
            throw DomainException.bad("Giờ kết thúc không được để trống.");
        }
        if (request.startLocationId() == null || request.startLocationId().isBlank()) {
            throw DomainException.bad("Địa điểm bắt đầu không được để trống.");
        }
    }

    private ItineraryPreviewResponse needsData(CriteriaInfo criteria, List<String> notices) {
        return new ItineraryPreviewResponse(Status.NEEDS_DATA, criteria, List.of(), List.of(),
            new Totals(0, 0, 0, 0.0, 0), null, notices);
    }

    private ItineraryPreviewResponse noFeasiblePlan(CriteriaInfo criteria, List<String> orderedIds, List<String> notices) {
        return new ItineraryPreviewResponse(Status.NO_FEASIBLE_PLAN, criteria, orderedIds, List.of(),
            new Totals(0, 0, 0, 0.0, 0), null, notices);
    }

    private ItineraryPreviewResponse unavailable(CriteriaInfo criteria, List<String> orderedIds, List<String> notices) {
        return new ItineraryPreviewResponse(Status.UNAVAILABLE, criteria, orderedIds, List.of(),
            new Totals(0, 0, 0, 0.0, 0), null, notices);
    }
}
