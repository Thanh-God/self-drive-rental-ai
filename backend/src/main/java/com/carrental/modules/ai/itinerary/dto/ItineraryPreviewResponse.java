package com.carrental.modules.ai.itinerary.dto;

import java.util.List;

public record ItineraryPreviewResponse(
    Status status,
    CriteriaInfo criteria,
    List<String> orderedLocationIds,
    List<ScheduleItem> items,
    Totals totals,
    String fingerprint,
    List<String> notices
) {
    public enum Status {
        VALIDATED,
        NEEDS_DATA,
        NO_FEASIBLE_PLAN,
        UNAVAILABLE
    }

    public record CriteriaInfo(
        String tripDate,
        String startTime,
        String endTime,
        String startLocationId,
        String startLocationName,
        String preferredCategoryId
    ) {}

    public record ScheduleItem(
        int sortOrder,
        String locationId,
        String locationName,
        String categoryName,
        double latitude,
        double longitude,
        String arrival,
        String departure,
        Integer dwellMinutes,
        Integer waitMinutes,
        Integer travelToNextMinutes,
        Double distanceToNextMeters,
        String hoursState,
        String hoursEvidenceUrl
    ) {}

    public record Totals(
        int totalDwellMinutes,
        int totalWaitMinutes,
        int totalTravelMinutes,
        double totalDistanceMeters,
        int locationCount
    ) {}
}
