package com.carrental.modules.booking.service;
import com.carrental.modules.booking.entity.Booking;
import com.carrental.modules.booking.repository.BookingRepository;
import com.carrental.modules.vehicle.service.VehicleService;
import com.carrental.modules.vehicle.entity.Vehicle;
import com.carrental.modules.branch.service.BranchService;
import com.carrental.modules.user.service.*;
import com.carrental.security.Actor;
import com.carrental.exception.DomainException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;
import org.springframework.jdbc.core.JdbcTemplate;
import java.time.*;
import java.util.*;
@Service public class BookingService {
 private final BookingRepository repo;private final VehicleService vehicles;private final BranchService branches;
 private final LicenseService licenses;private final AccountService accounts;private final JdbcTemplate jdbc;private final Clock clock;
 public BookingService(BookingRepository r,VehicleService v,BranchService b,LicenseService l,AccountService a,JdbcTemplate j,Clock c){repo=r;vehicles=v;branches=b;licenses=l;accounts=a;jdbc=j;clock=c;}
 public record Input(String vehicleId,String pickupBranchId,String returnBranchId,Instant startAt,Instant endAt,Long expectedTotal){}
 public record View(String id,String userId,String vehicleId,String customerName,String vehicleName,String pickupBranchId,String returnBranchId,String pickupName,String returnName,String actualReturnBranchId,Instant startAt,Instant endAt,Instant expiresAt,String status,long dailyPrice,int rentalDays,long rentalTotal,long oneWayFee,long total,long version){}
 public View view(Booking b){return new View(b.id,b.userId,b.vehicleId,b.customerName,b.vehicleName,b.pickupBranchId,b.returnBranchId,b.pickupName,b.returnName,b.actualReturnBranchId,b.startAt,b.endAt,b.expiresAt,effective(b),b.dailyPrice,b.rentalDays,b.rentalTotal,b.oneWayFee,b.total,b.version);}
 public String effective(Booking b){return "PENDING".equals(b.status)&&!b.expiresAt.isAfter(clock.instant())?"EXPIRED":b.status;}
 public boolean canRead(Actor a,Booking b){return a.is("ADMIN")||(a.is("USER")&&b.userId.equals(a.id()))||(a.is("STAFF")&&(branches.assigned(a,b.pickupBranchId)||branches.assigned(a,b.returnBranchId)));}
 public Booking require(Actor a,String id){Booking b=repo.findById(id).orElseThrow(DomainException::missing);if(!canRead(a,b))throw DomainException.missing();return b;}
 public List<View> list(Actor a){return (a.is("USER")?repo.findByUserIdOrderByCreatedAtDesc(a.id()):repo.findAll()).stream().filter(b->canRead(a,b)).map(this::view).toList();}
 public List<String> bookingIdsForVehicle(String vehicleId){return repo.findByVehicleIdOrderByStartAtAsc(vehicleId).stream().map(b->b.id).toList();}
 public Object detail(Actor a,String id){
  Booking b=require(a,id);
  var result=new LinkedHashMap<String,Object>();result.put("booking",view(b));
  result.put("history",jdbc.queryForList("select previous_status,next_status,occurred_at,reason from booking_status_history where booking_id=? order by occurred_at",id));
  result.put("records",jdbc.queryForList("select kind,occurred_at,condition_note,maintenance from vehicle_handover_records where booking_id=? order by occurred_at",id));
  if(a.is("STAFF"))result.put("license",licenses.forBooking(b.userId));
  return result;
 }
 private SchedulePolicy.Slot slot(Booking b){return new SchedulePolicy.Slot(b.id,b.pickupBranchId,b.returnBranchId,b.startAt,b.endAt,b.status,b.expiresAt);}
 private void schedule(Vehicle v,Booking added,String excluded){
  var existing=repo.lockScheduleByVehicleId(v.id);
  var rows=new ArrayList<>(existing.stream().filter(b->!b.id.equals(excluded)).map(this::slot).toList());
  if(added!=null)rows.add(slot(added));SchedulePolicy.validate(v.currentBranchId,rows,clock.instant());
 }
 private Booking prepare(Actor a,Input i,Vehicle v){
  a.require("USER");Instant now=clock.instant();
  if(i.startAt()==null||i.endAt()==null||!i.startAt().isAfter(now)||!i.endAt().isAfter(i.startAt())||Duration.between(i.startAt(),i.endAt()).compareTo(Duration.ofDays(90))>0)throw DomainException.bad("Khoảng thuê phải ở tương lai, thời lượng dương và không quá 90 ngày.");
  if(!"ACTIVE".equals(v.status))throw DomainException.conflict("Xe không hoạt động.");
  licenses.eligible(a.id(),v.transmission,v.seats,i.endAt());
  Booking b=new Booking();b.userId=a.id();b.vehicleId=v.id;b.pickupBranchId=i.pickupBranchId();b.returnBranchId=i.returnBranchId();
  var route=branches.bookingRoute(i.pickupBranchId(),i.returnBranchId());
  b.pickupName=route.pickupName();b.returnName=route.returnName();
  b.oneWayFee=route.fee();b.startAt=i.startAt();b.endAt=i.endAt();b.createdAt=now;
  b.expiresAt=now.plus(Duration.ofHours(2)).isBefore(b.startAt)?now.plus(Duration.ofHours(2)):b.startAt;
  b.rentalDays=(int)Math.ceil(Duration.between(b.startAt,b.endAt).toMillis()/86400000.0);b.dailyPrice=v.dailyPrice;
  b.rentalTotal=Math.multiplyExact(b.dailyPrice,b.rentalDays);b.total=Math.addExact(b.rentalTotal,b.oneWayFee);
  b.customerName=accounts.profile(a.id()).fullName();b.vehicleName=v.name;b.status="PENDING";b.policyVersion="rental-2026-09-28";
  schedule(v,b,null);return b;
 }
 @Transactional public View quote(Actor a,Input i){return view(prepare(a,i,vehicles.lock(i.vehicleId())));}
 @Transactional public View create(Actor a,Input i){
  Booking b=prepare(a,i,vehicles.lock(i.vehicleId()));
  if(i.expectedTotal()==null||i.expectedTotal()!=b.total)throw DomainException.conflict("Giá đã thay đổi hoặc chưa xác nhận báo giá. Vui lòng kiểm tra lại.");
  repo.saveAndFlush(b);history(b,null,a,"Tạo yêu cầu thuê");return view(b);
 }
 public record Action(String next,long version,String reason,String condition,boolean licenseChecked,boolean maintenance){}
 @Transactional public Booking change(Actor a,String id,Action action){
  String vehicleId=repo.findVehicleIdById(id).orElseThrow(DomainException::missing);
  Vehicle vehicle=vehicles.lock(vehicleId);
  Booking b=repo.lock(id).orElseThrow(DomainException::missing);
  if(!canRead(a,b))throw DomainException.forbidden();
  if(b.version!=action.version())throw DomainException.conflict("Đơn đã thay đổi. Tải lại trước khi xử lý.");
  String old=effective(b),next=action.next();
  if(next==null)throw DomainException.bad("Thiếu trạng thái.");
  switch(next){
   case "CANCELLED" -> {
    if(!Set.of("PENDING","CONFIRMED").contains(old))throw DomainException.conflict("Không thể hủy ở trạng thái này.");
    if(a.is("USER")&&Duration.between(clock.instant(),b.startAt).compareTo(Duration.ofHours(24))<0)throw DomainException.bad("Cần liên hệ Staff khi còn dưới 24 giờ.");
    reason(action.reason());schedule(vehicle,null,b.id);
   }
   case "CONFIRMED","REJECTED" -> {
    branches.requireStaff(a,b.pickupBranchId);
    if(!"PENDING".equals(old))throw DomainException.conflict("Đơn không còn chờ xác nhận.");
    if("REJECTED".equals(next)){reason(action.reason());schedule(vehicle,null,b.id);}
    else {if(!"ACTIVE".equals(vehicle.status))throw DomainException.conflict("Xe không hoạt động.");licenses.eligible(b.userId,vehicle.transmission,vehicle.seats,b.endAt);schedule(vehicle,null,null);}
   }
   case "IN_PROGRESS" -> {
    branches.requireStaff(a,b.pickupBranchId);
    if(!"CONFIRMED".equals(old)||clock.instant().isBefore(b.startAt)||!clock.instant().isBefore(b.endAt))throw DomainException.conflict("Chỉ giao đơn đã xác nhận trong khoảng thuê; chưa hỗ trợ giao sớm/no-show.");
    if(!"ACTIVE".equals(vehicle.status)||!vehicle.currentBranchId.equals(b.pickupBranchId))throw DomainException.conflict("Xe không sẵn sàng tại chi nhánh nhận.");
    if(repo.lockScheduleByVehicleId(vehicle.id).stream().anyMatch(x->!x.id.equals(b.id)&&"IN_PROGRESS".equals(x.status)))throw DomainException.conflict("Xe còn đang được thuê.");
    if(!action.licenseChecked())throw DomainException.bad("Staff phải kiểm tra GPLX thực tế trước giao.");
    reason(action.condition());licenses.verify(b.userId,a,vehicle.transmission,vehicle.seats,b.endAt);
   }
   case "RETURNED" -> {
    branches.requireStaff(a,b.returnBranchId);if(!"IN_PROGRESS".equals(old))throw DomainException.conflict("Đơn chưa ở trạng thái đang thuê.");
    reason(action.condition());vehicle.currentBranchId=b.returnBranchId;b.actualReturnBranchId=b.returnBranchId;
    if(action.maintenance())vehicle.status="MAINTENANCE";
   }
   case "COMPLETED" -> {
    branches.requireStaff(a,b.returnBranchId);if(!"RETURNED".equals(old))throw DomainException.conflict("Cần nhận xe trước khi hoàn tất.");
   }
   default -> throw DomainException.bad("Chuyển trạng thái không được hỗ trợ.");
  }
  b.status=next;repo.flush();history(b,old,a,action.reason()!=null?action.reason():action.condition());return b;
 }
 private void reason(String text){if(text==null||text.isBlank()||text.length()>2000)throw DomainException.bad("Cần nội dung/lý do không rỗng, tối đa 2000 ký tự.");}
 private void history(Booking b,String old,Actor a,String reason){
  jdbc.update("insert into booking_status_history(id,booking_id,previous_status,next_status,actor_id,occurred_at,reason) values(?,?,?,?,?,?,?)",UUID.randomUUID().toString(),b.id,old,b.status,a.id(),java.sql.Timestamp.from(clock.instant()),reason);
 }
}
