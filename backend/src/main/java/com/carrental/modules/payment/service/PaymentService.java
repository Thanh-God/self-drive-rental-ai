package com.carrental.modules.payment.service;

import com.carrental.exception.DomainException;
import com.carrental.modules.booking.service.BookingService;
import com.carrental.modules.payment.repository.PaymentRepository;
import com.carrental.modules.payment.repository.PaymentRepository.*;
import com.carrental.security.Actor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;
import java.time.Clock;
import java.util.*;

@Service
public class PaymentService {
    private final PaymentRepository repo;
    private final BookingService bookings;
    private final PaymentSettings settings;
    private final VnpayGateway gateway;
    private final Clock clock;
    public PaymentService(PaymentRepository repo,BookingService bookings,PaymentSettings settings,VnpayGateway gateway,Clock clock){
        this.repo=repo;this.bookings=bookings;this.settings=settings;this.gateway=gateway;this.clock=clock;
    }
    private static String id(){return UUID.randomUUID().toString().replace("-","");}
    public static class AmountMismatch extends DomainException {
        public AmountMismatch(){super(org.springframework.http.HttpStatus.BAD_REQUEST,"Số tiền VNPAY không khớp giao dịch.");}
    }
    public record Session(String transactionId,String url,java.time.Instant expiresAt){}
    @Transactional public Session start(Actor actor,String bookingId,String ip){
        settings.requireNew();var b=bookings.requirePayable(actor,bookingId);
        for(var p:repo.forBooking(bookingId)){
            if(p.applied()||"SUCCEEDED".equals(p.status()))throw DomainException.conflict("Đang ghi nhận khoản cọc; vui lòng tải lại đơn.");
            if("UNKNOWN".equals(p.status())||("PENDING".equals(p.status())&&!p.expiresAt().isAfter(clock.instant())))throw DomainException.conflict("Cần đối soát giao dịch trước trước khi thanh toán lại.");
            if("PENDING".equals(p.status()))return new Session(p.id(),gateway.checkout(p,ip),p.expiresAt());
        }
        String ref=id();repo.createPayment(ref,bookingId,b.deposit().amount(),clock.instant(),b.expiresAt());
        var p=repo.payment(ref).orElseThrow();
        repo.event(bookingId,ref,"PAYMENT_CREATED","Tạo phiên VNPAY Sandbox",actor.id(),clock.instant(),"created:"+ref);
        return new Session(ref,gateway.checkout(p,ip),p.expiresAt());
    }
    public Object summary(Actor actor,String bookingId){
        var b=bookings.view(bookings.require(actor,bookingId));
        return Map.of("sandbox",true,"acceptingNew",settings.enabled&&settings.configured(),"deposit",b.deposit(),"payments",repo.forBooking(bookingId),"refunds",repo.refunds(bookingId),"events",repo.events(bookingId));
    }
    @Transactional(propagation=Propagation.REQUIRES_NEW) public Payment receive(VnpayGateway.Receipt r){
        var found=repo.payment(r.ref()).orElseThrow(DomainException::missing);
        bookings.depositLock(found.bookingId());var p=repo.lockPayment(r.ref());
        if(p.amount()!=r.amount())throw new AmountMismatch();
        if("SUCCEEDED".equals(p.status())){
            if(r.success()&&!Objects.equals(p.providerTransaction(),r.transaction()))throw DomainException.conflict("Tham chiếu thanh toán không nhất quán.");
            return p;
        }
        repo.receipt(p.id(),r.success()?"SUCCEEDED":"FAILED",r.transaction(),r.payDate());
        repo.event(p.bookingId(),p.id(),r.success()?"PAYMENT_RECEIVED":"PAYMENT_FAILED",r.success()?"VNPAY Sandbox xác minh đã nhận tiền":"VNPAY Sandbox trả kết quả thất bại",null,clock.instant(),"receipt:"+p.id()+":"+r.success());
        return repo.payment(p.id()).orElseThrow();
    }
    @Transactional public void queueUnappliedRefund(String paymentId){
        var found=repo.payment(paymentId).orElseThrow(DomainException::missing);bookings.depositLock(found.bookingId());var p=repo.lockPayment(paymentId);
        if(p.applied()||!"SUCCEEDED".equals(p.status()))return;
        queue(p,true,"UNAPPLIED","Tiền đến sau hạn/hủy hoặc đơn không thể xác nhận; hoàn toàn bộ.");
    }
    @Transactional(propagation=Propagation.MANDATORY) public void cancellation(BookingService.View b){
        for(var p:repo.forBooking(b.id()))if("SUCCEEDED".equals(p.status())){
            boolean full=!p.applied()||Set.of("BUSINESS","EARLY_USER").contains(Objects.toString(b.deposit().cancellationKind(),""));
            queue(p,full,Objects.toString(b.deposit().cancellationKind(),"CANCELLED"),full?"Đủ điều kiện hoàn toàn bộ cọc":"Admin quyết định hoàn cọc; bắt buộc lý do.");
        }
    }
    private void queue(Payment p,boolean full,String kind,String reason){
        if(repo.refundForPayment(p.id()).isPresent())return;
        repo.createRefund(id(),p,full?p.amount():0,full?"APPROVED":"REQUESTED",kind,reason,clock.instant());
        repo.event(p.bookingId(),p.id(),"REFUND_REQUESTED",reason,null,clock.instant(),"refund:"+p.id());
    }
    @Transactional public Object decide(Actor admin,String refundId,long version,long amount,String reason){
        admin.require("ADMIN");if(reason==null||reason.isBlank()||reason.length()>1000)throw DomainException.bad("Cần lý do hoàn tiền, tối đa 1000 ký tự.");
        var first=repo.refund(refundId);bookings.depositLock(first.bookingId());var r=repo.lockRefund(refundId);var p=repo.lockPayment(r.paymentId());
        if(!"SUCCEEDED".equals(p.status())||amount<0||amount>p.amount()-repo.reserved(p.id(),r.id()))throw DomainException.bad("Số tiền hoàn vượt tiền đã nhận.");
        repo.decide(r.id(),version,amount,reason,admin.id(),clock.instant());
        repo.event(p.bookingId(),p.id(),"REFUND_DECIDED",reason,admin.id(),clock.instant(),null);return repo.refund(r.id());
    }
    public Object admin(Actor actor){actor.require("ADMIN");return Map.of("refunds",repo.adminRefunds(),"unresolved",repo.unresolvedPayments(),"sandbox",true);}
}
