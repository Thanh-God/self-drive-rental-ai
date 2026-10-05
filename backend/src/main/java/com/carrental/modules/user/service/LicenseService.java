package com.carrental.modules.user.service;
import com.carrental.modules.user.entity.DriverLicense;
import com.carrental.modules.user.repository.DriverLicenseRepository;
import com.carrental.exception.DomainException;
import com.carrental.security.Actor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.*;
@Service public class LicenseService {
 private final DriverLicenseRepository repo;private final java.time.Clock clock;
 public LicenseService(DriverLicenseRepository r,java.time.Clock c){repo=r;clock=c;}
 public record View(String id,String licenseNumber,String scheme,String licenseClass,LocalDate expiresOn,boolean automaticOnly,String status,long version){}
 public View view(DriverLicense d){return new View(d.id,d.licenseNumber,d.scheme,d.licenseClass,d.expiresOn,d.automaticOnly,d.status,d.version);}
 public View mine(Actor a){return repo.findByUserId(a.id()).map(this::view).orElse(null);}
 @Transactional public View save(Actor a,View i){
  a.require("USER");
  if(i.licenseNumber()==null||i.licenseNumber().isBlank()||i.licenseNumber().length()>40||i.licenseClass()==null||i.scheme()==null||!LicensePolicy.compatible(i.scheme(),i.licenseClass(),i.automaticOnly(),"AUTO",5,i.expiresOn(),clock.instant()))throw DomainException.bad("GPLX không nằm trong phạm vi ô tô con hỗ trợ hoặc đã hết hạn.");
  var d=repo.findByUserId(a.id()).map(old->repo.lock(old.id).orElseThrow()).orElseGet(DriverLicense::new);
  if(d.userId!=null&&d.version!=i.version())throw DomainException.conflict("GPLX đã thay đổi.");
  d.userId=a.id();d.licenseNumber=i.licenseNumber().strip();d.scheme=i.scheme();d.licenseClass=i.licenseClass();d.expiresOn=i.expiresOn();d.automaticOnly=i.automaticOnly();d.status="PENDING";d.checkedAt=null;d.checkedBy=null;
  return view(repo.saveAndFlush(d));
 }
 public DriverLicense eligible(String userId,String transmission,int seats,Instant through){
  var d=repo.findByUserId(userId).orElseThrow(()->DomainException.bad("Vui lòng khai báo GPLX trước khi đặt xe."));
  if("REJECTED".equals(d.status)||!LicensePolicy.compatible(d.scheme,d.licenseClass,d.automaticOnly,transmission,seats,d.expiresOn,through))throw DomainException.bad("GPLX không phù hợp xe hoặc không còn hiệu lực đến hết chuyến thuê.");
  return d;
 }
 @Transactional public View verify(String userId,Actor staff,String transmission,int seats,Instant through){
  staff.require("STAFF");var existing=repo.findByUserId(userId).orElseThrow(DomainException::missing);
  var d=repo.lock(existing.id).orElseThrow(DomainException::missing);eligible(userId,transmission,seats,through);
  d.status="VERIFIED";d.checkedBy=staff.id();d.checkedAt=clock.instant();repo.flush();return view(d);
 }
 public View forBooking(String userId){return repo.findByUserId(userId).map(this::view).orElse(null);}
}
