package com.carrental;

import com.carrental.modules.booking.service.BookingService;

/**
 * L5 (Q3): handover and return now carry fuel (0–8 gauge steps) and odometer readings. Tests that only need a valid
 * handover/return use these synthetic readings; tests about the readings themselves pass their own values.
 */
final class TestActions {
    static final int HANDOVER_FUEL = 6;
    static final long HANDOVER_KM = 12000L;
    static final int RETURN_FUEL = 5;
    static final long RETURN_KM = 12150L;

    private TestActions() {}

    static BookingService.Action handover(long version, String reason, String condition, boolean licenseChecked, boolean maintenance) {
        return new BookingService.Action("IN_PROGRESS", version, reason, condition, licenseChecked, maintenance, null, null, null, HANDOVER_FUEL, HANDOVER_KM);
    }

    /** Same as the six-argument Action, with synthetic readings added only where the transition needs them. */
    static BookingService.Action forNext(String next, long version, String reason, String condition, boolean licenseChecked, boolean maintenance) {
        if ("IN_PROGRESS".equals(next)) return handover(version, reason, condition, licenseChecked, maintenance);
        if ("RETURNED".equals(next)) return returned(version, reason, condition, licenseChecked, maintenance);
        return new BookingService.Action(next, version, reason, condition, licenseChecked, maintenance);
    }

    /** HTTP body entries for the same readings (empty for other transitions). */
    static java.util.Map<String, Object> readings(String next) {
        if ("IN_PROGRESS".equals(next)) return java.util.Map.of("fuelLevel", HANDOVER_FUEL, "odometerKm", HANDOVER_KM);
        if ("RETURNED".equals(next)) return java.util.Map.of("fuelLevel", RETURN_FUEL, "odometerKm", RETURN_KM);
        return java.util.Map.of();
    }

    static BookingService.Action returned(long version, String reason, String condition, boolean licenseChecked, boolean maintenance) {
        return new BookingService.Action("RETURNED", version, reason, condition, licenseChecked, maintenance, null, null, null, RETURN_FUEL, RETURN_KM);
    }
}
