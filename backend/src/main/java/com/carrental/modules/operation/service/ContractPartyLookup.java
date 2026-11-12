package com.carrental.modules.operation.service;

import com.carrental.modules.branch.service.BranchService;
import com.carrental.modules.contract.service.ContractParties;
import com.carrental.modules.user.service.AccountService;
import com.carrental.modules.user.service.LicenseService;
import com.carrental.modules.vehicle.service.VehicleService;
import org.springframework.stereotype.Component;

/** L7: reads the customer, licence, vehicle and branch facts a new contract copies, through the typed module services. */
@Component
public class ContractPartyLookup implements ContractParties {
    private final AccountService accounts;
    private final LicenseService licenses;
    private final VehicleService vehicles;
    private final BranchService branches;

    public ContractPartyLookup(AccountService accounts, LicenseService licenses, VehicleService vehicles, BranchService branches) {
        this.accounts = accounts; this.licenses = licenses; this.vehicles = vehicles; this.branches = branches;
    }

    @Override
    public Parties find(String userId, String vehicleId, String pickupBranchId, String returnBranchId) {
        var customer = accounts.profile(userId);
        var license = licenses.forBooking(userId);
        var vehicle = vehicles.get(vehicleId);
        String pickupAddress = branches.view(pickupBranchId).address();
        String returnAddress = pickupBranchId.equals(returnBranchId) ? pickupAddress : branches.view(returnBranchId).address();
        return new Parties(customer.phone(), customer.email(),
            license != null ? license.licenseNumber() : null, license != null ? license.licenseClass() : null, license != null ? license.scheme() : null,
            vehicle.plate, vehicle.seats, vehicle.transmission, pickupAddress, returnAddress);
    }
}
