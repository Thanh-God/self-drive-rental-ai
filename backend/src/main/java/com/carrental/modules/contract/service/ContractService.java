package com.carrental.modules.contract.service;
import com.carrental.modules.booking.entity.Booking;
import com.carrental.exception.DomainException;
import com.carrental.modules.booking.service.BookingService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.jdbc.core.JdbcTemplate;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.*;
@Service public class ContractService {
 /** Terms saved by contracts issued before L7 (terms_version terms-2026-09-28 or the deposit policy); kept for reference only. */
 public static final String TERMS="Người thuê chịu trách nhiệm đối với vi phạm và thiệt hại thuộc trách nhiệm của mình trong thời gian thuê, theo chứng cứ, căn cứ xử lý và thỏa thuận phù hợp. Yêu cầu bồi thường phải nêu thiệt hại, căn cứ trách nhiệm và khoản được bảo hiểm/bên khác chi trả. Không tự động khấu trừ cọc. Hợp đồng phục vụ đồ án, chưa là mẫu được thẩm định pháp lý.";
 private static final ZoneId VN=ZoneId.of("Asia/Ho_Chi_Minh");
 private final JdbcTemplate jdbc;private final ObjectMapper json;private final Clock clock;private final com.carrental.modules.booking.service.ReturnPolicy returnPolicies;
 private final ContractParties parties;private final String hotline;
 /** L8: when on, new contracts use the terms that need the customer's "Đồng ý" before handover; off issues the L7 terms. */
 @Value("${app.contract-acceptance-enabled:true}") boolean acceptanceEnabled=true;
 public ContractService(JdbcTemplate j,ObjectMapper m,Clock c,com.carrental.modules.booking.service.ReturnPolicy returnPolicies,ContractParties parties,
                        @Value("${app.ai-hotline:10008888}") String hotline){jdbc=j;json=m;clock=c;this.returnPolicies=returnPolicies;this.parties=parties;this.hotline=hotline;}

 /** Common facts of a booking at the moment the contract is issued. */
 private record Source(String id,String userId,String vehicleId,String pickupBranchId,String returnBranchId,String customer,String vehicle,String pickup,String returnName,
                       Instant startAt,Instant endAt,long rentalTotal,long oneWayFee,long total,String policyVersion,int rentalDays,
                       boolean depositRequired,long depositAmount,String depositPolicy,Object deposit,Object returnPolicy,boolean rentalBalancePolicy){}

 public void issue(Booking b){
  write(new Source(b.id,b.userId,b.vehicleId,b.pickupBranchId,b.returnBranchId,b.customerName,b.vehicleName,b.pickupName,b.returnName,b.startAt,b.endAt,
   b.rentalTotal,b.oneWayFee,b.total,b.policyVersion,b.rentalDays,b.depositRequired,b.depositAmount,b.depositPolicy,null,
   b.returnPolicyVersion!=null?returnPolicies.view(b.returnPolicyVersion,b.returnPolicySnapshot,b.returnPolicyAcceptedAt):null,b.rentalBalancePolicy!=null));
 }
 public void issueDeposit(BookingService.View b){
  write(new Source(b.id(),b.userId(),b.vehicleId(),b.pickupBranchId(),b.returnBranchId(),b.customerName(),b.vehicleName(),b.pickupName(),b.returnName(),b.startAt(),b.endAt(),
   b.rentalTotal(),b.oneWayFee(),b.total(),b.policyVersion(),b.rentalDays(),b.deposit().required(),b.deposit().amount(),b.deposit().policy(),b.deposit(),b.returnPolicy(),b.rentalBalance()!=null));
 }
 public Object get(String bookingId){return jdbc.queryForList("select id,issued_at,snapshot,terms_version,accepted_at from contracts where booking_id=?",bookingId);}

 /** L8: the customer accepts the contract once; a repeated press keeps the first time. Older contracts do not take an acceptance. */
 public void accept(String bookingId,Instant now){
  var rows=jdbc.queryForList("select terms_version,accepted_at from contracts where booking_id=? for update",bookingId);
  if(rows.isEmpty())throw DomainException.conflict("Hợp đồng chưa được phát hành.");
  if(!ContractTerms.acceptanceRequired((String)rows.get(0).get("terms_version")))throw DomainException.conflict("Hợp đồng này lập trước khi có bước đồng ý trên hệ thống; không cần bấm đồng ý.");
  if(rows.get(0).get("accepted_at")!=null)return;
  jdbc.update("update contracts set accepted_at=? where booking_id=? and accepted_at is null",java.sql.Timestamp.from(now),bookingId);
 }

