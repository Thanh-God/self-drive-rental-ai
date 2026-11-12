package com.carrental.modules.operation.service;
import com.carrental.modules.booking.service.BookingService;
import com.carrental.modules.contract.service.ContractService;
import com.carrental.modules.invoice.service.InvoiceService;
import com.carrental.modules.user.service.LicenseService;
import com.carrental.security.Actor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.UUID;
@Service public class RentalWorkflow {
 private final BookingService bookings;private final ContractService contracts;private final InvoiceService invoices;private final LicenseService licenses;private final JdbcTemplate jdbc;private final ObjectMapper json;private final java.time.Clock clock;
 @org.springframework.beans.factory.annotation.Autowired private com.carrental.modules.payment.service.PaymentService payments;
 @org.springframework.beans.factory.annotation.Autowired private PlatformTransactionManager transactionManager;
 public RentalWorkflow(BookingService b,ContractService c,InvoiceService i,LicenseService l,JdbcTemplate j,ObjectMapper m,java.time.Clock clk){bookings=b;contracts=c;invoices=i;licenses=l;jdbc=j;json=m;clock=clk;}
 public Object apply(Actor a,String id,BookingService.Action action){
  var transaction=new TransactionTemplate(transactionManager);
  // Only completion needs a fresh settlement read after waiting for the booking lock.
  // Preserve the existing transaction isolation for deposit/cancellation workflows.
  if("COMPLETED".equals(action.next()))transaction.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
  return transaction.execute(status -> applyLocked(a,id,action));
 }
 private Object applyLocked(Actor a,String id,BookingService.Action action){
  var b=bookings.change(a,id,action);
  if("IN_PROGRESS".equals(b.status))contracts.requireAcceptedForHandover(b.id); // L8: rolls back the handover when the customer has not accepted
  if(b.depositRequired&&java.util.Set.of("CANCELLED","REJECTED").contains(b.status))payments.cancellation(bookings.view(b));
  if("CONFIRMED".equals(b.status))contracts.issue(b);
  if("COMPLETED".equals(b.status))invoices.issue(b);
  if("IN_PROGRESS".equals(b.status)||"RETURNED".equals(b.status)){
   boolean handover="IN_PROGRESS".equals(b.status);String snapshot=null;
   try{if(handover)snapshot=json.writeValueAsString(licenses.forBooking(b.userId));}catch(com.fasterxml.jackson.core.JsonProcessingException e){throw new IllegalStateException(e);}
   var occurredAt = !handover && b.returnAssessment != null ? bookings.view(b).returnAssessment().actualReturnedAt() : clock.instant();
   jdbc.update("insert into vehicle_handover_records(id,booking_id,kind,actor_id,branch_id,occurred_at,condition_note,license_snapshot,maintenance,fuel_level,odometer_km) values(?,?,?,?,?,?,?,?,?,?,?)",UUID.randomUUID().toString(),b.id,handover?"HANDOVER":"RETURN",a.id(),handover?b.pickupBranchId:b.returnBranchId,java.sql.Timestamp.from(occurredAt),action.condition(),snapshot,action.maintenance(),action.fuelLevel(),action.odometerKm());
  }
  return bookings.view(b);
 }
 public Object contract(Actor a,String id){bookings.require(a,id);return contracts.get(id);}
 /** L8: only the booking's own customer accepts, while the booking is confirmed and not yet handed over. */
 public Object acceptContract(Actor a,String id){
  return new TransactionTemplate(transactionManager).execute(status->{
   // R9: lock vehicle -> booking like every status change, so a cancellation or handover in flight is either seen or waits.
   // Lock before loading the booking: an entity read earlier in this transaction would carry a stale version.
   bookings.lockDepositBooking(id);
   var b=bookings.require(a,id); // 404 for bookings the actor cannot read
   if(!"USER".equals(a.role())||!a.id().equals(b.userId))throw com.carrental.exception.DomainException.forbidden();
   if(!"CONFIRMED".equals(b.status))throw com.carrental.exception.DomainException.conflict("Chỉ đồng ý hợp đồng khi đơn đã xác nhận và chưa giao xe.");
   contracts.accept(id,clock.instant());
   return contracts.get(id);
  });
 }
 public Object invoice(Actor a,String id){bookings.require(a,id);return invoices.get(id);}
}
