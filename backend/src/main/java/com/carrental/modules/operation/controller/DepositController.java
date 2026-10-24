package com.carrental.modules.operation.controller;

import com.carrental.exception.DomainException;
import com.carrental.modules.operation.service.DepositWorkflow;
import com.carrental.modules.payment.service.PaymentService;
import com.carrental.security.Actor;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.*;
import java.util.*;

@RestController
@RequestMapping("/api/v1")
public class DepositController {
    private final PaymentService payments;private final DepositWorkflow workflow;
    public DepositController(PaymentService payments,DepositWorkflow workflow){this.payments=payments;this.workflow=workflow;}
    public record Approval(long expectedVersion){}
    public record NoShow(long expectedVersion,boolean contacted,boolean notDelivered,String reason){}
    public record Decision(long expectedVersion,long amount,String reason){}
    @GetMapping("/bookings/{id}/deposit") public Object summary(@AuthenticationPrincipal Actor actor,@PathVariable String id){return payments.summary(actor,id);}
    @PostMapping("/bookings/{id}/deposit/approve") public Object approve(@AuthenticationPrincipal Actor actor,@PathVariable String id,@RequestBody Approval input){return workflow.approve(actor,id,input.expectedVersion());}
    @PostMapping("/bookings/{id}/deposit/session") public Object session(@AuthenticationPrincipal Actor actor,@PathVariable String id,HttpServletRequest request){return payments.start(actor,id,request.getRemoteAddr());}
    @PostMapping("/bookings/{id}/no-show") public Object noShow(@AuthenticationPrincipal Actor actor,@PathVariable String id,@RequestBody NoShow input){return workflow.noShow(actor,id,input.expectedVersion(),input.contacted(),input.notDelivered(),input.reason());}
    @GetMapping("/admin/payments") public Object admin(@AuthenticationPrincipal Actor actor){return payments.admin(actor);}
    @PostMapping("/admin/payments/{id}/reconcile") public void reconcile(@AuthenticationPrincipal Actor actor,@PathVariable String id){workflow.reconcile(actor,id);}
    @PostMapping("/admin/refunds/{id}/decide") public Object decide(@AuthenticationPrincipal Actor actor,@PathVariable String id,@RequestBody Decision input){return payments.decide(actor,id,input.expectedVersion(),input.amount(),input.reason());}
    @PostMapping("/admin/refunds/{id}/process") public void process(@AuthenticationPrincipal Actor actor,@PathVariable String id){workflow.processRefund(actor,id);}
    @PostMapping("/admin/refunds/{id}/reconcile") public void reconcileRefund(@AuthenticationPrincipal Actor actor,@PathVariable String id){workflow.reconcileRefund(actor,id);}
    @GetMapping("/payments/vnpay/ipn") public Object ipn(@RequestParam MultiValueMap<String,String> query){
        try{
            if(query.values().stream().anyMatch(v->v.size()!=1))throw DomainException.bad("Tham số bị lặp.");
            workflow.notification(query.toSingleValueMap());return Map.of("RspCode","00","Message","Confirmed");
        }catch(PaymentService.AmountMismatch e){return Map.of("RspCode","04","Message","Invalid amount");}
        catch(DomainException e){return Map.of("RspCode",e.status.value()==404?"01":"97","Message","Invalid notification");}
        catch(RuntimeException e){return Map.of("RspCode","99","Message","Retry reconciliation");}
    }
}
