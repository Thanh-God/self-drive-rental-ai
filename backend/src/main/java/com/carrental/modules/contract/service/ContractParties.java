package com.carrental.modules.contract.service;

/**
 * L7 (12/11/2026): facts the contract copies from other modules when it is issued. The contract module only depends on
 * booking, so the operation module implements this port with the typed user, vehicle and branch services.
 */
public interface ContractParties {
    record Parties(String customerPhone, String customerEmail, String licenseNumber, String licenseClass, String licenseScheme,
                   String vehiclePlate, int vehicleSeats, String vehicleTransmission, String pickupAddress, String returnAddress) {}

    Parties find(String userId, String vehicleId, String pickupBranchId, String returnBranchId);
}