 /** L8: handover waits until the customer has accepted a contract that requires it. */
 public void requireAcceptedForHandover(String bookingId){
  // R9: locking read so a handover that waited behind an acceptance sees the committed time, not its older snapshot.
  var rows=jdbc.queryForList("select terms_version,accepted_at from contracts where booking_id=? for update",bookingId);
  if(!rows.isEmpty()&&ContractTerms.acceptanceRequired((String)rows.get(0).get("terms_version"))&&rows.get(0).get("accepted_at")==null)
   throw DomainException.conflict("Khách chưa bấm Đồng ý hợp đồng trên hệ thống; chưa thể bàn giao xe.");
 }

 private void write(Source s){
  Instant issuedAt=clock.instant();
  var p=parties.find(s.userId(),s.vehicleId(),s.pickupBranchId(),s.returnBranchId());
  long deposit=s.depositRequired()?Math.max(0,Math.min(s.depositAmount(),s.total())):0;
  long remaining=s.depositRequired()?s.total()-deposit:s.total();
  var snapshot=new LinkedHashMap<String,Object>();
  snapshot.put("contractNumber","HĐ-"+issuedAt.atZone(VN).format(DateTimeFormatter.ofPattern("yyyyMMdd"))+"-"+s.id().replace("-","").substring(0,8).toUpperCase(Locale.ROOT));
  snapshot.put("issuedAt",issuedAt);
  var lessor=new LinkedHashMap<String,Object>();
  lessor.put("name",ContractTerms.LESSOR_NAME);lessor.put("representative","Nhân viên chi nhánh nhận xe");lessor.put("address",s.pickup()+(p.pickupAddress()!=null?" — "+p.pickupAddress():""));
  lessor.put("hotline",hotline);lessor.put("sample",true);
  snapshot.put("lessor",lessor);
  snapshot.put("customer",s.customer());snapshot.put("customerPhone",p.customerPhone());snapshot.put("customerEmail",p.customerEmail());
  if(p.licenseNumber()!=null){var l=new LinkedHashMap<String,Object>();l.put("number",p.licenseNumber());l.put("licenseClass",p.licenseClass());l.put("scheme",p.licenseScheme());snapshot.put("license",l);}
  snapshot.put("vehicle",s.vehicle());snapshot.put("vehiclePlate",p.vehiclePlate());snapshot.put("vehicleSeats",p.vehicleSeats());snapshot.put("vehicleTransmission",p.vehicleTransmission());
  snapshot.put("pickup",s.pickup());snapshot.put("pickupAddress",p.pickupAddress());snapshot.put("return",s.returnName());snapshot.put("returnAddress",p.returnAddress());
  snapshot.put("startAt",s.startAt());snapshot.put("endAt",s.endAt());snapshot.put("rentalDays",s.rentalDays());
  snapshot.put("rentalTotal",s.rentalTotal());snapshot.put("oneWayFee",s.oneWayFee());snapshot.put("total",s.total());
  if(s.depositRequired())snapshot.put("deposit",s.deposit()!=null?s.deposit():Map.of("required",true,"amount",s.depositAmount(),"policy",String.valueOf(s.depositPolicy())));
  snapshot.put("depositAmount",deposit);snapshot.put("remainingRent",remaining);
  snapshot.put("policyVersion",s.policyVersion());
  if(s.returnPolicy()!=null)snapshot.put("returnPolicy",s.returnPolicy());
  snapshot.put("articles",ContractTerms.articles(new ContractTerms.Facts(s.depositRequired(),deposit,s.depositPolicy(),remaining,s.rentalBalancePolicy(),s.returnPolicy()!=null,hotline,acceptanceEnabled)));
  snapshot.put("termsNote",ContractTerms.NOTE);
  try{jdbc.update("insert into contracts(id,booking_id,issued_at,snapshot,terms_version) values(?,?,?,?,?)",UUID.randomUUID().toString(),s.id(),java.sql.Timestamp.from(issuedAt),json.writeValueAsString(snapshot),acceptanceEnabled?ContractTerms.VERSION:ContractTerms.VERSION_L7);}
  catch(com.fasterxml.jackson.core.JsonProcessingException e){throw new IllegalStateException(e);}
 }
}
