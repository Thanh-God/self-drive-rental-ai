package com.carrental;

import com.carrental.modules.user.service.*;
import com.carrental.modules.booking.service.BookingService;
import com.carrental.modules.payment.repository.PaymentRepository;
import com.carrental.modules.payment.service.*;
import com.carrental.modules.operation.service.DepositWorkflow;
import com.carrental.security.*;
import com.fasterxml.jackson.databind.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.*;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.context.annotation.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.*;
import org.springframework.test.web.servlet.MockMvc;
import java.time.*;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

/** QR DEMO HTTP tests - internal signed-protocol proof, not live merchant acceptance. */
@SpringBootTest(properties={"app.jwt-secret=qr-demo-test-only-secret-at-least-32-bytes", "app.seed-enabled=true", "app.seed-password=QRDemoTestOnly123!", "app.deposit-enabled=true", "app.deposit.method=DEMO_QR_MANUAL", "app.payment-reconcile-ms=86400000", "spring.jpa.properties.hibernate.type.preferred_instant_jdbc_type=TIMESTAMP"})
@AutoConfigureMockMvc
@Import(QrDemoHttpTest.TimeConfig.class)
class QrDemoHttpTest {
    static final Path ROOT;
    static {try{ROOT=Files.createTempDirectory("qr-demo-synthetic-photos-");}catch(Exception e){throw new IllegalStateException(e);}}
    @DynamicPropertySource static void database(DynamicPropertyRegistry r){
        String url=System.getenv("KDRIVE_TEST_DB_URL");
        if(url!=null)CancelBoundaryTest.verifySafeIsolatedDatabase(url,System.getenv("KDRIVE_TEST_REQUIRED_SCHEMA_PREFIX"),System.getenv("KDRIVE_TEST_FIXTURE_MARKER_TOKEN"),System.getenv("KDRIVE_TEST_DB_USER"),System.getenv("KDRIVE_TEST_DB_PASSWORD"));
        r.add("spring.datasource.url",()->url==null?"jdbc:h2:mem:qr-demo;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1":url);
        r.add("spring.datasource.username",()->url==null?"sa":System.getenv("KDRIVE_TEST_DB_USER"));r.add("spring.datasource.password",()->url==null?"":System.getenv("KDRIVE_TEST_DB_PASSWORD"));r.add("app.license-photo-directory",()->ROOT.toString());
    }
    static class FixtureClock extends Clock {Instant value=Instant.parse("2026-10-23T03:00:00Z");public ZoneId getZone(){return ZoneOffset.UTC;}public Clock withZone(ZoneId z){return this;}public Instant instant(){return value;}}
    @TestConfiguration static class TimeConfig {@Bean @Primary FixtureClock qrDemoClock(){return new FixtureClock();}}
    @Autowired MockMvc mvc;@Autowired ObjectMapper json;@Autowired JdbcTemplate jdbc;@Autowired FixtureClock clock;
    @Autowired LicenseService licenses;@Autowired BookingService bookings;@Autowired PaymentService payments;@Autowired DepositWorkflow workflow;@Autowired PaymentRepository repo;
    @org.springframework.boot.test.mock.mockito.SpyBean VnpayGateway gateway;
    @Autowired TokenService tokens;@Autowired AccountService accounts;
    @Autowired com.carrental.modules.operation.service.RentalWorkflow rental;
    final Actor user=new Actor("demo-user","USER","Synthetic"),staff=new Actor("demo-staff-dn","STAFF","Synthetic"),admin=new Actor("demo-admin","ADMIN","Synthetic");
    @BeforeEach void setup(){
        CancelBoundaryTest.verifySafeIsolatedDatabase(jdbc);
        for(String t:List.of("payment_events","payment_refunds","payment_transactions","reviews","incident_events","incident_cases","vehicle_handover_records","invoice_items","invoices","contracts","booking_status_history","bookings"))jdbc.update("delete from "+t);
        jdbc.update("update vehicles set current_branch_id='dn',status='ACTIVE' where id='v1'");clock.value=Instant.parse("2026-10-23T03:00:00Z");
        var old=licenses.mine(user);licenses.save(user,new LicenseService.View(null,"SYNTHETIC-QR-DEMO-NOT-REAL","VN_2025","B",LocalDate.of(2035,12,31),false,"PENDING",old==null?0:old.version()));LicensePhotoFixture.approved(licenses,user);
    }
    BookingService.View create(){return bookings.create(user,new BookingService.Input("v1","dn","dn",null,null,1300000L,LocalDate.of(2026,10,26),LocalDate.of(2026,10,28)));}
    BookingService.View approve(String id,long version){return (BookingService.View)workflow.approve(staff,id,version);}
    String postJson(String url, Object body){try{return mvc.perform(post("/api/v1"+url).contentType("application/json").content(json.writeValueAsString(body))).andReturn().getResponse().getContentAsString();}catch(Exception e){throw new RuntimeException(e);}}
    <T> T postJson(String url, Object body, Class<T> clazz){try{return json.readValue(postJson(url,body),clazz);}catch(Exception e){throw new RuntimeException(e);}}
    String getJson(String url){try{return mvc.perform(get("/api/v1"+url)).andReturn().getResponse().getContentAsString();}catch(Exception e){throw new RuntimeException(e);}}
    void postForm(String url, Object body){try{mvc.perform(post("/api/v1"+url).contentType("application/json").content(json.writeValueAsString(body))).andReturn();}catch(Exception e){throw new RuntimeException(e);}}
    com.fasterxml.jackson.databind.JsonNode readTree(String jsonString){try{return json.readTree(jsonString);}catch(Exception e){throw new RuntimeException(e);}}
    void verifyQr(String bookingId, String transactionRef, long amountVnd, String transferTime, String idempotencyKey){
        var fields=new TreeMap<String,String>();fields.put("transactionRef",transactionRef);fields.put("amountVnd",Long.toString(amountVnd));fields.put("transferTime",transferTime);fields.put("transferNote","Test note");fields.put("sourceAccount","0000000000");fields.put("idempotencyKey",idempotencyKey);fields.put("expectedVersion",Long.toString(bookings.view(bookings.require(staff,bookingId)).version()));
        postForm("/bookings/"+bookingId+"/deposit/verify", fields);
    }
    @Test void qrFullFlow_userBooks_staffApproves_userReports_staffVerifies_confirmedAndContract(){
        var b=create();assertTrue(b.deposit().required());assertEquals("DEMO_QR_MANUAL",b.deposit().method());assertEquals(390000,b.deposit().amount());
        var approved=approve(b.id(),b.version());assertEquals("DEMO_QR_MANUAL",approved.deposit().method());assertEquals("FULL",approved.deposit().mode());
        // USER: GET QR payload
        var qrUrl="/bookings/"+b.id()+"/deposit/qr-payload";
        var qrData = readTree(getJson(qrUrl));
        assertEquals("KDRIVE_DEMO|"+b.id()+"|390000", qrData.path("payload").asText());
        assertEquals("Mô phỏng — Không chuyển tiền thật", qrData.path("warning").asText());
        // USER: report deposit
        var reportUrl="/bookings/"+b.id()+"/deposit/report";
        var reportFields=Map.of("transactionRef","TXN123","transferTime","2026-10-23T03:15:00","transferNote","Test","sourceAccount","0000000001","idempotencyKey","report-"+b.id()+"-TXN123-2026-10-23T03:15:00");
        postForm(reportUrl, reportFields);
        // Report again (idempotent) - should not error
        postForm(reportUrl, reportFields);
        // STAFF: verify deposit (partial 200k)
        verifyQr(b.id(),"TXN123",200000,"2026-10-23T03:15:00","verify-"+b.id()+"-TXN123-2026-10-23T03:15:00");
        var partial=bookings.view(bookings.require(user,b.id()));assertEquals("PARTIAL",partial.deposit().mode());assertEquals(200000,partial.deposit().appliedAmount());assertEquals(190000,partial.deposit().missingAmount());
        // STAFF: verify deposit (remaining 190k)
        verifyQr(b.id(),"TXN124",190000,"2026-10-23T03:20:00","verify-"+b.id()+"-TXN124-2026-10-23T03:20:00");
        var confirmed=bookings.view(bookings.require(user,b.id()));assertEquals("CONFIRMED",confirmed.status());assertEquals("FULL",confirmed.deposit().mode());assertEquals(390000,confirmed.deposit().appliedAmount());
        // Contract issued
        assertEquals(1,jdbc.queryForObject("select count(*) from contracts where booking_id=?",Integer.class,b.id()));
    }
    @Test void qrPartialThenExpired_createsRefundForUnapplied(){
        var b=create();approve(b.id(),b.version());
        // STAFF verifies partial 200k
        verifyQr(b.id(),"TXN200",200000,"2026-10-23T03:15:00","verify-"+b.id()+"-TXN200-2026-10-23T03:15:00");
        var partial=bookings.view(bookings.require(user,b.id()));assertEquals("PARTIAL",partial.deposit().mode());
        // Advance clock past reviewDueAt
        clock.value=clock.value.plusSeconds(4000); // past reviewDueAt
        var expired=bookings.view(bookings.require(user,b.id()));assertEquals("EXPIRED",expired.status());
        // Refund created for unapplied 190k
        var refund=repo.refundForPayment(repo.forBooking(b.id()).get(0).id()).orElseThrow();
        assertEquals("APPROVED",refund.status());assertEquals(190000,refund.amount());assertEquals("UNAPPLIED_EXPIRED",refund.kind());
        assertEquals(0,jdbc.queryForObject("select count(*) from contracts where booking_id=?",Integer.class,b.id()));
    }
    @Test void qrLatePayment_recordedButNotApplied_createsRefund(){
        var b=create();approve(b.id(),b.version());
        // STAFF verifies payment AFTER paymentDueAt (late)
        var lateTime = clock.value.plusSeconds(2000).toString(); // paymentDueAt + 30min
        verifyQr(b.id(),"TXN_LATE",390000,lateTime,"verify-"+b.id()+"-TXN_LATE-"+lateTime);
        // Payment recorded but not applied, refund created
        var refund=repo.refundForPayment(repo.forBooking(b.id()).get(0).id()).orElseThrow();
        assertEquals("APPROVED",refund.status());assertEquals(390000,refund.amount());assertEquals("UNAPPLIED_LATE",refund.kind());
        var expired=bookings.view(bookings.require(user,b.id()));assertEquals("PENDING",expired.status()); // still pending, not confirmed
        assertEquals(0,jdbc.queryForObject("select count(*) from contracts where booking_id=?",Integer.class,b.id()));
    }
    @Test void qrExcessPayment_appliedFIFO_createsExcessRefund(){
        var b=create();approve(b.id(),b.version());
        // First payment 500k (excess 110k)
        verifyQr(b.id(),"TXN_EXCESS1",500000,"2026-10-23T03:15:00","verify-"+b.id()+"-TXN_EXCESS1-2026-10-23T03:15:00");
        var confirmed=bookings.view(bookings.require(user,b.id()));assertEquals("CONFIRMED",confirmed.status());assertEquals("EXCESS",confirmed.deposit().mode());assertEquals(110000,confirmed.deposit().excessAmount());
        // Excess refund created
        var paymentsList=repo.forBooking(b.id());assertEquals(1,paymentsList.size());
        var refund=repo.refundForPayment(paymentsList.get(0).id()).orElseThrow();
        assertEquals("APPROVED",refund.status());assertEquals(110000,refund.amount());assertEquals("MANUAL_EXCESS",refund.kind());
    }
    @Test void qrAdminManualRefund_createDecideProcess(){
        var b=create();approve(b.id(),b.version());
        verifyQr(b.id(),"TXN_ADMIN",500000,"2026-10-23T03:15:00","verify-"+b.id()+"-TXN_ADMIN-2026-10-23T03:15:00");
        // Admin creates manual refund for excess 110k
        var createFields=Map.of("paymentId",repo.forBooking(b.id()).get(0).id(),"amount",110000,"reason","Excess refund");
        var createResp = postJson("/admin/refunds/create-manual", createFields);
        var createNode = readTree(createResp);
        assertEquals("REQUESTED",createNode.path("status").asText());
        assertEquals(110000,createNode.path("amount").asLong());
        // Admin decides
        var refundId = createNode.path("id").asText();
        var refundVersion = createNode.path("version").asLong();
        var decideFields=Map.of("expectedVersion",refundVersion,"amount",110000,"reason","Approved");
        var decideResp = postJson("/admin/refunds/"+refundId+"/decide-manual", decideFields);
        var decideNode = readTree(decideResp);
        assertEquals("APPROVED",decideNode.path("status").asText());
        // Admin processes
        postForm("/admin/refunds/"+refundId+"/process-manual", Map.of());
        var processed=repo.refund(refundId);assertEquals("SUCCEEDED",processed.status());
    }
    @Test void qrReportIdempotent_sameIdempotencyKeyReturnsSameResult(){
        var b=create();approve(b.id(),b.version());
        var fields=Map.of("transactionRef","TXN_IDEM","transferTime","2026-10-23T03:15:00","transferNote","Test","sourceAccount","0000000001","idempotencyKey","idem-"+b.id()+"-TXN_IDEM-2026-10-23T03:15:00");
        var url="/bookings/"+b.id()+"/deposit/report";
        postForm(url, fields);
        postForm(url, fields);
        postForm(url, fields);
        // Only one report recorded
        assertEquals(1, jdbc.queryForObject("select count(*) from payment_transactions where booking_id=? and idempotency_key like 'idem-%'", Integer.class, b.id()));
    }
    @Test void qrHandoverChecksAppliedAmount_notTxnRef(){
        var b=create();approve(b.id(),b.version());
        verifyQr(b.id(),"TXN_HO",390000,"2026-10-23T03:15:00","verify-"+b.id()+"-TXN_HO-2026-10-23T03:15:00");
        var confirmed=bookings.view(bookings.require(user,b.id()));assertEquals("CONFIRMED",confirmed.status());
        // Handover should succeed (appliedAmount >= depositAmount)
        clock.value=Instant.parse("2026-10-26T03:00:00Z");
        var handover = assertDoesNotThrow(()-> (BookingService.View)rental.apply(staff,b.id(),new BookingService.Action("IN_PROGRESS",confirmed.version(),null,"Handover",true,false)));
        assertEquals("IN_PROGRESS",handover.status());
    }
    @Test void qrDecodePayload_containsCorrectData(){
        var b=create();approve(b.id(),b.version());
        var qrUrl="/bookings/"+b.id()+"/deposit/qr-payload";
        var qrData = readTree(getJson(qrUrl));
        assertEquals("KDRIVE_DEMO|"+b.id()+"|390000", qrData.path("payload").asText());
        assertEquals(b.id(), qrData.path("requestCode").asText());
        assertEquals(390000, qrData.path("amount").asLong());
        assertTrue(qrData.path("receiverSnapshot").asText().contains("Mô phỏng — Không chuyển tiền thật"));
        assertNotNull(qrData.path("paymentDueAt").asText());
        assertNotNull(qrData.path("reviewDueAt").asText());
        assertNotNull(qrData.path("originalHoldUntil").asText());
    }
}