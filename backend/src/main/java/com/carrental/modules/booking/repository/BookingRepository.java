package com.carrental.modules.booking.repository;

import com.carrental.modules.booking.entity.Booking;
import org.springframework.data.jpa.repository.*;
import org.springframework.data.repository.query.Param;
import jakarta.persistence.LockModeType;

public interface BookingRepository extends JpaRepository<Booking, String> {
    java.util.List<Booking> findByVehicleIdOrderByStartAtAsc(String vehicleId);
    java.util.List<Booking> findByUserIdOrderByCreatedAtDesc(String userId);

    @Query("select e.vehicleId from Booking e where e.id = :id")
    java.util.Optional<String> findVehicleIdById(@Param("id") String id);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select e from Booking e where e.vehicleId = :vehicleId order by e.startAt asc")
    java.util.List<Booking> lockScheduleByVehicleId(@Param("vehicleId") String vehicleId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select e from Booking e where e.id = :id")
    java.util.Optional<Booking> lock(@Param("id") String id);
}
